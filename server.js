const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000; const GRID_SIZE = 40; const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;

// Map Initialization Matrix Model Structure Array
let mapsCatalogDatabase = {};
function spinUpProceduralSeedMap(mapName) {
    let grid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));
    // Hard borders
    for (let i = 0; i < BLOCKS_COUNT; i++) {
        grid[i][0] = 1; grid[i][BLOCKS_COUNT - 1] = 1;
        grid[0][i] = 1; grid[BLOCKS_COUNT - 1][i] = 1;
    }
    // Random procedural geometry walls
    for (let k = 0; k < 35; k++) {
        let wx = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
        let wy = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
        let horizontal = Math.random() > 0.5;
        for (let l = 0; l < 6; l++) {
            if (horizontal) grid[wx + l][wy] = 1; else grid[wx][wy + l] = 1;
        }
    }
    // Insert environmental lava zones
    for (let v = 0; v < 6; v++) {
        let lx = Math.floor(Math.random() * (BLOCKS_COUNT - 6)) + 3;
        let ly = Math.floor(Math.random() * (BLOCKS_COUNT - 6)) + 3;
        grid[lx][ly] = 2; grid[lx+1][ly] = 2;
    }
    // Step trap zones
    for (let t = 0; t < 6; t++) {
        grid[Math.floor(Math.random()*(BLOCKS_COUNT-6))+3][Math.floor(Math.random()*(BLOCKS_COUNT-6))+3] = 3;
    }
    mapsCatalogDatabase[mapName] = grid;
}
spinUpProceduralSeedMap("ALPHA_SECTOR");
spinUpProceduralSeedMap("NEON_DISTRICT");

let gameState = { 
    players: {}, decoys: [], bullets: [], fields: [], items: [],
    scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180, 
    gamemode: 'TDM', mapGrid: mapsCatalogDatabase["ALPHA_SECTOR"],
    stormRadius: 1400, activeKingId: null, queueType: 'casual'
};
let matchmakingQueue = [];

function getRequiredPlayersCount(clashType, gamemode) {
    if (gamemode === 'ZOMBIE') return 3;
    if (clashType === '1v1') return 2;
    if (clashType === '2v2') return 4;
    if (clashType === '3v3') return 6;
    return 2;
}

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
            
            // Battle Royale continuous storm ring shrinkage
            if (gameState.stormRadius > 200) gameState.stormRadius -= 4;

            if (gameState.matchTimer <= 0) {
                concludeServerMatchSession();
            }
        }
    }, 1000);
}

function concludeServerMatchSession() {
    gameState.state = 'lobby';
    gameState.matchTimer = 180;
    gameState.stormRadius = 1400;
    clearInterval(matchClockInterval);

    Object.values(gameState.players).forEach(p => {
        let isWin = false;
        if(gameState.scores.red > gameState.scores.blue && p.team === 'red') isWin = true;
        if(gameState.scores.blue > gameState.scores.red && p.team === 'blue') isWin = true;
        
        io.to(p.id).emit('progressionAwarded', {
            xp: isWin ? 600 : 250,
            wins: isWin ? 1 : 0,
            rpChange: gameState.queueType === 'ranked' ? (isWin ? 25 : -15) : 0
        });
    });
    gameState.players = {};
}

function spawnLootNodeEntities() {
    gameState.items = [];
    for(let i=0; i<8; i++) {
        gameState.items.push({
            id: 'it_'+Math.random(),
            x: 300 + Math.random()*1400, y: 300 + Math.random()*1400,
            type: ['armor', 'health', 'invuln', 'token'][Math.floor(Math.random()*4)]
        });
    }
}

io.on('connection', (socket) => {
    socket.on('joinQueue', (data) => {
        let pProfile = {
            id: socket.id, name: data.name, device: data.device, clashType: data.clashType, gamemode: data.gamemode,
            x: 200 + Math.random() * 1600, y: 200 + Math.random() * 1600,
            hp: 100, overshield: 50, team: matchmakingQueue.length % 2 === 0 ? 'red' : 'blue', isZombie: false,
            loadout: data.loadout.slice(0,5), abilities: data.abilities.slice(0,3),
            activeWeaponIndex: 0, ammo: 30, maxAmmo: 30, isReloading: false, laserHeat: 0,
            ability1ReadyAt: 0, ability2ReadyAt: 0, ability3ReadyAt: 0,
            stimActiveUntil: 0, cloakActive: false, phaseActive: false, positionAnchored: false,
            shieldActiveUntil: 0, radarPulseActiveUntil: 0, damageBoostUntil: 0, invulnUntil: 0,
            killBuffUntil: 0, lastStandActive: false, reviveTokens: 1, killstreak: 0, assistPool: {},
            angle: 0, lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }, isKing: false
        };
        
        matchmakingQueue.push(pProfile);
        gameState.gamemode = data.gamemode;
        gameState.queueType = data.queueType || 'casual';
        
        // Dynamic map rotation selection
        gameState.mapGrid = mapsCatalogDatabase[Math.random() > 0.5 ? "ALPHA_SECTOR" : "NEON_DISTRICT"];
        socket.emit('roomJoined', { map: gameState.mapGrid });

        let needed = getRequiredPlayersCount(data.clashType, data.gamemode);

        if (matchmakingQueue.length >= needed && gameState.state === 'lobby') {
            gameState.state = 'playing';
            matchmakingQueue.forEach(p => { gameState.players[p.id] = p; });
            
            if (gameState.gamemode === 'ZOMBIE') {
                let keys = Object.keys(gameState.players);
                let patientZero = keys[Math.floor(Math.random() * keys.length)];
                gameState.players[patientZero].isZombie = true; gameState.players[patientZero].hp = 240;
            }

            // Initialize moving health zones
            gameState.fields = [
                { x: 500, y: 500, radius: 90, type: 'moving_heal', life: 999, vx: 40, vy: 20 },
                { x: 1500, y: 1200, radius: 90, type: 'moving_heal', life: 999, vx: -30, vy: 40 }
            ];

            spawnLootNodeEntities();
            matchmakingQueue = [];
            activateMatchTimerCountdown();
            io.emit('matchStarted', { map: gameState.mapGrid });
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
        if (p && idx >= 0 && idx < p.loadout.length && !p.isReloading) {
            p.activeWeaponIndex = idx;
        }
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
        if (!p || p.hp <= 0 || p.positionAnchored) return;

        let type = p.loadout[p.activeWeaponIndex];
        
        // Energy overheat processing logic for short-range emitters
        if (type === 'laser_beam') {
            if (p.laserHeat >= 100) return;
            p.laserHeat = Math.min(100, p.laserHeat + 14);
        } else {
            if (p.ammo <= 0 || p.isReloading) return;
            p.ammo--;
        }

        let pAngle = p.angle;
        
        // Recoil displacement offset application loop
        pAngle += (Math.random() - 0.5) * 0.06;

        let baseDmg = 14;
        if (p.damageBoostUntil && Date.now() < p.damageBoostUntil) baseDmg = 28;

        let bulletModel = { 
            x: p.x + Math.cos(pAngle)*22, y: p.y + Math.sin(pAngle)*22, 
            vx: Math.cos(pAngle)*700, vy: Math.sin(pAngle)*700, 
            radius: 4, color: '#fbbf24', ownerId: p.id, life: 1.8, 
            type: 'standard', dmg: baseDmg, armorPen: false 
        };

        // Mechanical updates map configurations
        if (type === 'railgun') {
            bulletModel.vx *= 2.2; bulletModel.dmg = 32; bulletModel.armorPen = true;
        } else if (type === 'chaingun') {
            bulletModel.vx *= 0.9; bulletModel.dmg = 10;
        } else if (type === 'shotgun') {
            for (let i = -2; i <= 2; i++) {
                let dev = pAngle + (i * 0.12);
                gameState.bullets.push({ ...bulletModel, vx: Math.cos(dev)*550, vy: Math.sin(dev)*550, dmg: 8, life: 0.7 });
            }
            return;
        } else if (type === 'heavy_revolver') {
            bulletModel.dmg = 40; bulletModel.radius = 6;
        } else if (type === 'bouncing_sniper') {
            bulletModel.type = 'bounce'; bulletModel.bounces = 3; bulletModel.dmg = 25;
        } else if (type === 'sawblade') {
            bulletModel.type = 'bounce'; bulletModel.bounces = 4; bulletModel.dmg = 18;
        } else if (type === 'napalm') {
            bulletModel.type = 'napalm_lob'; bulletModel.life = 0.9; bulletModel.vx *= 0.6; bulletModel.vy *= 0.6;
        } else if (type === 'seeker' || type === 'plasma_rifle') {
            bulletModel.type = 'homing'; bulletModel.vx *= 0.65; bulletModel.vy *= 0.65; bulletModel.life = 3.0;
        } else if (type === 'micro_nuke') {
            bulletModel.radius = 11; bulletModel.vx *= 0.4; bulletModel.vy *= 0.4; bulletModel.dmg = 70; bulletModel.type = 'nuke';
        }

        gameState.bullets.push(bulletModel);
    });

    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id]; if (!p || p.hp <= 0) return;
        let name = p.abilities[slotIdx]; let now = Date.now(); let readyProp = `ability${slotIdx + 1}ReadyAt`;
        if (now < p[readyProp]) return; p[readyProp] = now + 12000;

        if (name === 'blink') {
            let bx = p.x + Math.cos(p.angle) * 150; let by = p.y + Math.sin(p.angle) * 150;
            if (!checkServerWallCollision(bx, by, 16)) { p.x = bx; p.y = by; }
        } else if (name === 'stim') {
            p.stimActiveUntil = now + 4000; p.hp = Math.min(100, p.hp + 25);
        } else if (name === 'decoy') {
            // Decoy replica mirrors the source position and vectors away to draw aggro
            gameState.decoys.push({ x: p.x, y: p.y, vx: Math.cos(p.angle + Math.PI)*200, vy: Math.sin(p.angle + Math.PI)*200, angle: p.angle + Math.PI, life: 5.0, ownerId: p.id });
        } else if (name === 'shield') {
            p.shieldActiveUntil = now + 4000; p.overshield = Math.min(100, p.overshield + 40);
        } else if (name === 'smoke') {
            gameState.fields.push({ x: p.x, y: p.y, radius: 110, type: 'smoke', life: 6.0 });
        } else if (name === 'radar') {
            p.radarPulseActiveUntil = now + 4000;
        } else if (name === 'overdrive') {
            p.ammo = p.maxAmmo; p.isReloading = false;
        } else if (name === 'phase_shift') {
            p.phaseActive = true; setTimeout(() => { p.phaseActive = false; }, 2000);
        }
    });

    socket.on('disconnect', () => {
        delete gameState.players[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    });
});

// Primary Server Processing Tick Rate Frame Update
setInterval(() => {
    let dt = 1 / 60;
    if (gameState.state !== 'playing') return;

    // Decoy mirror lifetime update frames
    if (gameState.decoys) {
        for (let i = gameState.decoys.length - 1; i >= 0; i--) {
            let d = gameState.decoys[i]; d.life -= dt;
            if (d.life <= 0 || checkServerWallCollision(d.x + d.vx*dt, d.y + d.vy*dt, 14)) {
                gameState.decoys.splice(i, 1);
            } else {
                d.x += d.vx * dt; d.y += d.vy * dt;
            }
        }
    }

    // Environmental zone shifts
    gameState.fields.forEach(f => {
        if (f.type === 'moving_heal') {
            f.x += f.vx * dt; f.y += f.vy * dt;
            if (f.x < 100 || f.x > MAP_SIZE-100) f.vx *= -1;
            if (f.y < 100 || f.y > MAP_SIZE-100) f.vy *= -1;

            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) {
                    p.hp = Math.min(100, p.hp + 12 * dt);
                }
            });
        } else if (f.type === 'acid') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && p.invulnUntil < Date.now() && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) {
                    p.hp -= 15 * dt;
                }
            });
        }
    });

    // Check world state hazard intersections
    Object.values(gameState.players).forEach(p => {
        if(p.hp <= 0) return;
        let gx = Math.floor(p.x / GRID_SIZE);
        let gy = Math.floor(p.y / GRID_SIZE);
        if (gameState.mapGrid[gx] && gameState.mapGrid[gx][gy] === 2 && p.invulnUntil < Date.now()) {
            p.hp -= 25 * dt; // Lava Damage
        }
        if (gameState.mapGrid[gx] && gameState.mapGrid[gx][gy] === 3 && p.invulnUntil < Date.now()) {
            p.hp -= 5; gameState.mapGrid[gx][gy] = 0; // Trigger spike traps
        }

        // Apply continuous ticking decay on laser weapon mechanics
        if(p.laserHeat > 0) p.laserHeat = Math.max(0, p.laserHeat - 30 * dt);

        // Continuous outer storm boundary collapse damages
        let distFromCenter = Math.hypot(p.x - MAP_SIZE/2, p.y - MAP_SIZE/2);
        if (distFromCenter > gameState.stormRadius && p.invulnUntil < Date.now()) {
            p.hp -= 10 * dt;
        }
    });

    // Pickups item management systems
    for(let i = gameState.items.length - 1; i >= 0; i--) {
        let it = gameState.items[i];
        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && Math.hypot(p.x - it.x, p.y - it.y) < 24) {
                if (it.type === 'armor') p.overshield = Math.min(100, p.overshield + 50);
                if (it.type === 'health') p.hp = Math.min(100, p.hp + 40);
                if (it.type === 'invuln') p.invulnUntil = Date.now() + 3000;
                if (it.type === 'token') p.reviveTokens++;
                gameState.items.splice(i, 1);
            }
        });
    }

    // Bullet loop management systems
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i]; b.life -= dt;
        
        if (b.type === 'homing') {
            let target = null; let minD = 400;
            Object.values(gameState.players).forEach(p => {
                if (p.id !== b.ownerId && p.hp > 0) {
                    let d = Math.hypot(p.x - b.x, p.y - b.y); if (d < minD) { minD = d; target = p; }
                }
            });
            if (target) {
                let ang = Math.atan2(target.y - b.y, target.x - b.x); 
                b.vx = Math.cos(ang) * 500; b.vy = Math.sin(ang) * 500;
            }
        }

        b.x += b.vx * dt; b.y += b.vy * dt;
        let hit = checkServerWallCollision(b.x, b.y, b.radius);
        
        if (hit && b.type === 'bounce' && b.bounces-- > 0) { 
            b.vx = -b.vx; b.y -= b.vy * dt * 2; hit = false; 
        }

        if (b.life <= 0 || hit) {
            if (b.type === 'napalm_lob') gameState.fields.push({ x: b.x, y: b.y, radius: 65, type: 'acid', life: 4.0 });
            if (b.type === 'nuke') gameState.fields.push({ x: b.x, y: b.y, radius: 120, type: 'acid', life: 3.0 });
            gameState.bullets.splice(i, 1); continue;
        }

        // Damage resolution calculation matrices
        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && p.id !== b.ownerId && Math.hypot(p.x - b.x, p.y - b.y) < 22) {
                if (p.cloakActive || p.invulnUntil > Date.now()) return;

                // Log hit interaction mapping for assistance awards tracking
                p.assistPool[b.ownerId] = Date.now();

                // Compute headshot and critical calculation multipliers
                let isHead = Math.random() < 0.15;
                let isCrit = Math.random() < 0.10;
                let finalDmg = b.dmg;
                if (isHead) finalDmg *= 1.5;
                if (isCrit) finalDmg *= 1.3;

                // Fire redirection notification angles
                let tAngle = Math.atan2(b.vy, b.vx) + Math.PI;
                io.to(p.id).emit('damageTakenAngle', tAngle);

                // Shield / Overshield degradation filters
                if (p.overshield > 0 && !b.armorPen) {
                    p.overshield -= finalDmg;
                    if (p.overshield <= 0) {
                        p.overshield = 0;
                        io.emit('shieldCrackFX', { x: p.x, y: p.y });
                    }
                } else {
                    p.hp -= finalDmg;
                }

                // Complete hitmaker notification sync mechanics
                io.to(b.ownerId).emit('hitFeedback', { x: p.x, y: p.y, dmg: Math.ceil(finalDmg), isHead, isCrit, heavy: finalDmg > 30 });

                // Check condition logic models for Last Stand passives
                if (p.hp <= 10 && p.hp > 0 && !p.lastStandActive) {
                    p.lastStandActive = true; p.hp = 10;
                    p.invulnUntil = Date.now() + 2000; 
                }

                if (p.hp <= 0) {
                    let killer = gameState.players[b.ownerId];
                    if (killer) {
                        killer.killstreak++;
                        if (killer.team === 'red') gameState.scores.red++; else gameState.scores.blue++;
                        
                        // Push system global announcement streams
                        io.emit('feedKillMessage', `${killer.name} [ELIMINATED] ${p.name}`);
                        io.to(killer.id).emit('popupAnnouncement', { elim: `YOU ELIMINATED ${p.name}` });
                        
                        if([2, 3, 5].includes(killer.killstreak)) {
                            io.emit('popupAnnouncement', { streak: `${killer.name} IS ON A ${killer.killstreak} KILL STREAK!` });
                        }

                        // Apply tactical boost upgrades after secure confirmations
                        killer.killBuffUntil = Date.now() + 3000;
                        killer.overshield = Math.min(100, killer.overshield + 25);

                        // Gun Game structural index shifting updates
                        if (gameState.gamemode === 'GUNGAME') {
                            killer.activeWeaponIndex = (killer.activeWeaponIndex + 1) % killer.loadout.length;
                        }

                        // Award direct profile progression currencies
                        io.to(killer.id).emit('progressionAwarded', { xp: 300, kills: 1 });

                        // Distribute points to eligible assistants
                        Object.keys(p.assistPool).forEach(aid => {
                            if (aid !== killer.id && Date.now() - p.assistPool[aid] < 4000) {
                                io.to(aid).emit('progressionAwarded', { xp: 100 });
                            }
                        });
                    }

                    io.to(p.id).emit('progressionAwarded', { xp: 100, deaths: 1 });

                    // Revive structural validations logic parameters
                    if (p.reviveTokens > 0 && gameState.gamemode !== 'FFA') {
                        p.reviveTokens--; p.hp = 50; p.lastStandActive = false;
                    } else {
                        if (gameState.gamemode === 'ZOMBIE') { p.isZombie = true; p.hp = 150; } else { p.hp = 100; p.overshield = 50; }
                        p.lastStandActive = false;
                        setTimeout(() => {
                            p.x = 200 + Math.random() * 1600; p.y = 200 + Math.random() * 1600;
                            io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                        }, 4000);
                    }
                }
                b.life = 0;
            }
        });
    }

    // Resolve player alignment velocity positions loops
    Object.values(gameState.players).forEach(p => {
        if (p.hp <= 0 || p.positionAnchored) return;
        let input = p.lastInputState; let dx = 0; let dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let speed = 252;
        if (p.device === 'mobile') speed *= 1.15;
        if (p.loadout && p.loadout[p.activeWeaponIndex] === 'chaingun') speed = 150;
        if (Date.now() < p.stimActiveUntil) speed += 120;
        if (p.killBuffUntil > Date.now()) speed += 60;

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
http.listen(PORT, () => { console.log(`EVOLVED APEX ENGINE ONLINE ON PORT ${PORT}`); });