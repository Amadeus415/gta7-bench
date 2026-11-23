// Street clutter that can be knocked flying: cones, bins, crates, hydrants...
// Each kind is one InstancedMesh; a prop only costs CPU while it is moving.
import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, mat } from './util.js';
import { groundHeight, colliders } from './world.js';

const KINDS = {
  cone: { r: 0.22, rest: 0.14, heavy: false, bounce: 0.35 },
  bin: { r: 0.3, rest: 0.26, heavy: false, bounce: 0.3 },
  crate: { r: 0.42, rest: 0.34, heavy: false, bounce: 0.25 },
  chair: { r: 0.3, rest: 0.22, heavy: false, bounce: 0.3 },
  ball: { r: 0.24, rest: 0.22, heavy: false, bounce: 0.72 },
  barrel: { r: 0.36, rest: 0.32, heavy: true, bounce: 0.3 },
  mailbox: { r: 0.36, rest: 0.26, heavy: true, bounce: 0.2 },
  hydrant: { r: 0.24, rest: 0.18, heavy: true, bounce: 0.25 },
  barrier: { r: 0.8, rest: 0.2, heavy: false, bounce: 0.25 },
};

function geometryFor(kind) {
  const b = new GeoBuilder();
  switch (kind) {
    case 'cone':
      b.box(0.4, 0.04, 0.4, 0, 0.02, 0, 0x26282b);
      b.cyl(0.035, 0.16, 0.56, 0, 0.32, 0, 0xf06a1c, 8);
      b.cyl(0.085, 0.115, 0.14, 0, 0.36, 0, 0xf4f1ea, 8);
      break;
    case 'bin':
      b.cyl(0.28, 0.23, 0.82, 0, 0.41, 0, 0xffffff, 10);
      b.cyl(0.3, 0.3, 0.07, 0, 0.84, 0, 0x555a60, 10);
      break;
    case 'crate':
      b.box(0.66, 0.66, 0.66, 0, 0.33, 0, 0xb08a5a);
      b.box(0.7, 0.08, 0.7, 0, 0.06, 0, 0x8a6a40);
      b.box(0.7, 0.08, 0.7, 0, 0.6, 0, 0x8a6a40);
      break;
    case 'chair':
      b.box(0.42, 0.04, 0.42, 0, 0.45, 0, 0xd8d8d8);
      b.box(0.42, 0.44, 0.04, 0, 0.7, -0.2, 0xd8d8d8);
      for (const [x, z] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) b.box(0.035, 0.45, 0.035, x, 0.225, z, 0x8a8f96);
      break;
    case 'ball':
      b.add(new THREE.IcosahedronGeometry(0.22, 2), mat(0, 0.22, 0), 0xffffff);
      break;
    case 'barrel':
      b.cyl(0.3, 0.3, 0.9, 0, 0.45, 0, 0xffffff, 12);
      b.cyl(0.315, 0.315, 0.06, 0, 0.22, 0, 0x8a8f96, 12);
      b.cyl(0.315, 0.315, 0.06, 0, 0.68, 0, 0x8a8f96, 12);
      break;
    case 'mailbox':
      b.box(0.5, 0.75, 0.46, 0, 0.72, 0, 0x2a55a8);
      b.cyl(0.25, 0.25, 0.46, 0, 1.09, 0, 0x2a55a8, 10, Math.PI / 2);
      b.box(0.36, 0.05, 0.03, 0, 0.95, 0.235, 0x16233f);
      for (const [x, z] of [[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]]) b.box(0.05, 0.36, 0.05, x, 0.18, z, 0x1c2a4a);
      break;
    case 'hydrant':
      b.cyl(0.13, 0.15, 0.6, 0, 0.3, 0, 0xd9302b, 8);
      b.cyl(0.17, 0.17, 0.06, 0, 0.06, 0, 0xd9302b, 8);
      b.cyl(0.02, 0.14, 0.16, 0, 0.68, 0, 0xd9302b, 8);
      b.cyl(0.06, 0.06, 0.42, 0, 0.43, 0, 0xe8c84a, 6, 0, 0, Math.PI / 2);
      break;
    case 'barrier':
      b.box(1.9, 0.28, 0.05, 0, 0.82, 0, 0xf4f1ea);
      for (let i = 0; i < 4; i++) b.box(0.24, 0.285, 0.055, -0.72 + i * 0.48, 0.82, 0, 0xd9412b);
      b.box(1.9, 0.12, 0.05, 0, 0.42, 0, 0xf4f1ea);
      for (const x of [-0.85, 0.85]) { b.box(0.05, 0.95, 0.05, x, 0.47, 0.16, 0x8a8f96, 0, 0.32); b.box(0.05, 0.95, 0.05, x, 0.47, -0.16, 0x8a8f96, 0, -0.32); }
      break;
  }
  return b.build();
}

const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const _hit = {};

class PropSystem {
  constructor() {
    this.items = [];
    this.meshes = {};
    this.awake = [];
    this.geysers = [];
  }

  add(kind, x, z, ry = 0, color = null) {
    const k = KINDS[kind];
    const item = {
      kind, k, x, y: groundHeight(x, z), z, vx: 0, vy: 0, vz: 0,
      q: new THREE.Quaternion().setFromAxisAngle(_axis.set(0, 1, 0), ry),
      wx: 0, wy: 0, wz: 0, color, moving: false, tipped: false, index: 0, quiet: 0,
    };
    this.items.push(item);
    return item;
  }

  build(scene) {
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const byKind = {};
    for (const it of this.items) (byKind[it.kind] ||= []).push(it);
    for (const [kind, list] of Object.entries(byKind)) {
      const mesh = new THREE.InstancedMesh(geometryFor(kind), material, list.length);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      list.forEach((it, i) => {
        it.index = i;
        it.mesh = mesh;
        mesh.setColorAt(i, _c.set(it.color ?? 0xffffff));
        this.write(it);
      });
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(mesh);
      this.meshes[kind] = mesh;
    }
  }

  write(it) {
    _m.compose(_p.set(it.x, it.y, it.z), it.q, _s);
    it.mesh.setMatrixAt(it.index, _m);
    it.mesh.instanceMatrix.needsUpdate = true;
  }

  kick(it, vx, vy, vz, spin) {
    it.vx = vx; it.vy = vy; it.vz = vz;
    it.wx = (Math.random() - 0.5) * spin; it.wy = (Math.random() - 0.5) * spin; it.wz = (Math.random() - 0.5) * spin;
    it.tipped = true;
    it.quiet = 0;
    if (!it.moving) { it.moving = true; this.awake.push(it); }
  }

  /**
   * Cars plough through props; returns nothing but slows the car a touch.
   * `onHit(prop, speed)` lets the caller play sounds and spray particles.
   */
  hitByCars(cars, onHit) {
    for (let c = 0; c < cars.length; c++) {
      const car = cars[c];
      const speed = Math.hypot(car.vx, car.vz);
      if (speed < 0.6) continue;
      const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
      const hl = car.spec.len / 2, hw = car.spec.width / 2;
      const reach = hl + 1.2;
      for (let i = 0; i < this.items.length; i++) {
        const it = this.items[i];
        const dx = it.x - car.x, dz = it.z - car.z;
        if (dx > reach || dx < -reach || dz > reach || dz < -reach) continue;
        if (it.y - car.y > 1.3 || car.y - it.y > 1.2) continue;
        const lz = dx * sin + dz * cos, lx = -dx * cos + dz * sin;
        if (Math.abs(lz) > hl + it.k.r || Math.abs(lx) > hw + it.k.r) continue;
        const rel = Math.hypot(car.vx - it.vx, car.vz - it.vz);
        if (rel < 1) continue;
        const side = (lx / (hw + 0.3)) * 2.5;
        this.kick(it,
          car.vx * (1.05 + Math.random() * 0.3) + -cos * side, Math.min(7.5, 1.6 + rel * 0.22), car.vz * (1.05 + Math.random() * 0.3) + sin * side,
          Math.min(16, rel * 1.2));
        const drag = it.k.heavy ? 0.93 : 0.985;
        car.vx *= drag; car.vz *= drag;
        if (it.kind === 'hydrant' && !it.burst && rel > 4) {
          it.burst = true;
          this.geysers.push({ x: it.x, y: it.y, z: it.z, t: 26 });
        }
        if (onHit) onHit(it, rel, car);
      }
    }
  }

  /** The walking player shoves light props and is stopped by heavy ones. */
  hitByWalker(x, z, r, vx, vz, feet, out) {
    out.x = x; out.z = z;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const dx = out.x - it.x, dz = out.z - it.z;
      const rr = r + it.k.r;
      if (dx > rr || dx < -rr || dz > rr || dz < -rr) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 > rr * rr || feet > it.y + 0.9) continue;
      const d = Math.sqrt(d2) || 0.001;
      if (it.k.heavy && !it.tipped) {
        out.x = it.x + (dx / d) * rr; out.z = it.z + (dz / d) * rr;
      } else if (!it.moving || Math.hypot(it.vx, it.vz) < 1) {
        const push = it.kind === 'ball' ? 1.9 : 0.8;
        const sp = Math.hypot(vx, vz);
        this.kick(it, -dx / d * (1 + sp * push), it.kind === 'ball' ? 2.5 + sp * 0.5 : 1.2, -dz / d * (1 + sp * push), 5);
      }
    }
  }

  update(dt, fx) {
    for (let i = this.awake.length - 1; i >= 0; i--) {
      const it = this.awake[i];
      it.vy -= 16 * dt;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      if (colliders.resolve(it.x, it.z, it.k.r, it.y, _hit)) {
        const vn = it.vx * _hit.nx + it.vz * _hit.nz;
        if (vn < 0) { it.vx -= 1.5 * vn * _hit.nx; it.vz -= 1.5 * vn * _hit.nz; }
        it.x = _hit.x; it.z = _hit.z;
      }
      const floor = groundHeight(it.x, it.z) + it.k.rest;
      if (it.y < floor) {
        it.y = floor;
        if (it.vy < -1.2) it.vy = -it.vy * it.k.bounce; else it.vy = 0;
        const f = Math.max(0, 1 - 5 * dt);
        it.vx *= f; it.vz *= f;
        const wf = Math.max(0, 1 - 4 * dt);
        it.wx *= wf; it.wy *= wf; it.wz *= wf;
      }
      const w = Math.hypot(it.wx, it.wy, it.wz);
      if (w > 0.01) {
        _q.setFromAxisAngle(_axis.set(it.wx / w, it.wy / w, it.wz / w), w * dt);
        it.q.premultiply(_q);
      }
      this.write(it);
      const slow = Math.abs(it.vx) + Math.abs(it.vz) + Math.abs(it.vy) < 0.25 && it.y <= floor + 0.01;
      it.quiet = slow ? it.quiet + dt : 0;
      if (it.quiet > 0.4 || it.y < -30) {
        it.moving = false; it.vx = it.vy = it.vz = 0;
        this.awake.splice(i, 1);
      }
    }
    for (let i = this.geysers.length - 1; i >= 0; i--) {
      const g = this.geysers[i];
      g.t -= dt;
      if (g.t <= 0) { this.geysers.splice(i, 1); continue; }
      const power = Math.min(1, g.t / 4);
      for (let k = 0; k < 4; k++) {
        fx.emit(g.x, g.y + 0.2, g.z, (Math.random() - 0.5) * 1.6, (9 + Math.random() * 4) * power, (Math.random() - 0.5) * 1.6, 1.7, 0.3, 0.5, 0.8, 0.9, 1, 0.5, 12, 0.3);
      }
    }
  }
}

export const props = new PropSystem();
