const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const PORT = process.env.PORT || 3000;
const MAP_SIZE = 2000;
const GRID_SIZE = 40;
const ROUND_DURATION = 120; 

const WEAPONS = {
    railgun: { name: "Railgun", speed: 45, damage: 45, knockback: 3, radius: 2, magSize: 3, reloadTime: 2200, fireRate: 1500, color: '#00ffff', type: 'linear' },
    heavy_revolver: { name: "Heavy Revolver", speed: 20, damage: 35, knockback: 24, radius: 4, magSize: 6, reloadTime: 1800, fireRate: 700, color: '#f97316', type: 'standard' },
    bouncing_sniper: { name: "Bouncing Sniper", speed: 32, damage: 40, knockback: 5, radius: 3, magSize: 5, reloadTime: 2400, fireRate: 1000, color: '#a855f7', type: 'bounce', bounces: 3 },
    chaingun: { name: "Armor-Piercing Chaingun", speed: 18, damage: 8, knockback: 1, radius: 3, magSize: 60, reloadTime: 2000, fireRate: 90, selfSlow: true, color: '#fbbf24', type: 'standard' },
    burst_rifle: { name: "Burst Rifle", speed: 25, damage: 11, knockback: 2, radius: 3, magSize: 24, reloadTime: 1400, fireRate: 450, color: '#38bdf8', type: 'burst' },
    bouncing_betty: { name: "Bouncing Betty", speed: 11, damage: 10, knockback: 4, radius: 6, magSize: 3, reloadTime: 2000, fireRate: 900, color: '#ef4444', type: 'betty' },
    napalm: { name: "Napalm Launcher", speed: 12, damage: 15, knockback: 2, radius: 7, magSize: 4, reloadTime: 2200, fireRate: 850, color: '#ea580c', type: 'napalm' },
    prox_mine: { name: "Proximity Mine", speed: 8, damage: 55, knockback: 10, radius: 8, magSize: 2, reloadTime: 2500, fireRate: 1200, color: '#b91c1c', type: 'mine' },
    cluster_bomb: { name: "Cluster Bomb", speed: 13, damage: 20, knockback: 5, radius: 6, magSize: 3, reloadTime: 2100, fireRate: 950, color: '#f43f5e', type: 'cluster' },
    micro_nuke: { name: "Micro-Nuke", speed: 6, damage: 85, knockback: 32, radius: 12, magSize: 1, reloadTime: 4000, fireRate: 3000, color: '#22c55e', type: 'nuke' },
    stun_baton: { name: "Stun Baton", speed: 16, damage: 12, knockback: 0.5, radius: 6, magSize: 10, reloadTime: 1000, fireRate: 300, color: '#eab308', type: 'stun' },
    plasma_rifle: { name: "Plasma Rifle", speed: 17, damage: 13, knockback: 2.5, radius: 5, magSize: 30, reloadTime: 1500, fireRate: 180, color: '#ec4899', type: 'homing' },
    shotgun: { name: "Shotgun Spread", speed: 15, damage: 9, knockback: 12, radius: 4, magSize: 5, reloadTime: 1900, fireRate: 750, color: '#64748b', type: 'shotgun' },
    seeker: { name: "Seeker Missile", speed: 8, damage: 35, knockback: 15, radius: 6, magSize: 2, reloadTime: 2800, fireRate: 1600, color: '#6366f1', type: 'homing' },
    sawblade: { name: "Sawblade Launcher", speed: 14, damage: 24, knockback: 4, radius: 8, magSize: 6, reloadTime: 1800, fireRate: 400, color: '#14b8a6', type: 'bounce', bounces: 5 }
};

const ABILITIES = {
    blink: { cooldown: 4000 }, slide: { cooldown: 3000 }, stim: { cooldown: 10000 },
    decoy: { cooldown: 14000 }, shield: { cooldown: 14000 }, smoke: { cooldown: 9000 },
    pulse: { cooldown: 8000 }, gravity: { cooldown: 15000 }, overdrive: { cooldown: 16000 },
    teleport: { cooldown: 20000 }, heal: { cooldown: 18000 }, cloak: { cooldown: 22000 }
};

let rooms = {};

function generateMapLayout(style) {
    let grid = [];
    const blocks = MAP_SIZE / GRID_SIZE;
    for (let x = 0; x < blocks; x++) {
        grid[x] = [];
        for (let y = 0; y < blocks; y++) {
            grid[x][y] = (x === 0 || y === 0 || x === blocks - 1 || y === blocks - 1) ? 1 : 0;
        }
    }
    if (style === 'desert_outpost') {
        let midX = Math.floor(blocks / 2);
        for (let y = 5; y < blocks - 5; y++) {
            if (y > 8 && y < blocks - 9 && y !== Math.floor(blocks / 2)) {
                grid[midX][y] = 1;
            }
        }
    } else {
        for (let x = 8; x < blocks - 8; x += 10) {
            for (let y = 8; y < blocks - 8; y += 10) {
                if (grid[x]) { grid[x][y] = 1; grid[x+1][y] = 1; }
            }
        }
    }
    return grid;
}

function checkWallCollision(x, y, radius, grid) {
    if (!grid) return false;
    const blocks = MAP_SIZE / GRID_SIZE;
    let startX = Math.max(0, Math.floor((x - radius) / GRID_SIZE));
    let endX = Math.min(blocks - 1, Math.floor((x + radius) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - radius) / GRID_SIZE));
    let endY = Math.min(blocks - 1, Math.floor((y + radius) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (grid[gx] && grid[gx][gy] === 1) {
                let wX = gx * GRID_SIZE;
                let wY = gy * GRID_SIZE;
                if (x + radius > wX && x - radius < wX + GRID_SIZE && y + radius > wY && y - radius < wY + GRID_SIZE) {
                    return { x: wX, y: wY, gx, gy };
                }
            }
        }
    }
    return false;
}

function createNewRoom(sizePref, modePref) {
    let roomId = "room_" + Date.now();
    let targetCount = sizePref === '1v1' ? 2 : (sizePref === '2v2' ? 4 : 6);
    
    rooms[roomId] = {
        id: roomId, players: {}, bullets: [], decoys: [], fields: [],
        map: generateMapLayout('desert_outpost'), mapStyle: 'desert_outpost',
        sizePref, mode: modePref, state: "lobby", requiredPlayers: targetCount,
        scores: { red: 0, blue: 0 }, matchTimer: ROUND_DURATION, roundNumber: 1,
        mapVotes: { desert_outpost: 0, urban_blocks: 0 }, votedPlayers: new Set(),
        kothZone: { x: MAP_SIZE / 2, y: MAP_SIZE / 2, radius: 120, controllingTeam: 'none', captureProgress: 0 },
        ctfFlags: {
            red: { x: 250, y: MAP_SIZE / 2, homeX: 250, homeY: MAP_SIZE / 2, carrierId: null, status: 'home' },
            blue: { x: MAP_SIZE - 250, y: MAP_SIZE / 2, homeX: MAP_SIZE - 250, homeY: MAP_SIZE / 2, carrierId: null, status: 'home' }
        }
    };
    return rooms[roomId];
}

function triggerPlayerRespawn(room, player) {
    if (room.mode === 'CTF') {
        Object.keys(room.ctfFlags).forEach(teamColor => {
            if (room.ctfFlags[teamColor].carrierId === player.id) {
                room.ctfFlags[teamColor].carrierId = null;
                room.ctfFlags[teamColor].status = 'dropped';
                room.ctfFlags[teamColor].x = player.x;
                room.ctfFlags[teamColor].y = player.y;
            }
        });
    }

    setTimeout(() => {
        if (!room || !player) return;
        player.hp = 100;
        player.vx = 0; player.vy = 0;
        player.x = player.team === 'red' ? 250 : MAP_SIZE - 250;
        player.y = 400 + (Math.random() * 300);
        player.ammo = WEAPONS[player.loadout[player.activeWeaponIndex]]?.magSize || 10;
        player.isReloading = false;
        player.controllingDecoyId = null;
        io.to(room.id).emit('playerRespawned', { id: player.id, x: player.x, y: player.y });
    }, 3000); 
}

function triggerExplosionRing(room, x, y, radius, damage, knockback, ownerId) {
    room.fields.push({ type: 'explosion_flash', x: x, y: y, radius: radius, expiresAt: Date.now() + 250 });
    
    Object.values(room.players).forEach(p => {
        if (p.hp <= 0) return;
        let dist = Math.hypot(p.x - x, p.y - y);
        if (dist < radius + 16) {
            if (p.id !== ownerId && p.team === room.players[ownerId]?.team) return; 
            let angle = Math.atan2(p.y - y, p.x - x);
            if (Date.now() < p.shieldActiveUntil) {
                p.shieldActiveUntil = 0;
            } else {
                p.hp -= Math.floor(damage * (1 - dist / (radius + 16)));
                p.vx += Math.cos(angle) * knockback;
                p.vy += Math.sin(angle) * knockback;
            }
            if (p.hp <= 0) {
                p.hp = 0;
                if (p.id !== ownerId && room.players[ownerId]) {
                    if (room.players[ownerId].team === 'red') room.scores.red += (room.mode === 'TDM' ? 1 : 0); 
                    else room.scores.blue += (room.mode === 'TDM' ? 1 : 0);
                }
                triggerPlayerRespawn(room, p);
            }
        }
    });

    for(let j = room.decoys.length - 1; j >= 0; j--) {
        let dec = room.decoys[j];
        if (Math.hypot(dec.x - x, dec.y - y) < radius + 16) {
            dec.hp -= damage;
            if(dec.hp <= 0) {
                let creator = room.players[dec.ownerId];
                if (creator && creator.controllingDecoyId === dec.id) {
                    creator.controllingDecoyId = null;
                    creator.cloakActiveUntil = 0; 
                }
                room.decoys.splice(j, 1);
            }
        }
    }
}

function launchActiveMatch(room) {
    room.state = "playing";
    room.matchTimer = ROUND_DURATION;
    room.bullets = []; room.decoys = []; room.fields = [];
    room.votedPlayers.clear();

    let nextStyle = 'desert_outpost';
    if (room.mapVotes.urban_blocks > room.mapVotes.desert_outpost) {
        nextStyle = 'urban_blocks';
    }
    room.mapStyle = nextStyle;
    room.map = generateMapLayout(room.mapStyle);
    room.mapVotes = { desert_outpost: 0, urban_blocks: 0 };

    room.kothZone = { x: MAP_SIZE / 2, y: MAP_SIZE / 2, radius: 120, controllingTeam: 'none', captureProgress: 0 };
    room.ctfFlags = {
        red: { x: 250, y: MAP_SIZE / 2, homeX: 250, homeY: MAP_SIZE / 2, carrierId: null, status: 'home' },
        blue: { x: MAP_SIZE - 250, y: MAP_SIZE / 2, homeX: MAP_SIZE - 250, homeY: MAP_SIZE / 2, carrierId: null, status: 'home' }
    };

    let pArray = Object.values(room.players);
    pArray.forEach((p, idx) => {
        p.team = idx % 2 === 0 ? 'red' : 'blue';
        p.x = p.team === 'red' ? 250 : MAP_SIZE - 250;
        p.y = 400 + (idx * 120);
        p.hp = 100; p.vx = 0; p.vy = 0;
        p.activeWeaponIndex = 0;
        p.ammo = WEAPONS[p.loadout[0]]?.magSize || 10;
        p.isReloading = false; p.lastShotTime = 0;
        p.ability1ReadyAt = 0; p.ability2ReadyAt = 0;
        p.shieldActiveUntil = 0; p.overdriveActiveUntil = 0;
        p.cloakActiveUntil = 0; p.stimActiveUntil = 0;
        p.controllingDecoyId = null;
        p.recallX = p.x; p.recallY = p.y;
    });

    io.to(room.id).emit('matchStarted', { map: room.map, mapStyle: room.mapStyle, players: room.players, round: room.roundNumber, mode: room.mode });
}

setInterval(() => {
    Object.values(rooms).forEach(room => {
        if (room.state === "playing") {
            Object.values(room.players).forEach(p => { if (p.hp > 0) { p.recallX = p.x; p.recallY = p.y; } });
        }
    });
}, 3000);

setInterval(() => {
    Object.values(rooms).forEach(room => {
        if (room.state === "playing") {
            if (room.matchTimer > 0) {
                room.matchTimer--;
                
                if (room.mode === "KOTH") {
                    let redInZone = 0, blueInZone = 0;
                    Object.values(room.players).forEach(p => {
                        if (p.hp > 0 && !p.controllingDecoyId && Math.hypot(p.x - room.kothZone.x, p.y - room.kothZone.y) < room.kothZone.radius) {
                            if (p.team === 'red') redInZone++;
                            if (p.team === 'blue') blueInZone++;
                        }
                    });

                    if (redInZone > 0 && blueInZone === 0) {
                        if (room.kothZone.controllingTeam === 'red') room.scores.red += 2;
                        else {
                            room.kothZone.captureProgress += 25;
                            if (room.kothZone.captureProgress >= 100) { room.kothZone.controllingTeam = 'red'; room.kothZone.captureProgress = 100; }
                        }
                    } else if (blueInZone > 0 && redInZone === 0) {
                        if (room.kothZone.controllingTeam === 'blue') room.scores.blue += 2;
                        else {
                            room.kothZone.captureProgress -= 25;
                            if (room.kothZone.captureProgress <= -100) { room.kothZone.controllingTeam = 'blue'; room.kothZone.captureProgress = -100; }
                        }
                    }
                }
            } else { 
                room.roundNumber++; 
                room.state = "loadout_selection"; 
                io.to(room.id).emit('showLoadoutCustomizer', { round: room.roundNumber }); 
            }
        }
    });
}, 1000);

setInterval(() => {
    Object.values(rooms).forEach(room => {
        if (room.state !== "playing") return;
        let now = Date.now();

        for(let i = room.fields.length - 1; i >= 0; i--) {
            let f = room.fields[i];
            if (now > f.expiresAt) { room.fields.splice(i, 1); continue; }

            if (f.type === 'gravity') {
                Object.values(room.players).forEach(p => {
                    if (p.hp > 0 && p.team !== f.team) {
                        let dist = Math.hypot(f.x - p.x, f.y - p.y);
                        if (dist < f.radius) {
                            let angle = Math.atan2(f.y - p.y, f.x - p.x);
                            p.vx += Math.cos(angle) * 1.6; p.vy += Math.sin(angle) * 1.6;
                        }
                    }
                });
            } else if (f.type === 'napalm_pool') {
                Object.values(room.players).forEach(p => {
                    if (p.hp > 0 && Math.hypot(f.x - p.x, f.y - p.y) < f.radius + 14) {
                        if (now - (p.lastBurnTime || 0) > 250) {
                            p.hp = Math.max(0, p.hp - 2); p.lastBurnTime = now;
                            if (p.hp <= 0) { triggerPlayerRespawn(room, p); }
                        }
                    }
                });
            }
        }

        for (let i = room.decoys.length - 1; i >= 0; i--) {
            let dec = room.decoys[i];
            if (now > dec.expiresAt || dec.hp <= 0) {
                let creator = room.players[dec.ownerId];
                if (creator && creator.controllingDecoyId === dec.id) {
                    creator.controllingDecoyId = null;
                    creator.cloakActiveUntil = 0; 
                }
                room.decoys.splice(i, 1);
                continue;
            }
            dec.vx *= 0.8; dec.vy *= 0.8;
            let nX = dec.x + dec.vx; let nY = dec.y + dec.vy;
            if (!checkWallCollision(nX, nY, 16, room.map)) { dec.x = nX; dec.y = nY; }
        }

        Object.values(room.players).forEach(p => {
            if (p.hp <= 0) return;

            let curWep = p.loadout[p.activeWeaponIndex] || 'railgun';
            let profile = WEAPONS[curWep] || WEAPONS.railgun;
            let speedLimit = profile.selfSlow ? 2.5 : 4.2;
            if (now < p.stimActiveUntil) speedLimit += 2.0;

            p.vx *= 0.75; p.vy *= 0.75;
            if (Math.abs(p.vx) < 0.05) p.vx = 0;
            if (Math.abs(p.vy) < 0.05) p.vy = 0;

            if (!p.controllingDecoyId) {
                let nextX = p.x + p.vx; if (!checkWallCollision(nextX, p.y, 16, room.map)) p.x = nextX;
                let nextY = p.y + p.vy; if (!checkWallCollision(p.x, nextY, 16, room.map)) p.y = nextY;
            } else {
                let targetDecoy = room.decoys.find(d => d.id === p.controllingDecoyId);
                if (targetDecoy) {
                    targetDecoy.vx = p.vx; targetDecoy.vy = p.vy;
                    targetDecoy.angle = p.angle;
                }
            }

            if (room.mode === 'CTF') {
                if (p.team === 'red') {
                    let flag = room.ctfFlags.blue;
                    if (!flag.carrierId && !p.controllingDecoyId && Math.hypot(p.x - flag.x, p.y - flag.y) < 28) {
                        flag.carrierId = p.id; flag.status = 'carried';
                    }
                    if (flag.carrierId === p.id && Math.hypot(p.x - room.ctfFlags.red.homeX, p.y - room.ctfFlags.red.homeY) < 30 && room.ctfFlags.red.status === 'home') {
                        room.scores.red += 1; flag.status = 'home'; flag.carrierId = null;
                        flag.x = flag.homeX; flag.y = flag.homeY;
                    }
                    if (room.ctfFlags.red.status === 'dropped' && Math.hypot(p.x - room.ctfFlags.red.x, p.y - room.ctfFlags.red.y) < 28) {
                        room.ctfFlags.red.status = 'home'; room.ctfFlags.red.x = room.ctfFlags.red.homeX; room.ctfFlags.red.y = room.ctfFlags.red.homeY;
                    }
                }
                if (p.team === 'blue') {
                    let flag = room.ctfFlags.red;
                    if (!flag.carrierId && !p.controllingDecoyId && Math.hypot(p.x - flag.x, p.y - flag.y) < 28) {
                        flag.carrierId = p.id; flag.status = 'carried';
                    }
                    if (flag.carrierId === p.id && Math.hypot(p.x - room.ctfFlags.blue.homeX, p.y - room.ctfFlags.blue.homeY) < 30 && room.ctfFlags.blue.status === 'home') {
                        room.scores.blue += 1; flag.status = 'home'; flag.carrierId = null;
                        flag.x = flag.homeX; flag.y = flag.homeY;
                    }
                    if (room.ctfFlags.blue.status === 'dropped' && Math.hypot(p.x - room.ctfFlags.blue.x, p.y - room.ctfFlags.blue.y) < 28) {
                        room.ctfFlags.blue.status = 'home'; room.ctfFlags.blue.x = room.ctfFlags.blue.homeX; room.ctfFlags.blue.y = room.ctfFlags.blue.homeY;
                    }
                }
            }
        });

        if (room.mode === 'CTF') {
            Object.keys(room.ctfFlags).forEach(c => {
                let f = room.ctfFlags[c];
                if (f.status === 'carried' && f.carrierId) {
                    let carrier = room.players[f.carrierId];
                    if (carrier) { f.x = carrier.x; f.y = carrier.y; }
                }
            });
        }

        for (let i = room.bullets.length - 1; i >= 0; i--) {
            let b = room.bullets[i];
            
            if (b.type === 'homing') {
                let closest = null; let minDist = 400;
                Object.values(room.players).forEach(p => {
                    if (p.hp > 0 && p.team !== room.players[b.ownerId]?.team) {
                        let d = Math.hypot(p.x - b.x, p.y - b.y);
                        if (d < minDist) { minDist = d; closest = p; }
                    }
                });
                if (closest) {
                    let targetAngle = Math.atan2(closest.y - b.y, closest.x - b.x);
                    b.dx = b.dx * 0.85 + Math.cos(targetAngle) * 0.15;
                    b.dy = b.dy * 0.85 + Math.sin(targetAngle) * 0.15;
                }
            }

            if (b.type === 'mine' && b.isSet) {
                Object.values(room.players).forEach(p => {
                    if (p.hp > 0 && p.team !== room.players[b.ownerId]?.team) {
                        if (Math.hypot(b.x - p.x, b.y - p.y) < b.radius + 30) {
                            triggerExplosionRing(room, b.x, b.y, 110, b.damage, b.knockback, b.ownerId);
                            room.bullets.splice(i, 1); return;
                        }
                    }
                });
                continue;
            }

            b.x += b.dx * b.speed; b.y += b.dy * b.speed;

            let col = checkWallCollision(b.x, b.y, b.radius, room.map);
            if (col || b.x < 0 || b.x > MAP_SIZE || b.y < 0 || b.y > MAP_SIZE) {
                if ((b.type === 'bounce' || b.type === 'sawblade') && b.bouncesLeft > 0) {
                    b.bouncesLeft--;
                    if (b.x - b.speed <= col.x || b.x + b.speed >= col.x + GRID_SIZE) b.dx *= -1;
                    else b.dy *= -1;
                    continue;
                }
                if (b.type === 'mine') { b.isSet = true; b.speed = 0; continue; }
                if (b.type === 'nuke') { triggerExplosionRing(room, b.x, b.y, 220, b.damage, b.knockback, b.ownerId); room.bullets.splice(i, 1); continue; }
                if (b.type === 'cluster') {
                    for(let k=0; k<6; k++) {
                        let a = (Math.PI*2/6)*k;
                        room.bullets.push({ ownerId: b.ownerId, x: b.x, y: b.y, dx: Math.cos(a), dy: Math.sin(a), speed: 10, damage: 12, knockback: 3, radius: 3, color: '#f43f5e', type: 'standard' });
                    }
                }
                if (b.type === 'betty') { triggerExplosionRing(room, b.x, b.y, 85, b.damage, b.knockback, b.ownerId); }
                if (b.type === 'napalm') {
                    for(let n=0; n<3; n++) room.fields.push({ type: 'napalm_pool', x: b.x + (Math.random()*60-30), y: b.y + (Math.random()*60-30), radius: 55, expiresAt: now + 4000 });
                }

                room.bullets.splice(i, 1); continue;
            }

            let hit = false;
            for (let j = room.decoys.length - 1; j >= 0; j--) {
                let dec = room.decoys[j];
                if (dec.team !== room.players[b.ownerId]?.team && Math.hypot(b.x - dec.x, b.y - dec.y) < 16 + b.radius) {
                    hit = true; dec.hp -= b.damage; 
                    if (dec.hp <= 0) {
                        let creator = room.players[dec.ownerId];
                        if (creator && creator.controllingDecoyId === dec.id) {
                            creator.controllingDecoyId = null;
                            creator.cloakActiveUntil = 0;
                        }
                        room.decoys.splice(j, 1);
                    }
                    break;
                }
            }

            if (!hit) {
                Object.values(room.players).forEach(p => {
                    if (p.hp <= 0 || p.id === b.ownerId || hit) return;
                    if (p.team === room.players[b.ownerId]?.team) return;

                    if (Math.hypot(b.x - p.x, b.y - p.y) < 16 + b.radius) {
                        hit = true;
                        if (now < p.shieldActiveUntil) { p.shieldActiveUntil = 0; } 
                        else {
                            p.hp -= b.damage; p.vx += b.dx * b.knockback; p.vy += b.dy * b.knockback;
                            if (b.type === 'stun') { p.vx *= 0.1; p.vy *= 0.1; }
                        }
                        if (b.type === 'nuke') triggerExplosionRing(room, b.x, b.y, 220, b.damage, b.knockback, b.ownerId);
                        if (b.type === 'betty') triggerExplosionRing(room, b.x, b.y, 85, b.damage, b.knockback, b.ownerId);

                        if (p.hp <= 0) {
                            p.hp = 0;
                            if (room.players[b.ownerId]) {
                                if (room.players[b.ownerId].team === 'red') room.scores.red += (room.mode === 'TDM' ? 1 : 0); 
                                else room.scores.blue += (room.mode === 'TDM' ? 1 : 0);
                            }
                            triggerPlayerRespawn(room, p);
                        }
                    }
                });
            }

            if (hit && b.type !== 'railgun') { room.bullets.splice(i, 1); }
        }

        io.to(room.id).emit('serverTickUpdate', { 
            players: room.players, bullets: room.bullets, decoys: room.decoys, fields: room.fields,
            scores: room.scores, state: room.state, mapStyle: room.mapStyle, matchTimer: room.matchTimer,
            mapVotes: room.mapVotes, kothZone: room.kothZone, ctfFlags: room.ctfFlags, mode: room.mode
        });
    });
}, 1000 / 60);

io.on('connection', (socket) => {
    socket.on('joinQueue', (data) => {
        let sizePref = data.sizePref || "1v1"; let modePref = data.modePref || "TDM";
        let targetRoom = Object.values(rooms).find(r => r.state === "lobby" && r.sizePref === sizePref && r.mode === modePref && Object.keys(r.players).length < r.requiredPlayers);
        if (!targetRoom) targetRoom = createNewRoom(sizePref, modePref);

        socket.roomId = targetRoom.id; socket.join(targetRoom.id);
        targetRoom.players[socket.id] = {
            id: socket.id, name: data.name || "Operator", x: 1000, y: 1000, hp: 100, vx: 0, vy: 0, angle: 0, team: 'none',
            loadout: data.loadout || ['railgun', 'heavy_revolver', 'bouncing_sniper'], abilities: data.abilities || ['blink', 'slide'],
            activeWeaponIndex: 0, ammo: 10, isReloading: false, lastShotTime: 0, selectionConfirmed: true, controllingDecoyId: null
        };

        socket.emit('roomJoined', { roomId: targetRoom.id, map: targetRoom.map, mapStyle: targetRoom.mapStyle, state: targetRoom.state, mode: targetRoom.mode });
        if (Object.keys(targetRoom.players).length >= targetRoom.requiredPlayers && targetRoom.state === "lobby") launchActiveMatch(targetRoom);
    });

    socket.on('castMapVote', (style) => {
        let room = rooms[socket.roomId]; if (!room) return;
        if (room.votedPlayers.has(socket.id)) return;
        if (room.mapVotes[style] !== undefined) {
            room.mapVotes[style]++;
            room.votedPlayers.add(socket.id);
            io.to(room.id).emit('voteRegisteredUpdate', room.mapVotes);
        }
    });

    socket.on('updateLoadout', (data) => {
        let room = rooms[socket.roomId]; if (!room) return;
        let p = room.players[socket.id]; if (!p) return;
        if (data.loadout && data.loadout.length === 3) p.loadout = data.loadout;
        if (data.abilities && data.abilities.length === 2) p.abilities = data.abilities;
        p.selectionConfirmed = true; socket.emit('loadoutActionAck');
        if (Object.values(room.players).every(pl => pl.selectionConfirmed)) launchActiveMatch(room);
    });

    socket.on('skipLoadout', () => {
        let room = rooms[socket.roomId]; if (!room) return;
        let p = room.players[socket.id]; if (!p) return;
        p.selectionConfirmed = true; socket.emit('loadoutActionAck');
        if (Object.values(room.players).every(pl => pl.selectionConfirmed)) launchActiveMatch(room);
    });

    socket.on('switchWeapon', (idx) => {
        let room = rooms[socket.roomId]; if (!room || room.state !== "playing") return;
        let p = room.players[socket.id]; if (!p || p.hp <= 0 || p.isReloading) return;
        if (idx >= 0 && idx < 3) { p.activeWeaponIndex = idx; p.ammo = WEAPONS[p.loadout[idx]]?.magSize || 10; }
    });

    socket.on('triggerReload', () => {
        let room = rooms[socket.roomId]; if (!room || room.state !== "playing") return;
        let p = room.players[socket.id]; if (!p || p.hp <= 0 || p.isReloading) return;
        let profile = WEAPONS[p.loadout[p.activeWeaponIndex]] || WEAPONS.railgun;
        p.isReloading = true;
        setTimeout(() => {
            let activeRoom = rooms[socket.roomId];
            if (activeRoom && activeRoom.players[socket.id]) {
                let lp = activeRoom.players[socket.id]; lp.ammo = profile.magSize; lp.isReloading = false;
            }
        }, profile.reloadTime);
    });

    socket.on('playerActionInput', (data) => {
        let room = rooms[socket.roomId]; if (!room || room.state !== "playing") return;
        let p = room.players[socket.id]; if (!p || p.hp <= 0) return;
        
        let curWep = p.loadout[p.activeWeaponIndex] || 'railgun';
        let profile = WEAPONS[curWep] || WEAPONS.railgun;
        let speed = profile.selfSlow ? 2.5 : 4.2;
        if (Date.now() < p.stimActiveUntil) speed += 2.0;

        let dx = 0; let dy = 0;
        if (data.w) dy -= 1; if (data.s) dy += 1;
        if (data.a) dx -= 1; if (data.d) dx += 1;

        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }
        p.vx += dx * speed * 0.25; p.vy += dy * speed * 0.25;
        p.angle = data.angle;
    });

    socket.on('useAbility', (index) => {
        let room = rooms[socket.roomId]; if (!room || room.state !== "playing") return;
        let p = room.players[socket.id]; if (!p || p.hp <= 0) return;
        let abilityKey = p.abilities[index]; let abProfile = ABILITIES[abilityKey]; if (!abProfile) return;
        let now = Date.now();
        if (index === 0 && now < p.ability1ReadyAt) return;
        if (index === 1 && now < p.ability2ReadyAt) return;

        if (index === 0) p.ability1ReadyAt = now + abProfile.cooldown; else p.ability2ReadyAt = now + abProfile.cooldown;

        switch (abilityKey) {
            case 'blink':
                let originX = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.x || p.x) : p.x;
                let originY = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.y || p.y) : p.y;
                let bX = originX + Math.cos(p.angle) * 120; let bY = originY + Math.sin(p.angle) * 120;
                if (!checkWallCollision(bX, bY, 16, room.map)) {
                    if (p.controllingDecoyId) {
                        let targetDec = room.decoys.find(d=>d.id===p.controllingDecoyId);
                        if(targetDec) { targetDec.x = bX; targetDec.y = bY; }
                    } else { p.x = bX; p.y = bY; }
                } break;
            case 'slide': 
                if (p.controllingDecoyId) {
                    let td = room.decoys.find(d=>d.id===p.controllingDecoyId);
                    if (td) { td.vx += Math.cos(p.angle) * 28; td.vy += Math.sin(p.angle) * 28; }
                } else { p.vx += Math.cos(p.angle) * 28; p.vy += Math.sin(p.angle) * 28; }
                break;
            case 'stim': p.stimActiveUntil = now + 4000; p.hp = Math.min(100, p.hp + 10); break;
            case 'decoy': 
                let decId = "d_" + now + "_" + p.id;
                p.cloakActiveUntil = now + 10000; 
                p.controllingDecoyId = decId;
                room.decoys.push({
                    id: decId, ownerId: p.id, team: p.team, name: p.name,
                    x: p.x, y: p.y, vx: Math.cos(p.angle)*5, vy: Math.sin(p.angle)*5,
                    angle: p.angle, hp: 100, expiresAt: now + 10000
                });
                break;
            case 'shield': p.shieldActiveUntil = now + 5000; break;
            case 'smoke': 
                let smX = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.x || p.x) : p.x;
                let smY = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.y || p.y) : p.y;
                room.fields.push({ type: 'smoke', x: smX, y: smY, radius: 110, expiresAt: now + 6000 }); 
                break;
            case 'pulse': 
                let plX = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.x || p.x) : p.x;
                let plY = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.y || p.y) : p.y;
                io.to(room.id).emit('radarPulseFeedback', { x: plX, y: plY, team: p.team }); 
                break;
            case 'gravity': 
                let grX = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.x || p.x) : p.x;
                let grY = p.controllingDecoyId ? (room.decoys.find(d=>d.id===p.controllingDecoyId)?.y || p.y) : p.y;
                room.fields.push({ type: 'gravity', x: grX + Math.cos(p.angle)*80, y: grY + Math.sin(p.angle)*80, radius: 140, team: p.team, expiresAt: now + 5000 }); 
                break;
            case 'overdrive': p.overdriveActiveUntil = now + 5000; break;
            case 'teleport': if (!checkWallCollision(p.recallX, p.recallY, 16, room.map)) { p.x = p.recallX; p.y = p.recallY; } break;
            case 'heal': p.hp = Math.min(100, p.hp + 40); break;
            case 'cloak': p.cloakActiveUntil = now + 6000; break;
        }
    });

    socket.on('shootWeapon', () => {
        let room = rooms[socket.roomId]; if (!room || room.state !== "playing") return;
        let p = room.players[socket.id]; if (!p || p.hp <= 0 || p.isReloading || p.ammo <= 0) return;
        let profile = WEAPONS[p.loadout[p.activeWeaponIndex]] || WEAPONS.railgun;
        let now = Date.now();
        let rate = profile.fireRate; if (now < p.overdriveActiveUntil) rate *= 0.45;
        if (now - p.lastShotTime < rate) return;
        p.lastShotTime = now; p.ammo--;

        let fireX = p.x; let fireY = p.y;
        if (p.controllingDecoyId) {
            let activeDecoy = room.decoys.find(d => d.id === p.controllingDecoyId);
            if (activeDecoy) { fireX = activeDecoy.x; fireY = activeDecoy.y; }
        }

        if (profile.type === 'shotgun') {
            for(let i = -2; i <= 2; i++) {
                let dev = p.angle + (i * 0.12);
                room.bullets.push({ ownerId: p.id, x: fireX, y: fireY, dx: Math.cos(dev), dy: Math.sin(dev), speed: profile.speed, damage: profile.damage, knockback: profile.knockback, radius: profile.radius, color: profile.color, type: 'standard' });
            }
        } else if (profile.type === 'burst') {
            for(let i=0; i<3; i++) {
                setTimeout(() => {
                    let activeRoom = rooms[socket.roomId];
                    if(activeRoom && activeRoom.players[p.id] && activeRoom.players[p.id].hp > 0) {
                        let curP = activeRoom.players[p.id];
                        let bX = curP.x; let bY = curP.y;
                        if (curP.controllingDecoyId) {
                            let ad = activeRoom.decoys.find(d=>d.id === curP.controllingDecoyId);
                            if(ad) { bX = ad.x; bY = ad.y; }
                        }
                        activeRoom.bullets.push({ ownerId: p.id, x: bX, y: bY, dx: Math.cos(curP.angle), dy: Math.sin(curP.angle), speed: profile.speed, damage: profile.damage, knockback: profile.knockback, radius: profile.radius, color: profile.color, type: 'standard' });
                    }
                }, i * 90);
            }
        } else {
            room.bullets.push({
                ownerId: p.id, x: fireX + Math.cos(p.angle) * 22, y: fireY + Math.sin(p.angle) * 22,
                dx: Math.cos(p.angle), dy: Math.sin(p.angle), speed: profile.speed, damage: profile.damage,
                knockback: profile.knockback, radius: profile.radius, color: profile.color,
                type: profile.type, bouncesLeft: profile.bounces || 0, isSet: false
            });
        }
    });

    socket.on('disconnect', () => {
        if (socket.roomId && rooms[socket.roomId]) {
            let r = rooms[socket.roomId];
            let p = r.players[socket.id];
            if (p && p.controllingDecoyId) {
                r.decoys = r.decoys.filter(d => d.id !== p.controllingDecoyId);
            }
            delete r.players[socket.id];
            if (Object.keys(r.players).length === 0) delete rooms[socket.roomId];
        }
    });
});

server.listen(PORT, () => console.log(`Server live on port ${PORT}`));