const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000; const GRID_SIZE = 40; const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;

let currentGrid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));
for (let i = 0; i < BLOCKS_COUNT; i++) {
    currentGrid[i][0] = 1; currentGrid[i][BLOCKS_COUNT - 1] = 1;
    currentGrid[0][i] = 1; currentGrid[BLOCKS_COUNT - 1][i] = 1;
}
for (let k = 0; k < 25; k++) {
    let wx = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
    let wy = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
    let horiz = Math.random() > 0.5;
    for (let l = 0; l < 5; l++) { if (horiz) currentGrid[wx + l][wy] = 1; else currentGrid[wx][wy + l] = 1; }
}

let gameState = { 
    players: {}, decoys: [], bullets: [], fields: [],
    scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180, 
    gamemode: 'TDM', mapGrid: currentGrid
};

let matchmakingQueue = [];
let intermissionResponses = {}; 

function checkServerWallCollision(x, y, radius) {
    let startX = Math.max(0, Math.floor((x - radius) / GRID_SIZE));
    let endX = Math.min(BLOCKS_COUNT - 1, Math.floor((x + radius) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - radius) / GRID_SIZE));
    let endY = Math.min(BLOCKS_COUNT - 1, Math.floor((y + radius) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (gameState.mapGrid[gx] && gameState.mapGrid[gx][gy] === 1) {
                let wX = gx * GRID_SIZE; let wY = gy * GRID_SIZE;
                if (x + radius > wX && x - radius < wX + GRID_SIZE && y + radius > wY && y - radius < wY + GRID_SIZE) return true;
            }
        }
    }
    return false;
}

let matchClockInterval = null;
function activateMatchTimerCountdown() {
    if (matchClockInterval) clearInterval(matchClockInterval);
    matchClockInterval = setInterval(() => {
        if (gameState.state === 'playing') {
            gameState.matchTimer--;
            if (gameState.matchTimer <= 0) triggerRoundIntermissionPhase();
        }
    }, 1000);
}

function triggerRoundIntermissionPhase() {
    gameState.state = 'intermission'; intermissionResponses = {}; io.emit('roundIntermissionScreen');
}

function processRestartMatchVerification() {
    let activePlayerIds = Object.keys(gameState.players);
    let readyCount = Object.keys(intermissionResponses).length;
    
    if (readyCount >= activePlayerIds.length && activePlayerIds.length > 0) {
        gameState.bullets = []; gameState.decoys = []; gameState.fields = [];
        gameState.matchTimer = 180; gameState.state = 'playing';

        activePlayerIds.forEach(id => {
            let p = gameState.players[id];
            p.x = 200 + Math.random() * 1600; p.y = 200 + Math.random() * 1600;
            p.hp = 100; p.overshield = 50; p.invisibleActive = false; p.controllingDecoyId = null;
            p.isReloading = false; p.ammo = p.maxAmmo; p.activeSpeedBuff = false; p.abilitySilencedUntil = 0;
        });

        activateMatchTimerCountdown();
        io.emit('matchStarted', { map: gameState.mapGrid });
    }
}

io.on('connection', (socket) => {
    socket.on('joinQueue', (data) => {
        let pProfile = {
            id: socket.id, name: data.name, device: data.device,
            x: 200 + Math.random() * 1600, y: 200 + Math.random() * 1600,
            hp: 100, overshield: 50, team: matchmakingQueue.length % 2 === 0 ? 'red' : 'blue',
            loadout: data.loadout, abilities: data.abilities,
            activeWeaponIndex: 0, ammo: 30, maxAmmo: 30, isReloading: false,
            ability1ReadyAt: 0, ability2ReadyAt: 0, ability3ReadyAt: 0,
            invisibleActive: false, controllingDecoyId: null, activeSpeedBuff: false, abilitySilencedUntil: 0,
            angle: 0, lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }
        };
        
        matchmakingQueue.push(pProfile);
        socket.emit('roomJoined', { map: gameState.mapGrid });

        let needed = 2; 
        if (matchmakingQueue.length >= needed && gameState.state === 'lobby') {
            gameState.state = 'playing';
            matchmakingQueue.forEach(p => { gameState.players[p.id] = p; });
            matchmakingQueue = [];
            activateMatchTimerCountdown();
            io.emit('matchStarted', { map: gameState.mapGrid });
        } else {
            let list = matchmakingQueue.map(p => ({ name: p.name, device: p.device }));
            io.emit('lobbyUpdate', { count: matchmakingQueue.length, required: needed, users: list });
        }
    });

    socket.on('submitIntermissionKeepLoadout', () => {
        if (gameState.players[socket.id]) { intermissionResponses[socket.id] = true; processRestartMatchVerification(); }
    });

    socket.on('submitIntermissionLoadoutChange', (data) => {
        let p = gameState.players[socket.id];
        if (p) {
            p.loadout = data.loadout; p.abilities = data.abilities; p.activeWeaponIndex = 0;
            intermissionResponses[socket.id] = true; processRestartMatchVerification();
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
        if (p && idx >= 0 && idx < p.loadout.length && !p.isReloading) p.activeWeaponIndex = idx;
    });

    socket.on('triggerReload', () => {
        let p = gameState.players[socket.id];
        if (p && !p.isReloading) {
            p.isReloading = true;
            setTimeout(() => { p.ammo = p.maxAmmo; p.isReloading = false; }, 1200);
        }
    });

    socket.on('shootWeapon', () => {
        let p = gameState.players[socket.id];
        if (!p || p.hp <= 0 || p.invisibleActive || p.ammo <= 0 || p.isReloading) return;
        
        p.ammo--;
        let currentWepId = p.loadout[p.activeWeaponIndex];
        
        let bRadius = 4, bSpeed = 750, bDmg = 18, bColor = '#fbbf24', bLife = 1.5;
        let bBounce = 0, bPassWalls = false, typeTag = "NORMAL";

        // BEHAVIORAL WEAPON DISPATCH INDICES (Mapping descriptions exactly)
        if (currentWepId === "wep_1") { bColor = "#a855f7"; typeTag = "LIGHTNING"; bDmg = 15; }
        else if (currentWepId === "wep_2") { bColor = "#38bdf8"; typeTag = "PRISM"; }
        else if (currentWepId === "wep_3") { bRadius = 2; bSpeed = 1500; bColor = "#00ffff"; typeTag = "PIERCE"; bDmg = 12; }
        else if (currentWepId === "wep_4") { bColor = "#ec4899"; typeTag = "PULSE"; }
        else if (currentWepId === "wep_6") { bBounce = 3; bColor = "#fb923c"; typeTag = "MIRROR"; }
        else if (currentWepId === "wep_7") { bBounce = 8; bColor = "#facc15"; }
        else if (currentWepId === "wep_11") { bSpeed = 250; bColor = "#b91c1c"; typeTag = "MINE"; bLife = 8.0; }
        else if (currentWepId === "wep_12") { bRadius = 10; bSpeed = 400; bColor = "#ef4444"; typeTag = "FLAME"; bLife = 0.6; }
        else if (currentWepId === "wep_13") { bColor = "#38bdf8"; typeTag = "CRYO"; }
        else if (currentWepId === "wep_19") { bColor = "#10b981"; typeTag = "ANCHOR"; }
        else if (currentWepId === "wep_22") { bColor = "#a855f7"; typeTag = "SWAP"; }
        else if (currentWepId === "wep_27") { bColor = "#f59e0b"; typeTag = "EMP_WPN"; }
        else if (currentWepId === "wep_30") { bColor = "#6366f1"; typeTag = "SILENCE_WPN"; }
        else if (currentWepId === "wep_31") { bRadius = 5; bSpeed = 1600; bDmg = 40; bColor = "#ef4444"; }
        else if (currentWepId === "wep_35") { bDmg = (p.hp < 100) ? 25 : 18; bColor = "#e11d48"; typeTag = "EXECUTION"; }
        else if (currentWepId === "wep_41") { p.hp = Math.max(5, p.hp - 10); bRadius = 7; bDmg = 45; bColor = "#991b1b"; }
        else if (currentWepId === "wep_45") { bDmg = 55; bColor = "#ffffff"; p.overshield = 0; } // Glass Cannon penalty
        else if (currentWepId === "wep_46") { bRadius = 18; bSpeed = 220; bDmg = 5; bColor = "#6d28d9"; bLife = 3.0; typeTag = "BLACK_HOLE"; }
        else if (currentWepId === "wep_48") { bColor = "#4c1d95"; bPassWalls = true; }

        let activeFireSource = { x: p.x, y: p.y, angle: p.angle };
        if (p.controllingDecoyId) {
            let dObj = gameState.decoys.find(d => d.id === p.controllingDecoyId);
            if (dObj) { activeFireSource.x = dObj.x; activeFireSource.y = dObj.y; activeFireSource.angle = dObj.angle; }
        }

        let bulletModel = { 
            x: activeFireSource.x + Math.cos(activeFireSource.angle)*22, y: activeFireSource.y + Math.sin(activeFireSource.angle)*22, 
            vx: Math.cos(activeFireSource.angle)*bSpeed, vy: Math.sin(activeFireSource.angle)*bSpeed, 
            radius: bRadius, ownerId: p.id, life: bLife, dmg: bDmg, color: bColor,
            bounce: bBounce, passWalls: bPassWalls, type: typeTag
        };
        gameState.bullets.push(bulletModel);
    });

    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id]; if (!p || p.hp <= 0 || gameState.state !== 'playing') return;
        if (Date.now() < p.abilitySilencedUntil) return;

        let name = p.abilities[slotIdx]; let now = Date.now(); let readyProp = `ability${slotIdx + 1}ReadyAt`;
        if (now < p[readyProp]) return; p[readyProp] = now + 14000;

        // SPECIFIC FUNCTIONAL ABILITY ENGINE RESOLUTIONS
        if (name === 'abil_1') { 
            p.hp = Math.min(100, p.hp + 40); 
        } else if (name === 'abil_6') { 
            p.activeSpeedBuff = true; setTimeout(() => { let pl = gameState.players[socket.id]; if (pl) pl.activeSpeedBuff = false; }, 4000);
        } else if (name === 'abil_16') { 
            p.overshield = Math.min(100, p.overshield + 50);
        } else if (name === 'abil_37') { 
            Object.values(gameState.players).forEach(opp => {
                if (opp.id !== p.id && Math.hypot(opp.x - p.x, opp.y - p.y) < 250) opp.abilitySilencedUntil = Date.now() + 4000;
            });
        } else if (name === 'abil_45') { 
            // CONTROLLED DECOY MATRIX LOGIC: Spawns sub-entity, routes physics loops, triggers invisible states
            let cloneId = 'decoy_' + socket.id + '_' + Date.now();
            p.invisibleActive = true; p.controllingDecoyId = cloneId;

            gameState.decoys.push({ id: cloneId, ownerId: p.id, x: p.x, y: p.y, angle: p.angle, life: 10.0 });
            setTimeout(() => {
                let targetPlayer = gameState.players[socket.id];
                if (targetPlayer && targetPlayer.controllingDecoyId === cloneId) {
                    targetPlayer.invisibleActive = false; targetPlayer.controllingDecoyId = null;
                    gameState.decoys = gameState.decoys.filter(d => d.id !== cloneId);
                }
            }, 10000);
        } else if (name === 'abil_49') { 
            gameState.fields.push({ x: p.x, y: p.y, radius: 140, color: 'rgba(16, 185, 129, 0.4)', type: 'TOXIC', ownerId: p.id, life: 6.0 });
        } else {
            p.hp = Math.min(100, p.hp + 15);
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id]; delete intermissionResponses[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        if (gameState.state === 'intermission') processRestartMatchVerification();
    });
});

setInterval(() => {
    let dt = 1 / 60; if (gameState.state !== 'playing') return;

    for (let j = gameState.fields.length - 1; j >= 0; j--) {
        let f = gameState.fields[j]; f.life -= dt;
        if (f.life <= 0) { gameState.fields.splice(j, 1); continue; }
        if (f.type === 'TOXIC') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) {
                    p.hp = Math.max(1, p.hp - (12 * dt));
                }
            });
        }
    }

    Object.values(gameState.players).forEach(p => {
        if (p.hp <= 0) return;
        let input = p.lastInputState;
        let dx = 0, dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let speed = p.activeSpeedBuff ? 440 : 252;

        // CONTROL REDIRECTION: If clone configuration flag exists, route controls to the decoy instead
        if (p.controllingDecoyId) {
            let activeDecoy = gameState.decoys.find(d => d.id === p.controllingDecoyId);
            if (activeDecoy) {
                let nX = activeDecoy.x + (dx * speed * dt); let nY = activeDecoy.y + (dy * speed * dt);
                if (!checkServerWallCollision(nX, activeDecoy.y, 14)) activeDecoy.x = nX;
                if (!checkServerWallCollision(activeDecoy.x, nY, 14)) activeDecoy.y = nY;
                activeDecoy.angle = input.angle || 0;
            }
        } else {
            let nextX = p.x + (dx * speed * dt); let nextY = p.y + (dy * speed * dt);
            if (!checkServerWallCollision(nextX, p.y, 16)) p.x = nextX;
            if (!checkServerWallCollision(p.x, nextY, 16)) p.y = nextY;
            p.angle = input.angle || 0;
        }
    });

    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i]; b.life -= dt;
        b.x += b.vx * dt; b.y += b.vy * dt;

        if (b.life <= 0) { gameState.bullets.splice(i, 1); continue; }

        if (!b.passWalls && checkServerWallCollision(b.x, b.y, b.radius)) {
            if (b.bounce > 0) { b.bounce--; b.vx = -b.vx; b.vy = -b.vy; } 
            else { gameState.bullets.splice(i, 1); continue; }
        }

        if (b.type === "BLACK_HOLE") {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && p.id !== b.ownerId) {
                    let dist = Math.hypot(p.x - b.x, p.y - b.y);
                    if (dist < 180) {
                        let pullAng = Math.atan2(b.y - p.y, b.x - p.x);
                        p.x += Math.cos(pullAng) * 140 * dt; p.y += Math.sin(pullAng) * 140 * dt;
                    }
                }
            });
        }

        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && !p.invisibleActive && Math.hypot(p.x - b.x, p.y - b.y) < 22) {
                let damageAmount = b.dmg;
                if (b.type === "EXECUTION" && p.hp < 30) damageAmount *= 2;

                if (p.overshield > 0) {
                    p.overshield -= damageAmount; if (p.overshield < 0) p.overshield = 0;
                } else {
                    p.hp -= damageAmount;
                }

                if (b.type === "ANCHOR") { p.activeSpeedBuff = false; p.lastInputState = { w:false, a:false, s:false, d:false }; }
                if (b.type === "SILENCE_WPN") { p.abilitySilencedUntil = Date.now() + 3000; }

                io.to(b.ownerId).emit('hitFeedback', { x: p.x, y: p.y, dmg: damageAmount });

                if (p.hp <= 0) {
                    let killer = gameState.players[b.ownerId];
                    if (killer) {
                        if (killer.team === 'red') gameState.scores.red++; else gameState.scores.blue++;
                        io.emit('feedKillMessage', `${killer.name} eliminated ${p.name}`);
                    }
                    setTimeout(() => {
                        p.x = 200 + Math.random() * 1600; p.y = 200 + Math.random() * 1600;
                        p.hp = 100; p.overshield = 50; p.invisibleActive = false; p.controllingDecoyId = null;
                        io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                    }, 3000);
                }
                b.life = 0;
            }
        });
    }
    io.emit('serverTickUpdate', gameState);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`SYSTEM ONLINE ON PORT ${PORT}`); });