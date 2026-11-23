// Every car in the world lives here: parked ones, AI traffic and police.
// AI drivers steer the same physics the player uses, so crashes are symmetric.
import { clamp, makeRng } from './util.js';
import {
  PITCH, LANE, PARK_LANE, SPAWN, nodes, edges, nearestNode, route, lightState, colliders,
} from './world.js';
import { Car, CAR_TYPES, collideCars } from './vehicles.js';

const TRAFFIC_MIX = ['marlin', 'marlin', 'pico', 'pico', 'bison', 'caravel', 'cab', 'cab', 'kestrel', 'marlin', 'pico', 'caravel'];
const _t = { x: 0, z: 0 };
let nextDriverId = 0;

class Driver {
  constructor(car, from, to, R) {
    this.car = car;
    this.id = nextDriverId++;
    this.blockedBy = null; this.wasBlockedBy = null; this.pushT = 0;
    this.from = from; this.to = to; this.next = null;
    this.R = R;
    this.cruise = R.range(8.5, 12.5);
    this.mode = 'cruise'; // or 'chase'
    this.stuck = 0; this.reverse = 0; this.blocked = 0; this.idle = 0;
    this.slowT = 0;
    this.honk = 0;
    this.direct = false;
    this.playerNode = -1;
    this.retire = false;
    car.driver = this;
    car.wake();
  }

  pickNext() {
    const B = nodes[this.to];
    const opts = B.nb.filter((n) => n !== this.from);
    if (!opts.length) { this.next = this.from; return; }
    const A = nodes[this.from];
    const straight = opts.find((n) => nodes[n].x - B.x === B.x - A.x && nodes[n].z - B.z === B.z - A.z);
    this.next = straight !== undefined && this.R.chance(0.55) ? straight : this.R.pick(opts);
  }

  /** Follow the lane from `from` to `to`, turning toward `next`. Returns the wanted speed. */
  followLane(ctx, cruise, obeyLights) {
    const car = this.car;
    let A = nodes[this.from], B = nodes[this.to];
    let dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
    let s = (car.x - A.x) * dx + (car.z - A.z) * dz;
    if (this.next === null && s > PITCH * 0.35) this.chooseNext(ctx);
    let turn = 0, sK = PITCH + 2, ndx = dx, ndz = dz;
    if (this.next !== null) {
      const C = nodes[this.next];
      ndx = Math.sign(C.x - B.x); ndz = Math.sign(C.z - B.z);
      turn = dx * ndz - dz * ndx; // +1 right, -1 left, 0 straight or U-turn
      const uturn = turn === 0 && (ndx !== dx || ndz !== dz);
      sK = uturn ? PITCH - 1 : turn > 0 ? PITCH - LANE : turn < 0 ? PITCH + LANE : PITCH;
      if (s >= sK - (turn === 0 ? 0 : 0.4)) {
        this.from = this.to; this.to = this.next; this.next = null;
        if (turn !== 0 || uturn) this.slowT = 1.1;
        A = B; B = nodes[this.to];
        dx = ndx; dz = ndz;
        s = (car.x - A.x) * dx + (car.z - A.z) * dz;
        turn = 0; sK = PITCH + 2;
      }
    }
    const rx = -dz, rz = dx;
    const look = clamp(2.6 + car.speed * 0.45, 3.6, 10);
    const st = s + look;
    if (turn !== 0 && st > sK) {
      const over = st - sK;
      _t.x = A.x + dx * sK + rx * LANE + ndx * over;
      _t.z = A.z + dz * sK + rz * LANE + ndz * over;
    } else {
      _t.x = A.x + dx * st + rx * LANE;
      _t.z = A.z + dz * st + rz * LANE;
    }
    let v = cruise;
    if (turn !== 0) {
      const dK = sK - s;
      if (dK < 18) v = Math.min(v, 4.8 + clamp((dK - 4) / 14, 0, 1) * (cruise - 4.8));
    }
    if (this.slowT > 0) v = Math.min(v, 6.5);
    if (obeyLights && B.nb.length >= 3) {
      const state = lightState(B, dx !== 0, ctx.time);
      const stopS = PITCH - 13.4;
      const dStop = stopS - s;
      if (state !== 'g' && dStop > -1.2 && (state === 'r' || dStop > 9)) {
        v = Math.min(v, dStop <= 0.5 ? 0 : Math.sqrt(2 * 3.2 * dStop));
        if (v < 0.5) this.waiting = true;
      }
    }
    return v;
  }

  chooseNext(ctx) {
    if (this.mode === 'chase') {
      const path = route(this.to, ctx.playerNode);
      this.next = path.length ? path[0] : null;
      if (this.next === null) this.direct = true;
    } else this.pickNext();
  }

  steerAt(tx, tz) {
    const car = this.car;
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    const dx = tx - car.x, dz = tz - car.z;
    const lz = dx * sin + dz * cos, lx = -dx * cos + dz * sin;
    const ang = Math.atan2(lx, lz);
    car.steerIn = clamp(ang * 2.4, -1, 1) * (car.forward < -0.5 ? -1 : 1);
    return ang;
  }

  /** Slow for whatever is in the lane ahead. */
  watchAhead(ctx, v, width) {
    const car = this.car;
    const sin = Math.sin(car.heading), cos = Math.cos(car.heading);
    const reach = 7 + car.speed * 1.35;
    const hl = car.spec.len / 2;
    for (let i = 0; i < ctx.cars.length; i++) {
      const o = ctx.cars[i];
      if (o === car) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      if (dx > 40 || dx < -40 || dz > 40 || dz < -40) continue;
      const lz = dx * sin + dz * cos, lx = -dx * cos + dz * sin;
      const gap = lz - hl - o.spec.len / 2;
      if (lz <= 0 || gap > reach || Math.abs(lx) > width + (Math.abs(Math.sin(o.heading - car.heading)) > 0.5 ? 1.4 : 0)) continue;
      // Two cars each waiting for the other would wait forever: the older one goes.
      const od = o.driver;
      if (od && od !== 'player' && od.wasBlockedBy === car && o.speed < 1 && (this.id < od.id || this.idle > 5)) continue;
      // ...and a driver who has sat in a snarl long enough noses through the stopped cross traffic.
      if (this.pushT > 0 && o.speed < 1 && Math.abs(Math.sin(o.heading - car.heading)) > 0.5) continue;
      const of = o.vx * sin + o.vz * cos;
      const allowed = gap < 1.6 ? 0 : Math.max(0, of) + (gap - 2.2) * 0.9;
      if (allowed < v) { v = allowed; this.blockedBy = o; }
    }
    const walkReach = 3.5 + car.speed * 0.9 + hl;
    for (let i = 0; i < ctx.walkers.length; i++) {
      const p = ctx.walkers[i];
      const dx = p.x - car.x, dz = p.z - car.z;
      if (dx > 30 || dx < -30 || dz > 30 || dz < -30) continue;
      const lz = dx * sin + dz * cos, lx = -dx * cos + dz * sin;
      if (lz > 0 && lz < walkReach && Math.abs(lx) < width - 0.1) { v = 0; this.blockedBy = p; }
    }
    return v;
  }

  drive(v) {
    const car = this.car;
    const err = v - car.forward;
    if (v <= 0.05 && car.speed < 0.6) { car.throttle = 0; car.brake = 1; }
    else if (err > 0.3) { car.throttle = clamp(err * 0.45, 0.18, this.mode === 'chase' ? 1 : 0.7); car.brake = 0; }
    else if (err < -0.6) { car.throttle = 0; car.brake = clamp(-err * 0.22, 0.12, 1); }
    else { car.throttle = 0.08; car.brake = 0; }
  }

  update(dt, ctx) {
    const car = this.car;
    this.slowT -= dt;
    this.waiting = false;
    this.wasBlockedBy = this.blockedBy;
    this.blockedBy = null;
    car.handbrake = false;

    // Backing out of a jam.
    if (this.reverse > 0) {
      this.reverse -= dt;
      car.throttle = -0.8; car.brake = 0; car.steerIn = this.reverseSteer;
      return;
    }

    let v;
    if (this.mode === 'chase') v = this.chase(dt, ctx);
    else {
      v = this.followLane(ctx, this.cruise, true);
      this.steerAt(_t.x, _t.z);
      v = this.watchAhead(ctx, v, 1.75);
    }
    this.drive(v);

    // Notice when we are getting nowhere.
    if (v > 1.5 && car.speed < 0.5) this.stuck += dt; else this.stuck = Math.max(0, this.stuck - dt * 2);
    if (this.stuck > (this.mode === 'chase' ? 1.1 : 2.2)) {
      this.stuck = 0;
      this.reverse = 1.3;
      this.reverseSteer = -Math.sign(car.steerIn || (Math.random() - 0.5));
    }
    this.pushT -= dt;
    if (car.speed < 0.4 && !this.waiting) {
      this.idle += dt;
      if (this.idle > 4 + (this.id % 6) * 0.7 && this.pushT < -1) this.pushT = 2.6;
      if (this.blockedBy && this.idle > 2.5 && this.honk <= 0) { this.honk = 3 + Math.random() * 4; ctx.onHonk(car); }
    } else this.idle = 0;
    this.honk -= dt;
  }

  chase(dt, ctx) {
    const car = this.car;
    const px = ctx.px, pz = ctx.pz;
    const dist = Math.hypot(px - car.x, pz - car.z);
    car.siren = true;
    this.seesPlayer = dist < 26 || (dist < 130 && colliders.clearSight(car.x, car.z, px, pz));
    if (ctx.playerNode !== this.playerNode) { this.playerNode = ctx.playerNode; if (!this.direct) this.next = null; }
    const wantDirect = dist < 16 || (dist < 55 && this.seesPlayer);
    if (wantDirect && !this.direct) this.direct = true;
    else if (!wantDirect && this.direct && dist > 24) {
      // Lost them: get back on the road network toward where they were.
      this.direct = false;
      const here = nearestNode(car.x, car.z).id;
      const path = route(here, ctx.playerNode);
      this.from = here;
      this.to = path.length ? path[0] : nodes[here].nb[0];
      this.next = null;
      // start from the far end if we are already past `here` along the segment
      const A = nodes[this.from], B = nodes[this.to];
      const s = (car.x - A.x) * Math.sign(B.x - A.x) + (car.z - A.z) * Math.sign(B.z - A.z);
      if (s < -PITCH * 0.5) { this.to = this.from; this.from = nodes[this.to].nb.find((n) => n !== B.id) ?? B.id; }
    }
    if (this.direct) {
      const lead = clamp(dist / 28, 0, 1) * 0.7;
      const ang = this.steerAt(px + ctx.pvx * lead, pz + ctx.pvz * lead);
      let v = 30 - Math.min(18, Math.abs(ang) * 20);
      if (dist < 11) v = Math.min(v, ctx.pSpeed + 4);
      if (dist < 6.5 && ctx.pSpeed < 3) v = 0;
      return v;
    }
    let v = this.followLane(ctx, 25, false);
    this.steerAt(_t.x, _t.z);
    return this.watchAhead(ctx, v, 1.25);
  }
}

export class Traffic {
  constructor(scene) {
    this.scene = scene;
    this.cars = [];
    this.drivers = [];
    this.R = makeRng(31337);
    this.wantTraffic = 54;
    this.spawnTimer = 3;
    this.time = 0;
  }

  addCar(type, paint, x, z, heading) {
    const car = new Car(type, paint, x, z, heading);
    this.scene.add(car.group);
    this.cars.push(car);
    return car;
  }

  removeCar(car) {
    car.alive = false;
    this.scene.remove(car.group);
    this.cars.splice(this.cars.indexOf(car), 1);
    if (car.driver && car.driver !== 'player') this.drivers.splice(this.drivers.indexOf(car.driver), 1);
    car.tailMat.dispose();
  }

  /** The hero car, parked cars along the curbs, and the first wave of traffic. */
  populate() {
    const R = this.R;
    const hero = this.addCar('kestrel', 0xe2442b, SPAWN.x, SPAWN.z, SPAWN.heading);
    let parked = 0;
    for (const [a, b] of edges) {
      const A = nodes[a], B = nodes[b];
      const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
      for (const side of [1, -1]) {
        if (A.z === 180 && B.z === 180) continue; // the seafront boulevard stays clear: it is the opening runway
        if (A.x === -180 && B.x === -180 && side === 1 && A.z > -160 && B.z < 120) continue; // open onto the docks
        if (parked > 26 || !R.chance(0.42)) continue;
        const n = R.int(1, 3);
        const s0 = R.range(17, 30);
        for (let k = 0; k < n; k++) {
          const s = s0 + k * R.range(6.2, 7.5);
          if (s > PITCH - 17) break;
          const x = A.x + dx * s + -dz * side * PARK_LANE, z = A.z + dz * s + dx * side * PARK_LANE;
          const type = R.pick(['marlin', 'pico', 'pico', 'marlin', 'bison', 'caravel', 'kestrel', 'marlin']);
          const heading = Math.atan2(dx * side, dz * side) + R.range(-0.03, 0.03);
          this.addCar(type, R.pick(CAR_TYPES[type].paints), x, z, heading);
          parked++;
        }
      }
    }
    for (let i = 0; i < this.wantTraffic; i++) this.spawnDriver(SPAWN.x, SPAWN.z, null, 46, false);
    // One patrol car on the beat from the start.
    this.spawnDriver(SPAWN.x, SPAWN.z, null, 120, true);
    return hero;
  }

  /**
   * Put a new AI car on a lane at least `minDist` from (px, pz) and, when a
   * camera is given, out of its view. Returns the driver or null.
   */
  spawnDriver(px, pz, camera, minDist, police, maxDist = 1e9) {
    const R = this.R;
    for (let attempt = 0; attempt < 30; attempt++) {
      const [a, b] = R.pick(edges);
      const flip = R.chance(0.5);
      const from = flip ? b : a, to = flip ? a : b;
      const A = nodes[from], B = nodes[to];
      const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
      const s = R.range(16, PITCH - 20);
      const x = A.x + dx * s - dz * LANE, z = A.z + dz * s + dx * LANE;
      const d = Math.hypot(x - px, z - pz);
      if (d < minDist || d > maxDist) continue;
      if (camera) {
        const fx = x - camera.position.x, fz = z - camera.position.z;
        const fl = Math.hypot(fx, fz);
        const cam = camera.userData.dir;
        if (fl < 190 && (fx * cam.x + fz * cam.z) / fl > 0.35 && colliders.clearSight(camera.position.x, camera.position.z, x, z)) continue;
      }
      if (this.cars.some((c) => Math.abs(c.x - x) < 9 && Math.abs(c.z - z) < 9)) continue;
      const type = police ? 'patrol' : R.pick(TRAFFIC_MIX);
      const car = this.addCar(type, R.pick(CAR_TYPES[type].paints), x, z, Math.atan2(dx, dz));
      const driver = new Driver(car, from, to, R);
      car.vx = dx * 6; car.vz = dz * 6;
      this.drivers.push(driver);
      return driver;
    }
    return null;
  }

  /** Take the AI driver out of a car (the player is stealing it). */
  evict(car) {
    const d = car.driver;
    if (d && d !== 'player') this.drivers.splice(this.drivers.indexOf(d), 1);
    car.driver = null;
    car.siren = false;
  }

  police() { return this.drivers.filter((d) => d.car.spec.police); }

  update(dt, ctx) {
    this.time += dt;
    ctx.cars = this.cars;
    for (const d of this.drivers) d.update(dt, ctx);

    // Keep the streets populated; retire cars that are lost, sunk or surplus.
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.2;
      const civilians = this.drivers.filter((d) => !d.car.spec.police).length;
      if (civilians < this.wantTraffic && this.cars.length < 118) this.spawnDriver(ctx.px, ctx.pz, ctx.camera, 70, false);
      const cops = this.police();
      const chasing = cops.filter((d) => d.mode === 'chase').length;
      if (ctx.heatLevel > 0) {
        for (const d of cops) if (d.mode !== 'chase' && Math.hypot(d.car.x - ctx.px, d.car.z - ctx.pz) < 220) { d.mode = 'chase'; d.next = null; d.retire = false; }
        if (chasing < ctx.heatLevel) {
          const d = this.spawnDriver(ctx.px, ctx.pz, ctx.camera, 80, true, 230);
          if (d) { d.mode = 'chase'; d.playerNode = ctx.playerNode; }
        }
      } else {
        for (const d of cops) {
          if (d.mode !== 'chase') continue;
          d.mode = 'cruise'; d.direct = false; d.car.siren = false;
          const here = nearestNode(d.car.x, d.car.z);
          d.from = here.id; d.to = this.R.pick(here.nb); d.next = null;
          d.retire = cops.indexOf(d) > 0;
        }
      }
      for (let i = this.cars.length - 1; i >= 0; i--) {
        const car = this.cars[i];
        if (car.driver === 'player' || car === ctx.keep) continue;
        const dist = Math.hypot(car.x - ctx.px, car.z - ctx.pz);
        const d = car.driver;
        const sunk = car.underwater();
        const lost = d && (d.idle > 26 || (d.retire && dist > 110)) && dist > 60;
        const litter = !d && car.abandoned && (car.abandoned += 1.2) > 50 && dist > 130;
        if (sunk || lost || litter) this.removeCar(car);
      }
    }
  }

  /** Physics for every car in `substeps` slices, each followed by car-against-car contacts. */
  step(dt, onCrash, substeps = 2) {
    for (const car of this.cars) { car.impact = 0; car.landed = 0; }
    for (let i = 0; i < substeps; i++) {
      for (const car of this.cars) if (!car.asleep) car.step(dt / substeps);
      collideCars(this.cars, onCrash);
    }
  }
}

