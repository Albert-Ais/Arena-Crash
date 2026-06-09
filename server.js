const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

app.use(express.static(path.join(__dirname, 'public')));

const MAP_SIZE = 2000; 
const GRID_SIZE = 40; 
const BLOCKS_COUNT = MAP_SIZE / GRID_SIZE;

// Initialize layout matrix with outer perimeter wall rings
let currentGrid = Array(BLOCKS_COUNT).fill(null).map(() => Array(BLOCKS_COUNT).fill(0));
for (let i = 0; i < BLOCKS_COUNT; i++) {
    currentGrid[i][0] = 1; 
    currentGrid[i][BLOCKS_COUNT - 1] = 1;
    currentGrid[0][i] = 1; 
    currentGrid[BLOCKS_COUNT - 1][i] = 1;
}

// Procedural obstacle generation loop
for (let k = 0; k < 25; k++) {
    let wx = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
    let wy = Math.floor(Math.random() * (BLOCKS_COUNT - 8)) + 4;
    let horiz = Math.random() > 0.5;
    for (let l = 0; l < 5; l++) { 
        if (horiz) currentGrid[wx + l][wy] = 1; 
        else currentGrid[wx][wy + l] = 1; 
    }
}

// Global Game State Structure holding mode objects
let gameState = { 
    players: {}, decoys: [], bullets: [], fields: [],
    scores: { red: 0, blue: 0 }, 
    ffaScores: {}, // Holds individual scores for Free For All mode
    state: 'lobby', matchTimer: 180, 
    gamemode: 'TDM', // Dynamic default: TDM, FFA, CTF, KOTH
    matchType: '1v1', // Dynamic default: 1v1, 2v2, 3v3, FFA
    mapGrid: currentGrid,
    // --- MODE SPECIFIC ARTIFACTS ---
    ctf: {
        redFlag: { x: 200, y: 1000, carrierId: null, homeX: 200, homeY: 1000 },
        blueFlag: { x: 1800, y: 1000, carrierId: null, homeX: 1800, homeY: 1000 }
    },
    koth: {
        x: 1000, y: 1000, radius: 120, controllingTeam: 'none', timer: 30
    }
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
                let wX = gx * GRID_SIZE; 
                let wY = gy * GRID_SIZE;
                if (x + radius > wX && x - radius < wX + GRID_SIZE && y + radius > wY && y - radius < wY + GRID_SIZE) {
                    return true;
                }
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
            
            // King of the Hill Node Relocation Logic
            if (gameState.gamemode === 'KOTH') {
                gameState.koth.timer--;
                if (gameState.koth.timer <= 0) {
                    gameState.koth.x = 400 + Math.random() * 1200;
                    gameState.koth.y = 400 + Math.random() * 1200;
                    gameState.koth.timer = 30; // Move every 30 seconds
                    io.emit('feedKillMessage', "The Hill has relocated!");
                }
            }

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
        gameState.bullets = []; 
        gameState.decoys = []; 
        gameState.fields = [];
        gameState.matchTimer = 180; 
        gameState.scores = { red: 0, blue: 0 };
        gameState.ffaScores = {};
        gameState.state = 'playing';

        // Reset flags
        gameState.ctf.redFlag.carrierId = null;
        gameState.ctf.redFlag.x = gameState.ctf.redFlag.homeX;
        gameState.ctf.blueFlag.carrierId = null;
        gameState.ctf.blueFlag.x = gameState.ctf.blueFlag.homeX;

        activePlayerIds.forEach(id => {
            let p = gameState.players[id];
            gameState.ffaScores[id] = 0;
            p.x = p.team === 'red' ? 200 + Math.random() * 200 : 1600 + Math.random() * 200; 
            p.y = 400 + Math.random() * 1200;
            p.hp = 100; 
            p.overshield = 50; 
            p.invisibleActive = false; 
            p.controllingDecoyId = null;
            p.isReloading = false; 
            p.ammo = p.maxAmmo; 
            p.activeSpeedBuff = false; 
            p.abilitySilencedUntil = 0;
        });

        activateMatchTimerCountdown();
        io.emit('matchStarted', { map: gameState.mapGrid });
    }
}

io.on('connection', (socket) => {
    socket.on('joinQueue', (data) => {
        // Evaluate dynamic matchmaking properties based on user options selection
        let chosenMode = data.gamemode || 'TDM'; // 'TDM', 'FFA', 'CTF', 'KOTH'
        let chosenType = data.matchType || '1v1'; // '1v1', '2v2', '3v3', 'FFA'
        
        gameState.gamemode = chosenMode;
        gameState.matchType = chosenType;

        let needed = 2; // Default 1v1
        if (chosenType === '2v2') needed = 4;
        if (chosenType === '3v3') needed = 6;
        if (chosenType === 'FFA') needed = 4; // FFA launches with 4 players

        let assignedTeam = 'red';
        if (chosenType !== 'FFA') {
            assignedTeam = matchmakingQueue.length % 2 === 0 ? 'red' : 'blue';
        } else {
            assignedTeam = 'solo';
        }

        let pProfile = {
            id: socket.id, name: data.name || "Player", device: data.device,
            x: assignedTeam === 'red' ? 200 + Math.random() * 100 : 1700 + Math.random() * 100, 
            y: 500 + Math.random() * 1000,
            hp: 100, overshield: 50, team: assignedTeam,
            loadout: data.loadout || ["wep_1", "wep_12", "wep_15"], 
            abilities: data.abilities || ["abil_1", "abil_6"],
            activeWeaponIndex: 0, ammo: 30, maxAmmo: 30, isReloading: false,
            ability1ReadyAt: 0, ability2ReadyAt: 0, ability3ReadyAt: 0,
            invisibleActive: false, controllingDecoyId: null, activeSpeedBuff: false, abilitySilencedUntil: 0,
            angle: 0, lastInputState: { w: false, a: false, s: false, d: false, angle: 0 }
        };
        
        matchmakingQueue.push(pProfile);
        socket.emit('roomJoined', { map: gameState.mapGrid });

        if (matchmakingQueue.length >= needed && gameState.state === 'lobby') {
            gameState.state = 'playing';
            gameState.scores = { red: 0, blue: 0 };
            gameState.ffaScores = {};
            
            matchmakingQueue.forEach(p => { 
                gameState.players[p.id] = p; 
                gameState.ffaScores[p.id] = 0;
            });
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
            p.loadout = data.loadout; p.abilities = data.abilities; p.activeWeaponIndex = 0;
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
        if (!p || p.hp <= 0 || p.invisibleActive || p.ammo <= 0 || p.isReloading) return;
        
        p.ammo--;
        let currentWepId = p.loadout[p.activeWeaponIndex];
        
        let bRadius = 4; let bSpeed = 750; let bDmg = 18; let bColor = '#fbbf24'; let bLife = 1.5;
        let bBounce = 0; let bPassWalls = false; let typeTag = "NORMAL";

        let fireSource = { x: p.x, y: p.y, angle: p.angle };
        if (p.controllingDecoyId) {
            let dObj = gameState.decoys.find(d => d.id === p.controllingDecoyId);
            if (dObj) { fireSource.x = dObj.x; fireSource.y = dObj.y; fireSource.angle = dObj.angle; }
        }

        // ==========================================
        // DYNAMIC BEHAVIOR MATRIX FOR ALL 50 WEAPONS
        // ==========================================
        switch(currentWepId) {
            case "wep_1": bColor = "#a855f7"; typeTag = "CHAIN_LIGHTNING"; bDmg = 14; break;
            case "wep_2": bColor = "#38bdf8"; typeTag = "PRISM_SPLIT"; bLife = 0.5; break;
            case "wep_3": bRadius = 2; bSpeed = 1600; bColor = "#00ffff"; typeTag = "PHOTON_PIERCE"; bDmg = 15; bPassWalls = true; break;
            case "wep_4": bRadius = 6; bSpeed = 500; bColor = "#ec4899"; typeTag = "PULSE_RING"; bLife = 0.8; break;
            case "wep_5": bRadius = 5; bSpeed = 950; bDmg = 26; bColor = "#f43f5e"; typeTag = "ENERGY_SHREDDER"; break;
            case "wep_6": bBounce = 3; bColor = "#fb923c"; typeTag = "SMART_BOUNCE"; break;
            case "wep_7": bBounce = 8; bSpeed = 900; bColor = "#facc15"; typeTag = "PINBALL"; break;
            case "wep_8": bBounce = 4; bColor = "#a3e635"; typeTag = "GROWING_BOUNCE"; bDmg = 12; break;
            case "wep_9": bBounce = 1; bSpeed = 1500; bRadius = 3; bDmg = 45; bColor = "#34d399"; typeTag = "CORNER_BANK"; break;
            case "wep_10": bBounce = 5; bColor = "#f472b6"; typeTag = "CHAOS_BOUNCE"; break;
            case "wep_11": bSpeed = 150; bColor = "#b91c1c"; typeTag = "SPIKE_MINE"; bLife = 12.0; bRadius = 8; break;
            case "wep_12": bRadius = 14; bSpeed = 400; bColor = "#ef4444"; typeTag = "FLAME_BURST"; bLife = 0.4; bDmg = 5; break;
            case "wep_13": bSpeed = 450; bColor = "#60a5fa"; typeTag = "CRYO_BOMB"; bLife = 1.0; break;
            case "wep_14": bSpeed = 250; bColor = "#c084fc"; typeTag = "TESLA_DEPLOY"; bLife = 1.5; break;
            case "wep_15": bRadius = 10; bSpeed = 320; bColor = "#22c55e"; typeTag = "ACID_SLUDGE"; bLife = 0.75; bDmg = 6; break;
            case "wep_16": bColor = "#2dd4bf"; typeTag = "BOOMERANG"; bLife = 1.6; bSpeed = 550; break;
            case "wep_17": bColor = "#e2e8f0"; typeTag = "ORBITAL_NODE"; bLife = 5.0; break;
            case "wep_18": 
                let isMoving = p.lastInputState.w || p.lastInputState.s || p.lastInputState.a || p.lastInputState.d;
                bDmg = isMoving ? 35 : 15; bColor = "#fbbf24"; typeTag = "MOMENTUM_SHOT"; 
                break;
            case "wep_19": bColor = "#0d9488"; typeTag = "ANCHOR_ROOT"; bSpeed = 700; bDmg = 10; break;
            case "wep_20": bRadius = 4; bDmg = 12; bColor = "#f59e0b"; typeTag = "DASH_SHOT"; break;
            case "wep_21": bColor = "#3b82f6"; typeTag = "PORTAL_SHOT"; bSpeed = 900; break;
            case "wep_22": bColor = "#8b5cf6"; typeTag = "SWAP_HIT"; bSpeed = 1200; break;
            case "wep_23": bColor = "#6b7280"; typeTag = "TIME_STALL"; bLife = 3.5; break;
            case "wep_24": bColor = "#ec4899"; typeTag = "REVERSE_PULL"; bSpeed = 600; break;
            case "wep_25": bColor = "#14b8a6"; typeTag = "DUPLICATING_SHOT"; bLife = 0.7; break;
            case "wep_26": bRadius = 7; bColor = "#64748b"; typeTag = "MAGNET_CORE"; bSpeed = 400; break;
            case "wep_27": bColor = "#f59e0b"; typeTag = "EMP_SILENCE"; bSpeed = 950; break;
            case "wep_28": bRadius = 9; bColor = "#06b6d4"; typeTag = "SHOCK_NET_TRAP"; bSpeed = 550; break;
            case "wep_29": bSpeed = 500; bColor = "#4338ca"; typeTag = "GRAVITY_CAGE_LOB"; bLife = 1.4; break;
            case "wep_30": bColor = "#4f46e5"; typeTag = "SILENCE_BEAM_HIT"; bSpeed = 1300; break;
            case "wep_31": // Burst Sniper
                for(let step = 0; step < 3; step++) {
                    setTimeout(() => {
                        let innerP = gameState.players[p.id];
                        if(!innerP || innerP.hp <= 0) return;
                        gameState.bullets.push({
                            x: innerP.x + Math.cos(innerP.angle)*22, y: innerP.y + Math.sin(innerP.angle)*22,
                            vx: Math.cos(innerP.angle)*1600, vy: Math.sin(innerP.angle)*1600,
                            radius: 3.5, ownerId: innerP.id, life: 1.0, dmg: 24, color: "#ef4444", type: "NORMAL"
                        });
                    }, step * 100);
                }
                return;
            case "wep_32": bRadius = 5; bSpeed = 1500; bDmg = 40; bColor = "#f97316"; typeTag = "CHARGE_LINE"; break;
            case "wep_33": // Rail Burst
                for (let i = -2; i <= 2; i++) {
                    let devAng = fireSource.angle + (i * 0.07);
                    gameState.bullets.push({
                        x: fireSource.x + Math.cos(devAng)*22, y: fireSource.y + Math.sin(devAng)*22,
                        vx: Math.cos(devAng)*1400, vy: Math.sin(devAng)*1400,
                        radius: 2, ownerId: p.id, life: 0.9, dmg: 7, color: "#10b981", type: "NORMAL"
                    });
                }
                return;
            case "wep_34": bColor = "#a855f7"; typeTag = "HUNTER_MARK"; bDmg = 20; break;
            case "wep_35": bColor = "#e11d48"; typeTag = "EXECUTION_SHOT"; bDmg = 16; break;
            case "wep_36": bColor = "#38bdf8"; typeTag = "SUMMON_DRONE_PROJECTILE"; bSpeed = 500; break;
            case "wep_37": bSpeed = 350; bColor = "#f59e0b"; typeTag = "SPIDER_BOT_POD"; bLife = 2.0; break;
            case "wep_38": // Nano Swarm
                for (let i = 0; i < 6; i++) {
                    let spread = fireSource.angle + (Math.random() * 0.5 - 0.25);
                    gameState.bullets.push({
                        x: fireSource.x, y: fireSource.y, vx: Math.cos(spread)*450, vy: Math.sin(spread)*450,
                        radius: 2, ownerId: p.id, life: 2.5, dmg: 4, color: "#a78bfa", type: "TRACKING_NANO"
                    });
                }
                return;
            case "wep_39": bSpeed = 800; bColor = "#f43f5e"; typeTag = "ORBITAL_BEACON_DROP"; bLife = 0.8; break;
            case "wep_40": bSpeed = 250; bColor = "#34d399"; typeTag = "GUARDIAN_CORE_DEPLOY"; bLife = 1.2; break;
            case "wep_41": p.hp = Math.max(1, p.hp - 12); bRadius = 7; bDmg = 48; bColor = "#991b1b"; typeTag = "BLOOD_EXPLOSIVE"; break;
            case "wep_42": bColor = "#ea580c"; bDmg = 34; typeTag = "OVERLOAD_BURN"; break;
            case "wep_43": 
                let hpRatio = (100 - p.hp) / 100;
                bDmg = 15 + Math.floor(hpRatio * 40); bColor = "#dc2626"; bRadius = 5.5; typeTag = "BERSERK_BLAST"; 
                break;
            case "wep_44": bRadius = 9; bDmg = 55; bColor = "#facc15"; typeTag = "UNSTABLE_EXPLOSION"; if (Math.random() < 0.10) { p.hp = Math.max(1, p.hp - 20); } break;
            case "wep_45": bDmg = 60; bColor = "#ffffff"; p.overshield = 0; typeTag = "GLASS_SLUG"; break;
            case "wep_46": bRadius = 16; bSpeed = 200; bDmg = 5; bColor = "#6d28d9"; bLife = 4.0; typeTag = "BLACK_HOLE"; break;
            case "wep_47": bColor = "#ef4444"; typeTag = "METEOR_STRIKE"; bSpeed = 400; bLife = 1.5; break;
            case "wep_48": bColor = "#4c1d95"; bPassWalls = true; bDmg = 22; bSpeed = 1100; typeTag = "VOID_WALL_PIERCE"; break;
            case "wep_49": bRadius = 15; bSpeed = 180; bDmg = 35; bColor = "#ea580c"; bLife = 2.8; typeTag = "APOCALYPSE_PARENT"; break;
            case "wep_50": bRadius = 6; bColor = "#06b6d4"; typeTag = "REALITY_DISTORT"; bSpeed = 800; break;
        }

        let bulletModel = { 
            x: fireSource.x + Math.cos(fireSource.angle)*22, y: fireSource.y + Math.sin(fireSource.angle)*22, 
            vx: Math.cos(fireSource.angle)*bSpeed, vy: Math.sin(fireSource.angle)*bSpeed, 
            radius: bRadius, ownerId: p.id, life: bLife, dmg: bDmg, color: bColor,
            bounce: bBounce, passWalls: bPassWalls, type: typeTag
        };
        gameState.bullets.push(bulletModel);
    });

    socket.on('useAbility', (slotIdx) => {
        let p = gameState.players[socket.id]; 
        if (!p || p.hp <= 0 || gameState.state !== 'playing') return;
        if (Date.now() < p.abilitySilencedUntil) return;

        let name = p.abilities[slotIdx]; 
        let now = Date.now(); 
        let readyProp = `ability${slotIdx + 1}ReadyAt`;
        if (now < p[readyProp]) return; 
        p[readyProp] = now + 14000;

        if (name === 'abil_1') { p.hp = Math.min(100, p.hp + 40); } 
        else if (name === 'abil_6') { p.activeSpeedBuff = true; setTimeout(() => { let pl = gameState.players[socket.id]; if (pl) pl.activeSpeedBuff = false; }, 4000); } 
        else if (name === 'abil_16') { p.overshield = Math.min(100, p.overshield + 50); } 
        else if (name === 'abil_37') { 
            Object.values(gameState.players).forEach(opp => {
                if (opp.id !== p.id && Math.hypot(opp.x - p.x, opp.y - p.y) < 250) opp.abilitySilencedUntil = Date.now() + 4000;
            });
        } 
        else if (name === 'abil_45') { 
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
        } 
        else if (name === 'abil_49') { gameState.fields.push({ x: p.x, y: p.y, radius: 140, color: 'rgba(16, 185, 129, 0.4)', type: 'TOXIC', ownerId: p.id, life: 6.0 }); } 
        else { p.hp = Math.min(100, p.hp + 15); }
    });

    socket.on('disconnect', () => {
        // Drop flag if carrier leaves
        if (gameState.ctf.redFlag.carrierId === socket.id) gameState.ctf.redFlag.carrierId = null;
        if (gameState.ctf.blueFlag.carrierId === socket.id) gameState.ctf.blueFlag.carrierId = null;
        
        delete gameState.players[socket.id]; 
        delete intermissionResponses[socket.id];
        delete gameState.ffaScores[socket.id];
        matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
        if (gameState.state === 'intermission') processRestartMatchVerification();
    });
});

setInterval(() => {
    let dt = 1 / 60; 
    if (gameState.state !== 'playing') return;

    // --- GAME MODE SPECIFIC RUNTIME ENGINE RULES ---
    if (gameState.gamemode === 'KOTH') {
        let redInHill = 0; let blueInHill = 0;
        Object.values(gameState.players).forEach(p => {
            if (p.hp > 0 && Math.hypot(p.x - gameState.koth.x, p.y - gameState.koth.y) < gameState.koth.radius) {
                if (p.team === 'red') redInHill++;
                if (p.team === 'blue') blueInHill++;
            }
        });
        if (redInHill > 0 && blueInHill === 0) {
            gameState.scores.red += dt * 2; gameState.koth.controllingTeam = 'red';
        } else if (blueInHill > 0 && redInHill === 0) {
            gameState.scores.blue += dt * 2; gameState.koth.controllingTeam = 'blue';
        } else if (redInHill > 0 && blueInHill > 0) {
            gameState.koth.controllingTeam = 'contested';
        } else {
            gameState.koth.controllingTeam = 'none';
        }
    }

    if (gameState.gamemode === 'CTF') {
        // Track flag carriers positioning profiles
        if (gameState.ctf.redFlag.carrierId) {
            let carrier = gameState.players[gameState.ctf.redFlag.carrierId];
            if (carrier && carrier.hp > 0) {
                gameState.ctf.redFlag.x = carrier.x; gameState.ctf.redFlag.y = carrier.y;
                // Capture criteria check (Bringing Red Flag to Blue Home base zone)
                if (carrier.team === 'blue' && Math.hypot(carrier.x - gameState.ctf.blueFlag.homeX, carrier.y - gameState.ctf.blueFlag.homeY) < 40) {
                    gameState.scores.blue += 100;
                    gameState.ctf.redFlag.carrierId = null;
                    gameState.ctf.redFlag.x = gameState.ctf.redFlag.homeX; gameState.ctf.redFlag.y = gameState.ctf.redFlag.homeY;
                    io.emit('feedKillMessage', "Blue Team Captured The Flag!");
                }
            } else { gameState.ctf.redFlag.carrierId = null; }
        } else {
            // Flag pick-up lookup logic checks
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && p.team === 'blue' && Math.hypot(p.x - gameState.ctf.redFlag.x, p.y - gameState.ctf.redFlag.y) < 30) {
                    gameState.ctf.redFlag.carrierId = p.id;
                    io.emit('feedKillMessage', `${p.name} picked up the Red Flag!`);
                }
            });
        }

        if (gameState.ctf.blueFlag.carrierId) {
            let carrier = gameState.players[gameState.ctf.blueFlag.carrierId];
            if (carrier && carrier.hp > 0) {
                gameState.ctf.blueFlag.x = carrier.x; gameState.ctf.blueFlag.y = carrier.y;
                // Capture criteria check (Bringing Blue Flag to Red Home base zone)
                if (carrier.team === 'red' && Math.hypot(carrier.x - gameState.ctf.redFlag.homeX, carrier.y - gameState.ctf.redFlag.homeY) < 40) {
                    gameState.scores.red += 100;
                    gameState.ctf.blueFlag.carrierId = null;
                    gameState.ctf.blueFlag.x = gameState.ctf.blueFlag.homeX; gameState.ctf.blueFlag.y = gameState.ctf.blueFlag.homeY;
                    io.emit('feedKillMessage', "Red Team Captured The Flag!");
                }
            } else { gameState.ctf.blueFlag.carrierId = null; }
        } else {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && p.team === 'red' && Math.hypot(p.x - gameState.ctf.blueFlag.x, p.y - gameState.ctf.blueFlag.y) < 30) {
                    gameState.ctf.blueFlag.carrierId = p.id;
                    io.emit('feedKillMessage', `${p.name} picked up the Blue Flag!`);
                }
            });
        }
    }

    // Environmental Persistent Fields Updates
    for (let j = gameState.fields.length - 1; j >= 0; j--) {
        let f = gameState.fields[j]; f.life -= dt;
        if (f.life <= 0) { gameState.fields.splice(j, 1); continue; }
        
        if (f.type === 'TOXIC') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) p.hp = Math.max(1, p.hp - (12 * dt));
            });
        }
        if (f.type === 'FROST') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) { p.x -= (p.vx || 0) * 0.5 * dt; p.y -= (p.vy || 0) * 0.5 * dt; }
            });
        }
        if (f.type === 'PRISON') {
            Object.values(gameState.players).forEach(p => {
                if (p.hp > 0 && Math.hypot(p.x - f.x, p.y - f.y) < f.radius) { p.x = f.x; p.y = f.y; }
            });
        }
    }

    // Positions & Actions Translation Tick Loops
    Object.values(gameState.players).forEach(p => {
        if (p.hp <= 0) return;
        let input = p.lastInputState; let dx = 0, dy = 0;
        if (input.w) dy -= 1; if (input.s) dy += 1;
        if (input.a) dx -= 1; if (input.d) dx += 1;
        if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

        let speed = p.activeSpeedBuff ? 440 : 252;

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

    // Projectile Flight Path Engine Updates
    for (let i = gameState.bullets.length - 1; i >= 0; i--) {
        let b = gameState.bullets[i]; b.life -= dt;

        if (b.type === "TRACKING_NANO") {
            let closestOpp = null; let closeDist = 500;
            Object.values(gameState.players).forEach(opp => {
                // Free-For-All allows target lock onto anyone except the shooter
                let targetValidation = gameState.gamemode === 'FFA' ? (opp.id !== b.ownerId) : (opp.id !== b.ownerId && opp.team !== gameState.players[b.ownerId].team);
                if (targetValidation && opp.hp > 0 && !opp.invisibleActive) {
                    let d = Math.hypot(opp.x - b.x, opp.y - b.y);
                    if (d < closeDist) { closeDist = d; closestOpp = opp; }
                }
            });
            if (closestOpp) {
                let ang = Math.atan2(closestOpp.y - b.y, closestOpp.x - b.x);
                b.vx = Math.cos(ang) * 500; b.vy = Math.sin(ang) * 500;
            }
        }

        if (b.type === "BOOMERANG" && b.life < 0.8) {
            let owner = gameState.players[b.ownerId];
            if (owner) {
                let returnAng = Math.atan2(owner.y - b.y, owner.x - b.x);
                b.vx = Math.cos(returnAng) * 650; b.vy = Math.sin(returnAng) * 650;
            }
        }

        if (b.type === "ORBITAL_NODE") {
            let owner = gameState.players[b.ownerId];
            if (owner) {
                let currentAge = 5.0 - b.life; let radius = 90;
                let orbitalAngle = (currentAge * 4) + (i * 0.5); 
                b.x = owner.x + Math.cos(orbitalAngle) * radius; b.y = owner.y + Math.sin(orbitalAngle) * radius;
                b.vx = 0; b.vy = 0;
            }
        } else {
            b.x += b.vx * dt; b.y += b.vy * dt;
        }

        if (b.type === "TIME_STALL" && b.life < 2.8 && b.life > 1.8) { b.x -= b.vx * dt; b.y -= b.vy * dt; }

        if (b.life <= 0) {
            if (b.type === "PRISM_SPLIT") {
                let baseAngle = Math.atan2(b.vy, b.vx);
                for (let offset of [-0.3, 0, 0.3]) {
                    gameState.bullets.push({
                        x: b.x, y: b.y, vx: Math.cos(baseAngle + offset)*850, vy: Math.sin(baseAngle + offset)*850,
                        radius: 3, ownerId: b.ownerId, life: 0.8, dmg: 11, color: "#38bdf8", type: "NORMAL"
                    });
                }
            }
            if (b.type === "APOCALYPSE_PARENT") {
                for (let deg = 0; deg < Math.PI * 2; deg += Math.PI / 3) {
                    gameState.bullets.push({
                        x: b.x, y: b.y, vx: Math.cos(deg)*500, vy: Math.sin(deg)*500,
                        radius: 4.5, ownerId: b.ownerId, life: 1.0, dmg: 18, color: "#ef4444", type: "NORMAL"
                    });
                }
            }
            if (b.type === "ACID_SLUDGE") gameState.fields.push({ x: b.x, y: b.y, radius: 75, color: 'rgba(34, 197, 94, 0.35)', type: 'TOXIC', ownerId: b.ownerId, life: 5.0 });
            if (b.type === "FLAME_BURST") gameState.fields.push({ x: b.x, y: b.y, radius: 45, color: 'rgba(239, 68, 68, 0.3)', type: 'TOXIC', ownerId: b.ownerId, life: 2.0 });
            if (b.type === "CRYO_BOMB") gameState.fields.push({ x: b.x, y: b.y, radius: 90, color: 'rgba(96, 165, 250, 0.3)', type: 'FROST', ownerId: b.ownerId, life: 4.0 });
            if (b.type === "GRAVITY_CAGE_LOB") gameState.fields.push({ x: b.x, y: b.y, radius: 80, color: 'rgba(67, 56, 202, 0.35)', type: 'PRISON', ownerId: b.ownerId, life: 3.5 });

            gameState.bullets.splice(i, 1);
            continue;
        }

        if (!b.passWalls && checkServerWallCollision(b.x, b.y, b.radius)) {
            if (b.bounce > 0) {
                b.bounce--;
                if (b.type === "SMART_BOUNCE") {
                    let targetOpp = null; let targetDist = 600;
                    Object.values(gameState.players).forEach(o => {
                        let ffaCheck = gameState.gamemode === 'FFA' ? (o.id !== b.ownerId) : (o.id !== b.ownerId && o.team !== gameState.players[b.ownerId].team);
                        if (ffaCheck && o.hp > 0 && !o.invisibleActive) {
                            let d = Math.hypot(o.x - b.x, o.y - b.y);
                            if (d < targetDist) { targetDist = d; targetOpp = o; }
                        }
                    });
                    if (targetOpp) {
                        let trackingAng = Math.atan2(targetOpp.y - b.y, targetOpp.x - b.x);
                        b.vx = Math.cos(trackingAng) * 850; b.vy = Math.sin(trackingAng) * 850;
                    } else { b.vx = -b.vx; b.vy = -b.vy; }
                } else if (b.type === "CHAOS_BOUNCE") {
                    let randAng = Math.random() * Math.PI * 2; let speedMag = Math.hypot(b.vx, b.vy);
                    b.vx = Math.cos(randAng) * speedMag; b.vy = Math.sin(randAng) * speedMag;
                } else { b.vx = -b.vx; b.vy = -b.vy; }
                if (b.type === "GROWING_BOUNCE") b.dmg = Math.floor(b.dmg * 1.5);
            } else { gameState.bullets.splice(i, 1); continue; }
        }

        if (b.type === "BLACK_HOLE") {
            Object.values(gameState.players).forEach(opp => {
                if (opp.id !== b.ownerId && opp.hp > 0) {
                    let d = Math.hypot(opp.x - b.x, opp.y - b.y);
                    if (d < 220) {
                        let pullAng = Math.atan2(b.y - opp.y, b.x - opp.x);
                        opp.x += Math.cos(pullAng) * 190 * dt; opp.y += Math.sin(pullAng) * 190 * dt;
                    }
                }
            });
        }

        // Processing Hit Contacts
        Object.values(gameState.players).forEach(p => {
            let shooter = gameState.players[b.ownerId];
            if (!shooter) return;

            // --- HIT VALIDATION MECHANIC BASED ON GAME MODE ---
            let canHit = false;
            if (gameState.gamemode === 'FFA') {
                canHit = (p.id !== b.ownerId); // Everyone is an enemy
            } else {
                canHit = (p.id !== b.ownerId && p.team !== shooter.team); // Teammates safe
            }

            if (p.hp > 0 && canHit && !p.invisibleActive && Math.hypot(p.x - b.x, p.y - b.y) < 22) {
                let finalDmg = b.dmg;

                if (b.type === "EXECUTION_SHOT" && p.hp < 30) finalDmg *= 2;
                if (b.type === "HUNTER_MARK") p.activeSpeedBuff = false; 

                if (b.type === "SWAP_HIT") {
                    let tx = p.x; let ty = p.y;
                    p.x = shooter.x; p.y = shooter.y;
                    shooter.x = tx; shooter.y = ty;
                }

                if (b.type === "ANCHOR_ROOT") p.lastInputState = { w: false, a: false, s: false, d: false, angle: p.angle };
                if (b.type === "EMP_SILENCE" || b.type === "SILENCE_BEAM_HIT") p.abilitySilencedUntil = Date.now() + 4000;

                if (p.overshield > 0) {
                    p.overshield -= finalDmg;
                    if (p.overshield < 0) { p.hp += p.overshield; p.overshield = 0; }
                } else { p.hp -= finalDmg; }
                
                io.to(b.ownerId).emit('hitFeedback', { x: p.x, y: p.y, dmg: finalDmg });
                if (b.type !== "PHOTON_PIERCE") b.life = 0;

                // On Death / Elimination Lifecycle
                if (p.hp <= 0) {
                    // Drop flags immediately if carrying
                    if (gameState.ctf.redFlag.carrierId === p.id) { gameState.ctf.redFlag.carrierId = null; gameState.ctf.redFlag.x = p.x; }
                    if (gameState.ctf.blueFlag.carrierId === p.id) { gameState.ctf.blueFlag.carrierId = null; gameState.ctf.blueFlag.x = p.x; }

                    // Process dynamic game mode scoring
                    if (gameState.gamemode === 'FFA') {
                        if (gameState.ffaScores[b.ownerId] !== undefined) gameState.ffaScores[b.ownerId]++;
                    } else if (gameState.gamemode === 'TDM') {
                        if (shooter.team === 'red') gameState.scores.red += 10; else gameState.scores.blue += 10;
                    }

                    io.emit('feedKillMessage', `${shooter.name} eliminated ${p.name}`);
                    
                    setTimeout(() => {
                        p.x = p.team === 'red' ? 200 + Math.random() * 200 : 1600 + Math.random() * 200;
                        p.y = 400 + Math.random() * 1200;
                        p.hp = 100; p.overshield = 50; p.invisibleActive = false; p.controllingDecoyId = null;
                        io.emit('playerRespawned', { id: p.id, x: p.x, y: p.y });
                    }, 3000);
                }
            }
        });
    }
    io.emit('serverTickUpdate', gameState);
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => { console.log(`SYSTEM ONLINE ON PORT ${PORT}`); });