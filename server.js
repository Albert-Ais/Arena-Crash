const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000; const GRID_SIZE = 40; const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;
const REQUIRED_PLAYERS = 2; // MATCHMAKING LOBBY CAP RATIO REQUIREMENT MINIMUMS

let mapGrid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));

// STRUCTURAL MATRICES GENERATION LOOP (Adds walls & large square rocks blocks configurations)
function seedStructuralWorldGrid() {
    // 1. Build Perimeter Structural Boundary Blocks Walls
    for (let i = 0; i < BLOCKS_COUNT; i++) {
        mapGrid[i][0] = 1; mapGrid[i][BLOCKS_COUNT - 1] = 1;
        mapGrid[0][i] = 1; mapGrid[BLOCKS_COUNT - 1][i] = 1;
    }
    // 2. Generate Random Interior Linear Walls (Type 1)
    for (let k = 0; k < 30; k++) {
        let wx = Math.floor(Math.random() * (BLOCKS_COUNT - 6)) + 3;
        let wy = Math.floor(Math.random() * (BLOCKS_COUNT - 6)) + 3;
        let horizontal = Math.random() > 0.5;
        for (let l = 0; l < 5; l++) {
            if (horizontal) mapGrid[wx + l][wy] = 1;
            else mapGrid[wx][wy + l] = 1;
        }
    }
    // 3. Generate Large Square Rock Obstacles (Type 2 - 3x3 Grid Formations)
    for (let r = 0; r < 8; r++) {
        let rx = Math.floor(Math.random() * (BLOCKS_COUNT - 10)) + 5;
        let ry = Math.floor(Math.random() * (BLOCKS_COUNT - 10)) + 5;
        for (let x = 0; x < 3; x++) {
            for (let y = 0; y < 3; y++) {
                mapGrid[rx + x][ry + y] = 2;
            }
        }
    }
}
seedStructuralWorldGrid();

let gameState = { players: {}, bullets: [], fields: [], scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180 };
let matchmakingQueue = [];

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
                if (x + rBuffer > wX && x - rBuffer < wX + GRID_SIZE && y + rBuffer > wY && y - rBuffer < wY + GRID_SIZE) {
                    return true;
                }
            }
        }
    }
    return false;
}

io.on('connection', (socket) => {
    socket.on('joinQueue', (data) => {
        let playerProfile = {
            id: socket.id, name: data.name,
            x: 200 + Math.random() * 1600, y: 200 + Math.random() * 1600,
            hp: 100, team: matchmakingQueue.length % 2 === 0 ? 'red' : 'blue',
            loadout: data.loadout.slice(0,5), abilities: data.abilities.slice(0,3),
            activeWeaponIndex: 0, ammo: 30, isReloading: false,
            ability1ReadyAt: 0, ability2ReadyAt: 0, ability3ReadyAt: 0,
            stimActiveUntil: 0, cloakActive: false, phaseActive: false, positionAnchored: false,
            angle: 0, lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }
        };
        
        matchmakingQueue.push(playerProfile);
        socket.emit('roomJoined', { map: mapGrid });

        // Evaluate LOBBY thresholds condition rulesets
        if (matchmakingQueue.length >= REQUIRED_PLAYERS && gameState.state === 'lobby') {
            matchmakingQueue.forEach(p => { gameState.players[p.id] = p; });
            gameState.state = 'playing';
            matchmakingQueue = [];
            io.emit('matchStarted', { map: mapGrid });
        } else {
            let infoPack = matchmakingQueue.map(p => ({ name: p.name }));
            io.emit('lobbyUpdate', { count: matchmakingQueue.length, required: REQUIRED_PLAYERS, users: infoPack });
        }
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

    // WEAPONS LOGIC EMITTER INTEGRATION LOOPS
    socket.on('shootWeapon', () => {
        let p = gameState.players[socket.id];
        if (!p || p.hp <= 0 || p.ammo <= 0 || p.isReloading || p.positionAnchored) return;
        p.ammo--;

        let type = p.loadout[p.activeWeaponIndex];
        let pAngle = p.angle;
        let baseBullet = { x: p.x + Math.cos(pAngle)*22, y: p.y + Math.sin(pAngle)*22, vx: Math.cos(pAngle)*650, vy: Math.sin(pAngle)*650, radius: 4, color: '#f59e0b', ownerId: p.id, life: 2.0, type: 'standard', dmg: 15 };

        if (type === 'railgun') {
            baseBullet.vx *= 2.5; baseBullet.dmg = 35; baseBullet.radius = 2;
            gameState.bullets.push(baseBullet);
        } else if (type === 'shotgun') {
            for (let i = -2; i <= 2; i++) {
                let dev = pAngle + (i * 0.12);
                gameState.bullets.push({ ...baseBullet, vx: Math.cos(dev)*550, vy: Math.sin(dev)*550, dmg: 10, life: 0.8 });
            }
        } else if (type === 'heavy_revolver') {
            baseBullet.dmg = 45; baseBullet.vx *= 0.8; baseBullet.radius = 6;
            gameState.bullets.push(baseBullet);
        } else if (type === 'bouncing_sniper' || type === 'sawblade') {
            baseBullet.type = 'bounce'; baseBullet.bounces = type === 'sawblade' ? 5 : 3; baseBullet.vx *= 1.2;
            gameState.bullets.push(baseBullet);
        } else if (type === 'napalm') {
            baseBullet.type = 'napalm_lob'; baseBullet.life = 1.0; baseBullet.vx *= 0.6; baseBullet.vy *= 0.6;
            gameState.bullets.push(baseBullet);
        } else if (type === 'seeker' || type === 'plasma_rifle') {
            baseBullet.type = 'homing'; baseBullet.vx *= 0.7; baseBullet.vy *= 0.7; baseBullet.life = 3.5;
            gameState.bullets.push(baseBullet);
        } else if (type === 'freeze_ray') {
            baseBullet.type = 'freeze'; baseBullet.color = '#38bdf8'; baseBullet.dmg = 8;
            gameState.bullets.push(baseBullet);
        } else if (type === 'vampire_drain') {
            baseBullet.type = 'vampire'; baseBullet.color = '#ec4899'; baseBullet.dmg = 20;
            gameState.bullets.push(baseBullet);
        } else if (type === 'sticky_grenade') {
            baseBullet.type = 'sticky'; baseBullet.life = 4.0; baseBullet.vx *= 0.5; baseBullet.vy *= 0.5;
            gameState.bullets.push(baseBullet);
        } else if (type === 'wave_wave') {
            baseBullet.type = 'pierce_wave'; baseBullet.radius = 20; baseBullet.vx *= 0.5; baseBullet.vy *= 0.5; baseBullet.dmg = 12;
            gameState.bullets.push(baseBullet);
        } else if (type === 'gravity_star') {
            baseBullet.type = 'g_star'; baseBullet.life = 1.2;
            gameState.bullets.push(baseBullet);
        } else if (type === 'cluster_bomb') {
            baseBullet.type = 'cluster'; baseBullet.life = 1.1;
            gameState.bullets.push(baseBullet);
        } else {
            gameState.bullets.push(baseBullet); // Standard bullet default path configuration fallback
        }
    });

    // ACTIVE ABILITY ABSTRACTION INTERACTION CORES
    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id];
        if (!p || p.hp <= 0) return;
        let abilityName = p.abilities[slotIdx];
        let now = Date.now();
        let readyProp = `ability${slotIdx + 1}ReadyAt`;

        if (now < p[readyProp]) return; // CD rule check block
        p[readyProp] = now + 12000; // General 12s cool-down loop cycle boundary setting

        if (abilityName === 'blink') {
            let bx = p.x + Math.cos(p.angle) * 140; let by = p.y + Math.sin(p.angle) * 140;
            if (!checkServerWallCollision(bx, by, 16)) { p.x = bx; p.y = by; }
        } else if (abilityName === 'stim') {
            p.stimActiveUntil = now + 4000; p.hp = Math.min(100, p.hp + 20);
        } else if (abilityName === 'stealth_cloak') {
            p.cloakActive = true; setTimeout(() => { p.cloakActive = false; }, 6000);
        } else if (abilityName === 'phase_shift') {
            p.phaseActive = true; setTimeout(() => { p.phaseActive = false; }, 2500);
        } else if (abilityName === 'smoke') {
            gameState.fields.push({ x: p.x, y: p.y, radius: 100, type: 'smoke', life: 6.0 });
        } else if (abilityName === 'heal_matrix') {
            gameState.fields.push({ x: p.x, y: p.y, radius: 80, type: 'heal', life: 5.0 });
        } else if (abilityName === 'acid_trail') {
            let ticks = 0;
            let interval = setInterval(() => {
                if (p.hp > 0 && ticks++ < 15) gameState.fields.push({ x: p.x, y: p.y, radius: 45, type: 'acid', life: 4.0 });
                else clearInterval(interval);
            }, 250);
        } else if (abilityName === 'iron_fortress') {
            p.positionAnchored = true; p.hp = Math.min(100, p.hp + 40);
            setTimeout(() => { p.positionAnchored = false; }, 4000);
        } else if (abilityName === 'wall_build') {
            let bx = Math.floor((p.x + Math.cos(p.angle)*50)/GRID_SIZE);
            let by = Math.floor((p.y + Math.sin(p.angle)*50)/GRID_SIZE);
            if (bx > 0 && bx < BLOCKS_COUNT-1 && by > 0 && by < BLOCKS_COUNT-1) {
                mapGrid[bx][by] = 1; // Generates dynamic destructible or permanent barrier blocks
            }
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    });
});

// Primary Server Engine Fixed Physics Tick Loop Execution
let lastTickTime = performance.now();
setInterval(() => {
    let now = performance.now(); let dt = (now - lastTickTime) / 1000; lastTickTime = now;
    if (dt > 0.1) dt = 0.1;

    if (gameState.state !== 'playing') return;

    // Environmental ticking fields update logic loop
    for (let i = gameState.fields.length - 1; i >= 0; i--) {
        let f = gameState.fields[i]; f.life -= dt;
        if (f.life <= 0) { gameState.fields.splice(i, 1); continue; }
        
        if (f.type === 'acid') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius + 12) {
                    p.hp -= 18 * dt; // Ticking corrosive acid values damage processing loop bounds
                }
            });
        }
        if (f.type === 'heal') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) {
                    p.hp = Math.min(100, p.hp + 12 * dt);
                }
            });
        }
    }

    // Bullets Projectiles Update and Specialized Features Logic Iteration
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i]; b.life -= dt;
        
        // Homing projectile tracking lookups
        if (b.type === 'homing') {
            let closestTarget = null; let minD = 500;
            Object.values(gameState.players).forEach(p => {
                if (p.id !== b.ownerId && p.hp > 0) {
                    let d = Math.hypot(p.x - b.x, p.y - b.y);
                    if (d < minD) { minD = d; closestTarget = p; }
                }
            });
            if (closestTarget) {
                let targetAngle = Math.atan2(closestTarget.y - b.y, closestTarget.x - b.x);
                b.vx = Math.cos(targetAngle) * 450; b.vy = Math.sin(targetAngle) * 450;
            }
        }

        b.x += b.vx * dt; b.y += b.vy * dt;

        let wallHit = checkServerWallCollision(b.x, b.y, b.radius);
        if (wallHit && b.type === 'bounce' && b.bounces-- > 0) {
            b.vx = -b.vx; b.y -= b.vy * dt * 2; // Inverts movement trajectory configurations instantly
            wallHit = false;
        }

        if (b.life <= 0 || (wallHit && b.type !== 'pierce_wave')) {
            if (b.type === 'napalm_lob') gameState.fields.push({ x: b.x, y: b.y, radius: 70, type: 'acid', life: 4.5 });
            if (b.type === 'cluster') {
                for (let c=0; c<6; c++) {
                    let a = (Math.PI*2/6)*c;
                    gameState.bullets.push({ x: b.x, y: b.y, vx: Math.cos(a)*400, vy: Math.sin(a)*400, radius: 3, color: '#f43f5e', ownerId: b.ownerId, life: 0.8, type: 'standard', dmg: 8 });
                }
            }
            gameState.bullets.splice(i, 1); continue;
        }

        // Entity Damage Overlapping Processing Loop Bounds
        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && Math.hypot(p.x - b.x, p.y - b.y) < 22) {
                if (p.cloakActive) return; // Ignores collision check loops on hidden targets
                
                let rawDmg = b.dmg || 15;
                p.hp -= rawDmg;

                if (b.type === 'freeze') p.stimActiveUntil = 0; // Clears movement buffers instantly on freeze rays impact
                if (b.type === 'vampire') {
                    let owner = gameState.players[b.ownerId];
                    if (owner) owner.hp = Math.min(100, owner.hp + (rawDmg * 0.5));
                }

                if (p.hp <= 0) {
                    let killer = gameState.players[b.ownerId];
                    if (killer) { if (killer.team === 'red') gameState.scores.red++; else gameState.scores.blue++; }
                    setTimeout(() => {
                        p.hp = 100; p.x = 200 + Math.random() * 1600; p.y = 200 + Math.random() * 1600;
                        io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                    }, 4000);
                }
                b.life = 0;
            }
        });
    }

    // Standard Character Spatial Processing Loop Updates
    Object.values(gameState.players).forEach(p => {
        if (p.hp <= 0 || p.positionAnchored) return;
        let input = p.lastInputState;
        let dx = 0; let dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let speed = 252;
        if (p.loadout && p.loadout[p.activeWeaponIndex] === 'chaingun') speed = 150;
        if (Date.now() < p.stimActiveUntil) speed += 120;

        let nextX = p.x + (dx * speed * dt);
        let nextY = p.y + (dy * speed * dt);

        if (p.phaseActive) {
            p.x = Math.max(15, Math.min(MAP_SIZE - 15, nextX));
            p.y = Math.max(15, Math.min(MAP_SIZE - 15, nextY));
        } else {
            if (!checkServerWallCollision(nextX, p.y, 16)) p.x = nextX;
            if (!checkServerWallCollision(p.x, nextY, 16)) p.y = nextY;
        }
        p.angle = input.angle || 0;
    });

    io.emit('serverTickUpdate', gameState);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`SYSTEMS SECURED // EXPANDED CORE ONLINE ON PORT ${PORT}`); });