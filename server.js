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
for (let k = 0; k < 30; k++) {
    let wx = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
    let wy = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
    let horiz = Math.random() > 0.5;
    for (let l = 0; l < 6; l++) { if (horiz) currentGrid[wx + l][wy] = 1; else currentGrid[wx][wy + l] = 1; }
}

let gameState = { 
    players: {}, decoys: [], bullets: [], fields: [], items: [],
    scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180, 
    gamemode: 'TDM', mapGrid: currentGrid, queueType: 'casual'
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
    gameState.state = 'intermission';
    intermissionResponses = {};
    io.emit('roundIntermissionScreen');
}

function processRestartMatchVerification() {
    let activePlayerIds = Object.keys(gameState.players);
    let readyCount = Object.keys(intermissionResponses).length;
    
    if (readyCount >= activePlayerIds.length && activePlayerIds.length > 0) {
        // Reset dynamic state objects for new round execution
        gameState.bullets = [];
        gameState.decoys = [];
        gameState.matchTimer = 180;
        gameState.state = 'playing';

        activePlayerIds.forEach(id => {
            let p = gameState.players[id];
            p.x = 200 + Math.random() * 1600;
            p.y = 200 + Math.random() * 1600;
            p.hp = 100;
            p.overshield = 50;
            p.invisibleActive = false;
            p.controllingDecoyId = null;
            p.isReloading = false;
            p.ammo = p.maxAmmo;
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
            invisibleActive: false, controllingDecoyId: null,
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
        if (gameState.players[socket.id]) {
            intermissionResponses[socket.id] = true;
            processRestartMatchVerification();
        }
    });

    socket.on('submitIntermissionLoadoutChange', (data) => {
        let p = gameState.players[socket.id];
        if (p) {
            p.loadout = data.loadout;
            p.abilities = data.abilities;
            p.activeWeaponIndex = 0;
            intermissionResponses[socket.id] = true;
            processRestartMatchVerification();
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
        if (!p || p.hp <= 0 || p.invisibleActive) return; // Cannot fire weapons while invisible in decoy mode

        if (p.ammo <= 0 || p.isReloading) return;
        p.ammo--;

        let bulletModel = { 
            x: p.x + Math.cos(p.angle)*22, y: p.y + Math.sin(p.angle)*22, 
            vx: Math.cos(p.angle)*700, vy: Math.sin(p.angle)*700, 
            radius: 4, ownerId: p.id, life: 1.8, dmg: 20 
        };
        gameState.bullets.push(bulletModel);
    });

    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id]; if (!p || p.hp <= 0 || gameState.state !== 'playing') return;
        let name = p.abilities[slotIdx]; let now = Date.now(); let readyProp = `ability${slotIdx + 1}ReadyAt`;
        if (now < p[readyProp]) return; p[readyProp] = now + 14000;

        if (name === 'abil_3') { // Controllable Decoy System Core mapping
            let cloneId = 'decoy_' + socket.id + '_' + Date.now();
            p.invisibleActive = true;
            p.controllingDecoyId = cloneId;

            gameState.decoys.push({
                id: cloneId, ownerId: p.id,
                x: p.x, y: p.y, angle: p.angle, life: 10.0
            });

            // Revert state variables automatically after 10-second duration expires
            setTimeout(() => {
                let targetPlayer = gameState.players[socket.id];
                if (targetPlayer && targetPlayer.controllingDecoyId === cloneId) {
                    targetPlayer.invisibleActive = false;
                    targetPlayer.controllingDecoyId = null;
                    gameState.decoys = gameState.decoys.filter(d => d.id !== cloneId);
                }
            }, 10 * 1000);
        } else {
            // General backup core activation logic
            p.hp = Math.min(100, p.hp + 15);
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        delete intermissionResponses[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        if (gameState.state === 'intermission') processRestartMatchVerification();
    });
});

setInterval(() => {
    let dt = 1 / 60;
    if (gameState.state !== 'playing') return;

    // Separate input processing loop specifically routing control vector properties if decoy override properties are found
    Object.values(gameState.players).forEach(p => {
        if (p.hp <= 0) return;
        let input = p.lastInputState;
        let dx = 0; let dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let speed = 252;

        if (p.controllingDecoyId) {
            let activeDecoy = gameState.decoys.find(d => d.id === p.controllingDecoyId);
            if (activeDecoy) {
                let nX = activeDecoy.x + (dx * speed * dt);
                let nY = activeDecoy.y + (dy * speed * dt);
                if (!checkServerWallCollision(nX, activeDecoy.y, 14)) activeDecoy.x = nX;
                if (!checkServerWallCollision(activeDecoy.x, nY, 14)) activeDecoy.y = nY;
                activeDecoy.angle = input.angle || 0;
            }
        } else {
            let nextX = p.x + (dx * speed * dt);
            let nextY = p.y + (dy * speed * dt);
            if (!checkServerWallCollision(nextX, p.y, 16)) p.x = nextX;
            if (!checkServerWallCollision(p.x, nextY, 16)) p.y = nextY;
            p.angle = input.angle || 0;
        }
    });

    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i]; b.life -= dt;
        b.x += b.vx * dt; b.y += b.vy * dt;

        if (b.life <= 0 || checkServerWallCollision(b.x, b.y, b.radius)) {
            gameState.bullets.splice(i, 1); continue;
        }

        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && !p.invisibleActive && Math.hypot(p.x - b.x, p.y - b.y) < 22) {
                if (p.overshield > 0) {
                    p.overshield -= b.dmg; if (p.overshield < 0) p.overshield = 0;
                } else {
                    p.hp -= b.dmg;
                }

                io.to(b.ownerId).emit('hitFeedback', { x: p.x, y: p.y, dmg: b.dmg });

                if (p.hp <= 0) {
                    let killer = gameState.players[b.ownerId];
                    if (killer) {
                        if (killer.team === 'red') gameState.scores.red++; else gameState.scores.blue++;
                        io.emit('feedKillMessage', `${killer.name} [ELIMINATED] ${p.name}`);
                    }
                    setTimeout(() => {
                        p.x = 200 + Math.random() * 1600; p.y = 200 + Math.random() * 1600;
                        p.hp = 100; p.overshield = 50;
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
http.listen(PORT, () => { console.log(`MATRIX SELECTION ENGINE ONLINE ON PORT ${PORT}`); });