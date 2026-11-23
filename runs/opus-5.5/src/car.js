import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, clamp, col, damp } from './util.js';
import { circleHit } from './world.js';

// Vehicle catalogue. All names are invented for Halcyon Bay.
export const CAR_TYPES = {
  compact: { name: 'Pipit', len: 3.7, wid: 1.74, hgt: 1.5, clear: 0.2, bodyH: 0.62, cab: [-1.45, 0.75], inset: [0.14, 0.14, 0.25, 0.55], wheelR: 0.31, accel: 7.5, top: 40, mass: 950, grip: 10 },
  sedan: { name: 'Corvane', len: 4.5, wid: 1.86, hgt: 1.46, clear: 0.22, bodyH: 0.6, cab: [-1.3, 0.9], inset: [0.15, 0.15, 0.5, 0.62], wheelR: 0.33, accel: 8.5, top: 47, mass: 1300, grip: 10 },
  sports: { name: 'Strix GT', len: 4.4, wid: 1.96, hgt: 1.18, clear: 0.15, bodyH: 0.5, cab: [-1.25, 0.55], inset: [0.2, 0.2, 0.65, 0.72], wheelR: 0.34, accel: 11, top: 60, mass: 1250, grip: 12, spoiler: true },
  van: { name: 'Mulebox', len: 4.9, wid: 2.0, hgt: 2.25, clear: 0.28, bodyH: 0.9, cab: [-2.4, 1.35], inset: [0.06, 0.06, 0.02, 0.8], wheelR: 0.36, accel: 5.8, top: 35, mass: 2100, grip: 8, solidCab: true },
  pickup: { name: 'Oxbow', len: 5.0, wid: 1.96, hgt: 1.82, clear: 0.32, bodyH: 0.74, cab: [-0.25, 1.3], inset: [0.1, 0.1, 0.05, 0.5], wheelR: 0.38, accel: 7, top: 42, mass: 1800, grip: 9, bed: true },
  taxi: { name: 'Bay Cab', len: 4.5, wid: 1.86, hgt: 1.46, clear: 0.22, bodyH: 0.6, cab: [-1.3, 0.9], inset: [0.15, 0.15, 0.5, 0.62], wheelR: 0.33, accel: 8.5, top: 47, mass: 1300, grip: 10, sign: true },
  police: { name: 'Bay Patrol', len: 4.6, wid: 1.9, hgt: 1.48, clear: 0.22, bodyH: 0.62, cab: [-1.3, 0.85], inset: [0.15, 0.15, 0.5, 0.62], wheelR: 0.34, accel: 11, top: 58, mass: 1450, grip: 11, bar: true },
};

export const CAR_COLORS = [0xc0392b, 0x2e86de, 0xf5f6fa, 0x222831, 0x27ae60, 0xf39c12, 0x8e44ad, 0x7f8c8d, 0x16a085, 0xd35400, 0xe8d8b0, 0x34495e];

const carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
export const LIGHT_MATS = {
  head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2d0, emissiveIntensity: 0.4 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1a1a, emissiveIntensity: 0.4 }),
  brake: new THREE.MeshStandardMaterial({ color: 0x880000, emissive: 0xff2a2a, emissiveIntensity: 3.5 }),
  red: new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff0000, emissiveIntensity: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x000055, emissive: 0x1050ff, emissiveIntensity: 0.3 }),
  sign: new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffc000, emissiveIntensity: 0.6 }),
  beam: null,
};

const wheelGeos = new Map();
function wheelGeo(r) {
  if (wheelGeos.has(r)) return wheelGeos.get(r);
  const b = new GeoBuilder();
  const tire = new THREE.CylinderGeometry(r, r, 0.26, 16);
  tire.rotateZ(Math.PI / 2);
  b.geo(tire, new THREE.Matrix4(), col(0x1b1b1d));
  const hub = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.28, 10);
  hub.rotateZ(Math.PI / 2);
  b.geo(hub, new THREE.Matrix4(), col(0xb9bec4));
  const g = b.build();
  wheelGeos.set(r, g);
  return g;
}

const modelCache = new Map();
function bodyGeometry(type, color) {
  const key = type + ':' + color;
  if (modelCache.has(key)) return modelCache.get(key);
  const s = CAR_TYPES[type];
  const b = new GeoBuilder();
  const C = col(color), GLASS = col(0x1a222c), DARK = col(0x202124), TRIM = col(0x9aa0a6);
  const W = s.wid / 2, L = s.len / 2, y0 = s.clear, y1 = s.clear + s.bodyH, H = s.hgt;
  // lower body with softened top edges
  b.taper(-W, W, -L, L, y0, y1, [0.05, 0.05, 0.12, 0.18], C);
  // cabin
  const [c0, c1] = s.cab;
  const [il, ir, irr, ifr] = s.inset;
  const cx0 = -W + 0.09, cx1 = W - 0.09;
  b.taper(cx0, cx1, c0, c1, y1, H - 0.04, [il, ir, irr, ifr], s.solidCab ? C : GLASS);
  // roof cap
  b.box(cx0 + il, H - 0.05, c0 + irr, cx1 - ir, H, c1 - ifr, C);
  if (s.solidCab) {
    // van: windscreen and side windows painted on the body-coloured box
    b.taper(cx0 - 0.01, cx1 + 0.01, c1 - 1.0, c1 + 0.01, y1 + 0.15, H - 0.2, [il, ir, 0, ifr * 0.8], GLASS);
  }
  if (s.bed) {
    const bz0 = -L + 0.1, bz1 = c0 - 0.05, wy = y1 + 0.4;
    b.box(-W, y1, bz0, -W + 0.1, wy, bz1, C);
    b.box(W - 0.1, y1, bz0, W, wy, bz1, C);
    b.box(-W, y1, bz0, W, wy, bz0 + 0.1, C);
    b.box(-W + 0.1, y1 - 0.01, bz0 + 0.1, W - 0.1, y1 + 0.02, bz1, DARK);
  }
  if (s.spoiler) {
    b.box(-W + 0.15, y1 + 0.25, -L + 0.1, W - 0.15, y1 + 0.3, -L + 0.45, C);
    b.box(-W + 0.35, y1, -L + 0.2, -W + 0.45, y1 + 0.26, -L + 0.35, DARK);
    b.box(W - 0.45, y1, -L + 0.2, W - 0.35, y1 + 0.26, -L + 0.35, DARK);
  }
  // bumpers, grille, skirts
  b.box(-W - 0.02, y0 - 0.02, L - 0.12, W + 0.02, y0 + 0.24, L + 0.06, DARK);
  b.box(-W - 0.02, y0 - 0.02, -L - 0.06, W + 0.02, y0 + 0.24, -L + 0.12, DARK);
  b.box(-W * 0.55, y0 + 0.26, L - 0.02, W * 0.55, y0 + 0.44, L + 0.02, DARK);
  b.box(-W - 0.015, y0, -L * 0.62, -W + 0.02, y0 + 0.12, L * 0.62, DARK);
  b.box(W - 0.02, y0, -L * 0.62, W + 0.015, y0 + 0.12, L * 0.62, DARK);
  // mirrors and door seam
  b.box(-W - 0.12, y1 + 0.05, c1 - 0.2, -W, y1 + 0.18, c1 - 0.05, C);
  b.box(W, y1 + 0.05, c1 - 0.2, W + 0.12, y1 + 0.18, c1 - 0.05, C);
  b.box(-W - 0.005, y0 + 0.15, (c0 + c1) / 2 - 0.01, W + 0.005, y1 - 0.05, (c0 + c1) / 2 + 0.01, DARK, { top: false });
  b.box(-W - 0.004, y1 - 0.12, -L * 0.85, -W + 0.01, y1 - 0.09, L * 0.85, TRIM, { top: false });
  b.box(W - 0.01, y1 - 0.12, -L * 0.85, W + 0.004, y1 - 0.09, L * 0.85, TRIM, { top: false });
  const g = b.build();
  modelCache.set(key, g);
  return g;
}

const lightGeo = new THREE.BoxGeometry(1, 1, 1);

export class Car {
  constructor(scene, type, color, x, z, h, world) {
    this.type = type;
    this.spec = CAR_TYPES[type];
    this.color = color;
    this.world = world;
    const s = this.spec;
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    const bodyMesh = new THREE.Mesh(bodyGeometry(type, color), carMat);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.body.add(bodyMesh);

    const W = s.wid / 2, L = s.len / 2;
    const yl = s.clear + s.bodyH - 0.2;
    const light = (m, x, y, z, sx, sy, sz) => {
      const me = new THREE.Mesh(lightGeo, m);
      me.position.set(x, y, z);
      me.scale.set(sx, sy, sz);
      this.body.add(me);
      return me;
    };
    light(LIGHT_MATS.head, W - 0.3, yl, L + 0.01, 0.4, 0.14, 0.06);
    light(LIGHT_MATS.head, -W + 0.3, yl, L + 0.01, 0.4, 0.14, 0.06);
    this.tails = [
      light(LIGHT_MATS.tail, W - 0.25, yl, -L - 0.01, 0.34, 0.14, 0.06),
      light(LIGHT_MATS.tail, -W + 0.25, yl, -L - 0.01, 0.34, 0.14, 0.06),
    ];
    if (s.bar) {
      this.bar = [
        light(LIGHT_MATS.red, 0.32, s.hgt + 0.07, 0.1, 0.55, 0.14, 0.26),
        light(LIGHT_MATS.blue, -0.32, s.hgt + 0.07, 0.1, 0.55, 0.14, 0.26),
      ];
      // white door panels so police read at a glance
      const panel = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
      light(panel, W + 0.006, s.clear + 0.4, 0.15, 0.01, 0.34, 1.9);
      light(panel, -W - 0.006, s.clear + 0.4, 0.15, 0.01, 0.34, 1.9);
    }
    if (s.sign) light(LIGHT_MATS.sign, 0, s.hgt + 0.1, -0.1, 0.6, 0.2, 0.22);

    // ground beams for the headlights at night
    if (!LIGHT_MATS.beam) {
      LIGHT_MATS.beam = new THREE.MeshBasicMaterial({ map: world.T.glow, color: 0xfff0c8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
    }
    const beamGeo = new THREE.PlaneGeometry(1, 1);
    beamGeo.rotateX(-Math.PI / 2);
    const beam = new THREE.Mesh(beamGeo, LIGHT_MATS.beam);
    beam.scale.set(6, 1, 13);
    beam.position.set(0, 0.07, L + 6.5);
    beam.renderOrder = 3;
    this.group.add(beam);

    this.wheels = [];
    const wz = L - Math.min(0.85, s.len * 0.17);
    this.wheelbase = wz * 2;
    for (const [wx, wzz, front] of [[W - 0.15, wz, true], [-W + 0.15, wz, true], [W - 0.15, -wz, false], [-W + 0.15, -wz, false]]) {
      const pivot = new THREE.Group();
      pivot.position.set(wx, s.wheelR, wzz);
      const wm = new THREE.Mesh(wheelGeo(s.wheelR), wheelMat);
      wm.castShadow = true;
      pivot.add(wm);
      this.group.add(pivot);
      this.wheels.push({ pivot, mesh: wm, front });
    }
    scene.add(this.group);

    this.x = x; this.z = z; this.h = h;
    this.y = world.groundHeight(x, z);
    this.vx = 0; this.vz = 0; this.spin = 0; this.steer = 0;
    this.input = { accel: 0, steer: 0, handbrake: false };
    this.driver = null;
    this.ai = null;
    this.mass = s.mass;
    this.r = s.wid / 2;
    const n = Math.max(2, Math.round(s.len / s.wid) + 1);
    this.offsets = [];
    for (let k = 0; k < n; k++) this.offsets.push(-L + this.r + ((s.len - 2 * this.r) * k) / (n - 1));
    this.pitch = 0; this.roll = 0; this.lastVF = 0; this.latAcc = 0;
    this.braking = false; this.slip = 0; this.yawRate = 0; this.steerAngle = 0;
    this.damage = 0;
    this.sync(0);
  }

  get speed() { return Math.hypot(this.vx, this.vz); }
  get fwdSpeed() { return this.vx * Math.sin(this.h) + this.vz * Math.cos(this.h); }

  /** Point in car space: f = forward metres, r = right metres. */
  local(px, pz) {
    const dx = px - this.x, dz = pz - this.z;
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    return { f: dx * sh + dz * ch, r: -dx * ch + dz * sh };
  }
  contains(px, pz, margin = 0) {
    const l = this.local(px, pz);
    return Math.abs(l.f) < this.spec.len / 2 + margin && Math.abs(l.r) < this.spec.wid / 2 + margin;
  }
  /** Push a circle out of the car's box; returns push vector or null. */
  pushOut(px, pz, rad) {
    const s = this.spec;
    const l = this.local(px, pz);
    const hl = s.len / 2, hw = s.wid / 2;
    const cf = clamp(l.f, -hl, hl), cr = clamp(l.r, -hw, hw);
    let df = l.f - cf, dr = l.r - cr;
    let d = Math.hypot(df, dr);
    let nf, nr, depth;
    if (d > 0) {
      if (d >= rad) return null;
      nf = df / d; nr = dr / d; depth = rad - d;
    } else {
      const ef = hl - Math.abs(l.f), er = hw - Math.abs(l.r);
      if (ef < er) { nf = Math.sign(l.f) || 1; nr = 0; depth = ef + rad; } else { nf = 0; nr = Math.sign(l.r) || 1; depth = er + rad; }
    }
    const sh = Math.sin(this.h), ch = Math.cos(this.h);
    // forward = (sh, ch), right = (-ch, sh)
    return { x: (nf * sh - nr * ch) * depth, z: (nf * ch + nr * sh) * depth };
  }

  step(dt) {
    const s = this.spec, inp = this.input;
    let sh = Math.sin(this.h), ch = Math.cos(this.h);
    let vF = this.vx * sh + this.vz * ch;
    let vL = -this.vx * ch + this.vz * sh;
    const want = inp.accel;
    let a = 0;
    let braking = false;
    if (want > 0) {
      if (vF < -0.5) { a = 16 * want; braking = true; }
      else a = s.accel * want * Math.max(0, 1 - Math.pow(Math.max(0, vF) / s.top, 2));
    } else if (want < 0) {
      if (vF > 0.5) { a = -16 * -want; braking = true; }
      else a = -s.accel * 0.6 * -want * Math.max(0, 1 - Math.max(0, -vF) / 13);
    }
    if (inp.handbrake) { a -= Math.sign(vF) * 7; braking = true; }
    a -= vF * 0.05 + Math.sign(vF) * 0.35;
    const nvF = vF + a * dt;
    if ((braking || want === 0) && Math.sign(nvF) !== Math.sign(vF) && vF !== 0) vF = 0;
    else vF = nvF;
    if (want === 0 && Math.abs(vF) < 0.6) vF *= Math.exp(-4 * dt);
    this.braking = braking;

    // Steering: lock shrinks with speed, yaw is capped by available grip.
    this.steer = damp(this.steer, inp.steer, 9, dt);
    const sp = Math.abs(vF);
    this.steerAngle = (this.steer * 0.62) / (1 + sp * 0.055);
    let yaw = (-vF * Math.tan(this.steerAngle)) / this.wheelbase;
    const latMax = inp.handbrake ? 22 : 14;
    const cap = latMax / Math.max(sp, 1);
    yaw = clamp(yaw, -cap, cap);
    if (inp.handbrake && sp > 4) yaw *= 1.35;
    this.yawRate = yaw;
    this.h += (yaw + this.spin) * dt;
    this.spin *= Math.exp(-3.5 * dt);

    // Lateral grip pulls the velocity back in line with the wheels.
    const grip = inp.handbrake ? 1.1 : s.grip;
    this.slip = Math.abs(vL);
    vL *= Math.exp(-grip * dt);
    this.vx = sh * vF - ch * vL;
    this.vz = ch * vF + sh * vL;

    this.latAcc = vF * yaw;
    const longAcc = (vF - this.lastVF) / Math.max(dt, 1e-4);
    this.lastVF = vF;
    this.pitch = damp(this.pitch, clamp(longAcc * 0.006, -0.06, 0.06), 6, dt);
    this.roll = damp(this.roll, clamp(this.latAcc * 0.006, -0.07, 0.07), 6, dt);

    this.x += this.vx * dt;
    this.z += this.vz * dt;
    return this.collideStatic();
  }

  collideStatic() {
    const grid = this.world.grid;
    let impact = 0;
    for (const off of this.offsets) {
      const sh = Math.sin(this.h), ch = Math.cos(this.h);
      let cx = this.x + sh * off, cz = this.z + ch * off;
      for (const c of grid.query(cx, cz, this.r + 0.5)) {
        if (c.h < this.y + 0.35) continue;
        const hit = circleHit(cx, cz, this.r, c);
        if (!hit) continue;
        if (c.lamp != null && this.speed > 5) {
          // lamp posts snap off instead of stopping the car dead
          this.world.breakLamp(c, this.vx, this.vz);
          this.vx *= 0.82;
          this.vz *= 0.82;
          impact = Math.max(impact, 3.5);
          continue;
        }
        this.x += hit.nx * hit.depth;
        this.z += hit.nz * hit.depth;
        cx += hit.nx * hit.depth;
        cz += hit.nz * hit.depth;
        const vn = this.vx * hit.nx + this.vz * hit.nz;
        if (vn < 0) {
          const e = 0.25;
          this.vx -= (1 + e) * vn * hit.nx;
          this.vz -= (1 + e) * vn * hit.nz;
          // scrub some tangential speed
          const tx = -hit.nz, tz = hit.nx;
          const vt = this.vx * tx + this.vz * tz;
          const scrub = Math.min(Math.abs(vt), -vn * 0.3) * Math.sign(vt);
          this.vx -= tx * scrub;
          this.vz -= tz * scrub;
          const rx = sh * off, rz = ch * off;
          this.spin += (rz * hit.nx - rx * hit.nz) * -vn * 0.06;
          impact = Math.max(impact, -vn);
        }
      }
    }
    return impact;
  }

  sync(dt) {
    const target = this.world.groundHeight(this.x, this.z);
    this.y = dt ? damp(this.y, Math.max(target, 0), 14, dt) : target;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.h;
    this.body.rotation.x = this.pitch;
    this.body.rotation.z = this.roll;
    const vF = this.fwdSpeed;
    for (const w of this.wheels) {
      w.mesh.rotation.x += (vF / this.spec.wheelR) * dt;
      if (w.front) w.pivot.rotation.y = -this.steerAngle;
    }
    const brake = this.braking && this.speed > 0.3;
    const m = brake ? LIGHT_MATS.brake : LIGHT_MATS.tail;
    if (this.tails[0].material !== m) for (const t of this.tails) t.material = m;
  }

  setVisible(v) { this.group.visible = v; }
}

/** Circle-vs-circle contacts between every pair of nearby cars. */
export function collideCars(cars, onHit) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const reach = (a.spec.len + b.spec.len) / 2;
      if (dx * dx + dz * dz > reach * reach) continue;
      const sa = Math.sin(a.h), ca = Math.cos(a.h), sb = Math.sin(b.h), cb = Math.cos(b.h);
      let hitSpeed = 0;
      for (const oa of a.offsets) {
        for (const ob of b.offsets) {
          const ax = a.x + sa * oa, az = a.z + ca * oa;
          const bx = b.x + sb * ob, bz = b.z + cb * ob;
          const ddx = bx - ax, ddz = bz - az;
          const rr = a.r + b.r;
          const d2 = ddx * ddx + ddz * ddz;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.001;
          const nx = ddx / d, nz = ddz / d, depth = rr - d;
          const ma = a.mass, mb = b.mass, tot = ma + mb;
          a.x -= nx * depth * (mb / tot); a.z -= nz * depth * (mb / tot);
          b.x += nx * depth * (ma / tot); b.z += nz * depth * (ma / tot);
          const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rv < 0) {
            const jimp = (-(1 + 0.3) * rv) / (1 / ma + 1 / mb);
            a.vx -= (jimp / ma) * nx; a.vz -= (jimp / ma) * nz;
            b.vx += (jimp / mb) * nx; b.vz += (jimp / mb) * nz;
            const rax = sa * oa, raz = ca * oa, rbx = sb * ob, rbz = cb * ob;
            a.spin += (raz * -nx - rax * -nz) * (jimp / ma) * 0.08;
            b.spin += (rbz * nx - rbx * nz) * (jimp / mb) * 0.08;
            hitSpeed = Math.max(hitSpeed, -rv);
          }
        }
      }
      if (hitSpeed > 0) onHit(a, b, hitSpeed);
    }
  }
}
