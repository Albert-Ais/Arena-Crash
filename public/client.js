const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function fitCanvasToWindow() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', fitCanvasToWindow); fitCanvasToWindow();

const MAP_SIZE = 2000; const GRID_SIZE = 40;
let myId = null; let localGrid = []; let localMapStyle = 'desert_outpost';
let serverGameState = { players: {}, bullets: [], decoys: [], fields: [], scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 120, mode: 'TDM' };
let camera = { x: 1000, y: 1000 }; 
let inputState = { w: false, a: false, s: false, d: false, angle: 0 };

let predictedPos = { x: 1000, y: 1000 };
let serverVerifiedPos = { x: 1000, y: 1000 };
let hasSetInitialPos = false;

let selectedDeviceProfile = 'pc'; 
let keyboardBinds = {
    up: 'w', left: 'a', down: 's', right: 'd',
    reload: 'r', shoot: ' ',
    wep1: '1', wep2: '2', wep3: '3',
    ability1: 'm', ability2: 'n'
};

let activeListeningButtonNode = null;

const AVAILABLE_WEAPONS_LIST = [
    { id: 'railgun', title: 'Railgun', desc: 'Instant high velocity straight beam line.', color: '#00ffff' },
    { id: 'heavy_revolver', title: 'Heavy Revolver', desc: 'High kinetic damage with massive recoil thrust.', color: '#f97316' },
    { id: 'bouncing_sniper', title: 'Bouncing Sniper', desc: 'High velocity round bouncing off obstacles up to 3 times.', color: '#a855f7' },
    { id: 'chaingun', title: 'AP Chaingun', desc: '60-round fire-rate monster that slows movement slightly.', color: '#fbbf24' },
    { id: 'burst_rifle', title: 'Burst Rifle', desc: 'High accuracy three-round burst.', color: '#38bdf8' },
    { id: 'bouncing_betty', title: 'Bouncing Betty', desc: 'Explosive shell detonating on wall or character presence.', color: '#ef4444' },
    { id: 'napalm', title: 'Napalm Launcher', desc: 'Lobs explosive magma shell leaving three pools.', color: '#ea580c' },
    { id: 'prox_mine', title: 'Proximity Mine', desc: 'Deploys a rooted cloaked landmine.', color: '#b91c1c' },
    { id: 'cluster_bomb', title: 'Cluster Bomb', desc: 'Splits into 6 fragment shards on wall contact.', color: '#f43f5e' },
    { id: 'micro_nuke', title: 'Micro-Nuke', desc: 'Slow moving payload yielding catastrophic blast radius.', color: '#22c55e' },
    { id: 'stun_baton', title: 'Stun Baton', desc: 'Short range defensive shock that freezes target speed.', color: '#eab308' },
    { id: 'plasma_rifle', title: 'Plasma Rifle', desc: 'Rapid energy bolts featuring home-in capabilities.', color: '#ec4899' },
    { id: 'shotgun', title: 'Shotgun Spread', desc: 'Fires horizontal grouping arc of 5 heavy pellets.', color: '#64748b' },
    { id: 'seeker', title: 'Seeker Missile', desc: 'Heavy rocket that pursues enemy operational signatures.', color: '#6366f1' },
    { id: 'sawblade', title: 'Sawblade Launcher', desc: 'Kinetic circular saw blade bouncing up to 5 times.', color: '#14b8a6' }
];

const AVAILABLE_ABILITIES_LIST = [
    { id: 'blink', title: 'Blink Matrix', desc: 'Flash 120px down aiming heading vector.' },
    { id: 'slide', title: 'Power Slide', desc: 'High momentum forward acceleration push.' },
    { id: 'stim', title: 'Stim Injection', desc: 'Boost operational speed loop and heal 10 HP.' },
    { id: 'decoy', title: 'Decoy Clone Override', desc: 'Drive a full health clone while cloaking real frame for 10s.' },
    { id: 'shield', title: 'Deflect Shield', desc: 'Absorbs next weapon impact damage burst.' },
    { id: 'smoke', title: 'Smoke Screen', desc: 'Deploys an obscurement field.' },
    { id: 'pulse', title: 'Radar Pulse', desc: 'Highlights all match structural coordinates.' },
    { id: 'gravity', title: 'Gravity Well', desc: 'Vortex pulling in contrasting player layers.' },
    { id: 'overdrive', title: 'Fire Overdrive', desc: 'Boost weapon loading operational loop cycles.' },
    { id: 'teleport', title: 'Quantum Recall', desc: 'Recall to coordinate location from 3s ago.' },
    { id: 'heal', title: 'Repair Matrix', desc: 'Instantly restore 40 framework points.' },
    { id: 'cloak', title: 'Stealth Cloak', desc: 'Conceal player model framework completely.' }
];

function buildHardwareConfigInterface() {
    return `
        <h2 style="color: #00f0ff; text-align: center; margin-bottom: 4px;">SYSTEM ARCHITECTURE REGISTRY</h2>
        <p style="text-align: center; color:#64748b; font-size:12px; margin-bottom:20px;">Link callsign credentials, device hardware type, and key layout properties.</p>
        
        <div class="flex-col">
            <input type="text" id="player-name" placeholder="OPERATOR CALLSIGN" value="Spectre" maxlength="14">
            <div class="flex-row">
                <select id="size-pref"><option value="1v1">1v1 Arena Duel</option><option value="2v2">2vSkirmish</option><option value="3v3">3v3 Squad Chaos</option></select>
                <select id="mode-pref"><option value="TDM">Team Deathmatch (TDM)</option><option value="KOTH">King of the Hill (KOTH)</option><option value="CTF">Capture the Flag (CTF)</option></select>
            </div>
        </div>

        <div class="category-header" style="color: #fbbf24; border-color: #fbbf24;">SELECT HARDWARE LAYER DEVICE</div>
        <div class="device-selector-container">
            <div class="device-btn active" id="dev-btn-pc" onclick="assignHardwareProfile('pc')">Desktop PC / Mac</div>
            <div class="device-btn" id="dev-btn-mobile" onclick="assignHardwareProfile('mobile')">Mobile Touchscreen</div>
            <div class="device-btn" id="dev-btn-console" onclick="assignHardwareProfile('console')">Gamepad Controller</div>
        </div>

        <div id="dynamic-binds-customizer-wrapper">
            <div class="category-header" style="color: #38bdf8; border-color: #38bdf8;">CUSTOMIZE KEYBOARD INPUT MAPS</div>
            <div class="controls-mapping-window">
                <div class="bind-row"><span class="bind-label">Move Forward</span><button class="bind-input-btn" id="bk-up" onclick="primeInputCapture('up')">W</button></div>
                <div class="bind-row"><span class="bind-label">Move Left</span><button class="bind-input-btn" id="bk-left" onclick="primeInputCapture('left')">A</button></div>
                <div class="bind-row"><span class="bind-label">Move Backward</span><button class="bind-input-btn" id="bk-down" onclick="primeInputCapture('down')">S</button></div>
                <div class="bind-row"><span class="bind-label">Move Right</span><button class="bind-input-btn" id="bk-right" onclick="primeInputCapture('right')">D</button></div>
                <div class="bind-row"><span class="bind-label">Weapon Reload</span><button class="bind-input-btn" id="bk-reload" onclick="primeInputCapture('reload')">R</button></div>
                <div class="bind-row"><span class="bind-label">Primary Fire</span><button class="bind-input-btn" id="bk-shoot" onclick="primeInputCapture('shoot')">SPACE</button></div>
                <div class="bind-row"><span class="bind-label">Ability One</span><button class="bind-input-btn" id="bk-ability1" onclick="primeInputCapture('ability1')">M</button></div>
                <div class="bind-row"><span class="bind-label">Ability Two</span><button class="bind-input-btn" id="bk-ability2" onclick="primeInputCapture('ability2')">N</button></div>
            </div>
        </div>

        ${compileGridHTML('init')}
        <button id="dispatch-queue-btn" class="submit-btn">ENGAGE MATCH FRAMEWORK</button>
    `;
}

function compileGridHTML(suffix) {
    return `
        <div class="category-header">Weapons Systems (Select Exactly 3)</div>
        <div class="grid-layout">
            ${AVAILABLE_WEAPONS_LIST.map(w => `
                <div class="card"><label><input type="checkbox" class="wep-chk-${suffix}" value="${w.id}"> <span class="card-title" style="color: ${w.color};">${w.title}</span></label><div class="card-text">${w.desc}</div></div>
            `).join('')}
        </div>
        <div class="category-header ability-hdr">Abilities Grid Matrix (Select Exactly 2)</div>
        <div class="grid-layout">
            ${AVAILABLE_ABILITIES_LIST.map(a => `
                <div class="card"><label><input type="checkbox" class="abil-chk-${suffix}" value="${a.id}"> <span class="card-title" style="color:#00ff66;">${a.title}</span></label><div class="card-text">${a.desc}</div></div>
            `).join('')}
        </div>
    `;
}

document.getElementById('primary-registry-box').innerHTML = buildHardwareConfigInterface();

window.assignHardwareProfile = function(profile) {
    selectedDeviceProfile = profile;
    document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`dev-btn-${profile}`).classList.add('active');

    let container = document.getElementById('dynamic-binds-customizer-wrapper');
    if (profile === 'pc') {
        container.innerHTML = `
            <div class="category-header" style="color: #38bdf8; border-color: #38bdf8;">CUSTOMIZE KEYBOARD INPUT MAPS</div>
            <p style="font-size:11px; color:#94a3b8; margin: 0 0 10px 4px; font-family:sans-serif;">* Note: Arrow keys are also automatically enabled alongside your custom movement keys.</p>
            <div class="controls-mapping-window">
                <div class="bind-row"><span class="bind-label">Move Forward</span><button class="bind-input-btn" id="bk-up" onclick="primeInputCapture('up')">${keyboardBinds.up.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Move Left</span><button class="bind-input-btn" id="bk-left" onclick="primeInputCapture('left')">${keyboardBinds.left.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Move Backward</span><button class="bind-input-btn" id="bk-down" onclick="primeInputCapture('down')">${keyboardBinds.down.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Move Right</span><button class="bind-input-btn" id="bk-right" onclick="primeInputCapture('right')">${keyboardBinds.right.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Weapon Reload</span><button class="bind-input-btn" id="bk-reload" onclick="primeInputCapture('reload')">${keyboardBinds.reload.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Primary Fire</span><button class="bind-input-btn" id="bk-shoot" onclick="primeInputCapture('shoot')">${keyboardBinds.shoot === ' ' ? 'SPACE' : keyboardBinds.shoot.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Ability One</span><button class="bind-input-btn" id="bk-ability1" onclick="primeInputCapture('ability1')">${keyboardBinds.ability1.toUpperCase()}</button></div>
                <div class="bind-row"><span class="bind-label">Ability Two</span><button class="bind-input-btn" id="bk-ability2" onclick="primeInputCapture('ability2')">${keyboardBinds.ability2.toUpperCase()}</button></div>
            </div>
        `;
    } else if (profile === 'mobile') {
        container.innerHTML = `
            <div class="category-header" style="color: #00ff66; border-color: #00ff66;">MOBILE HARDWARE MATRIX OVERVIEW</div>
            <p style="font-size:11px; color:#94a3b8; margin: 0 0 16px 4px; font-family:sans-serif; line-height:1.5;">
                Left on-screen joystick handles orientation vector driving velocities. Right on-screen joystick operates player heading angle configurations.
            </p>
        `;
    } else if (profile === 'console') {
        container.innerHTML = `
            <div class="category-header" style="color: #a855f7; border-color: #a855f7;">STANDARD CONTROLLER GAMEPAD MAPS</div>
            <p style="font-size:11px; color:#94a3b8; margin: 0 0 16px 4px; font-family:sans-serif; line-height:1.5;">
                • Left Analog Stick: Controls position movement.<br>
                • Right Analog Stick: Drives crosshair tracking.<br>
                • Right Trigger: Discharges fire mechanics.
            </p>
        `;
    }
};

window.primeInputCapture = function(action) {
    if (activeListeningButtonNode) {
        activeListeningButtonNode.innerText = keyboardBinds[activeListeningButtonNode.dataset.action].toUpperCase();
    }
    let btn = document.getElementById(`bk-${action}`);
    btn.innerText = "PRESS KEY...";
    btn.dataset.action = action;
    activeListeningButtonNode = btn;
};

window.addEventListener('keydown', (e) => {
    if (activeListeningButtonNode) {
        e.preventDefault();
        let targetAction = activeListeningButtonNode.dataset.action;
        let incomingKey = e.key.toLowerCase();
        keyboardBinds[targetAction] = incomingKey;
        activeListeningButtonNode.innerText = incomingKey === ' ' ? 'SPACE' : incomingKey.toUpperCase();
        activeListeningButtonNode = null;
        return;
    }

    if (selectedDeviceProfile === 'pc') {
        let key = e.key.toLowerCase();
        if (key === keyboardBinds.up || e.key === 'ArrowUp') inputState.w = true;
        if (key === keyboardBinds.left || e.key === 'ArrowLeft') inputState.a = true;
        if (key === keyboardBinds.down || e.key === 'ArrowDown') inputState.s = true;
        if (key === keyboardBinds.right || e.key === 'ArrowRight') inputState.d = true;

        if (key === keyboardBinds.reload) socket.emit('triggerReload');
        if (key === keyboardBinds.shoot) socket.emit('shootWeapon');
        if (key === keyboardBinds.ability1) socket.emit('useAbility', 0);
        if (key === keyboardBinds.ability2) socket.emit('useAbility', 1);

        if (key === keyboardBinds.wep1) socket.emit('switchWeapon', 0);
        if (key === keyboardBinds.wep2) socket.emit('switchWeapon', 1);
        if (key === keyboardBinds.wep3) socket.emit('switchWeapon', 2);
    }
});

window.addEventListener('keyup', (e) => {
    if (selectedDeviceProfile === 'pc') {
        let key = e.key.toLowerCase();
        if (key === keyboardBinds.up || e.key === 'ArrowUp') inputState.w = false;
        if (key === keyboardBinds.left || e.key === 'ArrowLeft') inputState.a = false;
        if (key === keyboardBinds.down || e.key === 'ArrowDown') inputState.s = false;
        if (key === keyboardBinds.right || e.key === 'ArrowRight') inputState.d = false;
    }
});

window.addEventListener('mousemove', (e) => {
    if (selectedDeviceProfile === 'pc') {
        inputState.angle = Math.atan2(e.clientY - window.innerHeight / 2, e.clientX - window.innerWidth / 2);
    }
});

let activeJoysticksTracker = {
    left: { active: false, startX: 0, startY: 0, curX: 0, curY: 0 },
    right: { active: false, startX: 0, startY: 0, curX: 0, curY: 0 }
};

function setupTouchInterfaceLoop() {
    const leftStickEl = document.getElementById('left-movement-joystick');
    const rightStickEl = document.getElementById('right-aiming-joystick');

    function handleStickStart(e, tracker, element) {
        e.preventDefault();
        let rect = element.getBoundingClientRect();
        tracker.active = true;
        tracker.startX = rect.left + rect.width / 2;
        tracker.startY = rect.top + rect.height / 2;
        let t = e.targetTouches[0];
        tracker.curX = t.clientX; tracker.curY = t.clientY;
    }

    function handleStickMove(e, tracker, element) {
        if (!tracker.active) return;
        let touchMatch = null;
        for (let i = 0; i < e.targetTouches.length; i++) {
            let t = e.targetTouches[i];
            let dist = Math.hypot(t.clientX - tracker.startX, t.clientY - tracker.startY);
            if (dist < 160) { touchMatch = t; break; }
        }
        if (!touchMatch) touchMatch = e.targetTouches[0];
        tracker.curX = touchMatch.clientX; tracker.curY = touchMatch.clientY;

        let dx = tracker.curX - tracker.startX; let dy = tracker.curY - tracker.startY;
        let distance = Math.min(50, Math.hypot(dx, dy));
        let angle = Math.atan2(dy, dx);
        
        let thumbNode = element.querySelector('.joystick-thumb-node');
        if (thumbNode) {
            thumbNode.style.transform = `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance}px)`;
        }

        if (tracker === activeJoysticksTracker.left) {
            inputState.w = dy < -15; inputState.s = dy > 15;
            inputState.a = dx < -15; inputState.d = dx > 15;
        } else {
            inputState.angle = angle;
        }
    }

    function handleStickEnd(tracker, element) {
        tracker.active = false;
        let thumbNode = element.querySelector('.joystick-thumb-node');
        if (thumbNode) thumbNode.style.transform = "translate(0px, 0px)";
        if (tracker === activeJoysticksTracker.left) {
            inputState.w = false; inputState.a = false; inputState.s = false; inputState.d = false;
        }
    }

    leftStickEl.addEventListener('touchstart', (e) => handleStickStart(e, activeJoysticksTracker.left, leftStickEl));
    leftStickEl.addEventListener('touchmove', (e) => handleStickMove(e, activeJoysticksTracker.left, leftStickEl));
    leftStickEl.addEventListener('touchend', () => handleStickEnd(activeJoysticksTracker.left, leftStickEl));

    rightStickEl.addEventListener('touchstart', (e) => handleStickStart(e, activeJoysticksTracker.right, rightStickEl));
    rightStickEl.addEventListener('touchmove', (e) => handleStickMove(e, activeJoysticksTracker.right, rightStickEl));
    rightStickEl.addEventListener('touchend', () => handleStickEnd(activeJoysticksTracker.right, rightStickEl));
}

window.handleMobileAction = function(actionType) {
    if (actionType === 'shoot') socket.emit('shootWeapon');
    if (actionType === 'reload') socket.emit('triggerReload');
    if (actionType === 'ab1') socket.emit('useAbility', 0);
    if (actionType === 'ab2') socket.emit('useAbility', 1);
    if (actionType === 'swap') {
        let nextIdx = ((serverGameState.players[myId]?.activeWeaponIndex || 0) + 1) % 3;
        socket.emit('switchWeapon', nextIdx);
    }
};

function scanConsoleGamepadInputs() {
    let gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let activePad = null;
    for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) { activePad = gamepads[i]; break; }
    }
    if (!activePad) return;

    let lx = activePad.axes[0]; let ly = activePad.axes[1];
    inputState.a = lx < -0.25; inputState.d = lx > 0.25;
    inputState.w = ly < -0.25; inputState.s = ly > 0.25;

    let rx = activePad.axes[2]; let ry = activePad.axes[3];
    if (Math.hypot(rx, ry) > 0.3) inputState.angle = Math.atan2(ry, rx);

    if (activePad.buttons[7]?.pressed) {
        if (!inputState.wasFirePressedLastFrame) { socket.emit('shootWeapon'); inputState.wasFirePressedLastFrame = true; }
    } else { inputState.wasFirePressedLastFrame = false; }

    if (activePad.buttons[2]?.pressed) {
        if (!inputState.wasReloadPressedLastFrame) { socket.emit('triggerReload'); inputState.wasReloadPressedLastFrame = true; }
    } else { inputState.wasReloadPressedLastFrame = false; }
}

function checkClientWallCollision(x, y, radius) {
    if (!localGrid || localGrid.length === 0) return false;
    const blocks = MAP_SIZE / GRID_SIZE;
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

function bindLimits(type, limit) {
    document.querySelectorAll(`.${type}`).forEach(box => {
        box.addEventListener('change', () => { if (document.querySelectorAll(`.${type}:checked`).length > limit) box.checked = false; });
    });
}
bindLimits('wep-chk-init', 3); bindLimits('abil-chk-init', 2); bindLimits('wep-chk-mid', 3); bindLimits('abil-chk-mid', 2);

document.querySelectorAll('.wep-chk-init')[0].checked = true;
document.querySelectorAll('.wep-chk-init')[1].checked = true;
document.querySelectorAll('.wep-chk-init')[2].checked = true;
document.querySelectorAll('.abil-chk-init')[0].checked = true;
document.querySelectorAll('.abil-chk-init')[3].checked = true; 

function grabPack(suffix) {
    let weapons = []; document.querySelectorAll(`.wep-chk-${suffix}:checked`).forEach(el => weapons.push(el.value));
    let abs = []; document.querySelectorAll(`.abil-chk-${suffix}:checked`).forEach(el => abs.push(el.value));
    return { loadout: weapons, abilities: abs };
}

document.getElementById('dispatch-queue-btn').addEventListener('click', () => {
    let payload = grabPack('init');
    if (payload.loadout.length !== 3 || payload.abilities.length !== 2) { alert("Registry Denied: Select 3 weapons and 2 abilities."); return; }
    document.getElementById('setup-terminal').classList.add('hidden'); document.getElementById('hud').classList.remove('hidden');
    
    if (selectedDeviceProfile === 'mobile') {
        document.getElementById('mobile-touch-interface').style.display = 'block';
        setupTouchInterfaceLoop();
    }
    socket.emit('joinQueue', { name: document.getElementById('player-name').value.trim() || "Spectre", sizePref: document.getElementById('size-pref').value, modePref: document.getElementById('mode-pref').value, loadout: payload.loadout, abilities: payload.abilities });
});

document.getElementById('change-loadout-btn').addEventListener('click', () => {
    let payload = grabPack('mid'); if (payload.loadout.length !== 3 || payload.abilities.length !== 2) { alert("Pick exactly 3 weapons and 2 abilities."); return; }
    socket.emit('updateLoadout', payload);
});
document.getElementById('skip-loadout-btn').addEventListener('click', () => { socket.emit('skipLoadout'); });

function castVote(style) { socket.emit('castMapVote', style); }

socket.on('connect', () => { myId = socket.id; });
socket.on('roomJoined', (data) => { localGrid = data.map; localMapStyle = data.mapStyle; });
socket.on('loadoutActionAck', () => { document.getElementById('midround-terminal').classList.add('hidden'); });
socket.on('playerRespawned', (data) => { if (data.id === myId) { predictedPos.x = data.x; predictedPos.y = data.y; serverVerifiedPos.x = data.x; serverVerifiedPos.y = data.y; } });
socket.on('matchStarted', (data) => { localGrid = data.map; localMapStyle = data.mapStyle; document.getElementById('midround-terminal').classList.add('hidden'); hasSetInitialPos = false; });
socket.on('voteRegisteredUpdate', (votes) => {
    document.getElementById('count-desert_outpost').innerText = `VOTES: ${votes.desert_outpost}`;
    document.getElementById('count-urban_blocks').innerText = `VOTES: ${votes.urban_blocks}`;
});

socket.on('showLoadoutCustomizer', (data) => { 
    document.getElementById('round-banner').innerText = `WAVE ${data.round || 1} UPGRADES`; 
    document.getElementById('midround-terminal').classList.remove('hidden'); 
});

socket.on('serverTickUpdate', (data) => {
    serverGameState = data; if (data.mapStyle) localMapStyle = data.mapStyle;
    let min = Math.floor(data.matchTimer / 60).toString().padStart(2, '0');
    let sec = (data.matchTimer % 60).toString().padStart(2, '0');
    document.getElementById('top-center-timer-box').innerText = `${min}:${sec}`;
    
    if (data.mode === 'TDM') {
        document.getElementById('scores-panel').innerText = `MODE: TEAM DEATHMATCH || RED KILLS: ${data.scores.red} | BLUE KILLS: ${data.scores.blue}`;
    }

    if (myId && data.players[myId]) {
        let me = data.players[myId];
        document.getElementById('active-wep-line').innerText = `LOADOUT: ${(me.loadout[me.activeWeaponIndex] || 'None').toUpperCase()}`;
        document.getElementById('ammo-line').innerText = me.isReloading ? "AMMO: RELOADING..." : `MAG CAPACITY: ${me.ammo}`;

        let now = Date.now();
        let mDiff = Math.max(0, Math.ceil((me.ability1ReadyAt - now) / 1000));
        let mNode = document.getElementById('cd-m-status');
        if (mDiff > 0) { mNode.innerText = `RECHARGING (${mDiff}S)`; mNode.className = "cd-wait"; }
        else { mNode.innerText = `READY [${me.abilities[0].toUpperCase()}]`; mNode.className = "cd-ready"; }

        if (!hasSetInitialPos) {
            predictedPos.x = me.x; predictedPos.y = me.y;
            serverVerifiedPos.x = me.x; serverVerifiedPos.y = me.y;
            hasSetInitialPos = true;
        }
        serverVerifiedPos.x = me.x; serverVerifiedPos.y = me.y;
    }
});

let lastPhysicsLoopTimestamp = performance.now();

function executeHighPrecisionClientPrediction(currentFrameTime) {
    let dt = (currentFrameTime - lastPhysicsLoopTimestamp) / 1000;
    lastPhysicsLoopTimestamp = currentFrameTime;
    if (dt > 0.1) dt = 0.1;

    if (serverGameState.state === 'playing') {
        if (selectedDeviceProfile === 'console') scanConsoleGamepadInputs();

        socket.emit('playerActionInput', inputState); 

        let me = serverGameState.players[myId];
        if (me && me.hp > 0) {
            let dx = 0; let dy = 0;
            if (inputState.w) dy -= 1; if (inputState.s) dy += 1;
            if (inputState.a) dx -= 1; if (inputState.d) dx += 1;

            if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

            let currentMoveSpeed = 252; 
            if (me.loadout && me.loadout[me.activeWeaponIndex] === 'chaingun') currentMoveSpeed = 150; 
            if (Date.now() < me.stimActiveUntil) currentMoveSpeed += 120;

            let nextX = predictedPos.x + (dx * currentMoveSpeed * dt);
            let nextY = predictedPos.y + (dy * currentMoveSpeed * dt);

            if (!checkClientWallCollision(nextX, predictedPos.y, 16)) predictedPos.x = nextX;
            if (!checkClientWallCollision(predictedPos.x, nextY, 16)) predictedPos.y = nextY;
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
    requestAnimationFrame(executeHighPrecisionClientPrediction);
}
requestAnimationFrame(executeHighPrecisionClientPrediction);

function paintLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!myId || !serverGameState.players[myId]) { 
        requestAnimationFrame(paintLoop); 
        return; 
    }

    let camX = predictedPos.x; let camY = predictedPos.y;
    camera.x += (camX - camera.x) * 0.1; camera.y += (camY - camera.y) * 0.1;
    let oX = canvas.width / 2 - camera.x; let oY = canvas.height / 2 - camera.y;

    // Background Render Layer Loop
    if (localMapStyle === 'desert_outpost') {
        ctx.fillStyle = '#cc9966'; ctx.fillRect(0, 0, canvas.width, canvas.height); 
        ctx.fillStyle = '#dfb17b'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE); 
    } else {
        ctx.fillStyle = '#11121c'; ctx.fillRect(0, 0, canvas.width, canvas.height); 
        ctx.fillStyle = '#1e2030'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE); 
    }

    // Grid Construction and Wall Rendering Matrix
    if (localGrid && localGrid.length > 0) {
        for (let x = 0; x < localGrid.length; x++) {
            for (let y = 0; y < localGrid[x].length; y++) {
                if (localGrid[x][y] === 1) {
                    ctx.fillStyle = localMapStyle === 'desert_outpost' ? '#735135' : '#00f0ff';
                    ctx.fillRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
                } else {
                    ctx.strokeStyle = localMapStyle === 'desert_outpost' ? 'rgba(115,81,53,0.12)' : 'rgba(0,240,255,0.04)';
                    ctx.strokeRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
                }
            }
        }
    }

    // Bullets Layer
    serverGameState.bullets.forEach(b => {
        ctx.fillStyle = b.color || '#fbbf24'; ctx.beginPath(); ctx.arc(b.x + oX, b.y + oY, b.radius || 4, 0, Math.PI * 2); ctx.fill();
    });

    // Entities Layer
    Object.values(serverGameState.players).forEach(p => {
        if (p.hp <= 0) return;
        ctx.save(); 
        if (p.id === myId) {
            ctx.translate(predictedPos.x + oX, predictedPos.y + oY);
        } else {
            ctx.translate(p.x + oX, p.y + oY);
        }

        ctx.strokeStyle = p.team === 'red' ? '#ff007f' : '#00f0ff';
        ctx.lineWidth = 4;
        ctx.fillStyle = '#000000'; 
        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.rotate(p.id === myId ? inputState.angle : p.angle);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5); 
        ctx.restore();
    });

    requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);