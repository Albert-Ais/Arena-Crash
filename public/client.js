const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function fitCanvasToWindow() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
window.addEventListener('resize', fitCanvasToWindow); fitCanvasToWindow();

const MAP_SIZE = 2000; const GRID_SIZE = 40;
let myId = null; let localGrid = []; let localMapStyle = 'desert_outpost';
let serverGameState = { players: {}, bullets: [], decoys: [], fields: [], scores: { red: 0, blue: 0 }, state: 'lobby', matchTimer: 120, mode: 'TDM' };
let camera = { x: 1000, y: 1000 }; let inputState = { w: false, a: false, s: false, d: false, angle: 0 };
let radarPulses = [];

const AVAILABLE_WEAPONS_LIST = [
    { id: 'railgun', title: 'Railgun', desc: 'Instant high velocity armor piercing straight beam line.', color: '#00ffff' },
    { id: 'heavy_revolver', title: 'Heavy Revolver', desc: 'Immense kinetic impact damage accompanied by high weapon recoil thrust.', color: '#f97316' },
    { id: 'bouncing_sniper', title: 'Bouncing Sniper', desc: 'High velocity tracking sniper round that bounces off structures up to 3 times.', color: '#a855f7' },
    { id: 'chaingun', title: 'AP Chaingun', desc: 'Massive 60-round drum mag with extreme fire-rate that slightly slows movement speed.', color: '#fbbf24' },
    { id: 'burst_rifle', title: 'Burst Rifle', desc: 'High accuracy three-round grouping burst fired down vector heading.', color: '#38bdf8' },
    { id: 'bouncing_betty', title: 'Bouncing Betty', desc: 'Medium range explosive shell that detonates on structural wall impact or player entry.', color: '#ef4444' },
    { id: 'napalm', title: 'Napalm Launcher', desc: 'Lobs explosive magma shell leaving three residual lingering fire pools.', color: '#ea580c' },
    { id: 'prox_mine', title: 'Proximity Mine', desc: 'Deploys a rooted cloaked landmine that detonates when hostiles tread nearby.', color: '#b91c1c' },
    { id: 'cluster_bomb', title: 'Cluster Bomb', desc: 'Splits open into 6 separate fragment shards on wall contact.', color: '#f43f5e' },
    { id: 'micro_nuke', title: 'Micro-Nuke', desc: 'Slow moving payload yielding catastrophic devastation blast radius rings.', color: '#22c55e' },
    { id: 'stun_baton', title: 'Stun Baton', desc: 'Short range defensive micro-disruptor payload that freezes target velocity.', color: '#eab308' },
    { id: 'plasma_rifle', title: 'Plasma Rifle', desc: 'Rapid energy projectiles that feature low-yield homing capability.', color: '#ec4899' },
    { id: 'shotgun', title: 'Shotgun Spread', desc: 'Fires a horizontal arc grouping of 5 separate high-knockback pellets.', color: '#64748b' },
    { id: 'seeker', title: 'Seeker Missile', desc: 'Heavy rocket projectile that aggressively pursues nearby opposing signatures.', color: '#6366f1' },
    { id: 'sawblade', title: 'Sawblade Launcher', desc: 'Kinetic circular blade that bounces up to 5 times off solid structures.', color: '#14b8a6' }
];

const AVAILABLE_ABILITIES_LIST = [
    { id: 'blink', title: 'Blink Matrix', desc: 'Flash 120px in vector heading.' },
    { id: 'slide', title: 'Power Slide', desc: 'High momentum acceleration push.' },
    { id: 'stim', title: 'Stim Injection', desc: 'Boost velocity and restore 10 HP.' },
    { id: 'decoy', title: 'Decoy Clone Override', desc: 'Spawns a full-health clone you drive directly while cloaking real model for 10 seconds.' },
    { id: 'shield', title: 'Deflect Shield', desc: 'Absorbs next weapon impact burst.' },
    { id: 'smoke', title: 'Smoke Screen', desc: 'Deploys obscurement perimeter field.' },
    { id: 'pulse', title: 'Radar Pulse', desc: 'Highlights match positional coordinates.' },
    { id: 'gravity', title: 'Gravity Well', desc: 'Vortex drags hostile tracking fields.' },
    { id: 'overdrive', title: 'Fire Overdrive', desc: 'Boost operational weapon speed cyclic loop.' },
    { id: 'teleport', title: 'Quantum Recall', desc: 'Teleports backward to anchor coordinate.' },
    { id: 'heal', title: 'Repair Matrix', desc: 'Instantly restore 40 framework integrity.' },
    { id: 'cloak', title: 'Stealth Cloak', desc: 'Conceal player model framework completely.' }
];

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

document.getElementById('primary-registry-box').innerHTML = `
    <h2 style="color: #00f0ff; text-align: center; margin-bottom: 4px;">WARZONE DEPLOYMENT DISPATCH LOG</h2>
    <p style="text-align: center; color:#64748b; font-size:12px; margin-bottom:20px;">Link callsign credentials and select hardware layers below.</p>
    <div class="flex-col">
        <input type="text" id="player-name" placeholder="OPERATOR CALLSIGN" value="Spectre" maxlength="14">
        <div class="flex-row">
            <select id="size-pref"><option value="1v1">1v1 Arena Duel</option><option value="2v2">2v2 Fireteam Skirmish</option><option value="3v3">3v3 Squad Chaos</option></select>
            <select id="mode-pref">
                <option value="TDM">Team Deathmatch (TDM)</option>
                <option value="KOTH">King of the Hill (KOTH)</option>
                <option value="CTF">Capture the Flag (CTF)</option>
            </select>
        </div>
    </div>
    ${compileGridHTML('init')}
    <button id="dispatch-queue-btn" class="submit-btn">ENGAGE SIMULATION GRID</button>
`;

document.getElementById('midround-inserter-box').innerHTML = compileGridHTML('mid');
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
    if (payload.loadout.length !== 3 || payload.abilities.length !== 2) { alert("Matrix Registry Denied: Select 3 weapons and 2 abilities."); return; }
    document.getElementById('setup-terminal').classList.add('hidden'); document.getElementById('hud').classList.remove('hidden');
    socket.emit('joinQueue', { name: document.getElementById('player-name').value.trim() || "Spectre", sizePref: document.getElementById('size-pref').value, modePref: document.getElementById('mode-pref').value, loadout: payload.loadout, abilities: payload.abilities });
});
document.getElementById('change-loadout-btn').addEventListener('click', () => {
    let payload = grabPack('mid'); if (payload.loadout.length !== 3 || payload.abilities.length !== 2) { alert("Pick exactly 3 weapons and 2 abilities."); return; }
    socket.emit('updateLoadout', payload);
});
document.getElementById('skip-loadout-btn').addEventListener('click', () => { socket.emit('skipLoadout'); });

function castVote(style) { socket.emit('castMapVote', style); }

window.addEventListener('keydown', (e) => {
    let key = e.key.toLowerCase(); if (['w','a','s','d'].includes(key)) inputState[key] = true;
    if (key === 'r') socket.emit('triggerReload');
    if (key === '1') socket.emit('switchWeapon', 0); if (key === '2') socket.emit('switchWeapon', 1); if (key === '3') socket.emit('switchWeapon', 2);
    if (key === 'm') socket.emit('useAbility', 0); if (key === 'n') socket.emit('useAbility', 1);
    if (e.code === 'Space') { e.preventDefault(); socket.emit('shootWeapon'); }
});
window.addEventListener('keyup', (e) => { let key = e.key.toLowerCase(); if (['w','a','s','d'].includes(key)) inputState[key] = false; });
window.addEventListener('mousemove', (e) => { inputState.angle = Math.atan2(e.clientY - window.innerHeight/2, e.clientX - window.innerWidth/2); });

socket.on('connect', () => { myId = socket.id; });
socket.on('roomJoined', (data) => { localGrid = data.map; localMapStyle = data.mapStyle; });
socket.on('loadoutActionAck', () => { document.getElementById('midround-terminal').classList.add('hidden'); });
socket.on('matchStarted', (data) => { localGrid = data.map; localMapStyle = data.mapStyle; document.getElementById('midround-terminal').classList.add('hidden'); });
socket.on('voteRegisteredUpdate', (votes) => {
    document.getElementById('count-desert_outpost').innerText = `VOTES: ${votes.desert_outpost}`;
    document.getElementById('count-urban_blocks').innerText = `VOTES: ${votes.urban_blocks}`;
});

socket.on('showLoadoutCustomizer', (data) => { 
    document.getElementById('round-banner').innerText = `WAVE ${data.round || 1} DEPLOYMENT RE-ROUTE`; 
    document.getElementById('count-desert_outpost').innerText = "VOTES: 0";
    document.getElementById('count-urban_blocks').innerText = "VOTES: 0";
    document.getElementById('midround-terminal').classList.remove('hidden'); 
});

socket.on('radarPulseFeedback', (data) => { radarPulses.push({ x: data.x, y: data.y, radius: 10, maxRadius: 400, team: data.team }); });

socket.on('serverTickUpdate', (data) => {
    serverGameState = data; if (data.mapStyle) localMapStyle = data.mapStyle;
    let min = Math.floor(data.matchTimer / 60).toString().padStart(2, '0');
    let sec = (data.matchTimer % 60).toString().padStart(2, '0');
    document.getElementById('top-center-timer-box').innerText = `${min}:${sec}`;
    
    if (data.mode === 'TDM') {
        document.getElementById('scores-panel').innerText = `MODE: TEAM DEATHMATCH || RED KILLS: ${data.scores.red} | BLUE KILLS: ${data.scores.blue}`;
    } else if (data.mode === 'KOTH') {
        document.getElementById('scores-panel').innerText = `MODE: KING OF THE HILL || RED SCORE: ${data.scores.red} | BLUE SCORE: ${data.scores.blue}`;
    } else if (data.mode === 'CTF') {
        document.getElementById('scores-panel').innerText = `MODE: CAPTURE THE FLAG || RED CAPS: ${data.scores.red} | BLUE CAPS: ${data.scores.blue}`;
    }

    if (myId && data.players[myId]) {
        let me = data.players[myId];
        document.getElementById('active-wep-line').innerText = `HARDWARE LOADOUT: ${(me.loadout[me.activeWeaponIndex] || 'None').toUpperCase()}`;
        document.getElementById('ammo-line').innerText = me.isReloading ? "AMMO: RECUPERATING CYCLES..." : `MAG CAP: ${me.ammo}`;
        document.getElementById('slots-line').innerText = `[1]: ${me.loadout[0]} | [2]: ${me.loadout[1]} | [3]: ${me.loadout[2]}`;

        let now = Date.now();
        let mDiff = Math.max(0, Math.ceil((me.ability1ReadyAt - now) / 1000));
        let mNode = document.getElementById('cd-m-status');
        if (mDiff > 0) { mNode.innerText = `RECHARGING (${mDiff}S)`; mNode.className = "cd-wait"; }
        else { mNode.innerText = `READY // [${me.abilities[0].toUpperCase()}]`; mNode.className = "cd-ready"; }

        let nDiff = Math.max(0, Math.ceil((me.ability2ReadyAt - now) / 1000));
        let nNode = document.getElementById('cd-n-status');
        if (nDiff > 0) { nNode.innerText = `RECHARGING (${nDiff}S)`; nNode.className = "cd-wait"; }
        else { nNode.innerText = `READY // [${me.abilities[1].toUpperCase()}]`; nNode.className = "cd-ready"; }
    }
});

setInterval(() => { if (serverGameState.state === 'playing') socket.emit('playerActionInput', inputState); }, 1000 / 60);

let environmentDecorations = [];
for(let i=0; i<45; i++) {
    environmentDecorations.push({ x: Math.random()*MAP_SIZE, y: Math.random()*MAP_SIZE, size: Math.random()*25+10, variant: Math.random() });
}

function paintLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!myId || !serverGameState.players[myId]) { requestAnimationFrame(paintLoop); return; }

    let target = serverGameState.players[myId];
    let camX = target.x; let camY = target.y;
    if (target.controllingDecoyId) {
        let controlledClone = serverGameState.decoys.find(d => d.id === target.controllingDecoyId);
        if (controlledClone) { camX = controlledClone.x; camY = controlledClone.y; }
    }

    camera.x += (camX - camera.x) * 0.08; camera.y += (camY - camera.y) * 0.08;
    let oX = canvas.width / 2 - camera.x; let oY = canvas.height / 2 - camera.y;
    let now = Date.now();

    if (localMapStyle === 'desert_outpost') {
        ctx.fillStyle = '#cc9966'; ctx.fillRect(0, 0, canvas.width, canvas.height); 
        ctx.fillStyle = '#dfb17b'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE); 
        ctx.fillStyle = '#c5935c';
        environmentDecorations.forEach(d => {
            ctx.beginPath(); ctx.arc(d.x + oX, d.y + oY, d.size, 0, Math.PI, true); ctx.fill();
        });
    } else {
        ctx.fillStyle = '#11121c'; ctx.fillRect(0, 0, canvas.width, canvas.height); 
        ctx.fillStyle = '#1e2030'; ctx.fillRect(oX, oY, MAP_SIZE, MAP_SIZE); 
        ctx.fillStyle = '#161722';
        environmentDecorations.forEach(d => { ctx.fillRect(d.x + oX, d.y + oY, d.size*1.5, d.size); });
    }

    if (serverGameState.mode === 'KOTH' && serverGameState.kothZone) {
        let zone = serverGameState.kothZone;
        ctx.save(); ctx.beginPath(); ctx.arc(zone.x + oX, zone.y + oY, zone.radius, 0, Math.PI * 2);
        if (zone.controllingTeam === 'red') ctx.fillStyle = 'rgba(255, 0, 127, 0.12)';
        else if (zone.controllingTeam === 'blue') ctx.fillStyle = 'rgba(0, 240, 255, 0.12)';
        else ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
        ctx.fill();
        ctx.strokeStyle = zone.controllingTeam === 'red' ? '#ff007f' : (zone.controllingTeam === 'blue' ? '#00f0ff' : '#64748b');
        ctx.lineWidth = 3; ctx.setLineDash([6, 6]); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`CAPTURE ZONE [PROGRESS: ${Math.abs(zone.captureProgress)}%]`, zone.x + oX, zone.y + oY - 5);
        ctx.restore();
    }

    if (serverGameState.mode === 'CTF' && serverGameState.ctfFlags) {
        Object.keys(serverGameState.ctfFlags).forEach(color => {
            let flag = serverGameState.ctfFlags[color];
            ctx.save();
            ctx.fillStyle = color === 'red' ? 'rgba(255, 0, 127, 0.2)' : 'rgba(0, 240, 255, 0.2)';
            ctx.fillRect(flag.homeX + oX - 16, flag.homeY + oY - 16, 32, 32);
            ctx.strokeStyle = color === 'red' ? '#ff007f' : '#00f0ff'; ctx.strokeRect(flag.homeX + oX - 16, flag.homeY + oY - 16, 32, 32);
            ctx.beginPath(); ctx.arc(flag.x + oX, flag.y + oY, 12, 0, Math.PI * 2);
            ctx.fillStyle = color === 'red' ? '#ff007f' : '#00f0ff'; ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
            ctx.fillText(`${color.toUpperCase()} FLAG (${flag.status.toUpperCase()})`, flag.x + oX, flag.y + oY - 18);
            ctx.restore();
        });
    }

    if (localGrid) {
        for (let x = 0; x < localGrid.length; x++) {
            for (let y = 0; y < localGrid[x].length; y++) {
                if (localGrid[x][y] === 1) {
                    let wX = x * GRID_SIZE + oX; let wY = y * GRID_SIZE + oY;
                    if (localMapStyle === 'desert_outpost') {
                        ctx.fillStyle = '#735135'; ctx.fillRect(wX, wY, GRID_SIZE, GRID_SIZE); 
                        ctx.strokeStyle = '#3d2b1d'; ctx.lineWidth = 2; ctx.strokeRect(wX+1, wY+1, GRID_SIZE-2, GRID_SIZE-2);
                    } else {
                        ctx.fillStyle = '#090a14'; ctx.fillRect(wX, wY, GRID_SIZE, GRID_SIZE); 
                        ctx.strokeStyle = '#ff007f'; ctx.lineWidth = 1.5; ctx.strokeRect(wX+1, wY+1, GRID_SIZE-2, GRID_SIZE-2);
                    }
                }
            }
        }
    }

    if (serverGameState.fields) {
        serverGameState.fields.forEach(f => {
            ctx.save(); ctx.beginPath(); ctx.arc(f.x + oX, f.y + oY, f.radius, 0, Math.PI * 2);
            if (f.type === 'smoke') { ctx.fillStyle = 'rgba(148, 163, 184, 0.45)'; ctx.fill(); } 
            else if (f.type === 'gravity') { ctx.strokeStyle = 'rgba(168, 85, 247, 0.7)'; ctx.lineWidth = 2; ctx.stroke(); ctx.fillStyle = 'rgba(168, 85, 247, 0.05)'; ctx.fill(); } 
            else if (f.type === 'napalm_pool') { ctx.fillStyle = 'rgba(234, 88, 12, 0.4)'; ctx.fill(); ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1; ctx.stroke(); } 
            else if (f.type === 'explosion_flash') { ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'; ctx.fill(); }
            ctx.restore();
        });
    }

    for (let i = radarPulses.length - 1; i >= 0; i--) {
        let p = radarPulses[i]; p.radius += 6;
        if (p.radius >= p.maxRadius) { radarPulses.splice(i, 1); continue; }
        ctx.save(); ctx.strokeStyle = p.team === 'red' ? 'rgba(255, 0, 127, 0.6)' : 'rgba(0, 240, 255, 0.6)';
        ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(p.x + oX, p.y + oY, p.radius, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }

    if (serverGameState.decoys) {
        serverGameState.decoys.forEach(dec => {
            ctx.save(); ctx.translate(dec.x + oX, dec.y + oY);
            ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
            ctx.fillText(dec.name.toUpperCase(), 0, -26);
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-22, -18, 44, 5);
            ctx.fillStyle = dec.team === 'red' ? '#ff007f' : '#00f0ff';
            ctx.fillRect(-22, -18, (dec.hp / 100) * 44, 5);
            ctx.fillStyle = dec.team === 'red' ? '#2d0a1a' : '#0a1d30';
            ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = dec.team === 'red' ? '#ff007f' : '#00f0ff'; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();

            if (dec.ownerId === myId) {
                ctx.strokeStyle = '#00ff66'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
                ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.stroke();
            }
            ctx.rotate(dec.angle); ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5); ctx.restore();
        });
    }

    serverGameState.bullets.forEach(b => {
        ctx.fillStyle = b.color || '#fbbf24'; ctx.save();
        ctx.shadowBlur = 8; ctx.shadowColor = b.color;
        ctx.beginPath();
        if (b.type === 'mine') ctx.arc(b.x + oX, b.y + oY, b.isSet ? 4 : 7, 0, Math.PI * 2);
        else if (b.type === 'sawblade') ctx.arc(b.x + oX, b.y + oY, 8, 0, Math.PI * 2);
        else ctx.arc(b.x + oX, b.y + oY, b.radius || 4, 0, Math.PI * 2);
        ctx.fill(); ctx.restore();
    });

    Object.values(serverGameState.players).forEach(p => {
        if (p.hp <= 0) return;
        if (p.id !== myId && now < p.cloakActiveUntil) return;

        ctx.save(); ctx.translate(p.x + oX, p.y + oY);
        if (p.id === myId && now < p.cloakActiveUntil) ctx.globalAlpha = 0.35;

        ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText(p.name.toUpperCase(), 0, -26);
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(-22, -18, 44, 5);
        ctx.fillStyle = p.team === 'red' ? '#ff007f' : '#00f0ff';
        ctx.fillRect(-22, -18, (p.hp / 100) * 44, 5);
        ctx.fillStyle = p.team === 'red' ? '#2d0a1a' : '#0a1d30';
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = p.team === 'red' ? '#ff007f' : '#00f0ff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();

        if (now < p.shieldActiveUntil) { ctx.strokeStyle = '#00ff66'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.stroke(); }
        if (now < p.overdriveActiveUntil) { ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.5; ctx.strokeRect(-19, -19, 38, 38); }
        ctx.rotate(p.angle); ctx.fillStyle = '#ffffff'; ctx.fillRect(6, -2.5, 14, 5); ctx.restore();
    });

    requestAnimationFrame(paintLoop);
}
requestAnimationFrame(paintLoop);