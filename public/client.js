const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function fitCanvasToWindow() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', fitCanvasToWindow); fitCanvasToWindow();

const MAP_SIZE = 2000; const GRID_SIZE = 40;
let myId = null; let localGrid = [];
let serverGameState = { players: {}, decoys: [], bullets: [], fields: [], items: [], scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 180 };
let camera = { x: 1000, y: 1000 }; 
let inputState = { w: false, a: false, s: false, d: false, angle: 0 };

let predictedPos = { x: 1000, y: 1000 };
let serverVerifiedPos = { x: 1000, y: 1000 };
let hasSetInitialPos = false;
let selectedDeviceProfile = 'pc';
let localActiveWepIdx = 0;
let isInIntermissionSelection = false;

const WEAPONS_CATALOG = [
    // Energy Weapons
    { id: "wep_1", group: "Energy", title: "Chain Lightning Cannon", desc: "Hits one enemy, jumps to nearby enemies." },
    { id: "wep_2", group: "Energy", title: "Prism Rifle", desc: "Bullet splits into 3 after traveling." },
    { id: "wep_3", group: "Energy", title: "Photon Spear", desc: "Pierces every player in a line." },
    { id: "wep_4", group: "Energy", title: "Pulse Blaster", desc: "Creates expanding damage rings." },
    { id: "wep_5", group: "Energy", title: "Energy Shredder", desc: "Damage increases the longer you hold fire." },
    // Ricochet Weapons
    { id: "wep_6", group: "Ricochet", title: "Mirror Cannon", desc: "Bullets bounce toward nearest enemy after wall hit." },
    { id: "wep_7", group: "Ricochet", title: "Pinball Launcher", desc: "Projectiles bounce many times." },
    { id: "wep_8", group: "Ricochet", title: "Reflector Gun", desc: "Shots become stronger after every bounce." },
    { id: "wep_9", group: "Ricochet", title: "Corner Sniper", desc: "Designed to bank shots around walls." },
    { id: "wep_10", group: "Ricochet", title: "Chaos Ricochet", desc: "Random bounce directions." },
    // Area Control Weapons
    { id: "wep_11", group: "Area Control", title: "Spike Mine Launcher", desc: "Places hidden mines." },
    { id: "wep_12", group: "Area Control", title: "Flame Thrower", desc: "Creates fire patches." },
    { id: "wep_13", group: "Area Control", title: "Cryo Bomb", desc: "Creates slowing ice field." },
    { id: "wep_14", group: "Area Control", title: "Tesla Tower Gun", desc: "Deploys temporary electric turret." },
    { id: "wep_15", group: "Area Control", title: "Acid Sprayer", desc: "Leaves toxic puddles." },
    // Movement-Based Weapons
    { id: "wep_16", group: "Movement", title: "Boomerang Blade", desc: "Returns to shooter." },
    { id: "wep_17", group: "Movement", title: "Orbit Cannon", desc: "Projectiles circle player." },
    { id: "wep_18", group: "Movement", title: "Momentum Rifle", desc: "More damage while moving fast." },
    { id: "wep_19", group: "Movement", title: "Anchor Cannon", desc: "Temporarily roots enemy." },
    { id: "wep_20", group: "Movement", title: "Dash Shotgun", desc: "Fires automatically during dash." },
    // Weird Weapons
    { id: "wep_21", group: "Weird", title: "Portal Gun", desc: "Bullet enters one portal and exits another." },
    { id: "wep_22", group: "Weird", title: "Swap Rifle", desc: "Swaps positions with target." },
    { id: "wep_23", group: "Weird", title: "Time Shot", desc: "Bullet pauses then resumes." },
    { id: "wep_24", group: "Weird", title: "Reverse Gun", desc: "Pulls enemies toward projectile." },
    { id: "wep_25", group: "Weird", title: "Clone Cannon", desc: "Bullet duplicates mid-flight." },
    // Crowd-Control Weapons
    { id: "wep_26", group: "Crowd Control", title: "Magnet Launcher", desc: "Pulls nearby bullets." },
    { id: "wep_27", group: "Crowd Control", title: "EMP Rifle", desc: "Disables abilities briefly." },
    { id: "wep_28", group: "Crowd Control", title: "Shock Net", desc: "Traps enemies temporarily." },
    { id: "wep_29", group: "Crowd Control", title: "Gravity Cage", desc: "Creates temporary prison field." },
    { id: "wep_30", group: "Crowd Control", title: "Silence Beam", desc: "Prevents ability use." },
    // Precision Weapons
    { id: "wep_31", group: "Precision", title: "Burst Sniper", desc: "Fires 3 rapid sniper rounds." },
    { id: "wep_32", group: "Precision", title: "Charge Rifle", desc: "Hold for more damage." },
    { id: "wep_33", group: "Precision", title: "Rail Burst", desc: "Fires 5 tiny rail shots." },
    { id: "wep_34", group: "Precision", title: "Hunter Rifle", desc: "Marks target for bonus damage." },
    { id: "wep_35", group: "Precision", title: "Execution Revolver", desc: "Extra damage below 30 HP." },
    // Summon Weapons
    { id: "wep_36", group: "Summon", title: "Drone Launcher", desc: "Summons attack drone." },
    { id: "wep_37", group: "Summon", title: "Spider Bot Cannon", desc: "Deploys crawling explosive bots." },
    { id: "wep_38", group: "Summon", title: "Nano Swarm", desc: "Releases tracking micro-drones." },
    { id: "wep_39", group: "Summon", title: "Orbital Beacon", desc: "Calls down energy strikes." },
    { id: "wep_40", group: "Summon", title: "Guardian Core", desc: "Summons defensive turret." },
    // High-Risk Weapons
    { id: "wep_41", group: "High Risk", title: "Blood Cannon", desc: "Costs HP to fire." },
    { id: "wep_42", group: "High Risk", title: "Overload Rifle", desc: "Damage increases, but overheats." },
    { id: "wep_43", group: "High Risk", title: "Berserker Launcher", desc: "Stronger at low HP." },
    { id: "wep_44", group: "High Risk", title: "Unstable Reactor", desc: "Massive damage, chance to explode near user." },
    { id: "wep_45", group: "High Risk", title: "Glass Cannon", desc: "Huge damage but lowers your armor." },
    // Boss-Level Weapons
    { id: "wep_46", group: "Boss Level", title: "Black Hole Cannon", desc: "Creates a powerful gravity vortex." },
    { id: "wep_47", group: "Boss Level", title: "Meteor Launcher", desc: "Calls falling projectiles from sky." },
    { id: "wep_48", group: "Boss Level", title: "Void Beam", desc: "Damages through walls." },
    { id: "wep_49", group: "Boss Level", title: "Apocalypse Cannon", desc: "Huge slow projectile splitting repeatedly." },
    { id: "wep_50", group: "Boss Level", title: "Reality Breaker", desc: "Temporarily distorts bullets, players, and fields." }
];

const ABILITIES_CATALOG = [
    { id: "abil_1", group: "Support", title: "Emergency Repair", desc: "Instantly restores 40 HP." },
    { id: "abil_2", group: "Support", title: "Nano Regeneration", desc: "Gradually restores HP over 8 seconds." },
    { id: "abil_3", group: "Support", title: "Healing Beacon", desc: "Deploys a beacon that heals nearby teammates." },
    { id: "abil_4", group: "Support", title: "Lifesteal Surge", desc: "Converts 30% of damage dealt into health for 5 seconds." },
    { id: "abil_5", group: "Support", title: "Guardian Angel", desc: "Prevents one fatal hit and restores 25 HP." },
    { id: "abil_6", group: "Mobility", title: "Hyper Sprint", desc: "Boosts movement speed by 75% for 4 seconds." },
    { id: "abil_7", group: "Mobility", title: "Rocket Dash", desc: "Launches you forward at high speed." },
    { id: "abil_8", group: "Mobility", title: "Blink Chain", desc: "Allows three short-range teleports in quick succession." },
    { id: "abil_9", group: "Mobility", title: "Warp Tunnel", desc: "Creates two linked portals that players can travel through." },
    { id: "abil_10", group: "Mobility", title: "Ghost Walk", desc: "Pass through players and objects for 5 seconds." },
    { id: "abil_11", group: "Mobility", title: "Time Skip", desc: "Instantly teleport to a targeted nearby location." },
    { id: "abil_12", group: "Mobility", title: "Slipstream", desc: "Leaves behind speed-boost trails for allies." },
    { id: "abil_13", group: "Mobility", title: "Speed Steal", desc: "Steals movement speed from a nearby enemy." },
    { id: "abil_14", group: "Mobility", title: "Teleport Burst", desc: "Randomly teleports you a short distance." },
    { id: "abil_15", group: "Mobility", title: "Momentum Drive", desc: "Continuously increases speed while moving." },
    { id: "abil_16", group: "Defensive", title: "Armor Core", desc: "Grants 50 temporary armor points." },
    { id: "abil_17", group: "Defensive", title: "Reactive Armor", desc: "Reflects 25% of incoming damage back to attackers." },
    { id: "abil_18", group: "Defensive", title: "Energy Barrier", desc: "Deploys a large dome that blocks enemy projectiles." },
    { id: "abil_19", group: "Defensive", title: "Deflection Matrix", desc: "Randomly redirects incoming bullets away from you." },
    { id: "abil_20", group: "Defensive", title: "Damage Absorber", desc: "Stores incoming damage as shield energy." },
    { id: "abil_21", group: "Defensive", title: "Fortified Hull", desc: "Reduces incoming damage by 50% for 4 seconds." },
    { id: "abil_22", group: "Defensive", title: "Bullet Shield", desc: "Creates a rotating shield that destroys bullets." },
    { id: "abil_23", group: "Defensive", title: "Reflective Dome", desc: "Reflects enemy projectiles back toward owners." },
    { id: "abil_24", group: "Defensive", title: "Adaptive Armor", desc: "Increases damage resistance each time you are hit." },
    { id: "abil_25", group: "Defensive", title: "Emergency Evade", desc: "Automatically dashes away when HP becomes critically low." },
    { id: "abil_26", group: "Offensive", title: "Bloodlust", desc: "Gain bonus damage after every elimination." },
    { id: "abil_27", group: "Offensive", title: "Execution Protocol", desc: "Deal increased damage to enemies below 30% HP." },
    { id: "abil_28", group: "Offensive", title: "Mark Target", desc: "Marks an enemy, causing them to take extra damage." },
    { id: "abil_29", group: "Offensive", title: "Weakness Curse", desc: "Reduces an enemy's damage output for several seconds." },
    { id: "abil_30", group: "Offensive", title: "Chain Detonation", desc: "Defeated enemies explode and damage nearby opponents." },
    { id: "abil_31", group: "Offensive", title: "Overcharge", desc: "Your next attack deals triple damage." },
    { id: "abil_32", group: "Offensive", title: "Critical Focus", desc: "Guarantees a critical hit on your next shot." },
    { id: "abil_33", group: "Offensive", title: "Hunter Mode", desc: "Highlights wounded enemies through walls." },
    { id: "abil_34", group: "Offensive", title: "Armor Breaker", desc: "Temporarily ignores a portion of enemy armor." },
    { id: "abil_35", group: "Offensive", title: "Death Mark", desc: "Revealed and takes increased damage from all sources." },
    { id: "abil_36", group: "Tactical", title: "Sensor Jammer", desc: "Disrupts enemy radar and tracking abilities." },
    { id: "abil_37", group: "Tactical", title: "EMP Blast", desc: "Disables enemy abilities within a radius." },
    { id: "abil_38", group: "Tactical", title: "Vision Hack", desc: "Reveals enemy locations for a short time." },
    { id: "abil_39", group: "Tactical", title: "Recon Drone", desc: "Deploys a scouting drone that spots enemies." },
    { id: "abil_40", group: "Tactical", title: "Tracking Beacon", desc: "Attach a tracker to an enemy and reveal position." },
    { id: "abil_41", group: "Tactical", title: "Signal Scramble", desc: "Prevents enemies from receiving radar info." },
    { id: "abil_42", group: "Tactical", title: "Mimic", desc: "Copies the last ability used by a nearby enemy." },
    { id: "abil_43", group: "Tactical", title: "Ability Refresh", desc: "Instantly reduces all cooldown timers." },
    { id: "abil_44", group: "Tactical", title: "Enemy Scan", desc: "Displays nearby enemies, health, and active effects." },
    { id: "abil_45", group: "Tactical", title: "Controlled Decoy Matrix", desc: "Spawn a clone for 10s you control. You turn invisible!" },
    { id: "abil_46", group: "Area Control", title: "Turret Deployment", desc: "Places an automated turret that attacks enemies." },
    { id: "abil_47", group: "Area Control", title: "Mine Field", desc: "Deploys several hidden explosive mines." },
    { id: "abil_48", group: "Area Control", title: "Gravity Prison", desc: "Creates a field that traps and slows enemies." },
    { id: "abil_49", group: "Area Control", title: "Toxic Cloud", desc: "Releases a large poisonous gas cloud over time." },
    { id: "abil_50", group: "Area Control", title: "Orbital Strike", desc: "Calls down a powerful delayed strike on target area." }
];

window.assignActiveHardwareProfile = function(profileType) {
    selectedDeviceProfile = profileType;
    document.querySelectorAll('.device-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(`dev-prof-${profileType}`).classList.add('active');
};

function renderCatalogLayouts() {
    document.getElementById('weapons-placement-grid').innerHTML = WEAPONS_CATALOG.map(w => `
        <div class="card">
            <label>
                <input type="checkbox" class="wep-chk" value="${w.id}"> 
                <span class="card-title" style="color:#fbbf24;">${w.title}</span>
            </label>
            <div class="card-text" style="color: #818cf8; font-size:9px; margin-top:2px;">[${w.group}]</div>
            <div class="card-text">${w.desc}</div>
        </div>
    `).join('');
    
    document.getElementById('abilities-placement-grid').innerHTML = ABILITIES_CATALOG.map(a => `
        <div class="card">
            <label>
                <input type="checkbox" class="abil-chk" value="${a.id}"> 
                <span class="card-title" style="color:#00ff66;">${a.title}</span>
            </label>
            <div class="card-text" style="color: #a78bfa; font-size:9px; margin-top:2px;">[${a.group}]</div>
            <div class="card-text">${a.desc}</div>
        </div>
    `).join('');
}
renderCatalogLayouts();

function applyLimitRules(className, maxAllowed) {
    document.querySelectorAll(`.${className}`).forEach(box => {
        box.addEventListener('change', () => {
            if (document.querySelectorAll(`.${className}:checked`).length > maxAllowed) box.checked = false;
        });
    });
}
applyLimitRules('wep-chk', 5); applyLimitRules('abil-chk', 3);

let wChks = document.querySelectorAll('.wep-chk');
for(let i=0; i<5; i++) if(wChks[i]) wChks[i].checked = true;
let aChks = document.querySelectorAll('.abil-chk');
if(aChks[44]) aChks[44].checked = true; // Pre-select Controlled Decoy Matrix
if(aChks[0]) aChks[0].checked = true;
if(aChks[5]) aChks[5].checked = true;

function collectLoadoutSelection() {
    let chosenWeps = []; document.querySelectorAll('.wep-chk:checked').forEach(e => chosenWeps.push(e.value));
    let chosenAbils = []; document.querySelectorAll('.abil-chk:checked').forEach(e => chosenAbils.push(e.value));
    return { weapons: chosenWeps, abilities: chosenAbils };
}

document.getElementById('dispatch-queue-btn').addEventListener('click', () => {
    let loadout = collectLoadoutSelection();
    if (loadout.weapons.length === 0 || loadout.abilities.length === 0) return alert("Select weapon and ability cores.");
    
    document.getElementById('setup-terminal').classList.add('hidden');
    
    if (selectedDeviceProfile === 'mobile') {
        document.getElementById('mobile-touch-interface-layer').style.display = 'block';
        initiateMobileControlsLoops();
    }
    
    if (isInIntermissionSelection) {
        socket.emit('submitIntermissionLoadoutChange', { loadout: loadout.weapons, abilities: loadout.abilities });
        document.getElementById('round-intermission-terminal').classList.remove('hidden');
        document.getElementById('intermission-wait-status').innerText = "Loadout synced! Awaiting game cycle window...";
        isInIntermissionSelection = false;
    } else {
        socket.emit('joinQueue', {
            name: document.getElementById('player-name').value.trim() || "Operative",
            clashType: document.getElementById('clash-type-pref').value,
            gamemode: document.getElementById('gamemode-pref').value,
            queueType: document.getElementById('queue-tier-pref').value,
            device: selectedDeviceProfile,
            loadout: loadout.weapons,
            abilities: loadout.abilities
        });
        document.getElementById('lobby-terminal').classList.remove('hidden');
    }
});

document.getElementById('intermission-keep-btn').addEventListener('click', () => {
    socket.emit('submitIntermissionKeepLoadout');
    document.getElementById('intermission-keep-btn').disabled = true;
    document.getElementById('intermission-change-btn').disabled = true;
    document.getElementById('intermission-wait-status').innerText = "Confirmed. Awaiting sync verification window...";
});

document.getElementById('intermission-change-btn').addEventListener('click', () => {
    document.getElementById('round-intermission-terminal').classList.add('hidden');
    document.getElementById('setup-terminal').classList.remove('hidden');
    document.getElementById('setup-title').innerText = "ALTER SYSTEM SELECTION PROFILE";
    isInIntermissionSelection = true;
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
        if (['1','2','3','4','5'].includes(k)) socket.emit('switchWeapon', parseInt(k) - 1);
    }
    if (e.key === 'Enter') chatInput.focus();
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
        let rect = el.getBoundingClientRect();
        track.active = true; track.sx = rect.left + rect.width / 2; track.sy = rect.top + rect.height / 2;
    }

    function stickMove(e, track, el, isMovement) {
        if (!track.active) return; e.preventDefault();
        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (isMovement && e.touches[i].clientX < window.innerWidth * 0.6) touch = e.touches[i];
            if (!isMovement && e.touches[i].clientX >= window.innerWidth * 0.6) touch = e.touches[i];
        }
        if (!touch) touch = e.targetTouches[0];

        let dx = touch.clientX - track.sx; let dy = touch.clientY - track.sy;
        let dist = Math.min(40, Math.hypot(dx, dy)); let ang = Math.atan2(dy, dx);

        el.querySelector('.joystick-thumb-node').style.transform = `translate(${Math.cos(ang)*dist}px, ${Math.sin(ang)*dist}px)`;

        if (isMovement) {
            inputState.w = dy < -12; inputState.s = dy > 12;
            inputState.a = dx < -12; inputState.d = dx > 12;
        } else {
            inputState.angle = ang;
        }
    }

    function stickEnd(track, el, isMovement) {
        track.active = false; el.querySelector('.joystick-thumb-node').style.transform = `translate(0px, 0px)`;
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

socket.on('roundIntermissionScreen', () => {
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('round-intermission-terminal').classList.remove('hidden');
    document.getElementById('intermission-keep-btn').disabled = false;
    document.getElementById('intermission-change-btn').disabled = false;
    document.getElementById('intermission-wait-status').innerText = "";
});

socket.on('matchStarted', (data) => {
    localGrid = data.map;
    document.getElementById('lobby-terminal').classList.add('hidden');
    document.getElementById('setup-terminal').classList.add('hidden');
    document.getElementById('round-intermission-terminal').classList.add('hidden');
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
    const item = document.createElement('div'); item.className = 'feed-item'; item.innerText = msg;
    fContainer.appendChild(item);
    if(fContainer.children.length > 4) fContainer.removeChild(fContainer.children[0]);
    setTimeout(() => { if (item.parentNode) item.parentNode.removeChild(item); }, 4000);
});

socket.on('hitFeedback', (data) => {
    serverGameState.bullets.push({ x: data.x, y: data.y - 20, radius: 3, color: '#ff0055', life: 0.12 });
});

socket.on('serverTickUpdate', (data) => {
    serverGameState = data;
    if (data.state !== 'playing') return;

    let min = Math.floor(data.matchTimer / 60).toString().padStart(2, '0');
    let sec = (data.matchTimer % 60).toString().padStart(2, '0');
    document.getElementById('top-center-timer-box').innerText = `${min}:${sec}`;
    document.getElementById('scores-panel').innerText = `MODE: ${data.gamemode} || RED: ${data.scores.red} | BLUE: ${data.scores.blue}`;

    if (myId && data.players[myId]) {
        let me = data.players[myId];
        document.getElementById('hp-display').innerText = `VITALS: ${Math.ceil(me.hp)}%`;
        document.getElementById('shield-display').innerText = `OVERSHIELD: ${Math.ceil(me.overshield)}%`;
        
        let targetId = me.loadout[me.activeWeaponIndex];
        let wepObj = WEAPONS_CATALOG.find(w => w.id === targetId);
        let activeWepName = wepObj ? wepObj.title : 'Unknown System';
        
        document.getElementById('active-wep-line').innerText = `WEAPON: ${activeWepName.toUpperCase()}`;
        document.getElementById('ammo-line').innerText = me.isReloading ? "MAG CAP: RELOADING..." : `MAG CAP: ${me.ammo} / ${me.maxAmmo}`;
        
        let slotsDisplay = me.loadout.map((wId, idx) => {
            let foundW = WEAPONS_CATALOG.find(w => w.id === wId);
            let wTitle = foundW ? foundW.title : 'Empty';
            return `Slot ${idx + 1}: ${wTitle.toUpperCase()} ${idx === me.activeWeaponIndex ? '◀' : ''}`;
        }).join('\n');
        document.getElementById('wep-slots-rack').innerText = slotsDisplay;

        let now = Date.now();
        ['1','2','3'].forEach((num, idx) => {
            let readyTime = me[`ability${idx+1}ReadyAt`] || 0;
            let node = document.getElementById(`cd-${num}-status`);
            let abId = me.abilities[idx];
            let abObj = ABILITIES_CATALOG.find(a => a.id === abId);
            let abTitle = abObj ? abObj.title : 'EMPTY';

            if (now < readyTime) {
                node.innerText = `RECHARGING (${Math.ceil((readyTime - now)/1000)}S)`; node.className = "cd-wait";
            } else {
                node.innerText = `READY [${abTitle.toUpperCase()}]`; node.className = "cd-ready";
            }
        });

        const vig = document.getElementById('low-hp-vignette');
        if (me.hp < 30 && me.hp > 0) vig.style.boxShadow = 'inset 0 0 60px rgba(239,68,68,0.5)'; else vig.style.boxShadow = 'none';

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
        // If controlling a clone, predict the active position tracking vectors instead of the core body
        if (me && me.hp > 0 && !me.controllingDecoyId) {
            let dx = 0; let dy = 0;
            if (inputState.w) dy -= 1; if (inputState.s) dy += 1;
            if (inputState.a) dx -= 1; if (inputState.d) dx += 1;
            if (dx !== 0 && dy !== 0) { dx *= 0.7071; dy *= 0.7071; }

            let moveSpeed = me.activeSpeedBuff ? 440 : 252;
            let nextX = predictedPos.x + (dx * moveSpeed * dt);
            let nextY = predictedPos.y + (dy * moveSpeed * dt);

            if (!checkClientWallCollision(nextX, predictedPos.y, 16)) predictedPos.x = nextX;
            if (!checkClientWallCollision(predictedPos.x, nextY, 16)) predictedPos.y = nextY;
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

function paintLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (serverGameState.state !== 'playing' || !myId || !serverGameState.players[myId]) {
        ctx.fillStyle = "#0c0d19"; ctx.fillRect(0,0,canvas.width,canvas.height);
        requestAnimationFrame(paintLoop); return;
    }

    let localPlayer = serverGameState.players[myId];
    let trackingTargetPosition = { x: predictedPos.x, y: predictedPos.y };

    // CAMERA CENTER RE-ROUTE: Anchor viewport lock-on coordinates straight to our server decoy target frame
    if (localPlayer.controllingDecoyId) {
        let activeClone = serverGameState.decoys.find(d => d.id === localPlayer.controllingDecoyId);
        if (activeClone) {
            trackingTargetPosition.x = activeClone.x;
            trackingTargetPosition.y = activeClone.y;
        }
    }

    camera.x += (trackingTargetPosition.x - camera.x) * 0.15;
    camera.y += (trackingTargetPosition.y - camera.y) * 0.15;
    
    let oX = canvas.width / 2 - camera.x;
    let oY = canvas.height / 2 - camera.y;

    ctx.fillStyle = '#11121c'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e2030'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE);

    if (serverGameState.mapGrid) localGrid = serverGameState.mapGrid;

    for (let x = 0; x < localGrid.length; x++) {
        for (let y = 0; y < localGrid[x].length; y++) {
            if (localGrid[x][y] === 1) {
                ctx.fillStyle = '#475569'; ctx.fillRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
                ctx.strokeStyle = '#334155'; ctx.strokeRect(x * GRID_SIZE + oX, y * GRID_SIZE + oY, GRID_SIZE, GRID_SIZE);
            }
        }
    }

    if (serverGameState.fields) {
        serverGameState.fields.forEach(f => {
            ctx.fillStyle = f.color; ctx.globalAlpha = 0.15;
            ctx.beginPath(); ctx.arc(f.x + oX, f.y + oY, f.radius, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1.0; ctx.strokeStyle = f.color; ctx.lineWidth = 1; ctx.stroke();
        });
    }

    if (serverGameState.bullets) {
        serverGameState.bullets.forEach(b => {
            ctx.fillStyle = b.color || '#fbbf24';
            ctx.beginPath(); ctx.arc(b.x + oX, b.y + oY, b.radius, 0, Math.PI * 2); ctx.fill();
        });
    }

    if (serverGameState.decoys) {
        serverGameState.decoys.forEach(d => {
            ctx.save(); ctx.translate(d.x + oX, d.y + oY);
            ctx.strokeStyle = 'rgba(0, 240, 255, 0.9)'; ctx.lineWidth = 4; ctx.fillStyle = '#0c0d19';
            ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.rotate(d.angle); ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5);
            ctx.restore();

            // RENAME PRESENTATION LAYER: Forces decoy instance to draw exactly the operating operator's identity string
            let parentOwner = serverGameState.players[d.ownerId];
            let nameplateText = parentOwner ? parentOwner.name : "DECOY";

            ctx.fillStyle = '#00f0ff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
            ctx.fillText(nameplateText.toUpperCase(), d.x + oX, d.y + oY - 22);
        });
    }

    Object.values(serverGameState.players).forEach(p => {
        if (p.hp <= 0) return;
        if (p.invisibleActive) {
            if (p.id !== myId) return;
            ctx.globalAlpha = 0.25;
        }

        ctx.save();
        ctx.translate((p.id === myId ? predictedPos.x : p.x) + oX, (p.id === myId ? predictedPos.y : p.y) + oY);
        
        let strokeColor = p.team === 'red' ? '#ff007f' : '#00f0ff';
        ctx.strokeStyle = strokeColor; ctx.lineWidth = 4; ctx.fillStyle = '#05060c';

        ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.rotate(p.id === myId ? inputState.angle : p.angle);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5);
        ctx.restore();

        ctx.fillStyle = '#fff'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
        let subText = p.invisibleActive ? " [CLOAKED CORE]" : ` (${Math.ceil(p.hp)}HP)`;
        ctx.fillText(`${p.name}${subText}`, (p.id === myId ? predictedPos.x : p.x) + oX, (p.id === myId ? predictedPos.y : p.y) + oY - 22);
        ctx.globalAlpha = 1.0;
    });

    requestAnimationFrame(paintLoop);
}

window.addEventListener('load', () => {
    fitCanvasToWindow();
    requestAnimationFrame(runHighPrecisionClientPrediction);
    requestAnimationFrame(paintLoop);
});