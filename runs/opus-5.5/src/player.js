import { Character } from './character.js';
import { circleHit } from './world.js';
import { damp } from './util.js';

const RADIUS = 0.33;
const STEP = 0.32;

export class Player {
  constructor(scene, world) {
    this.world = world;
    this.char = new Character({ skin: 0xd9a47c, shirt: 0x1f9e8f, pants: 0x2b3a55, hair: 0x1d1510, shoes: 0xeeeeee, cap: 0xf2b134, scale: 1 });
    scene.add(this.char.root);
    this.x = 0; this.y = 0; this.z = 0; this.h = 0;
    this.vy = 0;
    this.spd = 0;
    this.onGround = true;
    this.knockT = 0;
    this.kvx = 0; this.kvz = 0;
    this.groundSpeed = 0;
  }

  place(x, z, h) {
    this.x = x; this.z = z; this.h = h;
    this.y = this.world.groundHeight(x, z);
    this.vy = 0; this.spd = 0; this.knockT = 0;
    this.sync();
  }

  knock(vx, vz) {
    if (this.knockT > 0) return;
    this.knockT = 1.8;
    this.kvx = vx; this.kvz = vz;
    this.vy = 4;
    this.onGround = false;
  }

  /** Returns 'splash' if the player fell in the sea. */
  update(dt, input, cars) {
    const w = this.world;
    let mvx = 0, mvz = 0;
    if (this.knockT > 0) {
      this.knockT -= dt;
      mvx = this.kvx; mvz = this.kvz;
      this.kvx *= Math.exp(-3 * dt); this.kvz *= Math.exp(-3 * dt);
      this.spd = 0;
    } else {
      this.h += input.turn * (input.run ? 2.9 : 2.5) * dt;
      const target = input.fwd > 0 ? (input.run ? 6.4 : 2.5) : input.fwd < 0 ? -1.9 : 0;
      this.spd = damp(this.spd, target, this.onGround ? 10 : 2, dt);
      mvx = Math.sin(this.h) * this.spd + input.strafe * Math.cos(this.h) * -2;
      mvz = Math.cos(this.h) * this.spd + input.strafe * Math.sin(this.h) * 2;
      if (input.jump && this.onGround) {
        this.vy = 5.6;
        this.onGround = false;
        this.jumped = true;
      }
    }
    const ox = this.x, oz = this.z;
    this.x += mvx * dt;
    this.z += mvz * dt;

    // Horizontal collisions; low things can be stepped onto.
    let support = w.groundHeight(this.x, this.z);
    for (let it = 0; it < 2; it++) {
      for (const c of w.grid.query(this.x, this.z, RADIUS + 0.2)) {
        const hit = circleHit(this.x, this.z, RADIUS, c);
        if (!hit) continue;
        if (c.stand && this.y >= c.h - STEP) {
          support = Math.max(support, c.h);
          continue;
        }
        this.x += hit.nx * hit.depth;
        this.z += hit.nz * hit.depth;
      }
    }
    for (const car of cars) {
      if (car.driver === 'player') continue;
      const dx = car.x - this.x, dz = car.z - this.z;
      if (dx * dx + dz * dz > 16) continue;
      const top = car.y + car.spec.hgt;
      if (this.y >= top - STEP - 0.1) {
        if (car.contains(this.x, this.z, 0.05)) support = Math.max(support, top);
        continue;
      }
      const p = car.pushOut(this.x, this.z, RADIUS);
      if (p) { this.x += p.x; this.z += p.z; }
    }

    // Vertical.
    if (this.onGround && this.vy <= 0) {
      if (Math.abs(this.y - support) <= STEP + 0.05) {
        this.y = support;
        this.vy = 0;
      } else if (this.y > support) this.onGround = false;
      else this.y = support;
    }
    if (!this.onGround) {
      this.vy -= 15 * dt;
      this.y += this.vy * dt;
      if (this.y <= support) {
        this.y = support;
        this.vy = 0;
        this.onGround = true;
        this.landed = true;
      }
    }

    this.groundSpeed = Math.hypot(this.x - ox, this.z - oz) / Math.max(dt, 1e-4);
    if (this.y < -0.6) return 'splash';
    return null;
  }

  sync(dt = 0) {
    const c = this.char;
    c.root.position.set(this.x, this.y, this.z);
    c.root.rotation.y = this.h;
    if (dt) c.animate(dt, this.knockT > 0 ? 0 : Math.abs(this.spd) > 0.2 ? this.groundSpeed : 0, this.knockT > 0.3 ? 'down' : this.onGround ? 'move' : 'air');
  }
}
