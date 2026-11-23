import * as THREE from '../vendor/three.module.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const dampAngle = (a, b, lambda, dt) => a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));

/** Small deterministic PRNG so the city is the same every load. */
export function rng(seed) {
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
  return r;
}

/** Draws into a canvas and wraps it as a repeating texture. */
export function canvasTexture(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Collects triangles with normals, uvs and vertex colours, then emits one
 * BufferGeometry. Lets a whole city of boxes draw in a handful of calls.
 */
export class GeoBuilder {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
  }

  tri(a, b, c, ua, ub, uc, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (const [p, u] of [[a, ua], [b, ub], [c, uc]]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nor.push(nx, ny, nz);
      this.uv.push(u[0], u[1]);
      this.col.push(col.r, col.g, col.b);
    }
  }

  /** Quad a-b-c-d counter-clockwise seen from the front. */
  quad(a, b, c, d, col, u0 = 0, u1 = 1, v0 = 0, v1 = 1) {
    this.tri(a, b, c, [u0, v0], [u1, v0], [u1, v1], col);
    this.tri(a, c, d, [u0, v0], [u1, v1], [u0, v1], col);
  }

  /** Axis-aligned box; side UVs in world metres scaled by uS/vS. */
  box(x0, y0, z0, x1, y1, z1, col, o = {}) {
    const uS = o.uS ?? 0.25, vS = o.vS ?? 0.25, uo = o.uOff ?? 0, vo = o.vOff ?? 0;
    if (o.sides !== false) {
      const dx = (x1 - x0) * uS, dz = (z1 - z0) * uS, va = y0 * vS + vo, vb = y1 * vS + vo;
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col, uo, uo + dz, va, vb);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], col, uo + 0.37, uo + 0.37 + dz, va, vb);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], col, uo + 0.61, uo + 0.61 + dx, va, vb);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], col, uo + 0.13, uo + 0.13 + dx, va, vb);
    }
    if (o.top !== false) {
      const s = o.topS ?? uS;
      this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], col, x0 * s, x1 * s, -z1 * s, -z0 * s);
    }
    if (o.bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], col);
  }

  /** Eight-corner solid: bottom 0..3 then top 0..3, ordered (-x-z, +x-z, +x+z, -x+z). */
  hexa(p, col) {
    const [b0, b1, b2, b3, t0, t1, t2, t3] = p;
    const b = [b0, b1, b2, b3], t = [t0, t1, t2, t3];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[j], b[i], t[i], t[j], col);
    }
    this.quad(t0, t3, t2, t1, col);
    this.quad(b0, b1, b2, b3, col);
  }

  /** Tapered box: bottom rect (x0..x1, z0..z1) at y0, top rect inset at y1. */
  taper(x0, x1, z0, z1, y0, y1, inset, col) {
    const [ix0, ix1, iz0, iz1] = inset;
    this.hexa([
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [x0 + ix0, y1, z0 + iz0], [x1 - ix1, y1, z0 + iz0], [x1 - ix1, y1, z1 - iz1], [x0 + ix0, y1, z1 - iz1],
    ], col);
  }

  /** Append an existing geometry transformed by a matrix. */
  geo(g, matrix, col) {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.attributes.position, n = src.attributes.normal, u = src.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.nor.push(v.x, v.y, v.z);
      this.uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
      this.col.push(col.r, col.g, col.b);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
export function mat(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return _m.clone().compose(_p, _q, _s);
}

export const col = (hex) => new THREE.Color(hex);
