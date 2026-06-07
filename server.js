const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000; const GRID_SIZE = 40; const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;
let mapGrid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));

function buildDynamicWorldMatrices() {
    for (let i = 0; i < BLOCKS_COUNT; i++) {
        mapGrid[i][0] = 1; mapGrid[i][BLOCKS_COUNT - 1] = 1;
        mapGrid[0][i] = 1; mapGrid[BLOCKS_COUNT - 1][i] = 1;
    }
    for (let k = 0; k < 30; k++) {
        let wx = Math.floor(Math.random() * (BLOCKS_COUNT - 6)) + 3;
        let wy = Math.floor(Math.random() * (BLOCKS_COUNT - 6)) + 3;
        let horizontal = Math.random() > 0.5;
        for (let l = 0; l < 5; l++) {
            if (horizontal) mapGrid[wx + l][wy] = 1; else mapGrid[wx][wy + l] = 1;
        }
    }
    for (let r = 0; r < 8; r++) {
        let rx = Math.floor(Math.random() * (BLOCKS_COUNT - 10)) + 5;
        let ry = Math.floor(Math.random() * (BLOCKS_COUNT - 10)) + 5;
        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) { mapGrid[rx + x][ry + y] = 2; }
        }
    }
}
buildDynamicWorldMatrices();

let gameState = { players: {}, bullets: [], fields: [], scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180, gamemode: 'TDM' };
let matchmakingQueue = [];

function getRequiredPlayersCount(clashType, gamemode) {
    if (gamemode === 'ZOMBIE') return 3;
    if (clashType === '1v1') return 2;
    if (clashType === '2v2') return 4;
    if (clashType === '3v3') return 6;
    return 4;
}

function checkServerWallCollision(x, y, radius) {
    const rBuffer = radius - 0.5;
    let startX = Math.max(0, Math.floor((x - rBuffer) / GRID_SIZE));
    let endX = Math.min(BLOCKS_COUNT - 1, Math.floor((x + rBuffer) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - rBuffer) / GRID_SIZE));
    let endY = Math.min(BLOCKS_COUNT - 1, Math.floor((y + rBuffer) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (mapGrid[gx] && mapGrid[gx][gy] !== 0) {
                let wX = gx * GRID_SIZE; let wY = gy * GRID_SIZE;
                if (x + rBuffer > wX && x - rBuffer < wX + GRID_SIZE && y + rBuffer > wY && y - rBuffer < wY + GRID_SIZE) return true;
            }
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.on('joinQueue', (data) => {
        let pProfile = {
            id: socket.id, name: data.name, device: data.device, clashType: data.clashType, gamemode: data.gamemode,
            x: 200 + Math.random() * 1600, y: 200 + Math.random() * 1600,
            hp: 100, team: matchmakingQueue.length % 2 === 0 ? 'red' : 'blue', isZombie: false,
            loadout: data.loadout.slice(0,5), abilities: data.abilities.slice(0,3),
            activeWeaponIndex: 0, ammo: 30, isReloading: false,
            ability1ReadyAt: 0, ability2ReadyAt: 0, ability3ReadyAt: 0,
            stimActiveUntil: 0, cloakActive: false, phaseActive: false, positionAnchored: false,
            angle: 0, lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }
        };
        
        matchmakingQueue.push(pProfile);
        gameState.gamemode = data.gamemode;
        socket.emit('roomJoined', { map: mapGrid });

        let needed = getRequiredPlayersCount(data.clashType, data.gamemode);

        // INSTANT STATE TRANSITION ACTION BUFFER: TRANSFERS OBJECT KEYS IMMEDIATELY WITHOUT DELAY TICK COOLDOWN
        if (matchmakingQueue.length >= needed && gameState.state === 'lobby') {
            gameState.state = 'playing'; // Change game state instantly before firing connection events
            matchmakingQueue.forEach(p => { gameState.players[p.id] = p; });
            
            if (gameState.gamemode === 'ZOMBIE') {
                let keys = Object.keys(gameState.players);
                let patientZero = keys[Math.floor(Math.random() * keys.length)];
                gameState.players[patientZero].isZombie = true; gameState.players[patientZero].hp = 240;
            }

            matchmakingQueue = [];
            io.emit('matchStarted', { map: mapGrid });
        } else {
            let list = matchmakingQueue.map(p => ({ name: p.name, device: p.device }));
            io.emit('lobbyUpdate', { count: matchmakingQueue.length, required: needed, users: list });
        }
    });

    socket.on('sendChatMessageEvent', (text) => {
        let p = gameState.players[socket.id];
        io.emit('receiveChatMessageBroadcast', { sender: p ? p.name : "System", text: text.replace(/<[^>]*>/g, '') });
    });

    socket.on('playerActionInput', (input) => {
        if (gameState.players[socket.id]) gameState.players[socket.id].lastInputState = input;
    });

    socket.on('switchWeapon', (idx) => {
        let p = gameState.players[socket.id];
        if (p && idx >= 0 && idx < p.loadout.length) p.activeWeaponIndex = idx;
    });

    socket.on('triggerReload', () => {
        let p = gameState.players[socket.id];
        if (p && !p.isReloading) {
            p.isReloading = true;
            setTimeout(() => { p.ammo = 30; p.isReloading = false; }, 1200);
        }
    });

    socket.on('shootWeapon', () => {
        let p = gameState.players[socket.id];
        if (!p || p.hp <= 0 || p.ammo <= 0 || p.isReloading || p.positionAnchored) return;
        p.ammo--;

        let type = p.loadout[p.activeWeaponIndex];
        let pAngle = p.angle;
        let baseBullet = { x: p.x + Math.cos(pAngle)*22, y: p.y + Math.sin(pAngle)*22, vx: Math.cos(pAngle)*650, vy: Math.sin(pAngle)*650, radius: 4, color: '#f59e0b', ownerId: p.id, life: 2.0, type: 'standard', dmg: 15 };

        if (type === 'railgun') {
            baseBullet.vx *= 2.5; baseBullet.dmg = 35; baseBullet.radius = 2; gameState.bullets.push(baseBullet);
        } else if (type === 'shotgun') {
            for (let i = -2; i <= 2; i++) {
                let dev = pAngle + (i * 0.12);
                gameState.bullets.push({ ...baseBullet, vx: Math.cos(dev)*550, vy: Math.sin(dev)*550, dmg: 10, life: 0.8 });
            }
        } else if (type === 'heavy_revolver') {
            baseBullet.dmg = 45; baseBullet.vx *= 0.8; baseBullet.radius = 6; gameState.bullets.push(baseBullet);
        } else if (type === 'bouncing_sniper' || type === 'sawblade') {
            baseBullet.type = 'bounce'; baseBullet.bounces = type === 'sawblade' ? 5 : 3; baseBullet.vx *= 1.2; gameState.bullets.push(baseBullet);
        } else if (type === 'napalm') {
            baseBullet.type = 'napalm_lob'; baseBullet.life = 1.0; baseBullet.vx *= 0.6; baseBullet.vy *= 0.6; gameState.bullets.push(baseBullet);
        } else if (type === 'seeker' || type === 'plasma_rifle') {
            baseBullet.type = 'homing'; baseBullet.vx *= 0.7; baseBullet.vy *= 0.7; baseBullet.life = 3.5; gameState.bullets.push(baseBullet);
        } else if (type === 'freeze_ray') {
            baseBullet.type = 'freeze'; baseBullet.color = '#38bdf8'; baseBullet.dmg = 8; gameState.bullets.push(baseBullet);
        } else if (type === 'vampire_drain') {
            baseBullet.type = 'vampire'; baseBullet.color = '#ec4899'; baseBullet.dmg = 20; gameState.bullets.push(baseBullet);
        } else if (type === 'sticky_grenade') {
            baseBullet.type = 'sticky'; baseBullet.life = 4.0; baseBullet.vx *= 0.5; baseBullet.vy *= 0.5; gameState.bullets.push(baseBullet);
        } else if (type === 'wave_wave') {
            baseBullet.type = 'pierce_wave'; baseBullet.radius = 20; baseBullet.vx *= 0.5; baseBullet.vy *= 0.5; baseBullet.dmg = 12; gameState.bullets.push(baseBullet);
        } else if (type === 'gravity_star') {
            baseBullet.type = 'g_star'; baseBullet.life = 1.2; gameState.bullets.push(baseBullet);
        } else if (type === 'cluster_bomb') {
            baseBullet.type = 'cluster'; baseBullet.life = 1.1; gameState.bullets.push(baseBullet);
        } else {
            gameState.bullets.push(baseBullet);
        }
    });

    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id]; if (!p || p.hp <= 0) return;
        let name = p.abilities[slotIdx]; let now = Date.now(); let readyProp = `ability${slotIdx + 1}ReadyAt`;
        if (now < p[readyProp]) return; p[readyProp] = now + 12000;

        if (name === 'blink') {
            let bx = p.x + Math.cos(p.angle) * 140; let by = p.y + Math.sin(p.angle) * 140;
            if (!checkServerWallCollision(bx, by, 16)) { p.x = bx; p.y = by; }
        } else if (name === 'stim') {
            p.stimActiveUntil = now + 4000; p.hp = Math.min(100, p.hp + 20);
        } else if (name === 'stealth_cloak') {
            p.cloakActive = true; setTimeout(() => { p.cloakActive = false; }, 6000);
        } else if (name === 'phase_shift') {
            p.phaseActive = true; setTimeout(() => { p.phaseActive = false; }, 2500);
        } else if (name === 'smoke') {
            gameState.fields.push({ x: p.x, y: p.y, radius: 100, type: 'smoke', life: 6.0 });
        } else if (name === 'heal_matrix') {
            gameState.fields.push({ x: p.x, y: p.y, radius: 80, type: 'heal', life: 5.0 });
        } else if (name === 'acid_trail') {
            let t = 0;
            let iv = setInterval(() => {
                if (p.hp > 0 && t++ < 15) gameState.fields.push({ x: p.x, y: p.y, radius: 45, type: 'acid', life: 4.0 });
                else clearInterval(iv);
            }, 250);
        } else if (name === 'iron_fortress') {
            p.positionAnchored = true; p.hp = Math.min(240, p.hp + 40); setTimeout(() => { p.positionAnchored = false; }, 4000);
        } else if (name === 'wall_build') {
            let bx = Math.floor((p.x + Math.cos(p.angle)*50)/GRID_SIZE);
            let by = Math.floor((p.y + Math.sin(p.angle)*50)/GRID_SIZE);
            if (bx > 0 && bx < BLOCKS_COUNT-1 && by > 0 && by < BLOCKS_COUNT-1) { mapGrid[bx][by] = 1; }
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    });
});

// HIGH-TICK RATE ENGINE RECTIFIER: SERVER TICK CLAMP RUNNING AT AN ABSOLUTE 60HZ REFRESH MATRIX
let lastTickTime = performance.now();
setInterval(() => {
    let now = performance.now(); let dt = (now - lastTickTime) / 1000; lastTickTime = now;
    if (dt > 0.05) dt = 0.05; // Ensures no heavy distance calculation snaps occur on frame drop

    if (gameState.state !== 'playing') return;

    for (let i = gameState.fields.length - 1; i >= 0; i--) {
        let f = gameState.fields[i]; f.life -= dt;
        if (f.life <= 0) { gameState.fields.splice(i, 1); continue; }
        if (f.type === 'acid') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius + 12) p.hp -= 18 * dt;
            });
        }
        if (f.type === 'heal') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) p.hp = Math.min(240, p.hp + 12 * dt);
            });
        }
    }

    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i]; b.life -= dt;
        if (b.type === 'homing') {
            let target = null; let minD = 500;
            Object.values(gameState.players).forEach(p => {
                if (p.id !== b.ownerId && p.hp > 0) {
                    let d = Math.hypot(p.x - b.x, p.y - b.y); if (d < minD) { minD = d; target = p; }
                }
            });
            if (target) {
                let ang = Math.atan2(target.y - b.y, target.x - b.x); b.vx = Math.cos(ang) * 450; b.vy = Math.sin(ang) * 450;
            }
        }

        b.x += b.vx * dt; b.y += b.vy * dt;
        let hit = checkServerWallCollision(b.x, b.y, b.radius);
        if (hit && b.type === 'bounce' && b.bounces-- > 0) { b.vx = -b.vx; b.y -= b.vy * dt * 2; hit = false; }

        if (b.life <= 0 || (hit && b.type !== 'pierce_wave')) {
            if (b.type === 'napalm_lob') gameState.fields.push({ x: b.x, y: b.y, radius: 70, type: 'acid', life: 4.5 });
            if (b.type === 'cluster') {
                for (let c=0; c<6; c++) {
                    let a = (Math.PI*2/6)*c;
                    gameState.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a)*400, vy: Math.sin(a)*400, radius: 3, color: '#f43f5e', ownerId: b.ownerId, life: 0.8, type: 'standard', dmg: 8 });
                }
            }
            gameState.bullets.splice(i, 1); continue;
        }

        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && Math.hypot(p.x - b.x, p.y - b.y) < 22) {
                if (p.cloakActive) return;
                let dmg = b.dmg || 15; p.hp -= dmg;
                if (b.type === 'freeze') p.stimActiveUntil = 0;
                if (b.type === 'vampire') {
                    let owner = gameState.players[b.ownerId]; if (owner) owner.hp = Math.min(240, owner.hp + (dmg * 0.5));
                }
                if (p.hp <= 0) {
                    let k = gameState.players[b.ownerId];
                    if (k) { if (k.team === 'red') gameState.scores.red++; else gameState.scores.blue++; }
                    if (gameState.gamemode === 'ZOMBIE') { p.isZombie = true; p.hp = 180; } else { p.hp = 100; }
                    setTimeout(() => {
                        p.x = 200 + Math.random() * 1600; p.y = 200 + Math.random() * 1600;
                        io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                    }, 4000);
                }
                b.life = 0;
            }
        });
    }

    Object.values(gameState.players).forEach(p => {
        if (p.hp <= 0 || p.positionAnchored) return;
        let input = p.lastInputState; let dx = 0; let dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let speed = 252;
        if (p.device === 'mobile') speed *= 1.15; // Normalized tick velocity scalar for cross platform equality
        if (p.loadout && p.loadout[p.activeWeaponIndex] === 'chaingun') speed = 150;
        if (Date.now() < p.stimActiveUntil) speed += 120;

        let nextX = p.x + (dx * speed * dt); let nextY = p.y + (dy * speed * dt);

        if (p.phaseActive) {
            p.x = Math.max(15, Math.min(MAP_SIZE - 15, nextX)); p.y = Math.max(15, Math.min(MAP_SIZE - 15, nextY));
        } else {
            if (!checkServerWallCollision(nextX, p.y, 16)) p.x = nextX;
            if (!checkServerWallCollision(p.x, nextY, 16)) p.y = nextY;
        }
        p.angle = input.angle || 0;
    });

    io.emit('serverTickUpdate', gameState);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`SMOOTH ENGINE CORE ONLINE ON PORT ${PORT}`); })