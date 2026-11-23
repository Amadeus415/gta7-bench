import * as THREE from '../vendor/three.module.js';
import { pushOutOfBoxes, pushOutOfCircles, clampToWorld } from './physics.js';

const defaultPalette = {
  skin: '#d9a277',
  jacket: '#2f8f7a',
  pants: '#2c3140',
  shoes: '#22242c',
  cap: '#173e38',
};

export function makeCharacter(palette = defaultPalette) {
  const mat = (color, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const group = new THREE.Group();
  const mats = {
    skin: mat(palette.skin, 0.7),
    jacket: mat(palette.jacket, 0.8),
    pants: mat(palette.pants, 0.85),
    shoes: mat(palette.shoes, 0.6),
    cap: mat(palette.cap, 0.8),
  };

  const hips = new THREE.Group(); hips.position.y = 0.98; group.add(hips);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.56, 0.28), mats.jacket);
  torso.position.y = 0.30; torso.castShadow = true; hips.add(torso);

  const legL = new THREE.Group(); legL.position.set(-0.13, 0, 0); hips.add(legL);
  const legLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.86, 0.24), mats.pants);
  legLMesh.position.y = -0.44; legLMesh.castShadow = true; legL.add(legLMesh);
  const shoeL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.34), mats.shoes);
  shoeL.position.set(0, -0.82, 0.05); legL.add(shoeL);

  const legR = new THREE.Group(); legR.position.set(0.13, 0, 0); hips.add(legR);
  const legRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.86, 0.24), mats.pants);
  legRMesh.position.y = -0.44; legRMesh.castShadow = true; legR.add(legRMesh);
  const shoeR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.13, 0.34), mats.shoes);
  shoeR.position.set(0, -0.82, 0.05); legR.add(shoeR);

  const shoulderL = new THREE.Group(); shoulderL.position.set(-0.30, 0.52, 0); hips.add(shoulderL);
  const armLMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.18), mats.jacket);
  armLMesh.position.y = -0.24; armLMesh.castShadow = true; shoulderL.add(armLMesh);
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.15), mats.skin);
  handL.position.y = -0.55; shoulderL.add(handL);

  const shoulderR = new THREE.Group(); shoulderR.position.set(0.30, 0.52, 0); hips.add(shoulderR);
  const armRMesh = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.55, 0.18), mats.jacket);
  armRMesh.position.y = -0.24; armRMesh.castShadow = true; shoulderR.add(armRMesh);
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.15), mats.skin);
  handR.position.y = -0.55; shoulderR.add(handR);

  const head = new THREE.Group(); head.position.set(0, 0.62, 0); hips.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), mats.skin);
  skull.position.y = 0.13; skull.castShadow = true; head.add(skull);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.24, 0.13, 12), mats.cap);
  cap.position.y = 0.27; head.add(cap);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.04, 0.22), mats.cap);
  brim.position.set(0, 0.24, 0.24); head.add(brim);

  const parts = { group, hips, torso, legL, legR, shoulderL, shoulderR, head, cap };
  return parts;
}

export class Character {
  constructor(x, z, heading = 0, palette) {
    const parts = makeCharacter(palette);
    this.parts = parts;
    this.group = parts.group;
    this.x = x; this.z = z;
    this.heading = heading;
    this.vy = 0;
    this.airY = 0;
    this.grounded = true;
    this.phase = 0;
    this.speed = 0;
    this.radius = 0.42;
    this.walkSpeed = 4.4;
    this.runSpeed = 7.4;
    this.turnRate = 3.1;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
  }

  setPos(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.group.position.set(x, this.group.position.y, z);
    this.group.rotation.y = heading;
  }

  jump() {
    if (this.grounded) {
      this.vy = 7.6; this.grounded = false;
    }
  }

  update(dt, input, world, fx) {
    // turn
    if (input.left) this.heading -= this.turnRate * dt;
    if (input.right) this.heading += this.turnRate * dt;

    // move
    const wantSpeed = input.run ? this.runSpeed : this.walkSpeed;
    let move = 0;
    if (input.forward) move += 1;
    if (input.back) move -= 0.75;
    const target = move * wantSpeed;
    this.speed = THREE.MathUtils.damp(this.speed, target, 10, dt);
    const fx2 = Math.sin(this.heading), fz = Math.cos(this.heading);
    this.x += fx2 * this.speed * dt;
    this.z += fz * this.speed * dt;

    // gravity
    if (!this.grounded) {
      this.airY += this.vy * dt;
      this.vy -= 22 * dt;
      const ground = world.groundHeight(this.x, this.z);
      if (this.airY <= 0) { this.airY = 0; this.grounded = true; this.vy = 0; }
    }
    const ground = world.groundHeight(this.x, this.z);
    const feetY = ground + this.airY;

    // collisions
    const pos = { x: this.x, z: this.z };
    pushOutOfBoxes(pos, this.radius, world.boxColliders);
    pushOutOfCircles(pos, this.radius, world.circleColliders);
    clampToWorld(pos, 162);
    this.x = pos.x; this.z = pos.z;

    // animation
    const speedAbs = Math.abs(this.speed);
    this.phase += dt * (4 + speedAbs * 2.1) * Math.min(1, speedAbs / 2);
    const moveAmount = Math.min(1, speedAbs / 4.5);
    this.animate(moveAmount, ground, dt);

    this.group.position.set(this.x, feetY, this.z);
    this.group.rotation.y = this.heading;

    return speedAbs;
  }

  animate(moveAmount, ground, dt) {
    const p = this.parts;
    const swing = moveAmount * 0.62;
    const s = Math.sin(this.phase);
    const t = performance.now() / 1000;
    if (!this.grounded && this.airY > 0.05) {
      // jump pose
      p.legL.rotation.x = 0.5; p.legR.rotation.x = -0.35;
      p.shoulderL.rotation.x = -2.6; p.shoulderR.rotation.x = -2.6;
      p.torso.rotation.x = -0.12;
    } else {
      p.legL.rotation.x = s * swing;
      p.legR.rotation.x = -s * swing;
      p.shoulderL.rotation.x = -s * swing * 0.85;
      p.shoulderR.rotation.x = s * swing * 0.85;
      p.torso.rotation.x = moveAmount * 0.1;
    }
    // idle breathing
    if (moveAmount < 0.05 && this.grounded) {
      p.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.018;
      p.head.rotation.y = Math.sin(t * 0.7) * 0.15;
    } else {
      p.torso.scale.y = 1;
    }
    this.group.rotation.y = this.heading;
    if (fxSound) fxSound.footstep(this.phase, moveAmount);
  }
}

// footstep audio callback (set from main.js)
let fxSound = null;
export function setFootstepHook(fn) { fxSound = fn; }
