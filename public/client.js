const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function fitCanvasToWindow() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', fitCanvasToWindow); fitCanvasToWindow();

const MAP_SIZE = 2000; const GRID_SIZE = 40;
let myId = null; let localGrid = [];
let serverGameState = { players: {}, decoys: [], bullets: [], fields: [], items: [], breakables: {}, scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180 };
let camera = { x: 1000, y: 1000 }; 
let inputState = { w: false, a: false, s: false, d: false, angle: 0 };

let predictedPos = { x: 1000, y: 1000 };
let serverVerifiedPos = { x: 1000, y: 1000 };
let hasSetInitialPos = false;
let selectedDeviceProfile = 'pc';
let localActiveWepIdx = 0;

// Client-side progression profile
let clientProgression = { kills: 0, deaths: 0, wins: 0, rankPoints: 100 };
function loadProgressionMetrics() {
    const data = localStorage.getItem('apex_progression_v2');
    if (data) {
        try { clientProgression = JSON.parse(data); } catch(e) {}
    }
    renderProgressionDisplays();
}
function saveProgressionMetrics() {
    localStorage.setItem('apex_progression_v2', JSON.stringify(clientProgression));
    renderProgressionDisplays();
}
function getRankTierName(rp) {
    if (rp < 200) return "BRONZE CORE";
    if (rp < 400) return "SILVER FRAME";
    if (rp < 700) return "GOLD MATRIX";
    return "ELITE APEX";
}
function renderProgressionDisplays() {
    document.getElementById('prof-rank-lbl').innerText = `RANK: ${getRankTierName(clientProgression.rankPoints)} (${clientProgression.rankPoints} RP)`;
    document.getElementById('prof-stats-lbl').innerText = `KILLS: ${clientProgression.kills} | DEATHS: ${clientProgression.deaths} | WINS: ${clientProgression.wins}`;
}

// FX Visual Arrays
let floatingNumbers = [];
let hitmarkers = [];
let screenShakeTimer = 0;
let directionDamageIndicators = [];
let shieldCracks = [];

const WEAPONS_CATALOG = [
    { id: 'railgun', title: 'Railgun', desc: 'Instant hitscan beam line.' },
    { id: 'chaingun', title: 'AP Chaingun', desc: 'Rapid automatic fire loops.' },
    { id: 'shotgun', title: 'Shotgun', desc: 'Fires wide projectile bundles.' },
    { id: 'heavy_revolver', title: 'Heavy Revolver', desc: 'Slow massive damage frame puncher.' },
    { id: 'bouncing_sniper', title: 'Bouncing Sniper', desc: 'Projectiles ricochet off grids.' },
    { id: 'napalm', title: 'Napalm Shell', desc: 'Lobs thermal tick fire damage.' },
    { id: 'seeker', title: 'Seeker Missile', desc: 'Self-correcting hunting payload.' },
    { id: 'sawblade', title: 'Sawblade Launcher', desc: 'Slicing fast bouncing blades.' },
    { id: 'plasma_rifle', title: 'Plasma Rifle', desc: 'Homing energy bolts.' },
    { id: 'micro_nuke', title: 'Micro-Nuke Launcher', desc: 'Severe structural blast radii.' }
];

const ABILITIES_CATALOG = [
    { id: 'blink', title: 'Blink Matrix', desc: 'Instantly flash forward through coordinates.' },
    { id: 'stim', title: 'Stim Injection', desc: 'Boost velocity loops and regain vitals.' },
    { id: 'decoy', title: 'Decoy Clone', desc: 'Spawns running replica construct to feign retreat.' },
    { id: 'shield', title: 'Deflect Shield', desc: 'Deploy barrier eating standard impacts.' },
    { id: 'smoke', title: 'Smoke Screen', desc: 'Drops dynamic sight-breaking obscurities.' },
    { id: 'radar', title: 'Radar Pulse', desc: 'Illuminates match positions through fog.' },
    { id: 'overdrive', title: 'Fire Overdrive', desc: 'Overclocks reloading cycle speeds.' },
    { id: 'phase_shift', title: 'Phase Shift Matrix', desc: 'Enter dimensions bypassing walls for 2s.' }
];

window.evaluateZombieConstraints = function() {
    let mode = document.getElementById('gamemode-pref').value;
    let clashBox = document.getElementById('clash-type-pref');
    if (mode === 'ZOMBIE' && (clashBox.value === '1v1')) clashBox.value = '3v3';
};

window.assignActiveHardwareProfile = function(profileType) {
    selectedDeviceProfile = profileType;
    document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`dev-prof-${profileType}`).classList.add('active');
};

function renderCatalogGrids() {
    document.getElementById('weapons-placement-grid').innerHTML = WEAPONS_CATALOG.map(w => `
        <div class="card">
            <label>
                <input type="checkbox" class="wep-chk" value="${w.id}"> 
                <span class="card-title" style="color:#fbbf24;">${w.title}</span>
            </label>
            <div class="card-text">${w.desc}</div>
        </div>
    `).join('');
    
    document.getElementById('abilities-placement-grid').innerHTML = ABILITIES_CATALOG.map(a => `
        <div class="card">
            <label>
                <input type="checkbox" class="abil-chk" value="${a.id}"> 
                <span class="card-title" style="color:#00ff66;">${a.title}</span>
            </label>
            <div class="card-text">${a.desc}</div>
        </div>
    `).join('');
}
renderCatalogGrids();
loadProgressionMetrics();

function applyLimitRules(className, maxAllowed) {
    document.querySelectorAll(`.${className}`).forEach(box => {
        box.addEventListener('change', () => {
            if (document.querySelectorAll(`.${className}:checked`).length > maxAllowed) box.checked = false;
        });
    });
}
applyLimitRules('wep-chk', 5); applyLimitRules('abil-chk', 3);

// Auto-check valid options
let wChks = document.querySelectorAll('.wep-chk');
for(let i=0; i<Math.min(5, wChks.length); i++) wChks[i].checked = true;
let aChks = document.querySelectorAll('.abil-chk');
for(let i=0; i<Math.min(3, aChks.length); i++) aChks[i].checked = true;

document.getElementById('dispatch-queue-btn').addEventListener('click', () => {
    let chosenWeps = []; document.querySelectorAll('.wep-chk:checked').forEach(e => chosenWeps.push(e.value));
    let chosenAbils = []; document.querySelectorAll('.abil-chk:checked').forEach(e => chosenAbils.push(e.value));
    
    if (chosenWeps.length === 0 || chosenAbils.length === 0) return alert("Select at least 1 weapon and 1 ability.");
    
    document.getElementById('setup-terminal').classList.add('hidden');
    
    if (selectedDeviceProfile === 'mobile') {
        document.getElementById('mobile-touch-interface-layer').style.display = 'block';
        initiateMobileControlsLoops();
    }
    
    socket.emit('joinQueue', {
        name: document.getElementById('player-name').value.trim() || "Operative",
        clashType: document.getElementById('clash-type-pref').value,
        gamemode: document.getElementById('gamemode-pref').value,
        queueType: document.getElementById('queue-tier-pref').value,
        rankPoints: clientProgression.rankPoints,
        device: selectedDeviceProfile,
        loadout: chosenWeps,
        abilities: chosenAbils
    });
    
    document.getElementById('lobby-terminal').classList.remove('hidden');
});

const chatInput = document.getElementById('chat-input-node');
chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        let msg = chatInput.value.trim();
        if (msg.length > 0) socket.emit('sendChatMessageEvent', msg);
        chatInput.value = ''; chatInput.blur();
    }
});

window.addEventListener('keydown', (e) => {
    if (document.activeElement === chatInput || serverGameState.state !== 'playing') return;
    let k = e.key.toLowerCase();
    if (selectedDeviceProfile === 'pc') {
        if (k === 'w') inputState.w = true; if (k === 'a') inputState.a = true;
        if (k === 's') inputState.s = true; if (k === 'd') inputState.d = true;
        if (k === 'r') socket.emit('triggerReload');
        if (k === ' ') { e.preventDefault(); socket.emit('shootWeapon'); }
        if (k === 'm') socket.emit('useAbility', 0);
        if (k === 'n') socket.emit('useAbility', 1);
        if (k === 'b') socket.emit('useAbility', 2);
        if (['1','2','3','4','5'].includes(k)) {
            let targetIdx = parseInt(k) - 1;
            socket.emit('switchWeapon', targetIdx);
        }
    }
    if (e.key === 'Enter') { chatInput.focus(); }
});

window.addEventListener('keyup', (e) => {
    if (selectedDeviceProfile !== 'pc') return;
    let k = e.key.toLowerCase();
    if (k === 'w') inputState.w = false; if (k === 'a') inputState.a = false;
    if (k === 's') inputState.s = false; if (k === 'd') inputState.d = false;
});

window.addEventListener('mousemove', (e) => {
    if (selectedDeviceProfile === 'pc') {
        inputState.angle = Math.atan2(e.clientY - window.innerHeight / 2, e.clientX - window.innerWidth / 2);
    }
});

let activeSticksTrackers = { left: { active:false, sx:0, sy:0 }, right: { active:false, sx:0, sy:0 } };
function initiateMobileControlsLoops() {
    const lEl = document.getElementById('left-virtual-stick');
    const rEl = document.getElementById('right-virtual-stick');

    function stickStart(e, track, el) {
        e.preventDefault();
        let touch = e.targetTouches[0];
        track.active = true;
        let rect = el.getBoundingClientRect();
        track.sx = rect.left + rect.width / 2;
        track.sy = rect.top + rect.height / 2;
    }

    function stickMove(e, track, el, isMovement) {
        if (!track.active) return;
        e.preventDefault();
        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (isMovement && e.touches[i].clientX < window.innerWidth * 0.6) touch = e.touches[i];
            if (!isMovement && e.touches[i].clientX >= window.innerWidth * 0.6) touch = e.touches[i];
        }
        if (!touch) touch = e.targetTouches[0];

        let dx = touch.clientX - track.sx;
        let dy = touch.clientY - track.sy;
        let dist = Math.min(40, Math.hypot(dx, dy));
        let ang = Math.atan2(dy, dx);

        el.querySelector('.joystick-thumb-node').style.transform = `translate(${Math.cos(ang)*dist}px, ${Math.sin(ang)*dist}px)`;

        if (isMovement) {
            inputState.w = dy < -12; inputState.s = dy > 12;
            inputState.a = dx < -12; inputState.d = dx > 12;
        } else {
            inputState.angle = ang;
        }
    }

    function stickEnd(track, el, isMovement) {
        track.active = false;
        el.querySelector('.joystick-thumb-node').style.transform = `translate(0px, 0px)`;
        if (isMovement) { inputState.w = false; inputState.a = false; inputState.s = false; inputState.d = false; }
    }

    lEl.addEventListener('touchstart', (e) => stickStart(e, activeSticksTrackers.left, lEl), {passive: false});
    lEl.addEventListener('touchmove', (e) => stickMove(e, activeSticksTrackers.left, lEl, true), {passive: false});
    lEl.addEventListener('touchend', () => stickEnd(activeSticksTrackers.left, lEl, true));

    rEl.addEventListener('touchstart', (e) => stickStart(e, activeSticksTrackers.right, rEl), {passive: false});
    rEl.addEventListener('touchmove', (e) => stickMove(e, activeSticksTrackers.right, rEl, false), {passive: false});
    rEl.addEventListener('touchend', () => stickEnd(activeSticksTrackers.right, rEl, false));

    document.getElementById('mbtn-fire').addEventListener('touchstart', (e) => { e.preventDefault(); socket.emit('shootWeapon'); });
    document.getElementById('mbtn-wep').addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (serverGameState.players[myId]) {
            localActiveWepIdx = (localActiveWepIdx + 1) % serverGameState.players[myId].loadout.length;
            socket.emit('switchWeapon', localActiveWepIdx);
        }
    });
    document.getElementById('mbtn-a1').addEventListener('touchstart', (e) => { e.preventDefault(); socket.emit('useAbility', 0); });
    document.getElementById('mbtn-a2').addEventListener('touchstart', (e) => { e.preventDefault(); socket.emit('useAbility', 1); });
    document.getElementById('mbtn-a3').addEventListener('touchstart', (e) => { e.preventDefault(); socket.emit('useAbility', 2); });
}

function checkClientWallCollision(x, y, radius) {
    if (!localGrid || localGrid.length === 0) return false;
    const blocks = localGrid.length;
    let startX = Math.max(0, Math.floor((x - radius) / GRID_SIZE));
    let endX = Math.min(blocks - 1, Math.floor((x + radius) / GRID_SIZE));
    let startY = Math.max(0, Math.floor((y - radius) / GRID_SIZE));
    let endY = Math.min(blocks - 1, Math.floor((y + radius) / GRID_SIZE));

    for (let gx = startX; gx <= endX; gx++) {
        for (let gy = startY; gy <= endY; gy++) {
            if (localGrid[gx] && localGrid[gx][gy] === 1) {
                let wX = gx * GRID_SIZE; let wY = gy * GRID_SIZE;
                if (x + radius > wX && x - radius < wX + GRID_SIZE && y + radius > wY && y - radius < wY + GRID_SIZE) return true;
            }
        }
    }
    return false;
}

socket.on('connect', () => { myId = socket.id; });
socket.on('roomJoined', (data) => { localGrid = data.map; });

socket.on('lobbyUpdate', (data) => {
    document.getElementById('lobby-player-count').innerText = `SYSTEMS DETECTED: ${data.count} / ${data.required}`;
    document.getElementById('lobby-player-list').innerHTML = data.users.map(u => `<div>• [${u.device.toUpperCase()}] // ${u.name}</div>`).join('');
});

socket.on('matchStarted', (data) => {
    localGrid = data.map;
    document.getElementById('lobby-terminal').classList.add('hidden');
    document.getElementById('setup-terminal').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    serverGameState.state = 'playing';
    hasSetInitialPos = false;
});

socket.on('receiveChatMessageBroadcast', (data) => {
    let histBox = document.getElementById('chat-history-box');
    let mNode = document.createElement('div');
    mNode.innerHTML = `<span style="color:#00f0ff;">[${data.sender}]</span>: ${data.text}`;
    histBox.appendChild(mNode); histBox.scrollTop = histBox.scrollHeight;
});

socket.on('playerRespawned', (data) => {
    if (data.id === myId) {
        predictedPos.x = data.x; predictedPos.y = data.y;
        serverVerifiedPos.x = data.x; serverVerifiedPos.y = data.y;
    }
});

socket.on('feedKillMessage', (msg) => {
    const fContainer = document.getElementById('kill-feed-container');
    const item = document.createElement('div');
    item.className = 'feed-item';
    item.innerText = msg;
    fContainer.appendChild(item);
    if(fContainer.children.length > 5) fContainer.removeChild(fContainer.children[0]);
    setTimeout(() => { if (item.parentNode) item.parentNode.removeChild(item); }, 4000);
});

socket.on('popupAnnouncement', (data) => {
    const pContainer = document.getElementById('announcement-popup-layer');
    pContainer.innerHTML = '';
    if (data.streak) {
        const d = document.createElement('div'); d.className = 'streak-msg'; d.innerText = data.streak;
        pContainer.appendChild(d);
    }
    if (data.elim) {
        const d = document.createElement('div'); d.className = 'elim-msg'; d.innerText = data.elim;
        pContainer.appendChild(d);
    }
    setTimeout(() => { pContainer.innerHTML = ''; }, 2500);
});

socket.on('hitFeedback', (data) => {
    hitmarkers.push({ life: 0.15 });
    if(data.heavy) screenShakeTimer = 0.25;
    floatingNumbers.push({
        x: data.x, y: data.y - 15,
        text: `${data.dmg}${data.isHead ? '!!' : ''}`,
        color: data.isHead ? '#ef4444' : (data.isCrit ? '#fbbf24' : '#ffffff'),
        life: 0.6
    });
});

socket.on('shieldCrackFX', (data) => {
    shieldCracks.push({ x: data.x, y: data.y, life: 0.4 });
});

socket.on('damageTakenAngle', (angle) => {
    directionDamageIndicators.push({ angle: angle, life: 0.5 });
});

socket.on('progressionAwarded', (data) => {
    clientProgression.kills += data.kills || 0;
    clientProgression.deaths += data.deaths || 0;
    clientProgression.wins += data.wins || 0;
    clientProgression.rankPoints = Math.max(0, clientProgression.rankPoints + (data.rpChange || 0));
    saveProgressionMetrics();
});

socket.on('serverTickUpdate', (data) => {
    if (data.state === 'playing' && !document.getElementById('lobby-terminal').classList.contains('hidden')) {
        document.getElementById('lobby-terminal').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');
    }
    serverGameState = data;
    if (data.state !== 'playing') return;

    let min = Math.floor(data.matchTimer / 60).toString().padStart(2, '0');
    let sec = (data.matchTimer % 60).toString().padStart(2, '0');
    document.getElementById('top-center-timer-box').innerText = `${min}:${sec}`;
    document.getElementById('scores-panel').innerText = `MODE: ${data.gamemode} || RED: ${data.scores.red} | BLUE: ${data.scores.blue}`;

    if (myId && data.players[myId]) {
        let me = data.players[myId];
        document.getElementById('hp-display').innerText = `VITALS: ${Math.ceil(me.hp)}% ${me.lastStandActive ? '[LAST STAND]' : ''}`;
        document.getElementById('shield-display').innerText = `OVERSHIELD: ${Math.ceil(me.overshield)}% ${me.invulnUntil > Date.now() ? '[INVULNERABLE]' : ''}`;
        
        let activeWep = me.loadout[me.activeWeaponIndex] || 'None';
        document.getElementById('active-wep-line').innerText = `WEAPON: ${activeWep.toUpperCase()}`;
        
        if (me.isReloading) {
            document.getElementById('ammo-line').innerText = "MAG CAP: RELOADING...";
        } else if (activeWep === 'laser_beam') {
            document.getElementById('ammo-line').innerText = `CORE TEMP: ${Math.ceil(me.laserHeat)}% / 100%`;
        } else {
            document.getElementById('ammo-line').innerText = `MAG CAP: ${me.ammo} / ${me.maxAmmo}`;
        }
        
        let slotsDisplay = me.loadout.map((w, idx) => `Slot ${idx + 1}: ${w.toUpperCase()} ${idx === me.activeWeaponIndex ? '◀' : ''}`).join('\n');
        document.getElementById('wep-slots-rack').innerText = slotsDisplay;

        let now = Date.now();
        ['1','2','3'].forEach((num, idx) => {
            let readyTime = me[`ability${idx+1}ReadyAt`] || 0;
            let node = document.getElementById(`cd-${num}-status`);
            if (now < readyTime) {
                node.innerText = `RECHARGING (${Math.ceil((readyTime - now)/1000)}S)`; node.className = "cd-wait";
            } else {
                node.innerText = `READY [${(me.abilities[idx] || 'NONE').toUpperCase()}]`; node.className = "cd-ready";
            }
        });

        const vig = document.getElementById('low-hp-vignette');
        if (me.hp < 30 && me.hp > 0) { vig.className = 'pulsing-vignette'; } else { vig.className = ''; }

        if (!hasSetInitialPos) {
            predictedPos.x = me.x; predictedPos.y = me.y;
            serverVerifiedPos.x = me.x; serverVerifiedPos.y = me.y;
            hasSetInitialPos = true;
        }
        serverVerifiedPos.x = me.x; serverVerifiedPos.y = me.y;
    }
});

let lastPhysicsLoopTimestamp = performance.now();
function runHighPrecisionClientPrediction(currentFrameTime) {
    let dt = (currentFrameTime - lastPhysicsLoopTimestamp) / 1000;
    lastPhysicsLoopTimestamp = currentFrameTime;
    if (dt > 0.05) dt = 0.05;

    if (serverGameState.state === 'playing' && myId && serverGameState.players[myId]) {
        socket.emit('playerActionInput', inputState);

        let me = serverGameState.players[myId];
        if (me && me.hp > 0) {
            let dx = 0; let dy = 0;
            if (inputState.w) dy -= 1; if (inputState.s) dy += 1;
            if (inputState.a) dx -= 1; if (inputState.d) dx += 1;
            if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

            let currentMoveSpeed = me.phaseActive ? 400 : 252;
            if (selectedDeviceProfile === 'mobile') currentMoveSpeed *= 1.15;
            if (me.loadout && me.loadout[me.activeWeaponIndex] === 'chaingun') currentMoveSpeed = 150;
            if (Date.now() < me.stimActiveUntil) currentMoveSpeed += 120;
            if (me.killBuffUntil > Date.now()) currentMoveSpeed += 60;

            let nextX = predictedPos.x + (dx * currentMoveSpeed * dt);
            let nextY = predictedPos.y + (dy * currentMoveSpeed * dt);

            if (me.phaseActive) {
                predictedPos.x = Math.max(10, Math.min(MAP_SIZE - 10, nextX));
                predictedPos.y = Math.max(10, Math.min(MAP_SIZE - 10, nextY));
            } else {
                if (!checkClientWallCollision(nextX, predictedPos.y, 16)) predictedPos.x = nextX;
                if (!checkClientWallCollision(predictedPos.x, nextY, 16)) predictedPos.y = nextY;
            }
        }

        let serverDist = Math.hypot(predictedPos.x - serverVerifiedPos.x, predictedPos.y - serverVerifiedPos.y);
        if (serverDist > 64) {
            predictedPos.x = serverVerifiedPos.x; predictedPos.y = serverVerifiedPos.y;
        } else if (serverDist > 0.01) {
            let smoothingAlpha = 1 - Math.exp(-35 * dt);
            predictedPos.x += (serverVerifiedPos.x - predictedPos.x) * smoothingAlpha;
            predictedPos.y += (serverVerifiedPos.y - predictedPos.y) * smoothingAlpha;
        }
    }
    requestAnimationFrame(runHighPrecisionClientPrediction);
}

function checkIfTargetVisible(x1, y1, x2, y2) {
    if (!localGrid || localGrid.length === 0) return true;
    
    if (serverGameState.fields) {
        for(let f of serverGameState.fields) {
            if (f.type === 'smoke') {
                if (Math.hypot(x1 - f.x, y1 - f.y) < f.radius || Math.hypot(x2 - f.x, y2 - f.y) < f.radius) return false;
            }
        }
    }

    let dist = Math.hypot(x2 - x1, y2 - y1); if (dist < 40) return true;
    let steps = Math.ceil(dist / 15);
    for (let i = 0; i <= steps; i++) {
        let checkX = x1 + (x2 - x1) * (i / steps);
        let checkY = y1 + (y2 - y1) * (i / steps);
        let gx = Math.floor(checkX / GRID_SIZE);
        let gy = Math.floor(checkY / GRID_SIZE);
        if (localGrid[gx] && localGrid[gx][gy] === 1) return false;
    }
    return true;
}

function paintLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (serverGameState.state !== 'playing' || !myId || !serverGameState.players[myId]) {
        ctx.fillStyle = "#0c0d19"; ctx.fillRect(0,0,canvas.width,canvas.height);
        requestAnimationFrame(paintLoop); return;
    }

    let shakeX = 0, shakeY = 0;
    if (screenShakeTimer > 0) {
        shakeX = (Math.random() - 0.5) * 12;
        shakeY = (Math.random() - 0.5) * 12;
        screenShakeTimer -= 1/60;
    }

    camera.x += (predictedPos.x - camera.x) * 0.15; camera.y += (predictedPos.y - camera.y) * 0.15;
    let oX = canvas.width / 2 - camera.x + shakeX; let oY = canvas.height / 2 - camera.y + shakeY;

    ctx.fillStyle = '#11121c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e2030'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE);

    if (serverGameState.mapGrid) localGrid = serverGameState.mapGrid;

    for (let x = 0; x < localGrid.length; x++) {
        for (let y = 0; y < localGrid[x].length; y++) {
            if (localGrid[x][y] === 1) {
                ctx.fillStyle = '#475569';
                ctx.fillRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
                ctx.strokeStyle = '#334155'; ctx.strokeRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
            } else if (localGrid[x][y] === 2) {
                ctx.fillStyle = 'rgba(239, 68, 68, 0.6)';
                ctx.fillRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
            } else if (localGrid[x][y] === 3) {
                ctx.fillStyle = 'rgba(168, 85, 247, 0.3)';
                ctx.fillRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
            }
        }
    }

    if (serverGameState.fields) {
        serverGameState.fields.forEach(f => {
            if (f.type === 'acid') ctx.fillStyle = 'rgba(34,197,94,0.25)';
            if (f.type === 'heal') ctx.fillStyle = 'rgba(0,255,102,0.15)';
            if (f.type === 'smoke') ctx.fillStyle = 'rgba(100,116,139,0.85)';
            if (f.type === 'moving_heal') ctx.fillStyle = 'rgba(236,72,153,0.2)';
            ctx.beginPath(); ctx.arc(f.x + oX, f.y + oY, f.radius, 0, Math.PI*2); ctx.fill();
            ctx.strokeStyle = f.type === 'heal' ? '#00ff66' : 'transparent'; ctx.stroke();
        });
    }

    if (serverGameState.stormRadius) {
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(MAP_SIZE/2 + oX, MAP_SIZE/2 + oY, serverGameState.stormRadius, 0, Math.PI*2); ctx.stroke();
    }

    if (serverGameState.items) {
        serverGameState.items.forEach(it => {
            ctx.fillStyle = it.type === 'armor' ? '#38bdf8' : (it.type === 'health' ? '#22c55e' : (it.type === 'invuln' ? '#fbbf24' : '#a855f7'));
            ctx.fillRect(it.x - 8 + oX, it.y - 8 + oY, 16, 16);
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.strokeRect(it.x - 8 + oX, it.y - 8 + oY, 16, 16);
        });
    }

    if (serverGameState.bullets) {
        serverGameState.bullets.forEach(b => {
            if (checkIfTargetVisible(predictedPos.x, predictedPos.y, b.x, b.y)) {
                ctx.fillStyle = b.color || '#fbbf24'; ctx.beginPath(); ctx.arc(b.x + oX, b.y + oY, b.radius, 0, Math.PI * 2); ctx.fill();
            }
        });
    }

    if (serverGameState.decoys) {
        serverGameState.decoys.forEach(d => {
            if (!checkIfTargetVisible(predictedPos.x, predictedPos.y, d.x, d.y)) return;
            ctx.save(); ctx.translate(d.x + oX, d.y + oY);
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.6)'; ctx.lineWidth = 3; ctx.fillStyle = 'rgba(12,13,25,0.7)';
            ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.rotate(d.angle); ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(6, -2.5, 14, 5);
            ctx.restore();
        });
    }

    Object.values(serverGameState.players).forEach(p => {
        if (p.hp <= 0 || (p.cloakActive && p.id !== myId)) return;
        if (p.id !== myId && !checkIfTargetVisible(predictedPos.x, predictedPos.y, p.x, p.y)) return; 

        ctx.save();
        ctx.translate((p.id === myId ? predictedPos.x : p.x) + oX, (p.id === myId ? predictedPos.y : p.y) + oY);
        
        let strokeColor = p.isZombie ? '#ea580c' : (p.team === 'red' ? '#ff007f' : '#00f0ff');
        if (p.isKing) strokeColor = '#f59e0b'; 
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = p.overshield > 0 ? 6 : 4; 
        ctx.fillStyle = '#05060c';

        if (p.invulnUntil > Date.now()) { ctx.strokeStyle = '#fff'; }

        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        
        ctx.rotate(p.id === myId ? inputState.angle : p.angle);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5);
        ctx.restore();

        ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`${p.name} (${Math.ceil(p.hp)}HP)`, (p.id === myId ? predictedPos.x : p.x) + oX, (p.id === myId ? predictedPos.y : p.y) + oY - 22);
    });

    for(let i=shieldCracks.length-1; i>=0; i--) {
        let sc = shieldCracks[i]; sc.life -= 1/60;
        if(sc.life <= 0) { shieldCracks.splice(i,1); continue; }
        ctx.strokeStyle = 'rgba(56,189,248,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sc.x + oX, sc.y + oY, 25 * (1 - sc.life), 0, Math.PI*2); ctx.stroke();
    }

    for(let i=floatingNumbers.length-1; i>=0; i--) {
        let f = floatingNumbers[i]; f.life -= 1/60; f.y -= 30 * (1/60);
        if (f.life <= 0) { floatingNumbers.splice(i, 1); continue; }
        ctx.fillStyle = f.color; ctx.font = 'bold 13px Courier New'; ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x + oX, f.y + oY);
    }

    for(let i=hitmarkers.length-1; i>=0; i--) {
        let hm = hitmarkers[i]; hm.life -= 1/60;
        if(hm.life <= 0) { hitmarkers.splice(i,1); continue; }
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
        let cx = canvas.width/2, cy = canvas.height/2;
        ctx.beginPath(); ctx.moveTo(cx-6, cy-6); ctx.lineTo(cx+6, cy+6); ctx.moveTo(cx+6, cy-6); ctx.lineTo(cx-6, cy+6); ctx.stroke();
    }

    for(let i=directionDamageIndicators.length-1; i>=0; i--) {
        let ind = directionDamageIndicators[i]; ind.life -= 1/60;
        if(ind.life <= 0) { directionDamageIndicators.splice(i,1); continue; }
        ctx.save(); ctx.translate(canvas.width/2, canvas.height/2); ctx.rotate(ind.angle);
        ctx.fillStyle = `rgba(239, 68, 68, ${ind.life * 2})`;
        ctx.beginPath(); ctx.moveTo(40, -10); ctx.lineTo(55, 0); ctx.lineTo(40, 10); ctx.fill();
        ctx.restore();
    }

    requestAnimationFrame(paintLoop);
}

window.addEventListener('load', () => {
    fitCanvasToWindow();
    requestAnimationFrame(runHighPrecisionClientPrediction);
    requestAnimationFrame(paintLoop);
});