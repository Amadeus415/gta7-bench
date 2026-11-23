import * as THREE from '../vendor/three.module.js';
import { pushOutOfBoxes, pushOutOfCircles, clampToWorld } from './physics.js';

const bodyGeomCache = new Map();
const wheelGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 14);
wheelGeom.rotateZ(Math.PI / 2); // axis along x

export function makeCarMesh(color, opts = {}) {
  const group = new THREE.Group();
  const bodyColor = new THREE.Color(color);
  const mat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.32, metalness: 0.55 });
  const glassMat = new THREE.MeshStandardMaterial({ color: '#1b2733', roughness: 0.08, metalness: 0.9 });
  const trimMat = new THREE.MeshStandardMaterial({ color: '#22252b', roughness: 0.8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 4.3), mat);
  body.position.y = 0.58; body.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.62, 0.44, 1.95), mat);
  cabin.position.set(0, 1.02, -0.25); cabin.castShadow = true;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.36, 1.75), glassMat);
  glass.position.set(0, 1.05, -0.25);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.34, 0.35), trimMat);
  nose.position.set(0, 0.5, 2.12);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.34, 0.22), trimMat);
  tail.position.set(0, 0.5, -2.12);

  const headMat = new THREE.MeshStandardMaterial({ color: '#fff3c8', emissive: new THREE.Color('#ffe9a3'), emissiveIntensity: 0.5 });
  const headL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), headMat);
  headL.position.set(-0.58, 0.62, 2.16);
  const headR = headL.clone(); headR.position.x = 0.58;
  const tailMat = new THREE.MeshStandardMaterial({ color: '#7d1b1b', emissive: new THREE.Color('#e03428'), emissiveIntensity: 0.7 });
  const tailL = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), tailMat);
  tailL.position.set(-0.62, 0.62, -2.16);
  const tailR = tailL.clone(); tailR.position.x = 0.62;

  const wheels = [];
  const wheelMat = new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.85 });
  const hubMat = new THREE.MeshStandardMaterial({ color: '#9aa1ab', roughness: 0.3, metalness: 0.8 });
  for (const [wx, wz, front] of [[-0.95, 1.42, true], [0.95, 1.42, true], [-0.95, -1.42, false], [0.95, -1.42, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Mesh(wheelGeom, wheelMat);
    wheel.castShadow = true;
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.32, 10), hubMat);
    hub.rotation.z = Math.PI / 2;
    wheel.add(hub);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push({ pivot, wheel, front });
  }

  group.add(body, cabin, glass, nose, tail, headL, headR, tailL, tailR);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });

  return { group, wheels, headMat, tailMat };
}

export class Vehicle {
  constructor(color, opts = {}) {
    this.name = opts.name || 'car';
    this.enterable = opts.enterable !== false;
    this.group = new THREE.Group();
    const mesh = makeCarMesh(color, opts);
    this.group.add(mesh.group);
    this.wheels = mesh.wheels;
    this.headlightMat = mesh.headMat;
    this.tailMat = mesh.tailMat;
    this.color = color;

    this.x = opts.x || 0;
    this.z = opts.z || 0;
    this.heading = opts.heading || 0;
    this.speed = 0;
    this.steer = 0;
    this.wheelBase = 2.6;
    this.maxSpeed = 34;
    this.maxReverse = 9;
    this.accel = 15;
    this.brakeForce = 26;
    this.radius = 1.85;
    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;
    this.flash = 0;      // hit flash timer
    this.lastHit = 0;
  }

  setPosition(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.speed = 0; this.steer = 0;
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
  }

  get forward() { return { x: Math.sin(this.heading), z: Math.cos(this.heading) }; }
  get right() { return { x: Math.cos(this.heading), z: -Math.sin(this.heading) }; }

  update(dt, input, world, fx) {
    const maxSteer = 0.46 / (1 + Math.abs(this.speed) * 0.052);
    const targetSteer = input.steer * maxSteer;
    this.steer = THREE.MathUtils.damp(this.steer, targetSteer, 9, dt);

    const fwd = this.speed >= 0 ? 1 : -1;
    if (input.throttle > 0 && this.speed < this.maxSpeed) {
      this.speed += this.accel * input.throttle * (1 - Math.abs(this.speed) / this.maxSpeed) * dt;
    } else if (input.throttle < 0) {
      if (this.speed > 0.4) {
        this.speed -= this.brakeForce * dt; // braking
      } else {
        this.speed = Math.max(this.speed - this.accel * 0.62 * dt, -this.maxReverse); // reverse
      }
    } else {
      // coast drag
      const drag = 1.9 + Math.abs(this.speed) * 0.06;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), drag * dt);
    }
    if (input.handbrake) {
      const hb = 17 + Math.abs(this.speed) * 0.9;
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), hb * dt);
    }

    // yaw
    const yawMax = 1.55;
    const yaw = (this.speed / this.wheelBase) * Math.tan(this.steer);
    const steerClamped = Math.max(-yawMax, Math.min(yawMax, yaw)) * fwd;
    this.heading += steerClamped * dt;

    // integrate
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.z += Math.cos(this.heading) * this.speed * dt;

    // collisions
    this.flash = Math.max(0, this.flash - dt);
    const pos = { x: this.x, z: this.z };
    let hit = false;
    hit = pushOutOfBoxes(pos, this.radius, world.boxColliders) || hit;
    hit = pushOutOfCircles(pos, this.radius, world.circleColliders) || hit;
    hit = clampToWorld(pos, 165) || hit;
    if (hit) {
      const impact = Math.abs(this.speed);
      this.x = pos.x; this.z = pos.z;
      if (impact > 3.5 && this.lastHit <= 0) {
        fx && fx.thud(Math.min(impact / 20, 1));
        this.flash = 0.35;
        this.lastHit = 0.5;
      }
      this.speed *= impact > 3.5 ? -0.22 : 0.55;
      if (impact <= 3.5) this.speed *= 0.8;
    }
    this.lastHit = Math.max(0, this.lastHit - dt);

    this.group.position.set(this.x, 0, this.z);
    this.group.rotation.y = this.heading;

    // visual: wheels
    const r = 0.36;
    const spin = (this.speed * dt) / r;
    for (const w of this.wheels) {
      w.wheel.rotation.x += spin;
      if (w.front) w.pivot.rotation.y = this.steer * 1.25;
    }
    // body pitch/roll
    this.group.rotation.z = THREE.MathUtils.damp(this.group.rotation.z, -this.steer * this.speed * 0.0045, 8, dt);
    this.group.rotation.x = THREE.MathUtils.damp(this.group.rotation.x, this.speed * 0.0018, 6, dt);

    return Math.abs(this.speed);
  }
}
