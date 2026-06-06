const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000;
const GRID_SIZE = 40;
const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;

// Generate dummy structural arena grids
let mapGrid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));
for (let i = 0; i < 40; i++) {
    let rx = Math.floor(Math.random() * BLOCKS_COUNT);
    let ry = Math.floor(Math.random() * BLOCKS_COUNT);
    if (rx > 3 && rx < BLOCKS_COUNT - 4 && ry > 3 && ry < BLOCKS_COUNT - 4) {
        mapGrid[rx][ry] = 1;
    }
}

let gameState = {
    players: {},
    bullets: [],
    decoys: [],
    fields: [],
    scores: { red: 0, blue: 0 },
    state: 'playing', // Defaulting to immediate playback framework
    matchTimer: 120,
    mode: 'TDM',
    mapStyle: 'desert_outpost',
    kothZone: { x: 1000, y: 1000, radius: 140, controllingTeam: 'none' },
    ctfFlags: {
        red: { x: 200, y: 200, homeX: 200, homeY: 200, carrierId: null },
        blue: { x: 1800, y: 1800, homeX: 1800, homeY: 1800, carrierId: null }
    }
};

let registeredVotesMap = { desert_outpost: 0, urban_blocks: 0 };
let socketsVotedTracker = new Set();

function checkServerWallCollision(x, y, radius) {
    let startX = Math.max(0, Math.floor((x - radius) / GRID_SIZE));
    let endX = Math.min(BLOCKS_COUNT - 1, Math.floor((x + radius) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - radius) / GRID_SIZE));
    let endY = Math.min(BLOCKS_COUNT - 1, Math.floor((y + radius) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (mapGrid[gx] && mapGrid[gx][gy] === 1) {
                let wX = gx * GRID_SIZE; let wY = gy * GRID_SIZE;
                if (x + radius > wX && x - radius < wX + GRID_SIZE && y + radius > wY && y - radius < wY + GRID_SIZE) {
                    return true;
                }
            }
        }
    }
    return false;
}

io.on('connection', (socket) => {
    gameState.players[socket.id] = {
        id: socket.id,
        name: "Spectre",
        x: 400 + Math.random() * 400,
        y: 400 + Math.random() * 400,
        hp: 100,
        team: Math.random() > 0.5 ? 'red' : 'blue',
        loadout: ['railgun', 'chaingun', 'shotgun'],
        abilities: ['blink', 'stim'],
        activeWeaponIndex: 0,
        ammo: 30,
        isReloading: false,
        ability1ReadyAt: 0,
        ability2ReadyAt: 0,
        stimActiveUntil: 0,
        cloakActiveUntil: 0,
        controllingDecoyId: null,
        angle: 0,
        lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }
    };

    socket.emit('roomJoined', { map: mapGrid, mapStyle: gameState.mapStyle });
    io.emit('voteRegisteredUpdate', registeredVotesMap);

    socket.on('playerActionInput', (input) => {
        if (gameState.players[socket.id]) {
            gameState.players[socket.id].lastInputState = input;
        }
    });

    socket.on('switchWeapon', (idx) => {
        let p = gameState.players[socket.id];
        if (p && idx >= 0 && idx < 3) p.activeWeaponIndex = idx;
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
        if (p && p.hp > 0 && p.ammo > 0 && !p.isReloading) {
            p.ammo--;
            gameState.bullets.push({
                x: p.x + Math.cos(p.angle) * 20,
                y: p.y + Math.sin(p.angle) * 20,
                vx: Math.cos(p.angle) * 580, // Tracked strictly in units per second
                vy: Math.sin(p.angle) * 580,
                radius: 4,
                color: p.team === 'red' ? '#ff007f' : '#00f0ff',
                ownerId: socket.id,
                life: 2.5
            });
        }
    });

    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id];
        if (!p || p.hp <= 0) return;
        let now = Date.now();
        
        if (slotIdx === 0 && now > p.ability1ReadyAt) {
            p.ability1ReadyAt = now + 8000;
            if (p.abilities[0] === 'blink') {
                let nx = p.x + Math.cos(p.angle) * 120;
                let ny = p.y + Math.sin(p.angle) * 120;
                if (!checkServerWallCollision(nx, ny, 16)) { p.x = nx; p.y = ny; }
            } else if (p.abilities[0] === 'stim') {
                p.stimActiveUntil = now + 4000;
                p.hp = Math.min(100, p.hp + 10);
            }
        } else if (slotIdx === 1 && now > p.ability2ReadyAt) {
            p.ability2ReadyAt = now + 12000;
            if (p.abilities[1] === 'stim') {
                p.stimActiveUntil = now + 4000;
            } else {
                p.cloakActiveUntil = now + 6000;
            }
        }
    });

    socket.on('castMapVote', (style) => {
        if (!socketsVotedTracker.has(socket.id) && registeredVotesMap[style] !== undefined) {
            registeredVotesMap[style]++;
            socketsVotedTracker.add(socket.id);
            io.emit('voteRegisteredUpdate', registeredVotesMap);
        }
    });

    socket.on('joinQueue', (cfg) => {
        let p = gameState.players[socket.id];
        if (p) {
            p.name = cfg.name;
            p.loadout = cfg.loadout;
            p.abilities = cfg.abilities;
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        socketsVotedTracker.delete(socket.id);
    });
});

// High-Precision Server Time Tracker
let lastServerTickTime = performance.now();

setInterval(() => {
    let now = performance.now();
    let dt = (now - lastServerTickTime) / 1000;
    lastServerTickTime = now;
    if (dt > 0.1) dt = 0.1;

    // Evaluate moving bullets across explicit timing properties
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;

        let hitWall = checkServerWallCollision(b.x, b.y, b.radius);
        if (b.life <= 0 || hitWall) {
            gameState.bullets.splice(i, 1);
            continue;
        }

        // Handle hit registration loops safely against active frameworks
        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && Math.hypot(p.x - b.x, p.y - b.y) < 20) {
                p.hp -= 15;
                if (p.hp <= 0) {
                    let killer = gameState.players[b.ownerId];
                    if (killer) {
                        if (killer.team === 'red') gameState.scores.red++;
                        else gameState.scores.blue++;
                    }
                    setTimeout(() => {
                        p.hp = 100; p.x = 400 + Math.random() * 1200; p.y = 400 + Math.random() * 1200;
                        io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                    }, 3000);
                }
                b.life = 0;
            }
        });
    }

    // Process Authoritative Player Velocity Layers matching Client Speed Metrics
    Object.values(gameState.players).forEach(player => {
        if (player.hp <= 0 || player.controllingDecoyId) return;

        let input = player.lastInputState;
        let dx = 0; let dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;

        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let moveSpeed = 252; 
        if (player.loadout && player.loadout[player.activeWeaponIndex] === 'chaingun') moveSpeed = 150;
        if (Date.now() < player.stimActiveUntil) moveSpeed += 120;

        let nextX = player.x + (dx * moveSpeed * dt);
        let nextY = player.y + (dy * moveSpeed * dt);

        if (!checkServerWallCollision(nextX, player.y, 16)) player.x = nextX;
        if (!checkServerWallCollision(player.x, nextY, 16)) player.y = nextY;
        
        player.angle = input.angle || 0;
    });

    io.emit('serverTickUpdate', gameState);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`NEON APEX ENGINE LIVE ON PORT // ${PORT}`); });