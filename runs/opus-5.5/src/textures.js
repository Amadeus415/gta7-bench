import * as THREE from '../vendor/three.module.js';
import { canvasTexture, rng } from './util.js';

// Every texture in the game is painted here on a 2D canvas.

const R = rng(99);

function noise(g, w, h, base, spread, count, size = 1) {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < count; i++) {
    const v = Math.floor((R() - 0.5) * spread);
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(0,0,0,${-v / 255})`;
    g.fillRect(R() * w, R() * h, size, size);
  }
}

export function makeTextures() {
  const T = {};

  // Asphalt, plain (intersections). 1 tile = 8 m.
  T.asphalt = canvasTexture(256, 256, (g, w, h) => {
    noise(g, w, h, '#3b3e44', 60, 9000, 2);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = 'rgba(20,20,22,0.35)';
      g.lineWidth = 1 + R() * 2;
      g.beginPath();
      g.moveTo(R() * w, R() * h);
      g.bezierCurveTo(R() * w, R() * h, R() * w, R() * h, R() * w, R() * h);
      g.stroke();
    }
  });

  // Road segment: u spans the 14 m width, v repeats every 12 m along the road.
  T.road = canvasTexture(256, 512, (g, w, h) => {
    noise(g, w, h, '#3b3e44', 60, 16000, 2);
    const px = w / 14;
    g.fillStyle = 'rgba(30,30,32,0.35)';
    g.fillRect(px * 2.2, 0, px * 2.6, h);
    g.fillRect(w - px * 4.8, 0, px * 2.6, h);
    g.fillStyle = '#e9e6dc';
    g.fillRect(px * 0.45, 0, px * 0.18, h);
    g.fillRect(w - px * 0.63, 0, px * 0.18, h);
    g.fillStyle = '#e8b21c';
    for (let y = 0; y < h; y += h / 2) {
      g.fillRect(w / 2 - px * 0.22, y, px * 0.13, h / 4);
      g.fillRect(w / 2 + px * 0.09, y, px * 0.13, h / 4);
    }
    g.fillStyle = 'rgba(233,230,220,0.55)';
    for (let y = 0; y < h; y += h / 4) {
      g.fillRect(px * 1.75, y, px * 0.12, h / 12);
      g.fillRect(w - px * 1.87, y, px * 0.12, h / 12);
    }
  });

  // Concrete sidewalk slabs. 1 tile = 4 m, joints every 2 m.
  T.concrete = canvasTexture(256, 256, (g, w, h) => {
    noise(g, w, h, '#b9b6ae', 40, 7000, 2);
    g.strokeStyle = 'rgba(60,60,60,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(0, (i * h) / 2); g.lineTo(w, (i * h) / 2); g.stroke();
      g.beginPath(); g.moveTo((i * w) / 2, 0); g.lineTo((i * w) / 2, h); g.stroke();
    }
  });

  // Grass. 1 tile = 8 m.
  T.grass = canvasTexture(256, 256, (g, w, h) => {
    noise(g, w, h, '#4f7a37', 70, 14000, 2);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = R() < 0.5 ? 'rgba(120,160,70,0.5)' : 'rgba(40,70,30,0.5)';
      g.fillRect(R() * w, R() * h, 1, 3 + R() * 3);
    }
  });

  // Plaza stone. 1 tile = 6 m.
  T.plaza = canvasTexture(256, 256, (g, w, h) => {
    noise(g, w, h, '#c7b291', 40, 6000, 2);
    const n = 6;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const s = w / n;
        g.fillStyle = `rgba(${(i + j) % 2 ? 120 : 255},${(i + j) % 2 ? 90 : 240},${(i + j) % 2 ? 70 : 220},0.12)`;
        g.fillRect(i * s, j * s, s, s);
        g.strokeStyle = 'rgba(80,60,40,0.35)';
        g.strokeRect(i * s + 0.5, j * s + 0.5, s - 1, s - 1);
      }
    }
  });

  // Wooden boardwalk planks. 1 tile = 4 m.
  T.wood = canvasTexture(256, 256, (g, w, h) => {
    noise(g, w, h, '#8a6440', 50, 5000, 2);
    const plank = h / 12;
    for (let i = 0; i < 12; i++) {
      g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,220,180'},${0.05 + R() * 0.1})`;
      g.fillRect(0, i * plank, w, plank);
      g.fillStyle = 'rgba(30,20,10,0.6)';
      g.fillRect(0, i * plank, w, 1.5);
      g.fillRect(((i * 97) % 5) * 50 + 20, i * plank, 1.5, plank);
    }
  });

  // Soft round glow used for lamp light pools and headlight beams.
  T.glow = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }, { repeat: false });

  // Ripple normal map for the sea, built from tileable sine heights.
  T.waterNormal = (() => {
    const N = 256;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const g = c.getContext('2d');
    const img = g.createImageData(N, N);
    const waves = [];
    for (let i = 0; i < 10; i++) {
      waves.push({ kx: Math.round(R() * 8 - 4) || 1, ky: Math.round(R() * 8 - 4) || 2, a: 0.3 + R(), p: R() * 6.28 });
    }
    const H = (x, y) => waves.reduce((s, w) => s + w.a * Math.sin(((w.kx * x + w.ky * y) / N) * 6.2832 + w.p), 0);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dx = H(x + 1, y) - H(x - 1, y);
        const dy = H(x, y + 1) - H(x, y - 1);
        const nx = -dx * 2, ny = -dy * 2, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        const o = (y * N + x) * 4;
        img.data[o] = ((nx / l) * 0.5 + 0.5) * 255;
        img.data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
        img.data[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();

  T.facades = makeFacades();
  return T;
}

// Facades: 512 px = 8 bays (4 m each) by 8 floors (3.5 m each). Map plus a
// matching emissive map of lit windows that fades in at night.
function makeFacades() {
  const S = 512, B = 64;
  const out = {};
  const litColors = ['#d9a25a', '#e8b878', '#f0cc90', '#9fb8d8', '#d08a48', '#c8a070'];

  const facade = (drawBay, litChance, ground) => {
    const lit = [];
    for (let i = 0; i < 64; i++) lit.push(R() < litChance ? R.pick(litColors) : null);
    const map = canvasTexture(S, S, (g) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, S, S);
      for (let fy = 0; fy < 8; fy++) {
        for (let bx = 0; bx < 8; bx++) drawBay(g, bx * B, fy * B, fy === 7 && ground, false);
      }
    });
    const emi = canvasTexture(S, S, (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, S, S);
      for (let fy = 0; fy < 8; fy++) {
        for (let bx = 0; bx < 8; bx++) {
          const c = fy === 7 && ground ? (bx % 3 === 1 ? null : '#b98a52') : lit[fy * 8 + bx];
          if (c) drawBay(g, bx * B, fy * B, fy === 7 && ground, c);
        }
      }
    });
    return { map, emi };
  };

  out.office = facade((g, x, y, groundFloor, lit) => {
    if (!lit) {
      g.fillStyle = '#d9dadc';
      g.fillRect(x, y, B, B);
    }
    const gx = x + 3, gy = groundFloor ? y + 6 : y + 9, gw = B - 6, gh = groundFloor ? B - 6 : B - 18;
    if (lit) {
      g.fillStyle = lit;
      g.fillRect(gx, gy, gw, gh);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(gx + gw * 0.5, gy, 2, gh);
      return;
    }
    const grd = g.createLinearGradient(gx, gy, gx + gw, gy + gh);
    grd.addColorStop(0, '#2c3a4c');
    grd.addColorStop(0.55, '#4f6580');
    grd.addColorStop(1, '#25303e');
    g.fillStyle = grd;
    g.fillRect(gx, gy, gw, gh);
    g.fillStyle = 'rgba(255,255,255,0.10)';
    g.fillRect(gx, gy, gw, 3);
    g.fillStyle = '#9ea3aa';
    g.fillRect(gx + gw * 0.5 - 1, gy, 2, gh);
  }, 0.38, true);

  out.brick = facade((g, x, y, groundFloor, lit) => {
    if (!lit) {
      g.fillStyle = '#f2ece6';
      g.fillRect(x, y, B, B);
      g.fillStyle = 'rgba(0,0,0,0.07)';
      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 8; c++) g.fillRect(x + c * 8 + (r % 2) * 4, y + r * 4, 7, 3);
      }
    }
    if (groundFloor) {
      if (lit) { g.fillStyle = lit; g.fillRect(x + 6, y + 18, B - 12, B - 20); return; }
      g.fillStyle = '#1f262d'; g.fillRect(x + 6, y + 18, B - 12, B - 20);
      g.fillStyle = 'rgba(160,40,40,0.9)'; g.fillRect(x + 2, y + 10, B - 4, 8);
      return;
    }
    const wx = x + 20, wy = y + 14, ww = 24, wh = 32;
    if (lit) { g.fillStyle = lit; g.fillRect(wx, wy, ww, wh); return; }
    g.fillStyle = '#e8e2d6'; g.fillRect(wx - 3, wy - 3, ww + 6, wh + 8);
    g.fillStyle = '#28303a'; g.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(wx, wy, ww, 4);
    g.fillStyle = '#e8e2d6'; g.fillRect(wx, wy + wh / 2 - 1, ww, 2);
  }, 0.32, true);

  out.warehouse = facade((g, x, y, groundFloor, lit) => {
    if (!lit) {
      g.fillStyle = '#e6e6e6';
      g.fillRect(x, y, B, B);
      for (let i = 0; i < B; i += 4) {
        g.fillStyle = 'rgba(0,0,0,0.13)';
        g.fillRect(x + i, y, 2, B);
      }
    }
    if (groundFloor) {
      if (lit) return;
      g.fillStyle = '#6d7075'; g.fillRect(x + 8, y + 14, B - 16, B - 14);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      for (let i = 0; i < B - 14; i += 5) g.fillRect(x + 8, y + 14 + i, B - 16, 1);
      return;
    }
    if (y % (B * 2) === 0) {
      if (lit) { g.fillStyle = lit; g.fillRect(x + 4, y + 40, B - 8, 12); return; }
      g.fillStyle = '#334050'; g.fillRect(x + 4, y + 40, B - 8, 12);
    }
  }, 0.2, true);

  return out;
}
