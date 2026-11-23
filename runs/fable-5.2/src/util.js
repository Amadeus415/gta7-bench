// Small math, random and geometry-building helpers shared by every module.
import * as THREE from '../vendor/three.module.js';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

/** Seeded random generator (mulberry32) with a few convenience methods. */
export function makeRng(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _c = new THREE.Color();

/** A shared temporary matrix from position, euler rotation and scale. */
export function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export const color = (hex) => new THREE.Color(hex);

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const cylCache = new Map();
function unitCyl(rTop, rBot, seg) {
  const key = `${rTop.toFixed(3)}|${rBot.toFixed(3)}|${seg}`;
  if (!cylCache.has(key)) cylCache.set(key, new THREE.CylinderGeometry(rTop, rBot, 1, seg));
  return cylCache.get(key);
}

/**
 * Accumulates many small pieces into one BufferGeometry with vertex colours,
 * so a whole class of scenery costs a single draw call.
 */
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.count = 0;
  }

  /** Append a geometry transformed by `matrix`, tinted with `col` (THREE.Color or hex). */
  add(geo, matrix, col = 0xffffff) {
    const c = col instanceof THREE.Color ? col : _c.set(col);
    const p = geo.attributes.position;
    const n = geo.attributes.normal;
    const u = geo.attributes.uv;
    const vc = geo.attributes.color;
    const base = this.count;
    _nm.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      if (n) _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      else _n.set(0, 1, 0);
      this.nor.push(_n.x, _n.y, _n.z);
      if (u) this.uv.push(u.getX(i), u.getY(i));
      else this.uv.push(0, 0);
      if (vc) this.col.push(vc.getX(i) * c.r, vc.getY(i) * c.g, vc.getZ(i) * c.b);
      else this.col.push(c.r, c.g, c.b);
    }
    if (geo.index) {
      const ix = geo.index;
      for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    this.count += p.count;
    return this;
  }

  box(w, h, d, x, y, z, col, ry = 0, rx = 0, rz = 0) {
    return this.add(unitBox, mat(x, y, z, rx, ry, rz, w, h, d), col);
  }

  /** Vertical cylinder centred at (x, y, z). */
  cyl(rTop, rBot, h, x, y, z, col, seg = 8, rx = 0, ry = 0, rz = 0) {
    return this.add(unitCyl(rTop, rBot, seg), mat(x, y, z, rx, ry, rz, 1, h, 1), col);
  }

  /** A quad from four corners given counter-clockwise as seen from its front. */
  quad(a, b, c, d, col, uvs) {
    const cc = col instanceof THREE.Color ? col : _c.set(col);
    const base = this.count;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const pts = [a, b, c, d];
    const uv = uvs || [0, 0, 1, 0, 1, 1, 0, 1];
    for (let i = 0; i < 4; i++) {
      this.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(uv[i * 2], uv[i * 2 + 1]);
      this.col.push(cc.r, cc.g, cc.b);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.count += 4;
    return this;
  }

  /** Flat horizontal rectangle facing up, with UVs in world units divided by `uvScale`. */
  floor(x0, z0, x1, z1, y, col, uvScale = 1) {
    return this.quad(
      [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], col,
      [x0 / uvScale, z1 / uvScale, x1 / uvScale, z1 / uvScale, x1 / uvScale, z0 / uvScale, x0 / uvScale, z0 / uvScale],
    );
  }

  /**
   * A vertical prism from a convex outline of [x, z] points: top cap at y1 and
   * side walls down to y0. Top UVs are world units divided by `uvScale`.
   */
  prism(points, y0, y1, col, uvScale = 1, sideCol = col) {
    const cc = (col instanceof THREE.Color ? col : _c.set(col)).clone();
    const sc = (sideCol instanceof THREE.Color ? sideCol : _c.set(sideCol)).clone();
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    // Viewed from above (+Y) a front-facing cap needs negative area in x/z terms.
    const pts = area > 0 ? points.slice().reverse() : points;
    let cx = 0, cz = 0;
    for (const p of pts) { cx += p[0]; cz += p[1]; }
    cx /= pts.length; cz /= pts.length;
    const base = this.count;
    this.pos.push(cx, y1, cz);
    this.nor.push(0, 1, 0);
    this.uv.push(cx / uvScale, cz / uvScale);
    this.col.push(cc.r, cc.g, cc.b);
    for (const p of pts) {
      this.pos.push(p[0], y1, p[1]);
      this.nor.push(0, 1, 0);
      this.uv.push(p[0] / uvScale, p[1] / uvScale);
      this.col.push(cc.r, cc.g, cc.b);
    }
    for (let i = 0; i < pts.length; i++) {
      this.idx.push(base, base + 1 + i, base + 1 + ((i + 1) % pts.length));
    }
    this.count += pts.length + 1;
    if (y1 > y0) {
      let run = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.quad(
          [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], sc,
          [run / uvScale, y0 / uvScale, (run + len) / uvScale, y0 / uvScale, (run + len) / uvScale, y1 / uvScale, run / uvScale, y1 / uvScale],
        );
        run += len;
      }
    }
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Outline of a rectangle with rounded corners as [x, z] points. */
export function roundedRect(x0, z0, x1, z1, r, seg = 4) {
  const pts = [];
  const corners = [
    [x1 - r, z1 - r, 0],
    [x0 + r, z1 - r, Math.PI / 2],
    [x0 + r, z0 + r, Math.PI],
    [x1 - r, z0 + r, Math.PI * 1.5],
  ];
  for (const [cx, cz, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    }
  }
  return pts;
}

export function circlePoints(cx, cz, r, seg = 20, rz = r) {
  const pts = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * rz]);
  }
  return pts;
}

/** Build a canvas texture by drawing into a 2D context. */
export function canvasTexture(w, h, draw, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

/** Sprinkle per-pixel brightness noise over a canvas region. */
export function noiseFill(ctx, w, h, base, amount, rand, grain = 1) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < (w * h) / (grain * grain * 2); i++) {
    const x = Math.floor(rand() * w), y = Math.floor(rand() * h);
    const v = rand();
    ctx.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * amount})` : `rgba(0,0,0,${(0.5 - v) * amount})`;
    ctx.fillRect(x, y, grain, grain);
  }
}
