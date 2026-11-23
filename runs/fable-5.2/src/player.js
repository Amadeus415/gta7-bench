// The player: walking, running, jumping, and getting in and out of cars.
import { clamp, damp } from './util.js';
import { groundHeight, colliders, WATER_Y } from './world.js';
import { Person } from './people.js';
import { props } from './props.js';

const RADIUS = 0.32;
const _hit = {};
const _pt = { x: 0, z: 0 };

const LOOK = {
  skin: 0xe0ac86, hair: 0x2a1c14, top: 0x2f6f73, bottom: 0x22283a, shoes: 0xf2f0ea,
  scale: 1.0, build: 1.05, longSleeve: true, hat: null, bag: null,
};

export class Player {
  constructor(scene, x, z, heading) {
    this.body = new Person(LOOK, true);
    scene.add(this.body.group);
    this.x = x; this.z = z; this.heading = heading;
    this.y = groundHeight(x, z);
    this.vy = 0;
    this.vel = 0; // signed speed along the heading
    this.sx = 0; this.sz = 0; // leftover momentum, e.g. from bailing out of a moving car
    this.grounded = true;
    this.mode = 'foot';
    this.car = null;
    this.speed = 0;
    this.stepPhase = 0;
    this.onStep = null; // callbacks set by the game
    this.onJump = null;
    this.onLand = null;
  }

  get down() { return this.body.down > 0; }

  /** Distance from the player to the nearest point of a car's body. */
  distanceTo(car) {
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    const dx = this.x - car.x, dz = this.z - car.z;
    const lz = dx * sin + dz * cos, lx = -dx * cos + dz * sin;
    const ex = Math.max(0, Math.abs(lx) - car.spec.width / 2), ez = Math.max(0, Math.abs(lz) - car.spec.len / 2);
    return Math.hypot(ex, ez);
  }

  nearestCar(cars, reach = 2.4) {
    let best = null, bd = reach;
    for (const car of cars) {
      if (Math.abs(car.x - this.x) > 8 || Math.abs(car.z - this.z) > 8 || Math.abs(car.y - this.y) > 2) continue;
      const d = this.distanceTo(car);
      if (d < bd) { bd = d; best = car; }
    }
    return best;
  }

  enter(car) {
    this.mode = 'car';
    this.car = car;
    car.driver = 'player';
    car.abandoned = 0;
    car.wake();
    this.body.group.visible = false;
    this.vel = 0; this.sx = 0; this.sz = 0;
  }

  /** Step out on the driver's side, or wherever there is room. */
  exit() {
    const car = this.car;
    const hw = car.spec.width / 2 + 0.55, hl = car.spec.len / 2 + 0.6;
    let placed = false;
    for (const [side, fwd] of [[-hw, 0.1], [hw, 0.1], [0, -hl], [0, hl], [-hw, -1.2], [hw, -1.2]]) {
      car.point(side, fwd, _pt);
      if (colliders.resolve(_pt.x, _pt.z, RADIUS, car.y, _hit) && Math.hypot(_hit.x - _pt.x, _hit.z - _pt.z) > 0.25) continue;
      this.x = _pt.x; this.z = _pt.z; placed = true;
      break;
    }
    if (!placed) { car.point(-hw, 0, _pt); this.x = _pt.x; this.z = _pt.z; }
    this.y = Math.max(car.y, groundHeight(this.x, this.z));
    this.heading = car.heading;
    this.vy = 0;
    // carry a little of the car's motion so bailing out at speed reads as a leap
    this.sx = car.vx * 0.35; this.sz = car.vz * 0.35;
    this.vel = clamp(car.forward * 0.3, 0, 5);
    car.driver = null;
    car.abandoned = 1;
    car.throttle = 0; car.brake = 0; car.steerIn = 0; car.handbrake = false;
    this.car = null;
    this.mode = 'foot';
    this.body.group.visible = true;
    this.grounded = false;
  }

  /** Walk, run, turn and jump. `input` holds booleans for the control keys. */
  updateFoot(dt, input, cars) {
    const b = this.body;
    if (b.down > 0) {
      b.x = this.x; b.y = this.y; b.z = this.z;
      b.tumble(dt);
      this.x = b.x; this.y = b.y; this.z = b.z;
      this.vel = 0; this.speed = Math.hypot(b.kx, b.kz);
      b.heading = this.heading;
      b.pose(dt);
      return;
    }
    const turn = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const move = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    this.heading += turn * (move !== 0 ? 2.5 : 3.1) * dt;
    const want = move > 0 ? (input.run ? 6.6 : 3.0) : move < 0 ? -2.0 : 0;
    this.vel = damp(this.vel, want, this.grounded ? 9 : 2.5, dt);
    const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
    const k = Math.max(0, 1 - 3.5 * dt);
    this.sx *= k; this.sz *= k;
    const vx = sin * this.vel + this.sx, vz = cos * this.vel + this.sz;
    let nx = this.x + vx * dt, nz = this.z + vz * dt;

    // Steps are fine, walls are not: refuse to climb anything taller than a curb or kerb-high lip.
    const gNew = groundHeight(nx, nz);
    if (gNew - this.y > 0.55) { nx = this.x; nz = this.z; this.vel *= 0.5; }

    if (colliders.resolve(nx, nz, RADIUS, this.y, _hit)) { nx = _hit.x; nz = _hit.z; }
    props.hitByWalker(nx, nz, RADIUS, vx, vz, this.y, _hit);
    nx = _hit.x; nz = _hit.z;

    // Cars are solid boxes; a fast one knocks the player down.
    for (const car of cars) {
      const dx = nx - car.x, dz = nz - car.z;
      if (dx > 5 || dx < -5 || dz > 5 || dz < -5 || this.y > car.y + 1.25) continue;
      const cs = Math.sin(car.heading), cc = Math.cos(car.heading);
      const lz = dx * cs + dz * cc, lx = -dx * cc + dz * cs;
      const px = car.spec.width / 2 + RADIUS - Math.abs(lx), pz = car.spec.len / 2 + RADIUS - Math.abs(lz);
      if (px <= 0 || pz <= 0) continue;
      if (car.speed > 4.5 && car.driver !== null) {
        b.knock(car.vx * 0.8, car.vz * 0.8, 2.2);
        if (this.onHit) this.onHit(car);
        break;
      }
      if (px < pz) { const s = Math.sign(lx) || 1; nx += -cc * s * px; nz += cs * s * px; }
      else { const s = Math.sign(lz) || 1; nx += cs * s * pz; nz += cc * s * pz; }
    }

    this.x = nx; this.z = nz;
    const g = groundHeight(this.x, this.z);
    if (this.grounded) {
      if (input.jump) {
        this.vy = 6.4; this.grounded = false;
        if (this.onJump) this.onJump();
      } else if (this.y - g > 0.3) this.grounded = false; // walked off a ledge
      else this.y = damp(this.y, g, 25, dt);
    }
    if (!this.grounded) {
      this.vy -= 19 * dt;
      this.y += this.vy * dt;
      if (this.y <= g) {
        this.y = g; this.grounded = true;
        if (this.onLand && this.vy < -3) this.onLand(-this.vy);
        this.vy = 0;
      }
    }
    this.speed = Math.hypot(vx, vz);

    b.x = this.x; b.y = this.y; b.z = this.z;
    b.heading = this.heading;
    b.speed = Math.abs(this.vel) + Math.hypot(this.sx, this.sz) * 0.5;
    b.backward = this.vel < -0.1;
    b.air = !this.grounded;
    const before = Math.floor(b.phase / Math.PI);
    b.pose(dt);
    if (this.grounded && b.speed > 0.6 && Math.floor(b.phase / Math.PI) !== before && this.onStep) this.onStep(b.speed);
  }

  /** Map the keys onto the car's controls. */
  updateDrive(input) {
    const car = this.car;
    const fwd = car.forward;
    car.throttle = 0; car.brake = 0;
    if (input.forward) {
      if (fwd < -1.5) car.brake = 1; else car.throttle = 1;
    }
    if (input.back) {
      if (fwd > 1.5) car.brake = 1; else car.throttle = -1;
    }
    car.steerIn = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    car.handbrake = !!input.jump;
    this.x = car.x; this.y = car.y; this.z = car.z;
    this.heading = car.heading;
    this.speed = car.speed;
  }

  underwater() { return this.y < WATER_Y - 0.6; }

  teleport(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.y = groundHeight(x, z);
    this.vy = 0; this.vel = 0; this.sx = 0; this.sz = 0;
    this.grounded = true;
    this.body.down = 0; this.body.downBlend = 0;
  }
}
