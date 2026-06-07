const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000;
const GRID_SIZE = 40;
const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;

let mapGrid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));
for (let i = 0; i < 45; i++) {
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
    state: 'playing', 
    matchTimer: 120,
    mode: 'TDM',
    mapStyle: 'desert_outpost'
};

function checkServerWallCollision(x, y, radius) {
    const bufferRadius = radius - 0.5; // Padding skin buffer eliminates fractional rounding jitter
    let startX = Math.max(0, Math.floor((x - bufferRadius) / GRID_SIZE));
    let endX = Math.min(BLOCKS_COUNT - 1, Math.floor((x + bufferRadius) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - bufferRadius) / GRID_SIZE));
    let endY = Math.min(BLOCKS_COUNT - 1, Math.floor((y + bufferRadius) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (mapGrid[gx] && mapGrid[gx][gy] === 1) {
                let wX = gx * GRID_SIZE; let wY = gy * GRID_SIZE;
                if (x + bufferRadius > wX && x - bufferRadius < wX + GRID_SIZE && y + bufferRadius > wY && y - bufferRadius < wY + GRID_SIZE) {
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
        angle: 0,
        lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }
    };

    // Broadcast the full system map layout explicitly to the client upon initialization handshake
    socket.emit('roomJoined', { map: mapGrid, mapStyle: gameState.mapStyle });

    socket.on('playerActionInput', (input) => {
        if (gameState.players[socket.id]) gameState.players[socket.id].lastInputState = input;
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
                vx: Math.cos(p.angle) * 580,
                vy: Math.sin(p.angle) * 580,
                radius: 4,
                color: p.team === 'red' ? '#ff007f' : '#00f0ff',
                ownerId: socket.id,
                life: 2.5
            });
        }
    });

    socket.on('disconnect', () => { delete gameState.players[socket.id]; });
});

let lastServerTickTime = performance.now();

setInterval(() => {
    let now = performance.now();
    let dt = (now - lastServerTickTime) / 1000;
    lastServerTickTime = now;
    if (dt > 0.1) dt = 0.1;

    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i];
        b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
        if (b.life <= 0 || checkServerWallCollision(b.x, b.y, b.radius)) {
            gameState.bullets.splice(i, 1); continue;
        }
        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && Math.hypot(p.x - b.x, p.y - b.y) < 20) {
                p.hp -= 15;
                if (p.hp <= 0) {
                    let killer = gameState.players[b.ownerId];
                    if (killer) { if (killer.team === 'red') gameState.scores.red++; else gameState.scores.blue++; }
                    setTimeout(() => {
                        p.hp = 100; p.x = 400 + Math.random() * 1200; p.y = 400 + Math.random() * 1200;
                        io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                    }, 3000);
                }
                b.life = 0;
            }
        });
    }

    Object.values(gameState.players).forEach(player => {
        if (player.hp <= 0) return;
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