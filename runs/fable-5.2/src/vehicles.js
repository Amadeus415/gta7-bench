// Car models (built from extruded side profiles) and the driving physics.
import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, clamp, damp, lerp, mat } from './util.js';
import { baseHeight, rampHeight, colliders, PROM, PARK, PIER, WATER_Y } from './world.js';
import { beamTexture } from './textures.js';

// Shapes are described by a handful of profile heights and positions (metres,
// z forward from the car's centre) and turned into geometry below.
const SEDAN = { belt: 0.93, trunk: 0.93, hood: 0.86, cabRear: -1.5, roofRear: -0.82, roofFront: 0.3, cabFront: 1.02 };
export const CAR_TYPES = {
  kestrel: {
    name: 'Kestrel GT', len: 4.4, width: 1.94, roof: 1.2, wb: 2.62, wheelR: 0.35,
    accel: 9.6, top: 58, brake: 22, grip: 17.5, mass: 1.0,
    shape: { belt: 0.8, trunk: 0.88, hood: 0.7, cabRear: -1.55, roofRear: -0.62, roofFront: 0.05, cabFront: 0.82 }, spoiler: true,
    paints: [0xe2442b, 0xf2b01e, 0x1f6fd0, 0xf2f0ea, 0x16181c, 0x2bb39a],
  },
  marlin: {
    name: 'Marlin', len: 4.7, width: 1.86, roof: 1.44, wb: 2.8, wheelR: 0.33,
    accel: 6.6, top: 45, brake: 19, grip: 13.5, mass: 1.15, shape: SEDAN,
    paints: [0x8a8f96, 0x23364a, 0x7a2e3a, 0xe8e4da, 0x1f2226, 0x3f6f5a, 0x9a7a52],
  },
  pico: {
    name: 'Pico', len: 3.86, width: 1.74, roof: 1.5, wb: 2.46, wheelR: 0.31,
    accel: 6.0, top: 40, brake: 19, grip: 14, mass: 0.85,
    shape: { belt: 0.95, trunk: 1.0, hood: 0.9, cabRear: -1.66, roofRear: -1.4, roofFront: 0.28, cabFront: 0.98 },
    paints: [0xf2c230, 0x4fb7d9, 0xe06a4a, 0xf2f0ea, 0x7fc06a, 0xd86aa0],
  },
  bison: {
    name: 'Bison', len: 5.3, width: 2.0, roof: 1.84, wb: 3.3, wheelR: 0.41,
    accel: 6.0, top: 41, brake: 17, grip: 11.5, mass: 1.6,
    shape: { belt: 1.12, trunk: 1.12, hood: 1.1, cabRear: -0.42, roofRear: -0.28, roofFront: 0.72, cabFront: 1.36 }, bed: true,
    paints: [0x2e5d3a, 0x8a2a22, 0x3a3f45, 0xd8d4c8, 0x23406a],
  },
  caravel: {
    name: 'Caravel', len: 5.0, width: 1.98, roof: 2.06, wb: 3.0, wheelR: 0.36,
    accel: 4.9, top: 35, brake: 16, grip: 10.5, mass: 1.7,
    shape: { belt: 1.12, trunk: 1.12, hood: 1.02, cabRear: -2.22, roofRear: -2.16, roofFront: 1.22, cabFront: 1.86 }, panel: true,
    paints: [0xf2f0ea, 0x2e6da4, 0xd98a2b, 0x8a8f96, 0x3d8f96],
  },
  cab: {
    name: 'Vesper Cab', len: 4.7, width: 1.86, roof: 1.44, wb: 2.8, wheelR: 0.33,
    accel: 7.0, top: 46, brake: 19, grip: 13.5, mass: 1.15, shape: SEDAN, taxi: true,
    paints: [0xf2b01e],
  },
  patrol: {
    name: 'Harbor Patrol', len: 4.8, width: 1.9, roof: 1.44, wb: 2.85, wheelR: 0.34,
    accel: 9.2, top: 54, brake: 22, grip: 16, mass: 1.3, shape: SEDAN, police: true,
    paints: [0xf2f0ea],
  },
};

function extrudeShape(shape, width, bevel) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelOffset: -bevel, bevelSegments: 2, steps: 1, curveSegments: 7,
  });
  g.rotateY(Math.PI / 2); // shape x becomes -z (front), extrusion becomes x
  g.translate(-(width - 2 * bevel) / 2, 0, 0);
  return g;
}

const paintMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.3 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x5f7486, metalness: 0.95, roughness: 0.06 });
const tyreMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.6 });
export const headMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
const sirenMats = [
  new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false }),
  new THREE.MeshBasicMaterial({ color: 0x2a5cff, toneMapped: false }),
];
let beamGeo = null;
const wheelGeos = new Map();
const bodyCache = new Map();

function wheelGeometry(r) {
  const key = r.toFixed(2);
  if (wheelGeos.has(key)) return wheelGeos.get(key);
  const b = new GeoBuilder();
  const w = 0.25;
  b.cyl(r, r, w, 0, 0, 0, 0x121316, 16, 0, 0, Math.PI / 2);
  b.cyl(r * 0.62, r * 0.62, w + 0.02, 0, 0, 0, 0xb9bec6, 12, 0, 0, Math.PI / 2);
  for (let i = 0; i < 5; i++) b.box(w + 0.04, r * 1.1, 0.07, 0, 0, 0, 0x3a3d42, 0, (i / 5) * Math.PI);
  b.cyl(r * 0.2, r * 0.2, w + 0.06, 0, 0, 0, 0x22252a, 8, 0, 0, Math.PI / 2);
  const g = b.build();
  wheelGeos.set(key, g);
  return g;
}

/** Geometry for one car type in one paint colour: { body, glass, head, tail }. */
function carGeometry(type, paint) {
  const key = type + paint;
  if (bodyCache.has(key)) return bodyCache.get(key);
  const spec = CAR_TYPES[type];
  const { len: L, width: W, roof, wb, wheelR, shape: s } = spec;
  const half = L / 2, gc = 0.25, arch = wheelR + 0.075;
  const col = new THREE.Color(paint);
  const dark = new THREE.Color(0x191a1d);
  const body = new GeoBuilder(), glass = new GeoBuilder(), head = new GeoBuilder(), tail = new GeoBuilder();

  // Lower body, traced in "shape space" where x = -z.
  const sh = new THREE.Shape();
  sh.moveTo(half - 0.06, gc + 0.14);
  sh.lineTo(half, 0.52);
  sh.lineTo(half - 0.07, s.trunk - 0.07);
  sh.lineTo(half - 0.22, s.trunk);
  sh.lineTo(-s.cabRear, s.belt);
  sh.lineTo(-s.cabFront, s.belt);
  sh.lineTo(-half + 0.4, s.hood);
  sh.lineTo(-half + 0.06, s.hood - 0.13);
  sh.lineTo(-half, 0.5);
  sh.lineTo(-half + 0.07, gc + 0.12);
  sh.lineTo(-wb / 2 - arch, gc);
  sh.lineTo(-wb / 2 - arch, wheelR);
  sh.absarc(-wb / 2, wheelR, arch, Math.PI, 0, true);
  sh.lineTo(-wb / 2 + arch, gc);
  sh.lineTo(wb / 2 - arch, gc);
  sh.lineTo(wb / 2 - arch, wheelR);
  sh.absarc(wb / 2, wheelR, arch, Math.PI, 0, true);
  sh.lineTo(wb / 2 + arch, gc);
  sh.closePath();
  body.add(extrudeShape(sh, W, 0.07), mat(0, 0, 0), col);

  // Cabin.
  const cw = W - 0.26;
  const cab = new THREE.Shape();
  cab.moveTo(-s.cabRear, s.belt - 0.03);
  cab.lineTo(-s.roofRear, roof);
  cab.lineTo(-s.roofFront, roof);
  cab.lineTo(-s.cabFront, s.belt - 0.03);
  cab.closePath();
  const cabGeo = extrudeShape(cab, cw, 0.04);
  if (spec.panel) {
    body.add(cabGeo, mat(0, 0, 0), col);
    // windscreen and front side windows on a panel van
    const wy0 = s.belt + 0.08, wy1 = roof - 0.12;
    const k = (y) => s.cabFront + ((s.roofFront - s.cabFront) * (y - s.belt)) / (roof - s.belt) + 0.025;
    glass.quad([-cw / 2 + 0.12, wy0, k(wy0)], [cw / 2 - 0.12, wy0, k(wy0)], [cw / 2 - 0.12, wy1, k(wy1)], [-cw / 2 + 0.12, wy1, k(wy1)]);
    for (const sx of [-1, 1]) {
      const x = sx * (cw / 2 + 0.012);
      const a = [x, wy0, s.roofFront - 0.1], b = [x, wy0, s.roofFront - 1.15], c = [x, wy1, s.roofFront - 1.15], d = [x, wy1, s.roofFront - 0.25];
      if (sx > 0) glass.quad(a, b, c, d); else glass.quad(b, a, d, c);
    }
    glass.quad([cw / 2 - 0.2, wy0 + 0.1, s.cabRear - 0.035], [-cw / 2 + 0.2, wy0 + 0.1, s.cabRear - 0.035], [-cw / 2 + 0.2, wy1, s.roofRear - 0.045], [cw / 2 - 0.2, wy1, s.roofRear - 0.045]);
  } else {
    glass.add(cabGeo, mat(0, 0, 0));
    body.box(cw + 0.03, 0.05, s.roofFront - s.roofRear - 0.06, 0, roof + 0.012, (s.roofFront + s.roofRear) / 2, col);
    const mid = (s.roofFront + s.roofRear) / 2 - 0.1;
    for (const sx of [-1, 1]) body.box(0.05, roof - s.belt, 0.11, sx * (cw / 2 + 0.005), (roof + s.belt) / 2, mid, col);
  }

  // Trim.
  body.box(W + 0.02, 0.2, 0.22, 0, 0.42, half - 0.06, dark);
  body.box(W + 0.02, 0.2, 0.22, 0, 0.42, -half + 0.06, dark);
  body.box(W - 0.16, 0.13, wb - 2 * arch - 0.05, 0, gc + 0.04, 0, dark);
  body.box(W * 0.5, 0.16, 0.06, 0, s.hood - 0.3, half - 0.0, dark);
  body.box(0.5, 0.13, 0.03, 0, 0.47, half + 0.055, 0xe8e6e0);
  body.box(0.5, 0.13, 0.03, 0, 0.6, -half - 0.02, 0xe8e6e0);
  for (const sx of [-1, 1]) body.box(0.2, 0.1, 0.14, sx * (W / 2 + 0.06), s.belt + 0.06, s.cabFront - 0.12, col);
  if (spec.spoiler) {
    body.box(W - 0.2, 0.05, 0.3, 0, s.trunk + 0.2, -half + 0.22, dark);
    for (const sx of [-1, 1]) body.box(0.06, 0.2, 0.14, sx * (W / 2 - 0.35), s.trunk + 0.1, -half + 0.22, dark);
    body.box(W * 0.28, 0.02, 1.0, 0, s.hood + 0.06, half - 1.1, dark, 0, 0.115);
  }
  if (spec.bed) {
    body.box(W - 0.3, 0.06, half + s.cabRear - 0.3, 0, s.trunk + 0.012, (-half + s.cabRear) / 2 - 0.02, 0x2a2c30);
    body.box(W - 0.16, 0.5, 0.1, 0, s.belt + 0.25, s.cabRear - 0.1, col);
  }
  if (spec.taxi) {
    body.box(0.62, 0.2, 0.3, 0, roof + 0.14, 0, 0x1c1c1c);
    head.box(0.5, 0.14, 0.31, 0, roof + 0.14, 0, 0xffe680);
    for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) body.box(0.02, 0.09, 0.09, sx * (W / 2 + 0.006), 0.74, -0.9 + i * 0.3, i % 2 ? 0x16181c : 0xf2f0ea);
  }
  if (spec.police) {
    for (const sx of [-1, 1]) body.box(0.02, 0.36, L * 0.46, sx * (W / 2 + 0.006), 0.66, -0.1, 0x1c3a7a);
    body.box(W - 0.24, 0.02, 1.0, 0, s.hood + 0.05, half - 1.05, 0x1c3a7a, 0, 0.07);
    body.box(1.2, 0.07, 0.34, 0, roof + 0.07, 0, 0x26282c);
  }

  // Lamps.
  const hy = s.hood - 0.17;
  for (const sx of [-1, 1]) {
    head.box(0.36, 0.12, 0.06, sx * (W / 2 - 0.3), hy, half - 0.02, 0xfff6dc);
    tail.box(0.38, 0.11, 0.06, sx * (W / 2 - 0.3), s.trunk - 0.2, -half + 0.0, 0xffffff);
  }
  if (spec.spoiler) tail.box(W - 1.05, 0.05, 0.06, 0, s.trunk - 0.2, -half + 0.0, 0xffffff);

  const out = { body: body.build(), glass: glass.build(), head: head.build(), tail: tail.build() };
  bodyCache.set(key, out);
  return out;
}

const _hit = {};
const _slope = { gx: 0, gz: 0 };
const G = 14;

export class Car {
  constructor(type, paint, x, z, heading) {
    this.type = type;
    this.spec = CAR_TYPES[type];
    this.paint = paint ?? this.spec.paints[0];
    this.x = x; this.z = z; this.heading = heading;
    this.y = baseHeight(x, z);
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.spin = 0; // extra yaw rate left over from impacts
    this.steer = 0;
    this.throttle = 0; this.brake = 0; this.steerIn = 0; this.handbrake = false;
    this.grounded = true;
    this.baseSm = this.y;
    this.pitch = 0; this.roll = 0; this.airPitch = 0;
    this.slip = 0; // sideways slide speed, drives smoke and squeal
    this.speed = 0; this.forward = 0;
    // Per-frame events, cleared by Traffic.step before the physics sub-steps run:
    this.impact = 0; this.impactX = 0; this.impactZ = 0; // hardest hit against the scenery
    this.landed = 0; // touchdown speed if the car came back to earth
    this.airTime = 0;
    this.driver = null; // AI driver, 'player', or null when parked
    this.asleep = true;
    this.wheelSpin = 0;
    this.rpm = 0; this.gear = 1;
    this.offroad = false;
    this.siren = false;
    this.health = 100;
    this.lastSkid = [null, null];
    this.alive = true;
    const hw = this.spec.width / 2;
    this.radius = hw + 0.02;
    this.circles = [this.spec.len / 2 - hw, 0, -(this.spec.len / 2 - hw)];
    this.buildModel();
    this.sync(0);
  }

  buildModel() {
    const spec = this.spec;
    const geo = carGeometry(this.type, this.paint);
    const g = new THREE.Group();
    g.rotation.order = 'YXZ';
    const body = new THREE.Group();
    const bodyMesh = new THREE.Mesh(geo.body, paintMat);
    bodyMesh.castShadow = true;
    const glass = new THREE.Mesh(geo.glass, glassMat);
    glass.castShadow = true;
    const head = new THREE.Mesh(geo.head, headMat);
    this.tailMat = new THREE.MeshBasicMaterial({ color: 0x7a0c08 });
    const tail = new THREE.Mesh(geo.tail, this.tailMat);
    body.add(bodyMesh, glass, head, tail);
    if (!beamGeo) {
      beamGeo = new THREE.PlaneGeometry(7, 15).rotateX(Math.PI / 2).translate(0, 0, 7.5);
      beamMat.map = beamTexture();
    }
    this.beam = new THREE.Mesh(beamGeo, beamMat);
    this.beam.position.set(0, 0.06, spec.len / 2 - 0.2);
    this.beam.renderOrder = 3;
    g.add(this.beam);
    if (spec.police) {
      this.sirenLamps = [-1, 1].map((sx, i) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.26), sirenMats[i]);
        m.position.set(sx * 0.32, spec.roof + 0.16, 0);
        body.add(m);
        return m;
      });
    }
    this.wheels = [];
    const wg = wheelGeometry(spec.wheelR);
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * (spec.width / 2 - 0.15), spec.wheelR, sz * spec.wb / 2);
      const wheel = new THREE.Mesh(wg, tyreMat);
      pivot.add(wheel);
      g.add(pivot);
      this.wheels.push({ pivot, wheel, front: sz > 0, sx });
    }
    g.add(body);
    this.group = g;
    this.body = body;
  }

  get sin() { return Math.sin(this.heading); }
  get cos() { return Math.cos(this.heading); }

  wake() { this.asleep = false; }

  /** Advance the physics by `dt` using the current control inputs. */
  step(dt) {
    const spec = this.spec;
    let sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    let vf = this.vx * sin + this.vz * cos;
    let vl = -this.vx * cos + this.vz * sin;
    const sp = Math.abs(vf);

    this.offroad = (this.z > PROM.z1 && !(this.x > PIER.x0 && this.x < PIER.x1)) ||
      (this.x > PARK.x0 + 3.5 && this.x < PARK.x1 - 3.5 && this.z > PARK.z0 + 3.5 && this.z < PARK.z1 - 3.5);
    const surface = this.offroad ? 0.72 : 1;

    // Steering eases off as speed rises.
    const maxSteer = Math.min(0.58, Math.atan((spec.grip * 1.12 * spec.wb) / Math.max(sp * sp, 1)));
    this.steer = damp(this.steer, this.steerIn * maxSteer, this.steerIn !== 0 ? 7 : 11, dt);

    let yawRate = 0;
    if (this.grounded) {
      let acc = 0;
      if (this.throttle > 0) {
        const k = 1 - clamp(vf / spec.top, 0, 1) ** 2;
        acc = spec.accel * this.throttle * (0.25 + 0.75 * k) * (vf < spec.top ? 1 : 0) * surface;
      } else if (this.throttle < 0) {
        acc = vf > -spec.top * 0.28 ? spec.accel * 0.7 * this.throttle : 0;
      }
      vf += acc * dt;
      const resist = 0.35 + 0.0011 * vf * vf + (this.throttle === 0 ? 1.0 : 0) + (this.offroad ? 1.6 : 0);
      let decel = resist + this.brake * spec.brake + (this.handbrake ? 7.5 : 0);
      if (!this.driver) decel += 9; // parked cars hold their brakes
      const dv = decel * dt;
      vf = Math.abs(vf) <= dv ? 0 : vf - Math.sign(vf) * dv;

      yawRate = -(vf / spec.wb) * Math.tan(this.steer);
      if (this.handbrake && sp > 4) yawRate *= 1.4;
    } else {
      this.airTime += dt;
    }
    this.vx = sin * vf - cos * vl;
    this.vz = cos * vf + sin * vl;
    this.heading += (yawRate + this.spin) * dt;
    this.spin *= Math.exp(-(this.grounded ? 3.2 : 0.4) * dt);

    // Tyres resist sliding sideways, up to their grip.
    sin = Math.sin(this.heading); cos = Math.cos(this.heading);
    vf = this.vx * sin + this.vz * cos;
    vl = -this.vx * cos + this.vz * sin;
    if (this.grounded) {
      const maxLat = spec.grip * surface * (this.handbrake ? 0.36 : 1) * dt;
      const want = -vl * Math.min(1, 14 * dt);
      vl += clamp(want, -maxLat, maxLat);
      if (!this.driver) vl *= Math.max(0, 1 - 6 * dt);
    }
    this.slip = this.grounded ? Math.abs(vl) : 0;
    this.vx = sin * vf - cos * vl;
    this.vz = cos * vf + sin * vl;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // Walls, lamp posts, trees.
    for (let i = 0; i < 3; i++) {
      const off = this.circles[i];
      const cx = this.x + sin * off, cz = this.z + cos * off;
      if (!colliders.resolve(cx, cz, this.radius, this.y, _hit)) continue;
      this.x += _hit.x - cx;
      this.z += _hit.z - cz;
      const vn = this.vx * _hit.nx + this.vz * _hit.nz;
      if (vn < 0) {
        const j = -1.18 * vn;
        this.vx += _hit.nx * j; this.vz += _hit.nz * j;
        this.vx *= 0.985; this.vz *= 0.985;
        this.spin += clamp((cos * off * _hit.nx - sin * off * _hit.nz) * j * 0.11, -2.5, 2.5);
        if (-vn > this.impact) { this.impact = -vn; this.impactX = cx - _hit.nx * this.radius; this.impactZ = cz - _hit.nz * this.radius; }
      }
    }

    // Ground: curbs are soaked up by the suspension, ramps throw the car.
    const base = baseHeight(this.x, this.z);
    const ramp = rampHeight(this.x, this.z, _slope);
    this.baseSm = damp(this.baseSm, base, 22, dt);
    const gy = this.baseSm + ramp;
    this.vy -= G * dt;
    this.y += this.vy * dt;
    if (this.y <= gy) {
      if (!this.grounded) this.landed = Math.max(this.landed, -this.vy);
      this.y = gy;
      this.vy = clamp(this.vx * _slope.gx + this.vz * _slope.gz, -30, 30);
      this.grounded = true;
      this.airPitch = 0;
    } else if (this.y - gy > 0.12) {
      if (this.grounded) this.airTime = 0;
      this.grounded = false;
    }

    this.forward = vf;
    this.speed = Math.hypot(this.vx, this.vz);
    this.wheelSpin += (vf / spec.wheelR) * dt;
    if (this.speed < 0.03 && !this.driver && Math.abs(this.spin) < 0.02 && this.grounded) {
      this.vx = this.vz = 0; this.asleep = true;
    }

    // A fake gearbox, just to give the engine note its rise and fall.
    const ratios = [0.11, 0.24, 0.4, 0.6, 0.82, 1.05];
    const frac = Math.abs(vf) / spec.top;
    let gear = 0;
    while (gear < ratios.length - 1 && frac > ratios[gear] * 0.93) gear++;
    this.gear = gear + 1;
    const lo = gear === 0 ? 0 : ratios[gear - 1] * 0.93;
    this.rpm = damp(this.rpm, clamp((frac - lo * 0.55) / (ratios[gear] - lo * 0.55), 0, 1.1), 8, dt);
  }

  /** Copy physics state to the visual model. */
  sync(dt) {
    const g = this.group, spec = this.spec;
    g.position.set(this.x, this.y, this.z);
    g.rotation.y = this.heading;
    // lean into corners and squat under power
    const lat = clamp(this.forward * this.steer * 0.012, -0.075, 0.075);
    const front = baseHeight(this.x + this.sin * spec.wb / 2, this.z + this.cos * spec.wb / 2) + rampHeight(this.x + this.sin * spec.wb / 2, this.z + this.cos * spec.wb / 2, null);
    const rear = baseHeight(this.x - this.sin * spec.wb / 2, this.z - this.cos * spec.wb / 2) + rampHeight(this.x - this.sin * spec.wb / 2, this.z - this.cos * spec.wb / 2, null);
    let pitch = this.grounded ? -Math.atan2(front - rear, spec.wb) : this.pitch + dt * 0.25;
    pitch = clamp(pitch, -0.5, 0.45);
    const squat = this.grounded ? clamp((this.brake * 0.035 - this.throttle * 0.02) * Math.min(1, this.speed / 6), -0.03, 0.04) : 0;
    this.pitch = dt > 0 ? damp(this.pitch, pitch, this.grounded ? 12 : 30, dt) : pitch;
    this.roll = dt > 0 ? damp(this.roll, lat, 8, dt) : lat;
    g.rotation.x = this.pitch;
    this.body.rotation.x = squat;
    this.body.rotation.z = this.roll;
    for (const w of this.wheels) {
      w.wheel.rotation.x = this.wheelSpin;
      if (w.front) w.pivot.rotation.y = -this.steer;
    }
    const braking = this.brake > 0.1 || (this.handbrake && this.speed > 1);
    this.tailMat.color.setHex(braking ? 0xff3020 : this.lit ? 0xb81810 : 0x6a0c08);
    if (this.sirenLamps) for (const m of this.sirenLamps) m.visible = this.siren;
  }

  /** Circle `i` (0 front, 1 middle, 2 rear) in world space. */
  circle(i, out) {
    out.x = this.x + Math.sin(this.heading) * this.circles[i];
    out.z = this.z + Math.cos(this.heading) * this.circles[i];
    return out;
  }

  /** World position `side` metres to the right and `fwd` metres ahead of the centre. */
  point(side, fwd, out) {
    const s = Math.sin(this.heading), c = Math.cos(this.heading);
    out.x = this.x + s * fwd - c * side;
    out.z = this.z + c * fwd + s * side;
    return out;
  }

  underwater() { return this.y < WATER_Y - 0.55; }
}

/** Night switches every car's lamps and road beams on. */
export function setCarLights(night, time) {
  headMat.color.setScalar(0.55 + night * 1.9);
  beamMat.opacity = night * 0.5;
  const flash = Math.floor(time * 5) % 2 === 0;
  sirenMats[0].color.setRGB(flash ? 1 : 0.12, 0.05, 0.04);
  sirenMats[1].color.setRGB(0.04, 0.1, flash ? 0.12 : 1);
}

const _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 };

/**
 * Collide every pair of cars as three circles each, trading momentum.
 * `onCrash(a, b, strength, x, z)` reports hits worth a sound or sparks.
 */
export function collideCars(cars, onCrash) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (a.asleep && b.asleep) continue;
      const dx = b.x - a.x, dz = b.z - a.z;
      const reach = (a.spec.len + b.spec.len) / 2 + 0.2;
      if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
      if (Math.abs(a.y - b.y) > 1.4) continue;
      for (let ia = 0; ia < 3; ia++) {
        a.circle(ia, _a);
        for (let ib = 0; ib < 3; ib++) {
          b.circle(ib, _b);
          const ex = _b.x - _a.x, ez = _b.z - _a.z;
          const rr = a.radius + b.radius;
          const d2 = ex * ex + ez * ez;
          if (d2 >= rr * rr) continue;
          const d = Math.sqrt(d2) || 0.001;
          const nx = ex / d, nz = ez / d; // from a to b
          const ma = a.spec.mass * (a.driver ? 1 : 1.6), mb = b.spec.mass * (b.driver ? 1 : 1.6);
          const pen = rr - d;
          const wa = mb / (ma + mb), wb = ma / (ma + mb);
          a.x -= nx * pen * wa; a.z -= nz * pen * wa;
          b.x += nx * pen * wb; b.z += nz * pen * wb;
          const rel = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
          if (rel >= 0) continue;
          const jimp = (-1.25 * rel) / (1 / ma + 1 / mb);
          a.vx -= (nx * jimp) / ma; a.vz -= (nz * jimp) / ma;
          b.vx += (nx * jimp) / mb; b.vz += (nz * jimp) / mb;
          const oa = a.circles[ia], ob = b.circles[ib];
          a.spin += clamp((Math.cos(a.heading) * oa * -nx - Math.sin(a.heading) * oa * -nz) * (jimp / ma) * 0.1, -2, 2);
          b.spin += clamp((Math.cos(b.heading) * ob * nx - Math.sin(b.heading) * ob * nz) * (jimp / mb) * 0.1, -2, 2);
          a.wake(); b.wake();
          if (onCrash && -rel > 1.5) onCrash(a, b, -rel, (_a.x + _b.x) / 2, (_a.z + _b.z) / 2);
        }
      }
    }
  }
}
