import { LINES, BLOCKS, BLOCK_HALF, ROAD_HALF, SEA_Z, PIER, BOUND } from './world.js';

const $ = (id) => document.getElementById(id);

// Map is pre-rendered once at 2 px per metre, then rotated under the player.
const MAP_X0 = -260, MAP_Z0 = -260, MAP_PX = 2, MAP_SIZE = 560;

export class HUD {
  constructor(world) {
    this.world = world;
    this.mm = $('minimap').getContext('2d');
    this.sp = $('speedo').getContext('2d');
    this.el = {
      clock: $('clock'), money: $('money'), stars: $('stars'), mission: $('mission'), toast: $('toast'),
      big: $('big'), help: $('help'), speedo: $('speedo'), prompt: $('prompt'), location: $('location'),
    };
    this.helpOn = true;
    this.mode = null;
    this.toastT = 0;
    this.bigT = 0;
    this.map = this.renderMap();
    this.last = {};
  }

  renderMap() {
    const c = document.createElement('canvas');
    c.width = c.height = MAP_SIZE * MAP_PX;
    const g = c.getContext('2d');
    const X = (x) => (x - MAP_X0) * MAP_PX, Z = (z) => (z - MAP_Z0) * MAP_PX;
    g.fillStyle = '#3d5a3a';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#1f5a7a';
    g.fillRect(0, Z(SEA_Z), c.width, c.height);
    g.fillStyle = '#9a9890';
    g.fillRect(X(-BOUND), Z(-BOUND), (BOUND * 2) * MAP_PX, (SEA_Z + BOUND) * MAP_PX);
    g.fillStyle = '#5b5e64';
    for (const L of LINES) {
      g.fillRect(X(-160 - ROAD_HALF), Z(L - ROAD_HALF), (320 + ROAD_HALF * 2) * MAP_PX, ROAD_HALF * 2 * MAP_PX);
      g.fillRect(X(L - ROAD_HALF), Z(-160 - ROAD_HALF), ROAD_HALF * 2 * MAP_PX, (320 + ROAD_HALF * 2) * MAP_PX);
    }
    for (const b of this.world.blocks) {
      g.fillStyle = b.type === 'park' ? '#4f8a45' : b.type === 'plaza' ? '#cbb58e' : '#b9b5ab';
      g.fillRect(X(b.cx - BLOCK_HALF), Z(b.cz - BLOCK_HALF), BLOCK_HALF * 2 * MAP_PX, BLOCK_HALF * 2 * MAP_PX);
    }
    // park pond
    g.fillStyle = '#2d7aa0';
    g.beginPath(); g.arc(X(-10), Z(10), 6.6 * MAP_PX, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#a07a50';
    g.fillRect(X(-BOUND), Z(182), BOUND * 2 * MAP_PX, 8 * MAP_PX);
    g.fillRect(X(PIER.x0), Z(SEA_Z), (PIER.x1 - PIER.x0) * MAP_PX, (PIER.z1 - SEA_Z) * MAP_PX);
    for (const r of this.world.buildings) {
      const t = Math.min(1, r.h / 80);
      const v = Math.round(110 - t * 50);
      g.fillStyle = `rgb(${v},${v + 4},${v + 12})`;
      g.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * MAP_PX, (r.z1 - r.z0) * MAP_PX);
    }
    // centre lines
    g.strokeStyle = 'rgba(240,200,60,0.5)';
    g.lineWidth = 1;
    for (const L of LINES) {
      g.beginPath(); g.moveTo(X(-160), Z(L)); g.lineTo(X(160), Z(L)); g.stroke();
      g.beginPath(); g.moveTo(X(L), Z(-160)); g.lineTo(X(L), Z(160)); g.stroke();
    }
    return c;
  }

  toast(text, secs = 3) {
    this.el.toast.innerHTML = text;
    this.el.toast.style.opacity = 1;
    this.toastT = secs;
  }

  big(text, sub = '', color = '#fff', secs = 3) {
    this.el.big.innerHTML = `${text}${sub ? `<small>${sub}</small>` : ''}`;
    this.el.big.style.color = color;
    this.el.big.style.opacity = 1;
    this.bigT = secs;
  }

  setText(el, key, v) {
    if (this.last[key] === v) return;
    this.last[key] = v;
    el.innerHTML = v;
  }

  update(dt, s) {
    const e = this.el;
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) e.toast.style.opacity = 0;
    if (this.bigT > 0 && (this.bigT -= dt) <= 0) e.big.style.opacity = 0;

    const hh = Math.floor(s.hour), mm = Math.floor((s.hour % 1) * 60);
    const ampm = hh < 12 ? 'AM' : 'PM';
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    this.setText(e.clock, 'clock', `${h12}:${String(mm).padStart(2, '0')} <span style="font-size:13px;opacity:.7">${ampm}</span>`);
    this.setText(e.money, 'money', `$${s.money.toLocaleString()}`);
    let stars = '';
    for (let i = 0; i < 5; i++) stars += `<span class="${i < s.wanted ? 'on' : ''}">★</span>`;
    this.setText(e.stars, 'stars', stars);
    e.stars.classList.toggle('blink', s.wanted > 0 && s.evading);

    if (s.mission) {
      e.mission.style.display = 'block';
      const m = s.mission;
      const secs = String(Math.floor(m.time % 60)).padStart(2, '0') + (m.up ? `.${Math.floor((m.time % 1) * 10)}` : '');
      const timer = m.time != null ? `<div class="timer ${!m.up && m.time < 10 ? 'low' : ''}">${Math.floor(m.time / 60)}:${secs}</div>` : '';
      this.setText(e.mission, 'mission', `${timer}${m.text}`);
    } else e.mission.style.display = 'none';

    this.setText(e.location, 'loc', s.location);

    if (s.prompt) {
      e.prompt.style.display = 'block';
      this.setText(e.prompt, 'prompt', s.prompt);
    } else e.prompt.style.display = 'none';

    if (this.mode !== s.mode || this.helpDirty) {
      this.mode = s.mode;
      this.helpDirty = false;
      const k = (key, text) => `<div><b>${key}</b>${text}</div>`;
      const foot = [k('W / S', 'walk / back'), k('A / D', 'turn'), k('Shift', 'run'), k('Space', 'jump'), k('F', 'enter vehicle'), k('Drag', 'mouse to look')];
      const car = [k('W', 'accelerate'), k('S', 'brake / reverse'), k('A / D', 'steer'), k('Space', 'handbrake'), k('F', 'exit vehicle'), k('Q', 'horn'), k('C', 'camera')];
      const misc = [k('T', 'skip 2 hours'), k('M', 'mute'), k('H', 'hide help')];
      e.help.innerHTML = this.helpOn
        ? `<div class="head">${s.mode === 'car' ? 'DRIVING' : 'ON FOOT'}</div>${(s.mode === 'car' ? car : foot).join('')}<div style="height:6px"></div>${misc.join('')}`
        : `<div><b>H</b>show controls</div>`;
    }

    e.speedo.style.display = s.mode === 'car' ? 'block' : 'none';
    if (s.mode === 'car') this.drawSpeedo(s.speed, s.carName, s.gear);
    this.drawMinimap(s);
  }

  drawSpeedo(speed, name, gear) {
    const g = this.sp, W = 380, cx = W / 2, cy = W / 2 + 10;
    g.clearRect(0, 0, W, W);
    const kmh = Math.abs(speed) * 3.6;
    const max = 240;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(cx, cy, 150, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8,12,22,0.6)';
    g.fill();
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.arc(cx, cy, 128, a0, a1); g.stroke();
    const t = Math.min(1, kmh / max);
    const grd = g.createLinearGradient(0, W, W, 0);
    grd.addColorStop(0, '#3fd8ff');
    grd.addColorStop(0.6, '#7fffb0');
    grd.addColorStop(1, '#ff5a5a');
    g.strokeStyle = grd;
    g.beginPath(); g.arc(cx, cy, 128, a0, a0 + (a1 - a0) * t); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.font = '600 18px Avenir Next, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let v = 0; v <= max; v += 40) {
      const a = a0 + (a1 - a0) * (v / max);
      g.fillText(String(v), cx + Math.cos(a) * 100, cy + Math.sin(a) * 100);
    }
    g.fillStyle = '#fff';
    g.font = '800 76px Avenir Next, Segoe UI, sans-serif';
    g.fillText(String(Math.round(kmh)), cx, cy - 4);
    g.font = '700 20px Avenir Next, Segoe UI, sans-serif';
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(`km/h · ${Math.abs(speed).toFixed(1)} m/s`, cx, cy + 48);
    g.fillStyle = '#7fe3ff';
    g.font = '700 22px Avenir Next, Segoe UI, sans-serif';
    g.fillText(`${name}  ${gear}`, cx, cy + 100);
  }

  drawMinimap(s) {
    const g = this.mm, W = 420, C = W / 2;
    const zoom = s.mode === 'car' ? Math.max(0.75, 1.25 - Math.abs(s.speed) * 0.012) : 1.4; // canvas px per metre / MAP_PX
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2a3a2a';
    g.fillRect(0, 0, W, W);
    // world transform: player at centre, view direction up
    const rot = s.camYaw - Math.PI;
    const k = zoom * MAP_PX * 1.05;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    // screen = C + R(rot) * (world - p) * k
    g.setTransform(cos * k, sin * k, -sin * k, cos * k, C, C);
    g.translate(-s.px, -s.pz);
    g.drawImage(this.map, MAP_X0, MAP_Z0, MAP_SIZE, MAP_SIZE);

    const dot = (x, z, r, color, stroke) => {
      g.beginPath();
      g.arc(x, z, r, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      if (stroke) { g.lineWidth = 0.8; g.strokeStyle = stroke; g.stroke(); }
    };
    for (const c of s.cars) {
      if (c.driver === 'player') continue;
      const cop = c.type === 'police';
      dot(c.x, c.z, cop ? 2.6 : 1.8, cop ? (s.flash ? '#ff3b3b' : '#3b7bff') : c.driver ? '#e8e8e8' : '#8fd0ff');
    }
    for (const p of s.peds) dot(p.x, p.z, 0.9, '#f2d38a');

    // objective marker, clamped to the rim
    const objs = [...(s.extras || [])];
    if (s.objective) objs.push(s.objective);
    for (const o of objs) {
      const dx = o.x - s.px, dz = o.z - s.pz;
      const d = Math.hypot(dx, dz);
      const maxD = (C - 14) / k;
      let x = o.x, z = o.z;
      if (d > maxD) { x = s.px + (dx / d) * maxD; z = s.pz + (dz / d) * maxD; }
      dot(x, z, (o.small ? 4 : 6) / zoom, o.color, '#000');
    }

    // player arrow
    g.save();
    g.translate(s.px, s.pz);
    g.rotate(-s.heading);
    g.beginPath();
    g.moveTo(0, 5.5); g.lineTo(3.6, -3.5); g.lineTo(0, -1.8); g.lineTo(-3.6, -3.5); g.closePath();
    g.fillStyle = '#ffffff';
    g.fill();
    g.lineWidth = 0.8;
    g.strokeStyle = '#000';
    g.stroke();
    g.restore();

    // north marker
    g.setTransform(1, 0, 0, 1, 0, 0);
    // world north is -z; its screen direction is R(rot)*(0,-1)
    const sx = sin, sy = -cos;
    g.fillStyle = '#fff';
    g.font = '800 26px Avenir Next, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('N', C + sx * (C - 24), C + sy * (C - 24));
  }
}
