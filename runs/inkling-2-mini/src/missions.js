import * as THREE from '../vendor/three.module.js';
import { ROADS, ROAD_HALF } from './world.js';

const pickupPoints = [];
const dropPoints = [];

function randomBlockPoint(world) {
  // keep targets away from the spawn vicinity so the first delivery is doable
  for (let attempt = 0; attempt < 50; attempt++) {
    const i = Math.floor(Math.random() * 4);
    const j = Math.floor(Math.random() * 4);
    const xMin = ROADS[i] + ROAD_HALF + 4;
    const xMax = ROADS[i + 1] - ROAD_HALF - 4;
    const zMin = ROADS[j] + ROAD_HALF + 4;
    const zMax = ROADS[j + 1] - ROAD_HALF - 4;
    const x = xMin + Math.random() * (xMax - xMin);
    const z = zMin + Math.random() * (zMax - zMin);
    const spawnDist = Math.hypot(x - 5.5, z - (-40));
    if (spawnDist < 28) continue;
    if (world) {
      // avoid points inside collider volumes
      let bad = false;
      for (const b of world.boxColliders) {
        if (x > b.minX - 1.2 && x < b.maxX + 1.2 && z > b.minZ - 1.2 && z < b.maxZ + 1.2) { bad = true; break; }
      }
      if (!bad) {
        for (const c of world.circleColliders) {
          if (Math.hypot(x - c.x, z - c.z) < c.r + 1.4) { bad = true; break; }
        }
      }
      if (bad) continue;
    }
    return { x, z };
  }
  return { x: 120, z: 60 };
}

export class MissionManager {
  constructor(world = null) {
    this.phase = 'pickup';
    this.score = 0;
    this.deliveries = 0;
    this.world = world;
    this.pickup = randomBlockPoint(world);
    this.drop = randomBlockPoint(world);
    this.flash = 0;
    this.beaconMesh = null;
    this.beaconBeam = null;
    this.beaconLight = null;
  }

  target() {
    return this.phase === 'pickup' ? this.pickup : this.drop;
  }

  setupBeacon(scene) {
    const beacon = new THREE.Group();
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.9, 34, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false })
    );
    beam.position.y = 17;
    const mat = new THREE.MeshStandardMaterial({ color: '#ffe27a', emissive: new THREE.Color('#ffce54'), emissiveIntensity: 2.2, roughness: 0.4 });
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), mat);
    gem.position.y = 2.4;
    beacon.add(beam, gem);
    this.beaconBeam = beam; this.beaconGem = gem; this.beaconMesh = beacon;
    scene.add(beacon);
    this.beaconMesh.position.set(this.pickup.x, 0, this.pickup.z);
    return beacon;
  }

  update(dt, playerPos, fx) {
    const t = this.target();
    const dx = t.x - playerPos.x, dz = t.z - playerPos.z;
    const dist = Math.hypot(dx, dz);
    // animate beacon
    if (this.beaconGem) {
      this.beaconGem.rotation.y += dt * 2.2;
      this.beaconGem.position.y = 2.4 + Math.sin(performance.now() / 260) * 0.35;
      this.beaconBeam.material.opacity = 0.28 + Math.sin(performance.now() / 380) * 0.12;
    }
    if (this.beaconMesh) this.beaconMesh.position.set(t.x, 0, t.z);

    this.flash = Math.max(0, this.flash - dt);
    if (dist < 3.2) {
      if (this.phase === 'pickup') {
        this.phase = 'carry';
        this.drop = randomBlockPoint(this.world);
        fx && fx.chime(1);
        this.flash = 1.4;
        return { kind: 'pickup', newDrop: this.drop };
      } else {
        this.deliveries++;
        this.score += 250;
        fx && fx.chime(2);
        this.flash = 1.6;
        this.phase = 'pickup';
        this.pickup = randomBlockPoint(this.world);
        this.drop = randomBlockPoint(this.world);
        return { kind: 'deliver', score: this.score };
      }
    }
    return null;
  }

  describe() {
    if (this.phase === 'pickup') return 'Pick up the package';
    return 'Deliver to the golden beacon';
  }

  distanceText(playerPos) {
    const t = this.target();
    const d = Math.hypot(t.x - playerPos.x, t.z - playerPos.z);
    return `${Math.round(d)} m`;
  }
}
