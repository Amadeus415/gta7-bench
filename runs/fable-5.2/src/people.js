// Jointed figures, their procedural animation, and the sidewalk crowd.
import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, clamp, damp, dampAngle, lerp, makeRng, mat, TAU } from './util.js';
import { LINES, ROAD_HALF, PARK, PIER, PROM, groundHeight, colliders } from './world.js';

const material = new THREE.MeshLambertMaterial({ vertexColors: true });
const HIP = 0.93;

const SKIN = [0xf1c9a5, 0xe0ac86, 0xc68e63, 0x9a6844, 0x70482e, 0xf6d7bd];
const HAIR = [0x1c1612, 0x3a2a1c, 0x6a4a2a, 0xb8894a, 0x8a8a8a, 0x7a2a1a, 0x111111, 0xd8c8a0];
const TOPS = [0xd9412b, 0x2e6da4, 0xf2f0ea, 0x2e8b6a, 0xe8b84a, 0x7a4a9a, 0x1f2226, 0xe07a9a, 0x4fb7d9, 0x8a8f96, 0xd98a2b, 0x3a5a3a];
const BOTTOMS = [0x23364a, 0x2a2c30, 0x4a5568, 0x6a5a48, 0x8a7a62, 0x1c1c22, 0x3a4a6a, 0xb8b0a0];
const SHOES = [0x1c1c1c, 0xf2f0ea, 0x6a3a22, 0xd9412b];

export function randomLook(R) {
  return {
    skin: R.pick(SKIN), hair: R.pick(HAIR), top: R.pick(TOPS), bottom: R.pick(BOTTOMS), shoes: R.pick(SHOES),
    scale: R.range(0.9, 1.08), build: R.range(0.9, 1.15), longSleeve: R.chance(0.5), hat: R.chance(0.14) ? R.pick(TOPS) : null,
    bag: R.chance(0.2) ? R.pick(BOTTOMS) : null,
  };
}

const capsule = new THREE.CapsuleGeometry(1, 1, 3, 8);
const sphere = new THREE.SphereGeometry(1, 12, 9);
/** A limb segment `total` metres long, centred at height y. The unit capsule is 3 tall. */
const cap = (b, r, total, y, c) => b.add(capsule, mat(0, y, 0, 0, 0, 0, r, total / 3, r), c);

/** Build a figure. `detailed` adds elbows (used for the player). */
export function buildFigure(look, detailed = false) {
  const root = new THREE.Group();
  const tilt = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = HIP;
  root.add(tilt);
  tilt.add(hips);
  const w = look.build;

  const tb = new GeoBuilder();
  tb.box(0.33 * w, 0.2, 0.21, 0, 0.02, 0, look.bottom);
  tb.add(new THREE.CylinderGeometry(0.215 * w, 0.165 * w, 1, 10), mat(0, 0.36, 0, 0, 0, 0, 1, 0.5, 0.6), look.top);
  tb.cyl(0.055, 0.06, 0.1, 0, 0.65, 0, look.skin, 6);
  tb.add(sphere, mat(0, 0.785, 0.005, 0, 0, 0, 0.112, 0.128, 0.118), look.skin);
  tb.add(sphere, mat(0, 0.815, -0.028, 0, 0, 0, 0.12, 0.118, 0.125), look.hair);
  tb.box(0.022, 0.022, 0.02, -0.042, 0.795, 0.113, 0x1a1a1a);
  tb.box(0.022, 0.022, 0.02, 0.042, 0.795, 0.113, 0x1a1a1a);
  if (look.hat) { tb.cyl(0.118, 0.125, 0.08, 0, 0.89, -0.01, look.hat, 10); tb.box(0.2, 0.02, 0.13, 0, 0.86, 0.12, look.hat); }
  if (look.bag) tb.box(0.3, 0.38, 0.14, 0, 0.36, -0.2, look.bag);
  const torso = new THREE.Mesh(tb.build(), material);
  hips.add(torso);

  const arm = (sx) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.245 * w, 0.55, 0);
    const sleeve = look.top, lower = look.longSleeve ? look.top : look.skin;
    const ub = new GeoBuilder();
    cap(ub, 0.052, 0.34, -0.15, sleeve);
    let elbow = null;
    if (detailed) {
      const fb = new GeoBuilder();
      cap(fb, 0.045, 0.32, -0.14, lower);
      fb.add(sphere, mat(0, -0.31, 0, 0, 0, 0, 0.05, 0.06, 0.05), look.skin);
      elbow = new THREE.Group();
      elbow.position.y = -0.3;
      elbow.add(new THREE.Mesh(fb.build(), material));
      shoulder.add(elbow);
    } else {
      cap(ub, 0.045, 0.32, -0.44, lower);
      ub.add(sphere, mat(0, -0.61, 0, 0, 0, 0, 0.05, 0.06, 0.05), look.skin);
    }
    shoulder.add(new THREE.Mesh(ub.build(), material));
    torso.add(shoulder);
    return { shoulder, elbow };
  };
  const leg = (sx) => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.095 * w, 0, 0);
    const th = new GeoBuilder();
    cap(th, 0.078, 0.5, -0.22, look.bottom);
    hip.add(new THREE.Mesh(th.build(), material));
    const sb = new GeoBuilder();
    cap(sb, 0.06, 0.48, -0.21, look.bottom);
    sb.box(0.1, 0.085, 0.25, 0, -0.445, 0.05, look.shoes);
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    knee.add(new THREE.Mesh(sb.build(), material));
    hip.add(knee);
    hips.add(hip);
    return { hip, knee };
  };
  const rig = { root, tilt, hips, torso, armL: arm(-1), armR: arm(1), legL: leg(-1), legR: leg(1), meshes: [] };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; rig.meshes.push(o); } });
  root.scale.setScalar(look.scale);
  return rig;
}

/** A walking body: position, heading, and the pose logic shared by player and crowd. */
export class Person {
  constructor(look, detailed = false) {
    this.rig = buildFigure(look, detailed);
    this.group = this.rig.root;
    this.x = 0; this.y = 0; this.z = 0; this.heading = 0;
    this.speed = 0; // horizontal speed, drives the gait
    this.phase = Math.random() * TAU;
    this.air = false;
    this.airBlend = 0;
    this.down = 0; // seconds left lying on the ground after being knocked over
    this.downBlend = 0;
    this.kx = 0; this.kz = 0; // slide velocity while knocked
    this.vy = 0;
    this.runBlend = 0; this.moveBlend = 0;
    this.idleT = Math.random() * 10;
    this.backward = false;
  }

  /** Knock the figure over with a shove. */
  knock(vx, vz, seconds = 3.2) {
    this.kx = vx; this.kz = vz; this.vy = 3.4;
    this.down = seconds;
  }

  /** Physics for a body that has been knocked flying. */
  tumble(dt) {
    this.down -= dt;
    this.x += this.kx * dt; this.z += this.kz * dt;
    this.vy -= 18 * dt;
    this.y += this.vy * dt;
    const g = groundHeight(this.x, this.z);
    if (this.y <= g) {
      this.y = g; this.vy = 0;
      const f = Math.max(0, 1 - 6 * dt);
      this.kx *= f; this.kz *= f;
    }
    if (colliders.resolve(this.x, this.z, 0.35, this.y, _hit)) { this.x = _hit.x; this.z = _hit.z; this.kx *= 0.4; this.kz *= 0.4; }
    this.speed = 0;
  }

  /** Pose the rig from the current motion state. */
  pose(dt) {
    const r = this.rig;
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.heading;
    this.idleT += dt;
    const move = clamp(this.speed / 1.4, 0, 1);
    const run = clamp((this.speed - 2.8) / 3, 0, 1);
    this.moveBlend = damp(this.moveBlend, move, 10, dt);
    this.runBlend = damp(this.runBlend, run, 8, dt);
    this.airBlend = damp(this.airBlend, this.air ? 1 : 0, 12, dt);
    this.downBlend = damp(this.downBlend, this.down > 0.7 ? 1 : 0, this.down > 0.7 ? 12 : 5, dt);
    const w = this.moveBlend, rn = this.runBlend, ab = this.airBlend, db = this.downBlend;
    const stride = lerp(1.5, 2.9, rn);
    this.phase += ((this.speed * dt) / stride) * TAU * (this.backward ? -1 : 1);
    const ph = this.phase;
    const A = lerp(0.52, 0.98, rn) * w, K = lerp(0.95, 1.75, rn) * w;
    const sL = Math.sin(ph), cL = Math.cos(ph);

    const g = 1 - ab;
    r.legL.hip.rotation.x = (-A * sL - 0.08 * rn) * g + -0.7 * ab;
    r.legR.hip.rotation.x = (A * sL - 0.08 * rn) * g + 0.25 * ab;
    r.legL.knee.rotation.x = (K * Math.max(0, cL) ** 1.2 + 0.06 * w) * g + 1.25 * ab;
    r.legR.knee.rotation.x = (K * Math.max(0, -cL) ** 1.2 + 0.06 * w) * g + 0.7 * ab;

    const Aa = lerp(0.5, 1.05, rn) * w;
    const sway = Math.sin(this.idleT * 1.7) * 0.02 * (1 - w);
    r.armL.shoulder.rotation.x = Aa * sL * g + sway - 0.9 * ab + db * -2.6;
    r.armR.shoulder.rotation.x = -Aa * sL * g - sway - 0.9 * ab + db * -2.4;
    r.armL.shoulder.rotation.z = -0.07 - 0.75 * ab - db * 0.6;
    r.armR.shoulder.rotation.z = 0.07 + 0.75 * ab + db * 0.6;
    if (r.armL.elbow) {
      const bend = -(0.14 + lerp(0.22, 1.5, rn) * w);
      r.armL.elbow.rotation.x = bend - 0.4 * ab;
      r.armR.elbow.rotation.x = bend - 0.4 * ab;
    }
    r.torso.rotation.x = 0.03 * w + 0.2 * rn - 0.1 * ab + Math.sin(this.idleT * 1.3) * 0.008;
    r.torso.rotation.y = -sL * 0.13 * w;
    r.hips.position.y = HIP - Math.abs(cL) * 0.035 * w * (1 + rn) - 0.03 * rn;
    r.hips.rotation.z = Math.sin(ph) * 0.03 * w;
    r.tilt.rotation.x = -db * 1.5;
    r.tilt.position.y = db * 0.17;
    r.tilt.position.z = db * 0.5;
  }
}

const _hit = {};

// ------------------------------------------------------------- the crowd

/** Rectangles whose rims people walk: one per block, plus the promenade and the pier. */
function buildLoops() {
  const loops = [];
  for (let bz = 0; bz < 5; bz++) for (let bx = 0; bx < 5; bx++) {
    if (bz === 2 && (bx === 2 || bx === 3)) continue;
    loops.push({ x0: LINES[bx] + ROAD_HALF, x1: LINES[bx + 1] - ROAD_HALF, z0: LINES[bz] + ROAD_HALF, z1: LINES[bz + 1] - ROAD_HALF, lo: 1.7, hi: 3.1, w: bz === 4 ? 2 : 1 });
  }
  loops.push({ ...PARK, lo: 1.7, hi: 3.0, w: 3 });
  loops.push({ x0: -188, x1: 188, z0: PROM.z0 + 3.2, z1: PROM.z1 - 2.6, lo: 0, hi: 1.6, isolated: true, w: 10 });
  loops.push({ x0: PIER.x0, x1: PIER.x1, z0: PIER.z0 + 4, z1: PIER.z1 - 34, lo: 5.2, hi: 8, isolated: true, w: 3 });
  loops.push({ x0: PARK.x0 + 4, x1: 32, z0: -3.5, z1: 3.5, lo: 2.4, hi: 3.2, isolated: true, w: 2 }); // park's main path
  return loops;
}

const corner = (L, c, d, out) => {
  out.x = c === 0 || c === 3 ? L.x0 + d : L.x1 - d;
  out.z = c < 2 ? L.z0 + d : L.z1 - d;
  return out;
};

export class Pedestrian extends Person {
  constructor(look, R) {
    super(look, false);
    this.R = R;
    this.loop = null; this.corner = 0; this.dir = 1; this.inset = 2;
    this.tx = 0; this.tz = 0;
    this.pace = R.chance(0.08) ? R.range(3, 3.8) : R.range(1.15, 1.75);
    this.wait = 0;
    this.flee = 0; this.fx = 0; this.fz = 0;
    this.visible = true;
    this.vel = 0;
    this.hitCool = 0;
  }

  place(loops, loop, R) {
    this.loop = loop;
    this.inset = R.range(loop.lo, loop.hi);
    this.dir = R.chance(0.5) ? 1 : -1;
    this.corner = R.int(0, 3);
    const a = corner(loop, this.corner, this.inset, {}), b = corner(loop, (this.corner + this.dir + 4) % 4, this.inset, {});
    const t = R();
    this.x = lerp(a.x, b.x, t); this.z = lerp(a.z, b.z, t);
    this.corner = (this.corner + this.dir + 4) % 4;
    this.tx = b.x; this.tz = b.z;
    this.y = groundHeight(this.x, this.z);
    this.heading = Math.atan2(this.tx - this.x, this.tz - this.z);
    this.down = 0; this.flee = 0; this.wait = 0;
  }

  /** At a corner: carry on round the block, or cross the street to the next one. */
  choose(loops) {
    const R = this.R, L = this.loop;
    if (!L.isolated && R.chance(0.34)) {
      const here = corner(L, this.corner, this.inset, _p);
      const sx = this.corner === 0 || this.corner === 3 ? -1 : 1, sz = this.corner < 2 ? -1 : 1;
      const [dx, dz] = R.chance(0.5) ? [sx, 0] : [0, sz];
      const px = here.x + dx * (2 * ROAD_HALF + 2 * this.inset), pz = here.z + dz * (2 * ROAD_HALF + 2 * this.inset);
      for (const M of loops) {
        if (M === L || M.isolated || px < M.x0 || px > M.x1 || pz < M.z0 || pz > M.z1) continue;
        for (let c = 0; c < 4; c++) {
          const q = corner(M, c, this.inset, _q);
          if (Math.abs(q.x - px) < 1.2 && Math.abs(q.z - pz) < 1.2) {
            this.loop = M; this.corner = c; this.tx = q.x; this.tz = q.z;
            if (R.chance(0.5)) this.dir = -this.dir;
            return;
          }
        }
      }
    }
    this.corner = (this.corner + this.dir + 4) % 4;
    const q = corner(L, this.corner, this.inset, _q);
    this.tx = q.x; this.tz = q.z;
    if (R.chance(0.2)) this.wait = R.range(1, 5);
  }

  update(dt, loops) {
    this.hitCool -= dt;
    if (this.down > 0) {
      this.tumble(dt);
      if (this.down <= 0) { this.flee = 2.5; const a = Math.random() * TAU; this.fx = Math.sin(a); this.fz = Math.cos(a); }
      return;
    }
    let want = 0, hx = 0, hz = 0;
    if (this.flee > 0) {
      this.flee -= dt;
      want = 5.4; hx = this.fx; hz = this.fz;
    } else if (this.wait > 0) {
      this.wait -= dt;
    } else {
      const dx = this.tx - this.x, dz = this.tz - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) this.choose(loops);
      else { want = this.pace; hx = dx / d; hz = dz / d; }
    }
    this.vel = damp(this.vel, want, 6, dt);
    if (want > 0) this.heading = dampAngle(this.heading, Math.atan2(hx, hz), 7, dt);
    this.x += Math.sin(this.heading) * this.vel * dt;
    this.z += Math.cos(this.heading) * this.vel * dt;
    if (this.flee > 0 && colliders.resolve(this.x, this.z, 0.3, this.y, _hit)) { this.x = _hit.x; this.z = _hit.z; }
    this.y = damp(this.y, groundHeight(this.x, this.z), 18, dt);
    this.speed = this.vel;
  }

  /** Run from something at (x, z) moving with velocity (vx, vz). */
  scare(x, z, vx, vz, seconds) {
    if (this.down > 0) return;
    const dx = this.x - x, dz = this.z - z;
    // step off to whichever side of its path we are already on
    const side = dx * vz - dz * vx > 0 ? 1 : -1;
    const sp = Math.hypot(vx, vz) || 1;
    this.fx = (side * vz) / sp + (dx / (Math.hypot(dx, dz) || 1)) * 0.4;
    this.fz = (-side * vx) / sp + (dz / (Math.hypot(dx, dz) || 1)) * 0.4;
    const n = Math.hypot(this.fx, this.fz) || 1;
    this.fx /= n; this.fz /= n;
    this.flee = Math.max(this.flee, seconds);
    this.wait = 0;
  }
}

const _p = {}, _q = {};

export class Crowd {
  constructor(scene, count = 34) {
    this.loops = buildLoops();
    this.people = [];
    const R = makeRng(8086);
    const total = this.loops.reduce((s, l) => s + l.w, 0);
    for (let i = 0; i < count; i++) {
      const p = new Pedestrian(randomLook(R), makeRng(1000 + i * 31));
      let pick = R() * total, loop = this.loops[0];
      for (const l of this.loops) { pick -= l.w; if (pick <= 0) { loop = l; break; } }
      p.place(this.loops, loop, R);
      scene.add(p.group);
      this.people.push(p);
    }
  }

  /**
   * Move everyone; hide and freeze the pose of those far from the camera.
   * `cars` scare people off the road and knock them over; `onHit(ped, car)` reports it.
   */
  update(dt, px, pz, cars, onHit) {
    for (const p of this.people) {
      const d2 = (p.x - px) ** 2 + (p.z - pz) ** 2;
      p.update(dt, this.loops);
      const show = d2 < 150 * 150;
      if (show !== p.visible) { p.visible = show; p.group.visible = show; }
      if (!show) continue;
      const shadow = d2 < 60 * 60;
      if (shadow !== p.shadow) { p.shadow = shadow; for (const m of p.rig.meshes) m.castShadow = shadow; }
      p.pose(dt);
      if (p.down > 0) continue;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (car.speed < 1.5) continue;
        const dx = p.x - car.x, dz = p.z - car.z;
        if (dx > 16 || dx < -16 || dz > 16 || dz < -16) continue;
        if (Math.abs(car.y - p.y) > 1.6) continue;
        const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
        const lz = dx * sin + dz * cos, lx = -dx * cos + dz * sin;
        const hl = car.spec.len / 2, hw = car.spec.width / 2;
        if (Math.abs(lz) < hl + 0.25 && Math.abs(lx) < hw + 0.25) {
          if (car.speed > 3 && p.hitCool <= 0) {
            p.knock(car.vx * 0.85 + (lx > 0 ? -cos : cos) * 1.5, car.vz * 0.85 + (lx > 0 ? sin : -sin) * 1.5, 4 + Math.random() * 2);
            p.hitCool = 1;
            if (onHit) onHit(p, car);
          } else {
            p.x += (lx > 0 ? -cos : cos) * 2 * dt; p.z += (lx > 0 ? sin : -sin) * 2 * dt;
          }
        } else if (car.speed > 5.5) {
          // is the car bearing down on this person?
          const ahead = (dx * car.vx + dz * car.vz) / car.speed;
          if (ahead > 0 && ahead < 4 + car.speed * 0.75 && Math.abs(lx) < hw + 1.5) p.scare(car.x, car.z, car.vx, car.vz, 1.6);
        }
      }
    }
  }

  /** Borrow the person furthest from (x, z), e.g. to play a driver thrown out of a car. */
  borrow(x, z) {
    let best = null, bd = -1;
    for (const p of this.people) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d > bd && p.down <= 0) { bd = d; best = p; }
    }
    return best;
  }

  /** Send a borrowed person back to the nearest loop once their scene is over. */
  rehome(p) {
    let best = this.loops[0], bd = Infinity;
    for (const l of this.loops) {
      const cx = clamp(p.x, l.x0, l.x1), cz = clamp(p.z, l.z0, l.z1);
      const d = (cx - p.x) ** 2 + (cz - p.z) ** 2;
      if (d < bd) { bd = d; best = l; }
    }
    p.loop = best;
    p.inset = lerp(best.lo, best.hi, Math.random());
    let bc = 0; bd = Infinity;
    for (let c = 0; c < 4; c++) { const q = corner(best, c, p.inset, _q); const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < bd) { bd = d; bc = c; } }
    p.corner = bc;
    const q = corner(best, bc, p.inset, _q);
    p.tx = q.x; p.tz = q.z;
  }
}
