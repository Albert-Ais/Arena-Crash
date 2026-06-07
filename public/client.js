const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function fitCanvasToWindow() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', fitCanvasToWindow); fitCanvasToWindow();

const MAP_SIZE = 2000; const GRID_SIZE = 40;
let myId = null; let localGrid = [];
let serverGameState = { players: {}, bullets: [], fields: [], scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 120 };
let camera = { x: 1000, y: 1000 }; 
let inputState = { w: false, a: false, s: false, d: false, angle: 0 };

let predictedPos = { x: 1000, y: 1000 };
let serverVerifiedPos = { x: 1000, y: 1000 };
let hasSetInitialPos = false;

const WEAPONS_CATALOG = [
    { id: 'railgun', title: 'Railgun', desc: 'Instant hitscan straight energy line beam.' },
    { id: 'chaingun', title: 'AP Chaingun', desc: 'Rapid automatic fire loops but caps velocity rates.' },
    { id: 'shotgun', title: 'Shotgun', desc: 'Fires wide grouping projectile bundle spreads.' },
    { id: 'heavy_revolver', title: 'Heavy Revolver', desc: 'Slow massive damage frame puncher rounds.' },
    { id: 'bouncing_sniper', title: 'Bouncing Sniper', desc: 'Projectiles ricochet off structural wall grids.' },
    { id: 'napalm', title: 'Napalm Shell', desc: 'Lobs thermal fire zones dealing ticking energy damage.' },
    { id: 'seeker', title: 'Seeker Missile', desc: 'Self-correcting heat signature hunting projectile payload.' },
    { id: 'sawblade', title: 'Sawblade Launcher', desc: 'Fires fast bouncing blades slicing objects.' },
    { id: 'plasma_rifle', title: 'Plasma Rifle', desc: 'Rapid energy bolts that home-in on proximate entities.' },
    { id: 'micro_nuke', title: 'Micro-Nuke Launcher', desc: 'Ultra slow moving projectile with severe blast radii.' },
    // 10 NEW WEAPONS INJECTED HERE
    { id: 'laser_beam', title: 'Continuous Laser', desc: 'Constant short-range damage tracking emitter stream.' },
    { id: 'sticky_grenade', title: 'Sticky Grenade', desc: 'Lobs sticky proximity charges locking to walls or targets.' },
    { id: 'vampire_drain', title: 'Vampiric Leech', desc: 'Fires a kinetic siphon bolt converting damage directly into self HP.' },
    { id: 'freeze_ray', title: 'Cryo Freeze Ray', desc: 'Projectiles reduce enemy target movement speeds completely.' },
    { id: 'tesla_shock', title: 'Tesla Launcher', desc: 'Fires arcing tracking electrical nodes bouncing between targets.' },
    { id: 'slugger_cannon', title: 'Heavy Slugger', desc: 'High momentum single kinetic slug dealing heavy pushback knockdowns.' },
    { id: 'poison_dart', title: 'Bio Poison Dart', desc: 'Applies stacking toxic damage over time ticks.' },
    { id: 'wave_wave', title: 'Sonic Wave Cannon', desc: 'Discharges wide wall-piercing compression rings.' },
    { id: 'gravity_star', title: 'Gravity Star Launcher', desc: 'Creates micro black-holes on impact pulling in characters.' },
    { id: 'cluster_bomb', title: 'Cluster Cluster', desc: 'Shell explodes into secondary cluster frag bursts.' }
];

const ABILITIES_CATALOG = [
    { id: 'blink', title: 'Blink Matrix', desc: 'Instantly flash forward through coordinate spaces.' },
    { id: 'stim', title: 'Stim Injection', desc: 'Boost velocity loops and regenerate vitals instantly.' },
    { id: 'decoy', title: 'Decoy Clone', desc: 'Spawns replica construct framework confusing enemies.' },
    { id: 'shield', title: 'Deflect Shield', desc: 'Deploy personal field barrier eating standard fire impact.' },
    { id: 'smoke', title: 'Smoke Screen', desc: 'Drops breaking line-of-sight visual dynamic obscurities.' },
    { id: 'radar', title: 'Radar Pulse', desc: 'Briefly illuminates absolute match positions through fog.' },
    { id: 'gravity_well', title: 'Vortex Gravity', desc: 'Pull contrasting target loops closer to epicenter.' },
    { id: 'overdrive', title: 'Fire Overdrive', desc: 'Overclocks reloading cycles and rate loops.' },
    { id: 'quantum_recall', title: 'Quantum Recall', desc: 'Warp chassis directly backwards to position state from 3s ago.' },
    { id: 'heal_matrix', title: 'Repair Field', desc: 'Anchor stationary aura curing self structure damage.' },
    // 10 NEW ABILITIES INJECTED HERE
    { id: 'stealth_cloak', title: 'Stealth Cloak', desc: 'Become completely invisible to radar and visual matrices.' },
    { id: 'dash_strike', title: 'Dash Strike', desc: 'High-speed forward pierce dealing impact damage to arrays.' },
    { id: 'wall_build', title: 'Emergency Barrier', desc: 'Instantly spawn a transient structural block on the grid.' },
    { id: 'shockwave', title: 'EM Pulse Shock', desc: 'Stuns proximate player actions and clears incoming bullets.' },
    { id: 'berserk', title: 'Berserker Engine', desc: 'Sacrifice current shield matrices for doubling fire rates.' },
    { id: 'phase_shift', title: 'Phase Shift Matrix', desc: 'Enter alternate dimensions bypassing wall bounds for 2s.' },
    { id: 'teleport_anchor', title: 'Anchor Teleport', desc: 'Drop marker node; reuse ability to recall directly to location.' },
    { id: 'acid_trail', title: 'Acid Speed Trail', desc: 'Leave pools of corrosive green waste trailing your character path.' },
    { id: 'damage_boost', title: 'Overload Amplification', desc: 'Boost output projectile parameters for the next 4 seconds.' },
    { id: 'iron_fortress', title: 'Titan Shield Core', desc: 'Become locked in position but gain absolute damage immunity.' }
];

// Dynamically compile the layout lists
function renderCatalogGrids() {
    document.getElementById('weapons-placement-grid').innerHTML = WEAPONS_CATALOG.map(w => `
        <div class="card"><label><input type="checkbox" class="wep-chk" value="${w.id}"> <span class="card-title" style="color:#fbbf24;">${w.title}</span></label><div class="card-text">${w.desc}</div></div>
    `).join('');
    
    document.getElementById('abilities-placement-grid').innerHTML = ABILITIES_CATALOG.map(a => `
        <div class="card"><label><input type="checkbox" class="abil-chk" value="${a.id}"> <span class="card-title" style="color:#00ff66;">${a.title}</span></label><div class="card-text">${a.desc}</div></div>
    `).join('');
}
renderCatalogGrids();

function applyLimitRules(className, maxAllowed) {
    document.querySelectorAll(`.${className}`).forEach(box => {
        box.addEventListener('change', () => {
            if (document.querySelectorAll(`.${className}:checked`).length > maxAllowed) box.checked = false;
        });
    });
}
applyLimitRules('wep-chk', 5); applyLimitRules('abil-chk', 3);

// Force default fallback selections to guarantee deployment validation profile values
for (let i = 0; i < 5; i++) document.querySelectorAll('.wep-chk')[i].checked = true;
for (let i = 0; i < 3; i++) document.querySelectorAll('.abil-chk')[i].checked = true;

document.getElementById('dispatch-queue-btn').addEventListener('click', () => {
    let chosenWeps = []; document.querySelectorAll('.wep-chk:checked').forEach(e => chosenWeps.push(e.value));
    let chosenAbils = []; document.querySelectorAll('.abil-chk:checked').forEach(e => chosenAbils.push(e.value));
    
    if (chosenWeps.length !== 5 || chosenAbils.length !== 3) {
        alert("System Configuration Profile Denied: Select exactly 5 weapons and 3 abilities cores.");
        return;
    }
    
    document.getElementById('setup-terminal').classList.add('hidden');
    document.getElementById('lobby-terminal').classList.remove('hidden');
    
    socket.emit('joinQueue', {
        name: document.getElementById('player-name').value.trim() || "Operative",
        loadout: chosenWeps,
        abilities: chosenAbils
    });
});

// High-precision non-lag input action binds mapping loop
window.addEventListener('keydown', (e) => {
    if (serverGameState.state !== 'playing') return;
    let k = e.key.toLowerCase();
    if (k === 'w') inputState.w = true; if (k === 'a') inputState.a = true;
    if (k === 's') inputState.s = true; if (k === 'd') inputState.d = true;

    if (k === 'r') socket.emit('triggerReload');
    if (k === ' ') socket.emit('shootWeapon');
    if (k === 'm') socket.emit('useAbility', 0);
    if (k === 'n') socket.emit('useAbility', 1);
    if (k === 'b') socket.emit('useAbility', 2); // Core Slot 3 Requirement linked to B

    if (['1','2','3','4','5'].includes(k)) {
        socket.emit('switchWeapon', parseInt(k) - 1);
    }
});

window.addEventListener('keyup', (e) => {
    let k = e.key.toLowerCase();
    if (k === 'w') inputState.w = false; if (k === 'a') inputState.a = false;
    if (k === 's') inputState.s = false; if (k === 'd') inputState.d = false;
});

window.addEventListener('mousemove', (e) => {
    inputState.angle = Math.atan2(e.clientY - window.innerHeight / 2, e.clientX - window.innerWidth / 2);
});

function checkClientWallCollision(x, y, radius) {
    if (!localGrid || localGrid.length === 0) return false;
    const blocks = MAP_SIZE / GRID_SIZE;
    let startX = Math.max(0, Math.floor((x - radius) / GRID_SIZE));
    let endX = Math.min(blocks - 1, Math.floor((x + radius) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - radius) / GRID_SIZE));
    let endY = Math.min(blocks - 1, Math.floor((y + radius) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (localGrid[gx] && localGrid[gx][gy] !== 0) {
                let wX = gx * GRID_SIZE; let wY = gy * GRID_SIZE;
                if (x + radius > wX && x - radius < wX + GRID_SIZE && y + radius > wY && y - radius < wY + GRID_SIZE) return true;
            }
        }
    }
    return false;
}

// Socket communication hooks
socket.on('connect', () => { myId = socket.id; });
socket.on('roomJoined', (data) => { localGrid = data.map; });

socket.on('lobbyUpdate', (data) => {
    document.getElementById('lobby-player-count').innerText = `SYSTEMS DETECTED: ${data.count} / ${data.required}`;
    document.getElementById('lobby-player-list').innerHTML = data.users.map(u => `<div>• [ONLINE CALLSIGN] // ${u.name}</div>`).join('');
});

socket.on('matchStarted', (data) => {
    localGrid = data.map;
    document.getElementById('lobby-terminal').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    hasSetInitialPos = false;
});

socket.on('playerRespawned', (data) => {
    if (data.id === myId) {
        predictedPos.x = data.x; predictedPos.y = data.y;
        serverVerifiedPos.x = data.x; serverVerifiedPos.y = data.y;
    }
});

socket.on('serverTickUpdate', (data) => {
    serverGameState = data;
    if (data.state !== 'playing') return;

    let min = Math.floor(data.matchTimer / 60).toString().padStart(2, '0');
    let sec = (data.matchTimer % 60).toString().padStart(2, '0');
    document.getElementById('top-center-timer-box').innerText = `${min}:${sec}`;
    document.getElementById('scores-panel').innerText = `RED SQUAD: ${data.scores.red} || BLUE SQUAD: ${data.scores.blue}`;

    if (myId && data.players[myId]) {
        let me = data.players[myId];
        document.getElementById('hp-display').innerText = `VITALS: ${me.hp}%`;
        document.getElementById('active-wep-line').innerText = `WEAPON: ${(me.loadout[me.activeWeaponIndex] || 'None').toUpperCase()}`;
        document.getElementById('ammo-line').innerText = me.isReloading ? "MAG CAP: RELOADING..." : `MAG CAP: ${me.ammo} / 30`;
        
        let slotsDisplay = me.loadout.map((w, idx) => {
            return `Slot ${idx + 1}: ${w.toUpperCase()} ${idx === me.activeWeaponIndex ? '◀' : ''}`;
        }).join('\n');
        document.getElementById('wep-slots-rack').innerText = slotsDisplay;

        let now = Date.now();
        ['1','2','3'].forEach((num, idx) => {
            let readyTime = me[`ability${idx+1}ReadyAt`] || 0;
            let node = document.getElementById(`cd-${num}-status`);
            if (now < readyTime) {
                node.innerText = `RECHARGING (${Math.ceil((readyTime - now)/1000)}S)`;
                node.className = "cd-wait";
            } else {
                node.innerText = `READY [${(me.abilities[idx] || 'NONE').toUpperCase()}]`;
                node.className = "cd-ready";
            }
        });

        if (!hasSetInitialPos) {
            predictedPos.x = me.x; predictedPos.y = me.y;
            serverVerifiedPos.x = me.x; serverVerifiedPos.y = me.y;
            hasSetInitialPos = true;
        }
        serverVerifiedPos.x = me.x; serverVerifiedPos.y = me.y;
    }
});

// Non-lag Client Prediction Framework Engine Loop
let lastPhysicsLoopTimestamp = performance.now();
function runHighPrecisionClientPrediction(currentFrameTime) {
    let dt = (currentFrameTime - lastPhysicsLoopTimestamp) / 1000;
    lastPhysicsLoopTimestamp = currentFrameTime;
    if (dt > 0.1) dt = 0.1;

    if (serverGameState.state === 'playing' && myId && serverGameState.players[myId]) {
        socket.emit('playerActionInput', inputState);

        let me = serverGameState.players[myId];
        if (me && me.hp > 0) {
            let dx = 0; let dy = 0;
            if (inputState.w) dy -= 1; if (inputState.s) dy += 1;
            if (inputState.a) dx -= 1; if (inputState.d) dx += 1;

            if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

            let currentMoveSpeed = me.phaseActive ? 400 : 252;
            if (me.loadout && me.loadout[me.activeWeaponIndex] === 'chaingun') currentMoveSpeed = 150;
            if (Date.now() < me.stimActiveUntil) currentMoveSpeed += 120;

            let nextX = predictedPos.x + (dx * currentMoveSpeed * dt);
            let nextY = predictedPos.y + (dy * currentMoveSpeed * dt);

            // Bypasses walls if phase shift matrix active component is running
            if (me.phaseActive) {
                predictedPos.x = Math.max(10, Math.min(MAP_SIZE - 10, nextX));
                predictedPos.y = Math.max(10, Math.min(MAP_SIZE - 10, nextY));
            } else {
                if (!checkClientWallCollision(nextX, predictedPos.y, 16)) predictedPos.x = nextX;
                if (!checkClientWallCollision(predictedPos.x, nextY, 16)) predictedPos.y = nextY;
            }
        }

        let serverDist = Math.hypot(predictedPos.x - serverVerifiedPos.x, predictedPos.y - serverVerifiedPos.y);
        if (serverDist > 48) {
            predictedPos.x = serverVerifiedPos.x; predictedPos.y = serverVerifiedPos.y;
        } else if (serverDist > 0.1) {
            let smoothingAlpha = 1 - Math.exp(-25 * dt);
            predictedPos.x += (serverVerifiedPos.x - predictedPos.x) * smoothingAlpha;
            predictedPos.y += (serverVerifiedPos.y - predictedPos.y) * smoothingAlpha;
        }
    }
    requestAnimationFrame(runHighPrecisionClientPrediction);
}
requestAnimationFrame(runHighPrecisionClientPrediction);

// Raycasting Line-of-Sight Visibility Check (Fog of War Calculation)
function checkIfTargetVisible(x1, y1, x2, y2) {
    if (!localGrid || localGrid.length === 0) return true;
    let dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 40) return true; // Always reveal closest elements
    
    let steps = Math.ceil(dist / 15);
    for (let i = 0; i <= steps; i++) {
        let alpha = i / steps;
        let checkX = x1 + (x2 - x1) * alpha;
        let checkY = y1 + (y2 - y1) * alpha;
        let gx = Math.floor(checkX / GRID_SIZE);
        let gy = Math.floor(checkY / GRID_SIZE);
        if (localGrid[gx] && localGrid[gx][gy] !== 0) {
            return false; // Obscured by structural wall grid or giant rocks
        }
    }
    return true;
}

function paintLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (serverGameState.state !== 'playing' || !myId || !serverGameState.players[myId]) {
        // Draw temporary loading splash screens
        ctx.fillStyle = "#0c0d19"; ctx.fillRect(0,0,canvas.width,canvas.height);
        requestAnimationFrame(paintLoop); return;
    }

    let targetMe = serverGameState.players[myId];
    camera.x += (predictedPos.x - camera.x) * 0.1; 
    camera.y += (predictedPos.y - camera.y) * 0.1;
    let oX = canvas.width / 2 - camera.x; let oY = canvas.height / 2 - camera.y;

    // Draw Map Strata Base Layers
    ctx.fillStyle = '#11121c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e2030'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE);

    // Draw Structural Environments (Walls = Type 1, Large Rocks = Type 2)
    if (localGrid && localGrid.length > 0) {
        for (let x = 0; x < localGrid.length; x++) {
            for (let y = 0; y < localGrid[x].length; y++) {
                if (localGrid[x][y] !== 0) {
                    if (localGrid[x][y] === 1) ctx.fillStyle = '#00f0ff'; // Cyan neon walls
                    if (localGrid[x][y] === 2) ctx.fillStyle = '#475569'; // Slate dark grey square rocks
                    ctx.fillRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
                } else {
                    ctx.strokeStyle = 'rgba(0,240,255,0.03)';
                    ctx.strokeRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
                }
            }
        }
    }

    // Render Environmental Fields
    serverGameState.fields.forEach(f => {
        if (f.type === 'acid') ctx.fillStyle = 'rgba(34,197,94,0.25)';
        if (f.type === 'heal') ctx.fillStyle = 'rgba(0,255,102,0.15)';
        if (f.type === 'smoke') ctx.fillStyle = 'rgba(100,116,139,0.7)';
        ctx.beginPath(); ctx.arc(f.x + oX, f.y + oY, f.radius, 0, Math.PI*2); ctx.fill();
    });

    // Render Bullets Projectile Layer (Fog filtered)
    serverGameState.bullets.forEach(b => {
        if (checkIfTargetVisible(predictedPos.x, predictedPos.y, b.x, b.y)) {
            ctx.fillStyle = b.color || '#fbbf24';
            ctx.beginPath(); ctx.arc(b.x + oX, b.y + oY, b.radius, 0, Math.PI * 2); ctx.fill();
        }
    });

    // Render Entities Layer (Strictly implements line-of-sight checks)
    Object.values(serverGameState.players).forEach(p => {
        if (p.hp <= 0) return;
        if (p.cloakActive && p.id !== myId) return; // Cloak stealth mode exception filtering

        // FOG OF WAR FILTER: Blocks visibility loop of player instances positioned past wall matrices
        if (p.id !== myId && !checkIfTargetVisible(predictedPos.x, predictedPos.y, p.x, p.y)) {
            return; 
        }

        ctx.save();
        if (p.id === myId) ctx.translate(predictedPos.x + oX, predictedPos.y + oY);
        else ctx.translate(p.x + oX, p.y + oY);

        ctx.strokeStyle = p.team === 'red' ? '#ff007f' : '#00f0ff';
        ctx.lineWidth = 4;
        ctx.fillStyle = p.cloakActive ? 'rgba(255,255,255,0.2)' : '#000000';
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.rotate(p.id === myId ? inputState.angle : p.angle);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5);
        ctx.restore();
    });

    requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);