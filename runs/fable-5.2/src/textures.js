// Every texture in the game is painted here on 2D canvases at load time.
import { canvasTexture, makeRng, noiseFill } from './util.js';

const CELLS = 8; // facade textures hold an 8 x 8 grid of window cells

// ---------------------------------------------------------------- ground

export function asphaltTexture() {
  const rand = makeRng(11);
  return canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#3a3b3e', 0.1, rand, 2);
    for (let i = 0; i < 26; i++) {
      c.strokeStyle = `rgba(0,0,0,${rand.range(0.05, 0.16)})`;
      c.lineWidth = rand.range(0.6, 1.6);
      c.beginPath();
      let x = rand() * w, y = rand() * h;
      c.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand.range(-22, 22); y += rand.range(-22, 22); c.lineTo(x, y); }
      c.stroke();
    }
    for (let i = 0; i < 10; i++) {
      c.fillStyle = `rgba(20,20,24,${rand.range(0.06, 0.14)})`;
      c.beginPath();
      c.ellipse(rand() * w, rand() * h, rand.range(10, 34), rand.range(6, 18), rand() * 3, 0, 7);
      c.fill();
    }
  });
}

export function sidewalkTexture() {
  const rand = makeRng(12);
  return canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#a9a69f', 0.14, rand, 2);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      c.fillStyle = `rgba(${rand.chance(0.5) ? '255,255,255' : '0,0,0'},${rand.range(0, 0.06)})`;
      c.fillRect(x * 64, y * 64, 64, 64);
    }
    c.strokeStyle = 'rgba(60,58,55,0.55)';
    c.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      c.beginPath(); c.moveTo(i * 64, 0); c.lineTo(i * 64, h); c.stroke();
      c.beginPath(); c.moveTo(0, i * 64); c.lineTo(w, i * 64); c.stroke();
    }
  });
}

export function plazaTexture() {
  const rand = makeRng(13);
  return canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#c9b9a3', 0.12, rand, 2);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const dark = (x + y) % 2 === 0;
      c.fillStyle = dark ? 'rgba(150,104,74,0.22)' : 'rgba(255,240,215,0.12)';
      c.fillRect(x * 32 + 1, y * 32 + 1, 30, 30);
    }
    c.strokeStyle = 'rgba(70,56,46,0.5)';
    c.lineWidth = 1.5;
    for (let i = 0; i <= 8; i++) {
      c.beginPath(); c.moveTo(i * 32, 0); c.lineTo(i * 32, h); c.stroke();
      c.beginPath(); c.moveTo(0, i * 32); c.lineTo(w, i * 32); c.stroke();
    }
  });
}

export function grassTexture() {
  const rand = makeRng(14);
  return canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#5c8f3e', 0.3, rand, 2);
    for (let i = 0; i < 1400; i++) {
      c.strokeStyle = rand.chance(0.5) ? 'rgba(130,180,80,0.35)' : 'rgba(40,90,40,0.35)';
      const x = rand() * w, y = rand() * h;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + rand.range(-3, 3), y - rand.range(2, 6)); c.stroke();
    }
    for (let i = 0; i < 14; i++) {
      c.fillStyle = `rgba(${rand.chance(0.5) ? '150,190,90' : '50,100,45'},0.12)`;
      c.beginPath(); c.ellipse(rand() * w, rand() * h, rand.range(16, 50), rand.range(12, 36), rand() * 3, 0, 7); c.fill();
    }
  });
}

export function sandTexture() {
  const rand = makeRng(15);
  return canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#dcc79a', 0.2, rand, 2);
    for (let i = 0; i < 40; i++) {
      c.strokeStyle = 'rgba(160,130,90,0.14)';
      c.lineWidth = 2;
      const y = rand() * h;
      c.beginPath(); c.moveTo(0, y);
      c.bezierCurveTo(w * 0.3, y + rand.range(-8, 8), w * 0.6, y + rand.range(-8, 8), w, y);
      c.stroke();
    }
  });
}

export function plankTexture() {
  const rand = makeRng(16);
  return canvasTexture(256, 256, (c, w, h) => {
    for (let i = 0; i < 8; i++) {
      const v = rand.range(-14, 14);
      c.fillStyle = `rgb(${150 + v},${112 + v},${78 + v})`;
      c.fillRect(0, i * 32, w, 32);
      for (let k = 0; k < 14; k++) {
        c.strokeStyle = `rgba(70,45,25,${rand.range(0.05, 0.2)})`;
        const y = i * 32 + rand.range(3, 29);
        c.beginPath(); c.moveTo(0, y); c.lineTo(w, y + rand.range(-2, 2)); c.stroke();
      }
      c.fillStyle = 'rgba(40,26,14,0.7)';
      c.fillRect(0, i * 32, w, 2);
      const seam = rand() * w;
      c.fillRect(seam, i * 32, 2, 32);
      c.fillStyle = 'rgba(50,50,55,0.7)';
      c.fillRect(seam + 6, i * 32 + 8, 3, 3);
      c.fillRect(seam + 6, i * 32 + 22, 3, 3);
    }
  });
}

export function concreteTexture() {
  const rand = makeRng(17);
  return canvasTexture(256, 256, (c, w, h) => {
    noiseFill(c, w, h, '#8f9092', 0.16, rand, 2);
    c.strokeStyle = 'rgba(50,50,52,0.5)';
    c.lineWidth = 2;
    c.strokeRect(0, 0, w, h);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = `rgba(40,40,44,${rand.range(0.05, 0.15)})`;
      c.beginPath(); c.ellipse(rand() * w, rand() * h, rand.range(8, 40), rand.range(6, 22), rand() * 3, 0, 7); c.fill();
    }
  });
}

// --------------------------------------------------------------- facades

const LIT = ['#ffd9a0', '#ffe9c4', '#ffcf8a', '#fff3da', '#cfe4ff', '#ffdcae', '#9fd0ff'];

/**
 * Paint one facade style. `emissive` paints the matching night layer: black
 * everywhere except the windows that have their lights on.
 */
function paintFacade(c, size, style, emissive) {
  const cell = size / CELLS;
  const layout = makeRng(100 + style.length * 7); // identical for both layers
  const detail = makeRng(emissive ? 501 : 502);
  const s = cell / 128; // drawing scale, written for 128 px cells
  if (emissive) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, size, size);
  }
  const R = (x, y, w, h) => c.fillRect(x * s, y * s, w * s, h * s);

  if (!emissive) {
    if (style === 'glass') { c.fillStyle = '#8fa6bb'; c.fillRect(0, 0, size, size); }
    if (style === 'brick') {
      noiseFill(c, size, size, '#c4b2a2', 0.12, detail, 2);
      c.fillStyle = 'rgba(70,50,40,0.28)';
      for (let y = 0; y < size; y += 8 * s) {
        c.fillRect(0, y, size, 1.5 * s);
        for (let x = (y / (8 * s)) % 2 ? 0 : 10 * s; x < size; x += 20 * s) c.fillRect(x, y, 1.5 * s, 8 * s);
      }
    }
    if (style === 'concrete') noiseFill(c, size, size, '#c2c0b9', 0.08, detail, 2);
    if (style === 'stucco') noiseFill(c, size, size, '#efe8dc', 0.06, detail, 2);
    if (style === 'metal') {
      c.fillStyle = '#b3b9bd'; c.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x += 8 * s) {
        c.fillStyle = 'rgba(255,255,255,0.16)'; c.fillRect(x, 0, 3 * s, size);
        c.fillStyle = 'rgba(0,0,0,0.16)'; c.fillRect(x + 5 * s, 0, 2 * s, size);
      }
    }
  }

  for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
    c.save();
    c.translate(cx * cell, cy * cell);
    const lit = layout.chance(style === 'glass' ? 0.3 : style === 'metal' ? 0.5 : 0.36);
    const litCol = layout.pick(LIT);
    const dim = layout.range(0.55, 1);
    const variant = layout();

    if (style === 'glass') {
      if (!emissive) {
        const g = c.createLinearGradient(0, 0, 0, cell);
        const v = Math.floor(detail.range(-16, 16));
        g.addColorStop(0, `rgb(${168 + v},${196 + v},${222 + v})`);
        g.addColorStop(0.7, `rgb(${108 + v},${138 + v},${170 + v})`);
        c.fillStyle = g; R(0, 0, 128, 128);
        c.fillStyle = 'rgba(255,255,255,0.14)';
        c.beginPath(); c.moveTo(20 * s, 0); c.lineTo(60 * s, 0); c.lineTo(10 * s, 100 * s); c.lineTo(0, 100 * s); c.lineTo(0, 40 * s); c.fill();
        c.fillStyle = '#5f6d7a'; R(0, 100, 128, 28); // spandrel
        c.fillStyle = '#39414a'; R(0, 0, 5, 128); R(123, 0, 5, 128); R(0, 0, 128, 4); R(0, 98, 128, 4); R(61, 0, 4, 100);
      } else if (lit) {
        c.globalAlpha = dim * 0.9;
        c.fillStyle = litCol; R(5, 4, 118, 94);
        c.globalAlpha = 1;
        c.fillStyle = '#000'; R(61, 0, 4, 100);
        c.fillStyle = 'rgba(0,0,0,0.35)'; R(5, 60, 118, 38);
      }
    } else if (style === 'brick' || style === 'stucco') {
      const wx = 30, wy = 22, ww = 68, wh = 84;
      if (!emissive) {
        c.fillStyle = style === 'brick' ? '#e6dfd2' : '#ffffff'; R(wx - 5, wy - 5, ww + 10, wh + 10);
        const g = c.createLinearGradient(0, wy * s, 0, (wy + wh) * s);
        g.addColorStop(0, '#5d7388'); g.addColorStop(1, '#27323e');
        c.fillStyle = g; R(wx, wy, ww, wh);
        c.fillStyle = style === 'brick' ? '#e6dfd2' : '#ffffff'; R(wx + ww / 2 - 2, wy, 4, wh); R(wx, wy + wh * 0.45, ww, 4);
        if (variant < 0.3) { c.fillStyle = 'rgba(235,228,210,0.85)'; R(wx, wy, ww, wh * layout.range(0.25, 0.7)); }
        c.fillStyle = 'rgba(0,0,0,0.25)'; R(wx - 8, wy + wh + 5, ww + 16, 5);
        if (style === 'stucco') { c.fillStyle = 'rgba(0,0,0,0.12)'; R(0, 122, 128, 6); }
      } else {
        if (variant < 0.3) layout.range(0.25, 0.7);
        if (lit) {
          c.globalAlpha = dim;
          c.fillStyle = litCol; R(wx, wy, ww, wh);
          c.globalAlpha = 1;
          c.fillStyle = '#000'; R(wx + ww / 2 - 2, wy, 4, wh); R(wx, wy + wh * 0.45, ww, 4);
          c.fillStyle = 'rgba(0,0,0,0.3)'; R(wx, wy + wh * 0.6, ww, wh * 0.4);
        }
      }
    } else if (style === 'concrete') {
      if (!emissive) {
        const g = c.createLinearGradient(0, 28 * s, 0, 98 * s);
        g.addColorStop(0, '#62788c'); g.addColorStop(1, '#232d38');
        c.fillStyle = g; R(0, 28, 128, 70);
        c.fillStyle = '#8d8b85'; R(0, 24, 128, 4); R(0, 98, 128, 4); R(0, 28, 4, 70); R(62, 28, 4, 70);
        c.fillStyle = 'rgba(0,0,0,0.14)'; R(0, 0, 128, 2); R(126, 0, 2, 128);
      } else if (lit) {
        c.globalAlpha = dim;
        c.fillStyle = litCol; R(variant < 0.5 ? 4 : 66, 28, 58, 70);
        if (variant > 0.8) R(4, 28, 58, 70);
        c.globalAlpha = 1;
      }
    } else if (style === 'metal') {
      const has = variant < 0.22;
      if (!emissive && has) {
        c.fillStyle = '#3a444e'; R(34, 30, 60, 40);
        c.fillStyle = '#7c8388'; R(62, 30, 4, 40); R(34, 48, 60, 3);
      } else if (emissive && has && lit) {
        c.globalAlpha = dim; c.fillStyle = litCol; R(34, 30, 60, 40); c.globalAlpha = 1;
      }
    }
    c.restore();
  }
}

export function facadeTextures(style) {
  const map = canvasTexture(1024, 1024, (c) => paintFacade(c, 1024, style, false));
  const emissive = canvasTexture(512, 512, (c) => paintFacade(c, 512, style, true));
  return { map, emissive };
}

/** Ground-floor shopfronts: four bays side by side, tiled horizontally only. */
function paintShops(c, w, h, emissive) {
  const rand = makeRng(77);
  const bay = w / 4;
  const frames = ['#3b3f45', '#5a4634', '#2f4a44', '#4a3a4f'];
  const glow = ['#ffd49a', '#ffe7c0', '#d6ecff', '#ffc98a'];
  c.fillStyle = emissive ? '#000' : '#6f6a64';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < 4; i++) {
    const x = i * bay;
    const doorLeft = i % 2 === 0;
    if (!emissive) {
      c.fillStyle = frames[i]; c.fillRect(x + 6, 14, bay - 12, h - 14);
      c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(x, 0, bay, 12);
      c.fillStyle = '#2b2b2e'; c.fillRect(x, h - 22, bay, 22);
    }
    const wx = doorLeft ? x + 78 : x + 16, ww = bay - 94;
    const dx = doorLeft ? x + 16 : x + bay - 70;
    const g = c.createLinearGradient(0, 30, 0, h - 28);
    if (emissive) { g.addColorStop(0, glow[i]); g.addColorStop(1, '#7a5a30'); }
    else { g.addColorStop(0, '#6f8ba0'); g.addColorStop(0.55, '#3a4a58'); g.addColorStop(1, '#283039'); }
    c.fillStyle = g;
    c.fillRect(wx, 30, ww, h - 62);
    c.fillRect(dx, 30, 54, h - 52);
    if (emissive) {
      // silhouettes of things on display
      c.fillStyle = 'rgba(0,0,0,0.55)';
      for (let k = 0; k < 5; k++) {
        const bw = rand.range(10, 26), bh = rand.range(20, 70);
        c.fillRect(wx + 6 + rand() * (ww - 36), h - 32 - bh, bw, bh);
      }
      c.fillStyle = '#000'; c.fillRect(dx + 25, 30, 4, h - 52);
    } else {
      c.fillStyle = 'rgba(255,255,255,0.13)';
      c.beginPath(); c.moveTo(wx + 12, 30); c.lineTo(wx + 60, 30); c.lineTo(wx + 14, h - 32); c.lineTo(wx, h - 32); c.lineTo(wx, 60); c.fill();
      c.fillStyle = frames[i]; c.fillRect(dx + 25, 30, 4, h - 52);
      c.fillStyle = '#c9c2b4'; c.fillRect(dx + 20, 130, 3, 26); c.fillRect(dx + 31, 130, 3, 26);
    }
  }
}

export function shopTextures() {
  const opts = { repeat: true };
  return {
    map: canvasTexture(1024, 256, (c, w, h) => paintShops(c, w, h, false), opts),
    emissive: canvasTexture(1024, 256, (c, w, h) => paintShops(c, w, h, true), opts),
  };
}

// ----------------------------------------------------------------- signs

export const SIGN_NAMES = [
  ['LUMA CAFE', '#ff7ab8'], ['NOODLE BAR', '#ffb347'], ['24H MARKET', '#7dff9b'], ['PIXEL ARCADE', '#b58cff'],
  ['TIDE RECORDS', '#5fd8ff'], ['BLOOM FLOWERS', '#ff9ad1'], ['GOLDEN BAO', '#ffd95a'], ['HOTEL CORAL', '#ff8f7a'],
  ['PHARMACY +', '#7dffd2'], ['BOOKS & TEA', '#ffe2a8'], ['LAUNDRY', '#8fd0ff'], ['PIZZA ROSSA', '#ff6b5a'],
  ['SURF SHACK', '#6ff2e0'], ['VESPER GYM', '#ffd447'], ['CINEMA LUX', '#ff5fa2'], ['HARBOR PATROL', '#8fb8ff'],
];

/** Atlas of 16 shop signs, 2 columns by 8 rows. */
export function signAtlas() {
  return canvasTexture(1024, 1024, (c) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, 1024, 1024);
    SIGN_NAMES.forEach(([name, col], i) => {
      const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
      c.fillStyle = '#14161c'; c.fillRect(x, y, 512, 128);
      c.strokeStyle = col; c.lineWidth = 5; c.strokeRect(x + 9, y + 9, 494, 110);
      c.font = `italic 900 ${name.length > 11 ? 56 : 66}px "Avenir Next Condensed","Arial Narrow",Arial,sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.shadowColor = col; c.shadowBlur = 22;
      c.fillStyle = col; c.fillText(name, x + 256, y + 68);
      c.shadowBlur = 0;
      c.fillStyle = 'rgba(255,255,255,0.75)'; c.fillText(name, x + 256, y + 68);
    });
  }, { repeat: false });
}

/** Atlas of eight rooftop billboards, 2 columns by 4 rows. */
export function billboardAtlas() {
  return canvasTexture(1024, 1024, (c) => {
    const ads = [
      (x, y) => { grad(x, y, '#ff8a3c', '#ffd24a'); big(x, y, 'MANGO POP!', '#fff', 92, 116); small(x, y, 'THE SODA  ·  ZERO CHILL REQUIRED', '#5a2600', 204); bubble(x, y); },
      (x, y) => { grad(x, y, '#1b1040', '#b1307a'); big(x, y, 'RADIO VESPER', '#ffe28a', 86, 104); small(x, y, '88.4 FM — NIGHT DRIVES, ALL DAY', '#fff', 190); },
      (x, y) => { grad(x, y, '#0d1a26', '#2d5d7c'); big(x, y, 'KESTREL GT', '#fff', 92, 96); small(x, y, 'HALDEN MOTORS · BUILT FOR THE COAST ROAD', '#9fe3ff', 180); },
      (x, y) => { grad(x, y, '#ffb26b', '#ff5d7a'); big(x, y, 'SUNDOWN PIER', '#fff', 84, 110); small(x, y, 'RIDES · LIGHTS · SALT AIR — OPEN LATE', '#4a1030', 196); },
      (x, y) => { grad(x, y, '#e8f6ff', '#8fd0ff'); big(x, y, 'PELICAN AIR', '#0e3a66', 88, 108); small(x, y, 'THE SLOW WAY TO GET ANYWHERE', '#0e3a66', 194); },
      (x, y) => { grad(x, y, '#12261a', '#2f7a4a'); big(x, y, 'LANTERN PARK', '#ffe9a8', 84, 100); small(x, y, 'NIGHT MARKET · EVERY EVENING', '#d9ffd0', 186); },
      (x, y) => { grad(x, y, '#f4f0e6', '#d9d2c2'); big(x, y, 'KOI & CO.', '#d9412b', 100, 108); small(x, y, 'SAVINGS THAT SWIM UPSTREAM', '#33302b', 194); },
      (x, y) => { grad(x, y, '#101828', '#27407a'); big(x, y, 'DRIVE KIND', '#fff', 96, 104); small(x, y, 'A MESSAGE FROM HARBOR PATROL', '#ffd447', 190); },
    ];
    function grad(x, y, a, b) {
      const g = c.createLinearGradient(x, y, x + 512, y + 256);
      g.addColorStop(0, a); g.addColorStop(1, b);
      c.fillStyle = g; c.fillRect(x, y, 512, 256);
      c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 6; c.strokeRect(x + 10, y + 10, 492, 236);
    }
    function big(x, y, t, col, size, ty) {
      c.font = `italic 900 ${size}px "Avenir Next Condensed","Arial Narrow",Arial,sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillText(t, x + 260, y + ty + 5);
      c.fillStyle = col; c.fillText(t, x + 256, y + ty);
    }
    function small(x, y, t, col, ty) {
      c.font = '700 22px "Avenir Next","Helvetica Neue",Arial,sans-serif';
      c.textAlign = 'center'; c.fillStyle = col; c.fillText(t, x + 256, y + ty);
    }
    function bubble(x, y) {
      c.fillStyle = 'rgba(255,255,255,0.4)';
      for (const [bx, by, r] of [[60, 60, 18], [96, 34, 9], [450, 70, 14], [430, 40, 7], [470, 110, 6]]) {
        c.beginPath(); c.arc(x + bx, y + by, r, 0, 7); c.fill();
      }
    }
    ads.forEach((ad, i) => ad((i % 2) * 512, Math.floor(i / 2) * 256));
  }, { repeat: false });
}

// ------------------------------------------------------------------ misc

/** Soft radial blob used for lamp pools, headlight glows and particles. */
export function glowTexture(inner = 'rgba(255,255,255,1)', size = 128) {
  return canvasTexture(size, size, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, inner);
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, w);
  }, { repeat: false });
}

/** Elongated cone of light thrown on the road by a pair of headlights. */
export function beamTexture() {
  return canvasTexture(128, 256, (c, w, h) => {
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    for (const cx of [w * 0.34, w * 0.66]) {
      const g = c.createRadialGradient(cx, h * 0.96, 2, cx, h * 0.5, h * 0.52);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = g;
      c.beginPath(); c.moveTo(cx - 6, h); c.lineTo(cx + 6, h); c.lineTo(w * 0.5 + (cx - w * 0.5) * 2.6 + 26, 0); c.lineTo(w * 0.5 + (cx - w * 0.5) * 2.6 - 26, 0); c.fill();
    }
  }, { repeat: false });
}

export function containerTexture() {
  return canvasTexture(128, 128, (c, w, h) => {
    c.fillStyle = '#e6e6e6'; c.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 8) {
      c.fillStyle = 'rgba(0,0,0,0.2)'; c.fillRect(x, 0, 3, h);
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.fillRect(x + 4, 0, 2, h);
    }
    c.fillStyle = 'rgba(0,0,0,0.3)'; c.fillRect(0, 0, w, 4); c.fillRect(0, h - 4, w, 4);
  });
}
