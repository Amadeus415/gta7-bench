import * as THREE from '../vendor/three.module.js';
import { LINES, SLAB } from './world.js';
import { mat } from './util.js';

// Traffic signals at every junction. Each junction cycles north-south green,
// amber, east-west green, amber, with its own offset so the town isn't in sync.
const GREEN = 9, AMBER = 2.2, CYCLE = (GREEN + AMBER) * 2;

const ON = { r: new THREE.Color(0xff2a1a), y: new THREE.Color(0xffb000), g: new THREE.Color(0x30ff70) };
const OFF = { r: new THREE.Color(0x2a0806), y: new THREE.Color(0x2a1e04), g: new THREE.Color(0x062a10) };

export class TrafficLights {
  constructor(scene, world) {
    this.time = 0;
    this.offsets = [];
    for (let i = 0; i < 6; i++) {
      this.offsets.push([]);
      for (let j = 0; j < 6; j++) this.offsets[i].push(((i * 7 + j * 13) % 11) * 2.1);
    }
    // per pole: which axis it controls and the junction it belongs to
    this.heads = [];
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) {
        const x = LINES[i], z = LINES[j];
        for (const [sx, sz, axis] of [[1, 1, 'z'], [-1, -1, 'z'], [-1, 1, 'x'], [1, -1, 'x']]) {
          const px = x + sx * 7.9, pz = z + sz * 7.9;
          // only on corners that are real sidewalk (outer ring corners outside the city have none)
          if (Math.abs(px) > 175 || Math.abs(pz) > 175) continue;
          // the head faces traffic arriving along its axis from this side
          const face = axis === 'z' ? Math.atan2(0, sz) : Math.atan2(sx, 0);
          this.heads.push({ i, j, axis, x: px, z: pz, face });
          const c = world.addBox(px - 0.14, pz - 0.14, px + 0.14, pz + 0.14, 5);
          c.signal = true;
        }
      }
    }
    const n = this.heads.length;
    const poleGeo = new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6);
    poleGeo.translate(0, 2.1, 0);
    const boxGeo = new THREE.BoxGeometry(0.42, 1.15, 0.3);
    boxGeo.translate(0, 4.55, 0);
    const lensGeo = new THREE.CircleGeometry(0.13, 12);
    const metal = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.5 });
    const poles = new THREE.InstancedMesh(poleGeo, metal, n);
    const boxes = new THREE.InstancedMesh(boxGeo, metal, n);
    this.lens = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n * 3);
    const m = new THREE.Matrix4();
    this.heads.forEach((h, k) => {
      poles.setMatrixAt(k, mat(h.x, SLAB, h.z, h.face));
      boxes.setMatrixAt(k, mat(h.x, SLAB, h.z, h.face));
      ['r', 'y', 'g'].forEach((c, q) => {
        const y = SLAB + 4.55 + 0.34 - q * 0.34;
        m.copy(mat(h.x + Math.sin(h.face) * 0.16, y, h.z + Math.cos(h.face) * 0.16, h.face));
        this.lens.setMatrixAt(k * 3 + q, m);
        this.lens.setColorAt(k * 3 + q, OFF[c]);
      });
    });
    poles.castShadow = boxes.castShadow = true;
    scene.add(poles, boxes, this.lens);
    this.acc = 0;
  }

  /** 'g' | 'y' | 'r' for traffic moving along `axis` through junction (i,j). */
  state(i, j, axis) {
    const t = (this.time + this.offsets[i][j]) % CYCLE;
    const zPhase = t < GREEN ? 'g' : t < GREEN + AMBER ? 'y' : 'r';
    const xPhase = t < GREEN + AMBER ? 'r' : t < GREEN * 2 + AMBER ? 'g' : 'y';
    return axis === 'z' ? zPhase : xPhase;
  }

  update(dt) {
    this.time += dt;
    this.acc -= dt;
    if (this.acc > 0) return;
    this.acc = 0.2;
    this.heads.forEach((h, k) => {
      const s = this.state(h.i, h.j, h.axis);
      ['r', 'y', 'g'].forEach((c, q) => this.lens.setColorAt(k * 3 + q, s === c ? ON[c] : OFF[c]));
    });
    this.lens.instanceColor.needsUpdate = true;
  }

  /**
   * For a car at (x,z) heading h: distance to the stop line of the junction
   * ahead and whether it must stop there, or null when not approaching one.
   */
  check(x, z, h) {
    const sx = Math.sin(h), sz = Math.cos(h);
    let axis, along, lat, dir;
    if (Math.abs(sz) > 0.9) { axis = 'z'; along = z; lat = x; dir = Math.sign(sz); }
    else if (Math.abs(sx) > 0.9) { axis = 'x'; along = x; lat = z; dir = Math.sign(sx); }
    else return null;
    // which road line are we on?
    let li = -1;
    for (let k = 0; k < 6; k++) if (Math.abs(lat - LINES[k]) < 7) li = k;
    if (li < 0) return null;
    // next junction ahead
    let best = -1, bd = 1e9;
    for (let k = 0; k < 6; k++) {
      const d = (LINES[k] - along) * dir;
      if (d > 0 && d < bd) { bd = d; best = k; }
    }
    if (best < 0) return null;
    const stop = bd - 10.8;
    if (stop < -1.5 || stop > 30) return null;
    const i = axis === 'z' ? li : best, j = axis === 'z' ? best : li;
    const s = this.state(i, j, axis);
    const mustStop = s === 'r' || (s === 'y' && stop > 4);
    return { stop, mustStop };
  }
}
