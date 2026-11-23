// The on-screen display: minimap, speedometer, objective, prompts and toasts.
import { clamp, TAU } from './util.js';
import { mapShapes, nodes, edges, ROAD_HALF } from './world.js';

const $ = (id) => document.getElementById(id);
const MAP = { x0: -300, z0: -230, size: 600, scale: 2 }; // world window baked into the static map

const FOOT_KEYS = [['W S', 'walk'], ['A D', 'turn'], ['Shift', 'run'], ['Space', 'jump'], ['F', 'get in a car']];
const CAR_KEYS = [['W', 'accelerate'], ['S', 'brake / reverse'], ['A D', 'steer'], ['Space', 'handbrake'], ['F', 'get out'], ['H', 'horn'], ['R', 'radio']];

export class Hud {
  constructor() {
    this.el = {
      district: $('district'), clock: $('clock'), cash: $('cash'), heat: $('heat'), tokens: $('tokens'), best: $('best'),
      objective: $('objective'), toast: $('toast'), prompt: $('prompt'), dash: $('dash'), carname: $('carname'), radio: $('radio'),
      controls: $('controls'), feed: $('feed'), fade: $('fade'), mapwrap: $('mapwrap'), warn: $('warn'), arrow: $('arrow'),
    };
    this.kicker = this.el.objective.querySelector('.kicker');
    this.text = this.el.objective.querySelector('.text');
    this.dist = this.el.objective.querySelector('.dist');
    this.timer = this.el.objective.querySelector('.timer');
    this.stars = [...this.el.heat.querySelectorAll('i')];
    this.map = $('minimap').getContext('2d');
    this.speedo = $('speedo').getContext('2d');
    this.cache = {};
    this.toastT = 0;
    this.mode = '';
    this.zoom = 1;
    this.bakeMap();
    this.setMode('foot');
  }

  /** Only touch the DOM when a value actually changes. */
  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  bakeMap() {
    const c = document.createElement('canvas');
    c.width = c.height = MAP.size * MAP.scale;
    const g = c.getContext('2d');
    g.scale(MAP.scale, MAP.scale);
    g.translate(-MAP.x0, -MAP.z0);
    g.fillStyle = '#1d3a4d';
    g.fillRect(MAP.x0, MAP.z0, MAP.size, MAP.size);
    for (const s of mapShapes) {
      g.fillStyle = s.color;
      if (s.kind === 'rect') g.fillRect(s.x0, s.z0, s.x1 - s.x0, s.z1 - s.z0);
      else { g.beginPath(); g.arc(s.x, s.z, s.r, 0, TAU); g.fill(); }
    }
    // centre lines make the streets readable at a glance
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 0.7;
    g.setLineDash([4, 4]);
    for (const [a, b] of edges) {
      g.beginPath(); g.moveTo(nodes[a].x, nodes[a].z); g.lineTo(nodes[b].x, nodes[b].z); g.stroke();
    }
    g.setLineDash([]);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = ROAD_HALF * 2;
    this.baked = c;
  }

  setMode(mode, carName = '') {
    if (mode === this.mode && carName === this.carName) return;
    this.mode = mode; this.carName = carName;
    const rows = (list) => list.map(([k, label]) => `<div class="row"><span class="keys">${k.split(' ').map((x) => `<kbd>${x}</kbd>`).join('')}</span><span>${label}</span></div>`).join('');
    this.el.controls.innerHTML = `<h4>${mode === 'car' ? 'Driving' : 'On foot'}</h4>${rows(mode === 'car' ? CAR_KEYS : FOOT_KEYS)}
      <div class="extra">${rows([['T', 'fast-forward time'], ['C', 'camera distance'], ['Tab', 'hide this panel']])}<div class="row"><span>drag the mouse to look around</span></div></div>`;
    this.el.dash.classList.toggle('show', mode === 'car');
    this.el.carname.textContent = carName;
  }

  toggleHelp() {
    this.el.controls.style.display = this.el.controls.style.display === 'none' ? '' : 'none';
  }

  toast(big, sub = '', kind = 'good', seconds = 3) {
    const t = this.el.toast;
    t.className = `show ${kind}`;
    t.querySelector('.big').textContent = big;
    t.querySelector('.sub').textContent = sub;
    this.toastT = seconds;
  }

  /** A small line in the feed under the cash counter, e.g. "+$50 token". */
  feed(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => d.remove(), 3300);
  }

  fade(on) { this.el.fade.classList.toggle('on', on); }

  cashBump() {
    this.el.cash.classList.remove('bump');
    void this.el.cash.offsetWidth;
    this.el.cash.classList.add('bump');
  }

  /**
   * s: { dt, mode, carName, district, clock, cash, heat, cooling, tokens, tokenTotal, best, prompt, warn,
   *      objective: { kicker, text, dist, timer, low, angle } | null,
   *      speed, rpm, gear, radio, px, pz, heading, camYaw, blips: [{ x, z, kind }] }
   */
  update(s) {
    const e = this.el;
    this.setMode(s.mode, s.carName);
    this.set('district', e.district, s.district);
    this.set('clock', e.clock, s.clock);
    this.set('cash', e.cash, `$${s.cash.toLocaleString('en-US')}`);
    this.set('tokens', e.tokens, `Tokens <b>${s.tokens}</b> / ${s.tokenTotal}`, 'innerHTML');
    this.set('best', e.best, s.best);
    if (this.cache.heat !== s.heat) {
      this.cache.heat = s.heat;
      this.stars.forEach((st, i) => st.classList.toggle('on', i < s.heat));
    }
    if (this.cache.cooling !== s.cooling) { this.cache.cooling = s.cooling; e.heat.classList.toggle('cooling', s.cooling); }
    if (this.cache.alert !== s.heat > 0) { this.cache.alert = s.heat > 0; e.mapwrap.classList.toggle('alert', s.heat > 0); }
    if (this.cache.warn !== s.warn) { this.cache.warn = s.warn; e.warn.classList.toggle('show', !!s.warn); if (s.warn) e.warn.textContent = s.warn; }

    const o = s.objective;
    if (o) {
      this.set('ok', this.kicker, o.kicker);
      this.set('ot', this.text, o.text);
      this.set('od', this.dist, o.dist ?? '');
      this.set('otm', this.timer, o.timer ?? '');
      if (this.cache.low !== !!o.low) { this.cache.low = !!o.low; this.timer.classList.toggle('low', !!o.low); }
      const showArrow = o.angle !== undefined && o.angle !== null;
      if (this.cache.arrowOn !== showArrow) { this.cache.arrowOn = showArrow; e.arrow.style.display = showArrow ? 'inline-block' : 'none'; }
      if (showArrow) e.arrow.style.transform = `rotate(${o.angle.toFixed(2)}rad)`;
    }
    if (this.cache.prompt !== s.prompt) {
      this.cache.prompt = s.prompt;
      e.prompt.classList.toggle('show', !!s.prompt);
      if (s.prompt) e.prompt.innerHTML = s.prompt;
    }
    if (this.toastT > 0) { this.toastT -= s.dt; if (this.toastT <= 0) e.toast.classList.remove('show'); }
    this.set('radio', e.radio, s.radio);

    this.drawMap(s);
    if (s.mode === 'car') this.drawSpeedo(s);
  }

  drawMap(s) {
    const g = this.map, W = 392, half = W / 2;
    this.zoom += ((s.mode === 'car' ? clamp(1.05 - s.speed * 0.012, 0.6, 1.05) : 1.5) - this.zoom) * Math.min(1, s.dt * 2);
    const z = this.zoom * 2; // canvas pixels per metre (the canvas is drawn at 2x)
    const rot = s.camYaw + Math.PI;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#1d3a4d';
    g.fillRect(0, 0, W, W);
    g.translate(half, half);
    g.rotate(rot);
    g.scale(z / MAP.scale, z / MAP.scale);
    g.drawImage(this.baked, -(s.px - MAP.x0) * MAP.scale, -(s.pz - MAP.z0) * MAP.scale);
    g.setTransform(1, 0, 0, 1, 0, 0);

    const cos = Math.cos(rot), sin = Math.sin(rot);
    const R = half - 16;
    for (const b of s.blips) {
      let x = (b.x - s.px) * z, y = (b.z - s.pz) * z;
      let sx = x * cos - y * sin, sy = x * sin + y * cos;
      const d = Math.hypot(sx, sy);
      const edge = d > R;
      if (edge) {
        if (!b.pin) continue;
        sx *= R / d; sy *= R / d;
      }
      sx += half; sy += half;
      if (b.kind === 'cop') {
        g.fillStyle = Math.floor(performance.now() / 180) % 2 ? '#ff4a3a' : '#4a7dff';
        g.beginPath(); g.arc(sx, sy, 8, 0, TAU); g.fill();
      } else if (b.kind === 'token') {
        g.fillStyle = '#ffd95a';
        g.beginPath(); g.arc(sx, sy, 4, 0, TAU); g.fill();
      } else if (b.kind === 'car') {
        g.fillStyle = 'rgba(255,255,255,0.55)';
        g.fillRect(sx - 3, sy - 3, 6, 6);
      } else {
        const col = b.kind === 'target' ? '#ffcf5a' : b.kind === 'sprint' ? '#5fe0ff' : b.kind === 'ride' ? '#ff6b4a' : '#ffcf5a';
        const r = b.kind === 'target' ? 12 + Math.sin(performance.now() / 160) * 2 : 10;
        g.fillStyle = col; g.strokeStyle = '#10141c'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(sx, sy - r); g.lineTo(sx + r, sy); g.lineTo(sx, sy + r); g.lineTo(sx - r, sy); g.closePath();
        g.fill(); g.stroke();
        if (b.label) { g.fillStyle = '#10141c'; g.font = '800 13px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(b.label, sx, sy + 1); }
      }
    }
    // north marker on the rim
    const nx = half + sin * (half - 13), ny = half - cos * (half - 13);
    g.fillStyle = 'rgba(16,20,28,0.8)'; g.beginPath(); g.arc(nx, ny, 11, 0, TAU); g.fill();
    g.fillStyle = '#f4efe6'; g.font = '800 14px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', nx, ny + 1);
    // the player
    g.translate(half, half);
    g.rotate(s.camYaw - s.heading);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#10141c'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, -13); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath();
    g.stroke(); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  drawSpeedo(s) {
    const g = this.speedo, W = 380, H = 300, cx = W / 2, cy = 178, r = 132;
    g.clearRect(0, 0, W, H);
    const a0 = Math.PI * 0.82, a1 = Math.PI * 2.18;
    const kmh = s.speed * 3.6, max = 220;
    g.lineCap = 'round';
    g.lineWidth = 15;
    g.strokeStyle = 'rgba(10,14,20,0.55)';
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
    const grad = g.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, '#45d6c0'); grad.addColorStop(0.6, '#ffcf5a'); grad.addColorStop(1, '#ff6b4a');
    g.strokeStyle = grad;
    g.lineWidth = 9;
    g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * clamp(kmh / max, 0.001, 1)); g.stroke();
    g.lineCap = 'butt';
    for (let i = 0; i <= 11; i++) {
      const a = a0 + ((a1 - a0) * i) / 11;
      g.strokeStyle = 'rgba(244,239,230,0.75)'; g.lineWidth = i % 2 ? 2 : 4;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14)); g.lineTo(cx + Math.cos(a) * (r - (i % 2 ? 22 : 28)), cy + Math.sin(a) * (r - (i % 2 ? 22 : 28))); g.stroke();
    }
    // rev bar
    g.lineWidth = 5; g.strokeStyle = 'rgba(244,239,230,0.2)';
    g.beginPath(); g.arc(cx, cy, r - 40, a0, a1); g.stroke();
    g.strokeStyle = s.rpm > 0.9 ? '#ff6b4a' : '#f4efe6';
    g.beginPath(); g.arc(cx, cy, r - 40, a0, a0 + (a1 - a0) * clamp(s.rpm, 0.001, 1)); g.stroke();
    g.fillStyle = '#f4efe6'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 8;
    g.font = 'italic 800 84px "Avenir Next Condensed","Futura","Arial Narrow",Arial,sans-serif';
    g.fillText(String(Math.round(kmh)), cx, cy + 26);
    g.font = '700 19px "Avenir Next","Helvetica Neue",Arial,sans-serif';
    g.fillStyle = 'rgba(244,239,230,0.7)';
    g.fillText('KM/H', cx, cy + 56);
    g.fillStyle = '#ffcf5a';
    g.font = '800 26px "Avenir Next Condensed","Arial Narrow",Arial,sans-serif';
    g.fillText(s.reverse ? 'R' : s.speed < 0.3 ? 'N' : String(s.gear), cx, cy + 92);
    g.shadowBlur = 0;
  }
}
