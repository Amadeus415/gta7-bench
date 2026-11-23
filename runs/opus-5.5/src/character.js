import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from './util.js';

// A jointed low-poly person: hips, spine, head, two-part arms and legs.
// Faces +z in local space; the root sits at the feet.

const box = (w, h, d, oy = 0, oz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, oy, oz);
  return g;
};
const GEO = {
  pelvis: box(0.36, 0.2, 0.22),
  torso: box(0.42, 0.56, 0.24, 0.3),
  thigh: box(0.16, 0.46, 0.18, -0.23),
  shin: box(0.14, 0.44, 0.16, -0.22),
  shoe: box(0.15, 0.09, 0.27, -0.47, 0.05),
  upper: box(0.12, 0.31, 0.13, -0.15),
  fore: box(0.11, 0.28, 0.11, -0.14),
  hand: box(0.09, 0.1, 0.1, -0.32),
  neck: box(0.1, 0.1, 0.1, 0.03),
  head: new THREE.SphereGeometry(0.13, 12, 10).translate(0, 0.16, 0),
  hair: new THREE.SphereGeometry(0.14, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 0.18, -0.01),
  cap: new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12).translate(0, 0.26, 0.02),
};

const matCache = new Map();
function m(hex) {
  let mt = matCache.get(hex);
  if (!mt) {
    mt = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.8 });
    matCache.set(hex, mt);
  }
  return mt;
}

const SKIN = [0xf1c9a5, 0xd9a47c, 0xa8714a, 0x7a4b2c, 0xe8b894, 0x5c3a24];
const SHIRT = [0xd64545, 0x3f7fd6, 0x45a868, 0xe0b23a, 0x8a55c8, 0xeeeeee, 0x333a44, 0xe07a3a, 0x2fa3a3, 0xc94f8a];
const PANTS = [0x2b3a55, 0x3a3a3a, 0x6b5a45, 0x1f2a36, 0x7a7f86, 0x4a3b2e];
const HAIR = [0x1d1510, 0x4a3020, 0x8a6a3a, 0xd8c08a, 0x222222, 0x9a3a1a, 0xcccccc];

export function randomLook(r) {
  return {
    skin: r.pick(SKIN), shirt: r.pick(SHIRT), pants: r.pick(PANTS), hair: r.pick(HAIR),
    shoes: r.pick([0x222222, 0xeeeeee, 0x5a3a20]), cap: r() < 0.2 ? r.pick(SHIRT) : null,
    scale: 0.92 + r() * 0.14,
  };
}

export class Character {
  constructor(look) {
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const mesh = (g, hex, parent) => {
      const me = new THREE.Mesh(g, m(hex));
      me.castShadow = true;
      parent.add(me);
      return me;
    };
    this.hips = new THREE.Group();
    this.hips.position.y = 0.98;
    this.body.add(this.hips);
    mesh(GEO.pelvis, look.pants, this.hips);

    this.spine = new THREE.Group();
    this.spine.position.y = 0.08;
    this.hips.add(this.spine);
    mesh(GEO.torso, look.shirt, this.spine);

    this.neck = new THREE.Group();
    this.neck.position.y = 0.6;
    this.spine.add(this.neck);
    mesh(GEO.neck, look.skin, this.neck);
    mesh(GEO.head, look.skin, this.neck);
    mesh(GEO.hair, look.hair, this.neck);
    if (look.cap) mesh(GEO.cap, look.cap, this.neck);

    const limb = (side) => {
      const leg = new THREE.Group();
      leg.position.set(side * 0.1, -0.04, 0);
      this.hips.add(leg);
      mesh(GEO.thigh, look.pants, leg);
      const knee = new THREE.Group();
      knee.position.y = -0.46;
      leg.add(knee);
      mesh(GEO.shin, look.pants, knee);
      mesh(GEO.shoe, look.shoes, knee);
      const arm = new THREE.Group();
      arm.position.set(side * 0.28, 0.54, 0);
      this.spine.add(arm);
      mesh(GEO.upper, look.shirt, arm);
      const elbow = new THREE.Group();
      elbow.position.y = -0.31;
      arm.add(elbow);
      mesh(GEO.fore, look.skin, elbow);
      mesh(GEO.hand, look.skin, elbow);
      return { leg, knee, arm, elbow };
    };
    this.L = limb(1);
    this.R = limb(-1);
    this.root.scale.setScalar(look.scale ?? 1);
    this.phase = Math.random() * 6;
    this.air = 0;
    this.down = 0;
  }

  /**
   * speed: ground speed in m/s. state: 'move' | 'air' | 'down' | 'sit'.
   */
  animate(dt, speed, state = 'move') {
    const { L, R } = this;
    if (state === 'down') {
      this.down = Math.min(1, this.down + dt * 4);
    } else {
      this.down = Math.max(0, this.down - dt * 2.5);
    }
    this.body.rotation.x = -this.down * Math.PI * 0.5;
    this.body.position.y = this.down * 0.15;
    this.body.position.z = this.down * 0.8;

    if (state === 'sit') {
      L.leg.rotation.x = R.leg.rotation.x = -1.5;
      L.knee.rotation.x = R.knee.rotation.x = 1.5;
      L.arm.rotation.x = R.arm.rotation.x = -0.9;
      L.elbow.rotation.x = R.elbow.rotation.x = -0.4;
      this.hips.position.y = 0.55;
      this.spine.rotation.x = 0;
      return;
    }
    if (state === 'air') this.air = Math.min(1, this.air + dt * 6);
    else this.air = Math.max(0, this.air - dt * 8);

    const run = clamp((speed - 2) / 4, 0, 1);
    const moving = speed > 0.15 ? 1 : 0;
    this.phase += dt * (moving ? 3.2 + speed * 1.5 : 0);
    const amp = moving * lerp(0.45, 0.95, run);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const a = this.air;
    L.leg.rotation.x = lerp(-s * amp, -0.7, a);
    R.leg.rotation.x = lerp(s * amp, 0.2, a);
    L.knee.rotation.x = lerp(Math.max(0, c) * amp * 1.3 + 0.05, 1.1, a);
    R.knee.rotation.x = lerp(Math.max(0, -c) * amp * 1.3 + 0.05, 0.5, a);
    const armAmp = amp * (0.8 + run * 0.4);
    L.arm.rotation.x = lerp(s * armAmp, -2.4, a);
    R.arm.rotation.x = lerp(-s * armAmp, -2.4, a);
    L.arm.rotation.z = lerp(0.06, 0.3, a);
    R.arm.rotation.z = lerp(-0.06, -0.3, a);
    L.elbow.rotation.x = R.elbow.rotation.x = -(0.15 + run * 1.2) * (moving || a ? 1 : 0.3);
    this.hips.position.y = 0.98 + Math.abs(c) * 0.06 * amp - run * 0.04;
    this.spine.rotation.x = run * 0.22 * moving;
    this.neck.rotation.x = -run * 0.15 * moving;
  }
}
