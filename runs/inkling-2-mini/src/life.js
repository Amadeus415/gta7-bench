import * as THREE from '../vendor/three.module.js';
import { ROADS, ROAD_HALF, SLAB_H } from './world.js';
import { makeCharacter } from './player.js';
import { makeCarMesh } from './vehicle.js';
import { pushOutOfBoxes, pushOutOfCircles, clampToWorld } from './physics.js';

// ------------------------------------------------------------------ traffic
const TRAFFIC_LANES = [
  { axis: 'x', road: -56, dir: 1, color: '#b8c4cf' },
  { axis: 'x', road: -112, dir: 1, color: '#e0cf8a' },
  { axis: 'x', road: 112, dir: -1, color: '#8fbf9a' },
  { axis: 'z', road: 112, dir: 1, color: '#c98a8a' },
];

export class TrafficCar {
  constructor(def, scene) {
    this.axis = def.axis;
    this.road = def.road;
    this.dir = def.dir;
    this.speed = 14;
    this.heading = def.axis === 'x' ? (def.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (def.dir > 0 ? 0 : Math.PI);
    this.steer = 0;
    this.group = new THREE.Group();
    const mesh = makeCarMesh(def.color, { headlight: true });
    this.group.add(mesh.group);
    this.tailMat = mesh.tailMat;
    this.headMat = mesh.headMat;
    const laneOff = 3.6 * def.dir * (def.axis === 'x' ? 1 : 1);
    if (def.axis === 'x') {
      // heading +x: right = (0,0,-1); right lane = road - 3.6 for +x dir
      this.z = def.road - (3.6 * def.dir);
      this.x = -130 + Math.random() * 260;
    } else {
      // heading +z: right = (1,0,0); right lane = road + 3.6
      this.x = def.road + 3.6 * def.dir;
      this.z = -130 + Math.random() * 260;
    }
    this.speed = 12 + Math.random() * 6;
    this.baseSpeed = this.speed;
    this.steer = 0;
    this.targetX = this.x; this.targetZ = this.z;
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
    this.wheels = mesh.wheels;
    this.scene = scene;
    scene.add(this.group);
    this.updateLegHeading();
  }

  axisOf() { return this.axis; }

  updateLegHeading() {
    // ahead-point on the current road to steer toward
    if (this.axis === 'x') {
      const aheadZ = this.axis === 'x' ? this.z : 0;
      // target along x on current lane
      this.targetX = this.x + this.dir * 14;
      this.targetZ = this.z;
    } else {
      this.targetX = this.x;
      this.targetZ = this.z + this.dir * 14;
    }
  }

  chooseNextLeg() {
    // at intersection-ish position: keep heading (grid roads are straight)
    if (this.axis === 'x') {
      if (this.x > 120) { this.dir *= -1; this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2; this.z = this.road - 3.6 * this.dir; }
      if (this.x < -120) { this.dir *= -1; this.heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2; this.z = this.road - 3.6 * this.dir; }
    } else {
      if (this.z > 120) { this.dir *= -1; this.heading = this.dir > 0 ? 0 : Math.PI; this.x = this.road + 3.6 * this.dir; }
      if (this.z < -120) { this.dir *= -1; this.heading = this.dir > 0 ? 0 : Math.PI; this.x = this.road + 3.6 * this.dir; }
    }
    this.updateLegHeading();
  }

  update(dt, world, playerPos, playerMode) {
    this.chooseNextLeg();

    // yield to player
    let desired = this.baseSpeed;
    if (playerPos) {
      const dx = playerPos.x - this.x, dz = playerPos.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d < 13) desired = Math.min(desired, 5);
    }
    this.speed = THREE.MathUtils.damp(this.speed, desired, 1.6, dt);

    const dx = this.targetX - this.x, dz = this.targetZ - this.z;
    const desiredHeading = Math.atan2(dx, dz);
    let diff = desiredHeading - this.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const maxTurn = 1.8 * dt;
    this.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));

    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;

    for (const w of this.wheels) {
      w.wheel.rotation.x += (this.speed * dt) / 0.36;
      if (w.front) w.pivot.rotation.y = this.steer;
    }

    // player interaction: push player away gently if colliding (foot mode only)
    if (playerPos && playerMode === 'foot') {
      const dx2 = playerPos.x - this.x, dz2 = playerPos.z - this.z;
      const d2 = Math.hypot(dx2, dz2);
      const minD = 3.3;
      if (d2 < minD && d2 > 0.01) {
        const push = (minD - d2) * 0.5;
        playerPos.x += (dx2 / d2) * push;
        playerPos.z += (dz2 / d2) * push;
      }
    }

    this.updateLegHeading();
    return this.speed;
  }
}

// ------------------------------------------------------------- pedestrians
const pedPalettes = [
  { skin: '#d9a277', jacket: '#7d4f9a', pants: '#2c3140', shoes: '#22242c', cap: '#432a55' },
  { skin: '#a06b42', jacket: '#c44e4e', pants: '#24303f', shoes: '#1c1e26', cap: '#6b2626' },
  { skin: '#e8c39a', jacket: '#3f6ea5', pants: '#3a3a30', shoes: '#23262e', cap: '#23405e' },
  { skin: '#b98a5e', jacket: '#d08b3e', pants: '#30363f', shoes: '#1f222a', cap: '#7d4d20' },
  { skin: '#8a5a3a', jacket: '#5a8f4f', pants: '#33302c', shoes: '#20232b', cap: '#2d4d28' },
  { skin: '#e0b18c', jacket: '#c4b23e', pants: '#2a3038', shoes: '#23262e', cap: '#5c5420' },
];

export class Pedestrian {
  constructor(lane, palette, group) {
    this.lane = lane; // { axis:'x'|'z', fixed, from, to, dir, speed, offsetSide }
    const parts = makeCharacter(palette);
    this.group = parts.group;
    this.hips = parts.hips; this.legL = parts.legL; this.legR = parts.legR;
    this.shoulderL = parts.shoulderL; this.shoulderR = parts.shoulderR;
    this.torso = parts.torso; this.head = parts.head;
    const [from, to] = lane.from < lane.to ? [lane.from, lane.to] : [lane.to, lane.from];
    this.pos = from + Math.random() * (to - from);
    this.speed = 1.1 + Math.random() * 0.7;
    this.heading = 0;
    this.phase = Math.random() * 6;
    this.dir = Math.random() < 0.5 ? 1 : -1;
    group.add(this.group);
    this.updateTransform();
  }

  updateTransform() {
    const lane = this.lane;
    let x, z, heading;
    if (lane.axis === 'z') {
      x = lane.fixed + lane.side * 1.9;
      z = this.pos;
      heading = this.dir > 0 ? 0 : Math.PI;
    } else {
      x = this.pos;
      z = lane.fixed + lane.side * 1.9;
      heading = this.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    this.group.position.set(x, SLAB_H, z);
    this.group.rotation.y = heading;
  }

  update(dt, playerPos) {
    const lane = this.lane;
    const from = lane.from, to = lane.to;
    this.pos += this.dir * this.speed * dt;
    if (this.pos > Math.max(from, to)) { this.pos = Math.max(from, to); this.dir = -1; }
    if (this.pos < Math.min(from, to)) { this.pos = Math.min(from, to); this.dir = 1; }
    this.phase += dt * this.speed * 3.4;
    const swing = 0.5;
    const s = Math.sin(this.phase);
    this.legL.rotation.x = s * swing;
    this.legR.rotation.x = -s * swing;
    this.shoulderL.rotation.x = -s * swing * 0.8;
    this.shoulderR.rotation.x = s * swing * 0.8;
    this.torso.rotation.x = 0.08;
    this.updateTransform();
  }
}

// lane generation: pick a block edge lane, avoid spawn vicinity
function buildPedestrianLanes() {
  const lanes = [];
  for (const i of [0, 1, 2, 3]) {
    for (const j of [0, 1, 2, 3]) {
      if (i === 2 && j === 1) continue;             // spawn block
      const xMin = ROADS[i] + ROAD_HALF + 1.2;
      const xMax = ROADS[i + 1] - ROAD_HALF - 1.2;
      const zMin = ROADS[j] + ROAD_HALF + 1.2;
      const zMax = ROADS[j + 1] - ROAD_HALF - 1.2;
      const vert = Math.random() < 0.5;
      if (vert) {
        const side = Math.random() < 0.5 ? 1 : -1;
        const x = side > 0 ? xMin + 0.4 : xMax - 0.4;
        lanes.push({ axis: 'z', fixed: x, side: 0, from: zMin + 2, to: zMax - 2 });
      } else {
        const side = Math.random() < 0.5 ? 1 : -1;
        const z = side > 0 ? zMin + 0.4 : zMax - 0.4;
        lanes.push({ axis: 'x', fixed: z, side: 0, from: xMin + 2, to: xMax - 2 });
      }
    }
  }
  return lanes;
}

export function initLife(scene) {
  const traffic = TRAFFIC_LANES.map((def) => new TrafficCar(def, scene));
  const lanes = buildPedestrianLanes();
  const peds = [];
  const palettes = [...pedPalettes];
  for (let i = 0; i < 9; i++) {
    const idx = Math.floor(Math.random() * lanes.length);
    const lane = lanes.splice(idx, 1)[0];
    const palette = palettes.splice(Math.floor(Math.random() * palettes.length), 1)[0];
    peds.push(new Pedestrian(lane, palette, scene));
  }
  return { traffic, peds, group: null };
}

export function updateLife(life, dt, world, playerPos, playerMode) {
  for (const t of life.traffic) t.update(dt, world, playerPos, playerMode);
  for (const p of life.peds) p.update(dt, playerPos);
}

export { SLAB_H };
