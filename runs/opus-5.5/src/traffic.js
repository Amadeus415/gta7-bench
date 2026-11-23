import { Car, CAR_COLORS } from './car.js';
import { Character, randomLook } from './character.js';
import { LINES, BLOCKS, DIRS, LANE, nodePos, validDir, headingOf, circleHit } from './world.js';
import { clamp, wrapAngle, rng } from './util.js';

const P = 64;
const R = rng(4242);

// ---------------------------------------------------------------------------
// Drivers. Each AI car follows a queue of lane points generated junction by
// junction, and turns them into throttle/steer inputs for the shared physics.
// ---------------------------------------------------------------------------
function bezier(p0, p1, p2, t) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x, z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z };
}

function extendPath(ai, lane = LANE) {
  const [dx, dz] = DIRS[ai.dir];
  const A = nodePos(ai.i, ai.j);
  const bi = ai.i + dx, bj = ai.j + dz;
  const Bn = nodePos(bi, bj);
  const ox = -dz * lane, oz = dx * lane;
  for (let t = 10; t <= P - 10; t += 4) ai.path.push({ x: A.x + dx * t + ox, z: A.z + dz * t + oz });
  const opts = [];
  for (let d = 0; d < 4; d++) {
    if (d === (ai.dir + 2) % 4 || !validDir(bi, bj, d)) continue;
    opts.push(d, ...(d === ai.dir ? [d] : []));
  }
  const nd = opts.length ? opts[Math.floor(R() * opts.length)] : (ai.dir + 2) % 4;
  const [ex, ez] = DIRS[nd];
  const o2x = -ez * lane, o2z = ex * lane;
  const p0 = { x: Bn.x - dx * 10 + ox, z: Bn.z - dz * 10 + oz };
  const p2 = { x: Bn.x + ex * 10 + o2x, z: Bn.z + ez * 10 + o2z };
  let p1;
  if (nd === ai.dir) p1 = { x: (p0.x + p2.x) / 2, z: (p0.z + p2.z) / 2 };
  else if (nd === (ai.dir + 2) % 4) p1 = { x: Bn.x + dx * 4, z: Bn.z + dz * 4 };
  else p1 = { x: Bn.x + ox + o2x, z: Bn.z + oz + o2z };
  for (let s = 1; s <= 6; s++) {
    const p = bezier(p0, p1, p2, s / 6);
    p.turn = nd !== ai.dir;
    ai.path.push(p);
  }
  ai.i = bi; ai.j = bj; ai.dir = nd;
}

/** Find the road segment a car is on and rebuild its route from there. */
export function replan(car) {
  let best = null, bs = 1e9;
  const sh = Math.sin(car.h), ch = Math.cos(car.h);
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      for (let d = 0; d < 4; d++) {
        if (!validDir(i, j, d)) continue;
        const [dx, dz] = DIRS[d];
        const A = nodePos(i, j);
        const along = (car.x - A.x) * dx + (car.z - A.z) * dz;
        const lat = (car.x - A.x) * -dz + (car.z - A.z) * dx; // negative = right side
        if (along < -4 || along > P - 6 || Math.abs(lat) > 9) continue;
        const align = sh * dx + ch * dz;
        if (align < 0.2) continue;
        const score = Math.abs(lat + LANE) + (1 - align) * 10;
        if (score < bs) { bs = score; best = { i, j, d }; }
      }
    }
  }
  if (!best) return false;
  const ai = car.ai;
  ai.i = best.i; ai.j = best.j; ai.dir = best.d;
  ai.path = [];
  extendPath(ai);
  ai.path = ai.path.filter((p) => (p.x - car.x) * sh + (p.z - car.z) * ch > 3);
  if (ai.path.length < 2) extendPath(ai);
  return true;
}

export class Traffic {
  constructor(scene, world, cars) {
    this.scene = scene;
    this.world = world;
    this.cars = cars;
    this.peds = [];
    this.police = [];
  }

  makeAICar(type, color, i, j, d, t, mode = 'traffic') {
    const [dx, dz] = DIRS[d];
    const A = nodePos(i, j);
    const ox = -dz * LANE, oz = dx * LANE;
    const car = new Car(this.scene, type, color, A.x + dx * t + ox, A.z + dz * t + oz, headingOf(dx, dz), this.world);
    car.driver = 'ai';
    car.ai = { i, j, dir: d, path: [], cruise: 9 + R() * 4, blockedT: 0, ignoreT: 0, stuckT: 0, dazed: 0, mode, reverseT: 0, honk: 0 };
    extendPath(car.ai);
    car.ai.path = car.ai.path.filter((p) => (p.x - car.x) * dx + (p.z - car.z) * dz > 3);
    const sp = car.ai.cruise * 0.7;
    car.vx = dx * sp; car.vz = dz * sp;
    this.cars.push(car);
    return car;
  }

  /** Random lane position at least `minDist` from (px,pz) and clear of cars. */
  findSpawn(px, pz, minDist, maxDist = 1e9) {
    for (let k = 0; k < 60; k++) {
      const i = Math.floor(R() * 6), j = Math.floor(R() * 6), d = Math.floor(R() * 4);
      if (!validDir(i, j, d)) continue;
      const t = 14 + R() * 36;
      const [dx, dz] = DIRS[d];
      const A = nodePos(i, j);
      const x = A.x + dx * t - dz * LANE, z = A.z + dz * t + dx * LANE;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < minDist || dist > maxDist) continue;
      if (this.cars.some((c) => Math.hypot(c.x - x, c.z - z) < 12)) continue;
      return { i, j, d, t, x, z };
    }
    return null;
  }

  spawnTraffic(n, px, pz, avoid) {
    const types = ['sedan', 'sedan', 'compact', 'compact', 'van', 'pickup', 'taxi', 'taxi', 'sports'];
    for (let k = 0; k < n; k++) {
      const s = this.findSpawn(px, pz, 30);
      if (!s) continue;
      if (avoid && avoid(s)) continue;
      const type = types[k % types.length];
      this.makeAICar(type, type === 'taxi' ? 0xf2c230 : R.pick(CAR_COLORS), s.i, s.j, s.d, s.t);
    }
  }

  spawnPolice(px, pz, minDist, maxDist) {
    const s = this.findSpawn(px, pz, minDist, maxDist) || this.findSpawn(px, pz, 40);
    if (!s) return null;
    const car = this.makeAICar('police', 0x1d2733, s.i, s.j, s.d, s.t, 'patrol');
    car.ai.cruise = 12;
    this.police.push(car);
    return car;
  }

  // ---- pedestrians ----
  spawnPeds(n) {
    for (let k = 0; k < n; k++) {
      const bi = Math.floor(R() * 5), bj = Math.floor(R() * 5);
      const corner = Math.floor(R() * 4);
      const ch = new Character(randomLook(R));
      this.scene.add(ch.root);
      const p = { ch, bi, bj, corner, x: 0, z: 0, y: 0.15, h: 0, speed: 1.1 + R() * 0.6, state: 'walk', t: 0, vx: 0, vy: 0, vz: 0, cw: R() < 0.5, fleeT: 0, wait: 0 };
      const c = this.cornerPos(bi, bj, corner);
      const n2 = this.cornerPos(bi, bj, (corner + 1) % 4);
      const f = R();
      p.x = c.x + (n2.x - c.x) * f;
      p.z = c.z + (n2.z - c.z) * f;
      p.target = p.cw ? n2 : c;
      p.nextCorner = p.cw ? (corner + 1) % 4 : corner;
      this.peds.push(p);
    }
  }

  cornerPos(bi, bj, k) {
    const sx = k === 0 || k === 3 ? 1 : -1;
    const sz = k === 0 || k === 1 ? 1 : -1;
    return { x: BLOCKS[bi] + sx * 23, z: BLOCKS[bj] + sz * 23, sx, sz };
  }

  pedArrive(p) {
    const c = this.cornerPos(p.bi, p.bj, p.nextCorner);
    // maybe cross the street to the neighbouring block
    if (R() < 0.3 && p.state === 'walk') {
      const alongX = R() < 0.5;
      const nbi = p.bi + (alongX ? c.sx : 0), nbj = p.bj + (alongX ? 0 : c.sz);
      if (nbi >= 0 && nbi < 5 && nbj >= 0 && nbj < 5) {
        p.bi = nbi; p.bj = nbj;
        const sx = alongX ? -c.sx : c.sx, sz = alongX ? c.sz : -c.sz;
        p.nextCorner = sx > 0 ? (sz > 0 ? 0 : 3) : sz > 0 ? 1 : 2;
        p.target = this.cornerPos(nbi, nbj, p.nextCorner);
        p.crossing = true;
        return;
      }
    }
    p.crossing = false;
    p.nextCorner = p.cw ? (p.nextCorner + 1) % 4 : (p.nextCorner + 3) % 4;
    p.target = this.cornerPos(p.bi, p.bj, p.nextCorner);
  }

  updatePeds(dt, ctx) {
    const { player, playerCar, camX, camZ, onPedHit } = ctx;
    for (const p of this.peds) {
      const far = Math.hypot(p.x - camX, p.z - camZ) > 140;
      p.ch.root.visible = !far;
      if (p.state === 'ko') {
        p.vy -= 15 * dt;
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
        const g = this.world.groundHeight(p.x, p.z);
        for (const c of this.world.grid.query(p.x, p.z, 0.6)) {
          const hit = circleHit(p.x, p.z, 0.3, c);
          if (hit && c.h > p.y) { p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth; p.vx *= -0.3; p.vz *= -0.3; }
        }
        if (p.y <= g) { p.y = g; p.vy = 0; p.vx *= Math.exp(-6 * dt); p.vz *= Math.exp(-6 * dt); }
        p.t -= dt;
        if (p.t <= 0) {
          p.state = 'flee'; p.fleeT = 6;
          // walk back to the nearest sidewalk corner of the closest block
          p.bi = clamp(Math.round((p.x + 128) / 64), 0, 4);
          p.bj = clamp(Math.round((p.z + 128) / 64), 0, 4);
          let bk = 0, bd = 1e9;
          for (let k = 0; k < 4; k++) {
            const c = this.cornerPos(p.bi, p.bj, k);
            const d = Math.hypot(c.x - p.x, c.z - p.z);
            if (d < bd) { bd = d; bk = k; }
          }
          p.nextCorner = bk;
          p.target = this.cornerPos(p.bi, p.bj, bk);
        }
        p.ch.root.position.set(p.x, p.y, p.z);
        p.ch.root.rotation.y = p.h;
        if (!far) p.ch.animate(dt, 0, 'down');
        continue;
      }

      // Panic when a fast car bears down, or when the player honks.
      if (playerCar && p.state !== 'flee') {
        const l = playerCar.local(p.x, p.z);
        if (playerCar.speed > 7 && l.f > 0 && l.f < 14 && Math.abs(l.r) < 3) { p.state = 'flee'; p.fleeT = 4; this.dodge(p, playerCar); }
      }
      if (ctx.honk && Math.hypot(p.x - ctx.honk.x, p.z - ctx.honk.z) < 18 && p.state !== 'flee') { p.state = 'flee'; p.fleeT = 4; }
      if (ctx.gunfire && Math.hypot(p.x - ctx.gunfire.x, p.z - ctx.gunfire.z) < 30) { p.state = 'flee'; p.fleeT = 5; }

      const spd = p.state === 'flee' ? 4.2 : p.speed;
      if (p.state === 'flee') { p.fleeT -= dt; if (p.fleeT <= 0) p.state = 'walk'; }

      // Wait at the kerb if a car is about to pass in front.
      let go = true;
      if (p.crossing && p.state === 'walk') {
        for (const c of this.cars) {
          if (c.speed < 2) continue;
          const dx = c.x - p.x, dz = c.z - p.z;
          if (dx * dx + dz * dz < 18 * 18 && (dx * c.vx + dz * c.vz) < 0 && Math.abs(this.world.groundHeight(p.x, p.z) - 0.15) < 0.01) { go = false; break; }
        }
      }
      const dx = p.target.x - p.x, dz = p.target.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) this.pedArrive(p);
      else if (go) {
        const step = Math.min(d, spd * dt);
        p.x += (dx / d) * step; p.z += (dz / d) * step;
        p.h += wrapAngle(Math.atan2(dx, dz) - p.h) * Math.min(1, dt * 8);
      }
      // keep out of the player's way
      if (player) {
        const ex = p.x - player.x, ez = p.z - player.z;
        const e2 = ex * ex + ez * ez;
        if (e2 < 0.5 && e2 > 0.0001) {
          const e = Math.sqrt(e2);
          player.x -= (ex / e) * (0.7 - e) * 0.5;
          player.z -= (ez / e) * (0.7 - e) * 0.5;
        }
      }
      p.y = this.world.groundHeight(p.x, p.z);

      // Hit by any moving car?
      for (const c of this.cars) {
        const s2 = c.speed;
        if (s2 < 3) continue;
        const dx2 = c.x - p.x, dz2 = c.z - p.z;
        if (dx2 * dx2 + dz2 * dz2 > 16) continue;
        if (c.contains(p.x, p.z, 0.35)) {
          p.state = 'ko'; p.t = 4;
          p.vx = c.vx * 0.85 + (R() - 0.5) * 2; p.vz = c.vz * 0.85 + (R() - 0.5) * 2;
          p.vy = 3 + s2 * 0.18;
          p.h = Math.atan2(-c.vx, -c.vz);
          c.vx *= 0.92; c.vz *= 0.92;
          onPedHit(p, c);
          break;
        }
      }

      p.ch.root.position.set(p.x, p.y, p.z);
      p.ch.root.rotation.y = p.h;
      if (!far) p.ch.animate(dt, go && d >= 0.4 ? spd : 0, 'move');
    }
  }

  dodge(p, car) {
    // step away from the car's path, back toward the building line
    const l = car.local(p.x, p.z);
    const sh = Math.sin(car.h), ch = Math.cos(car.h);
    const side = l.r >= 0 ? 1 : -1;
    p.x += -ch * side * 0.6; p.z += sh * side * 0.6;
  }

  // ---- driving ----
  updateDrivers(dt, ctx) {
    const { player, playerCar, wanted } = ctx;
    const sources = [];
    for (const c of this.cars) sources.push({ x: c.x, z: c.z, car: c });
    if (!playerCar) sources.push({ x: player.x, z: player.z });
    for (const p of this.peds) if (p.state !== 'ko') sources.push({ x: p.x, z: p.z, ped: true });

    for (const car of this.cars) {
      if (car.driver !== 'ai' || !car.ai) {
        if (car.driver !== 'player') car.input.accel = 0, car.input.steer = 0, car.input.handbrake = car.speed < 0.5;
        continue;
      }
      const ai = car.ai;
      const inp = car.input;
      if (ai.dazed > 0) {
        ai.dazed -= dt;
        inp.accel = 0; inp.steer = 0; inp.handbrake = true;
        if (ai.dazed <= 0) {
          inp.handbrake = false;
          if (ai.mode === 'traffic' || ai.mode === 'patrol') {
            if (!replan(car)) { car.driver = null; car.ai = null; }
          }
        }
        continue;
      }
      const chasing = ai.mode === 'chase' && wanted > 0;
      const sh = Math.sin(car.h), ch = Math.cos(car.h);
      const vF = car.fwdSpeed;
      const sp = Math.abs(vF);

      let tx, tz, targetSpeed;
      const target = playerCar || player;
      const pdx = target.x - car.x, pdz = target.z - car.z;
      const pDist = Math.hypot(pdx, pdz);
      if (chasing && pDist < 38) {
        // direct pursuit, leading the target
        const lead = playerCar ? 0.5 : 0.1;
        tx = target.x + (playerCar ? playerCar.vx : 0) * lead;
        tz = target.z + (playerCar ? playerCar.vz : 0) * lead;
        const ang = Math.abs(wrapAngle(Math.atan2(tx - car.x, tz - car.z) - car.h));
        targetSpeed = playerCar ? Math.max(10, playerCar.speed + 6) * (ang > 1.2 ? 0.45 : 1) : Math.min(8, pDist * 0.7);
        // box in a slow or stopped suspect instead of shoving them across town
        const slow = playerCar ? playerCar.speed < 5 : true;
        if (slow) targetSpeed = Math.min(targetSpeed, clamp((pDist - 6.5) * 1.2, 0, 20));
      } else {
        if (chasing) {
          ai.routeT = (ai.routeT ?? 0) - dt;
          if (ai.routeT <= 0 || ai.path.length < 3) { this.routeTo(car, target.x, target.z); ai.routeT = 2; }
        }
        while (ai.path.length < 14 && !chasing) extendPath(ai);
        if (chasing && ai.path.length < 2) this.routeTo(car, target.x, target.z);
        // drop points we've passed
        while (ai.path.length > 1) {
          const p = ai.path[0];
          const dx = p.x - car.x, dz = p.z - car.z;
          const ahead = dx * sh + dz * ch;
          if (dx * dx + dz * dz < 9 || ahead < 0) ai.path.shift();
          else break;
        }
        const look = 4.5 + sp * 0.45;
        let tp = ai.path[ai.path.length - 1];
        for (const p of ai.path) {
          if (Math.hypot(p.x - car.x, p.z - car.z) >= look) { tp = p; break; }
        }
        tx = tp.x; tz = tp.z;
        // slow for bends further ahead
        let far = tp;
        for (const p of ai.path) {
          if (Math.hypot(p.x - car.x, p.z - car.z) >= 10 + sp * 0.9) { far = p; break; }
        }
        const bend = Math.abs(wrapAngle(Math.atan2(far.x - car.x, far.z - car.z) - car.h));
        const cruise = chasing ? 26 : ai.cruise;
        targetSpeed = cruise * (1 - clamp(bend / 1.1, 0, chasing ? 0.6 : 0.62));
      }

      // Stop at red lights.
      if (!chasing && ctx.lights) {
        const L = ctx.lights.check(car.x, car.z, car.h);
        if (L && L.mustStop) {
          const d = L.stop - car.spec.len / 2;
          if (d > -0.5) targetSpeed = Math.min(targetSpeed, Math.max(0, d * 0.8));
        }
      }

      // Brake for anything in our lane ahead.
      if (!chasing || pDist > 12 || (playerCar && playerCar.speed < 5)) {
        let block = 1e9;
        if (ai.ignoreT > 0) ai.ignoreT -= dt;
        else {
          for (const s of sources) {
            if (s.car === car) continue;
            if (chasing && s.car === playerCar && playerCar.speed > 5) continue;
            const dx = s.x - car.x, dz = s.z - car.z;
            if (dx * dx + dz * dz > 400) continue;
            const f = dx * sh + dz * ch;
            const r = -dx * ch + dz * sh;
            const half = car.spec.len / 2;
            if (f > half && f < 16 && Math.abs(r) < (s.ped ? 1.6 : 2.1)) {
              // ignore oncoming cars already past the centre line
              if (s.car && s.car.speed > 1 && (s.car.vx * sh + s.car.vz * ch) < -1 && Math.abs(r) > 1.2) continue;
              block = Math.min(block, f - half);
            }
          }
        }
        if (block < 1e9) {
          targetSpeed = Math.min(targetSpeed, Math.max(0, (block - 3.5) * 1.1));
          ai.blockedT += dt;
          if (ai.blockedT > 4) {
            ai.ignoreT = 1.6; ai.blockedT = 0; ai.honk = 0.4;
          }
        } else ai.blockedT = 0;
      }
      if (ai.honk > 0) ai.honk -= dt;

      // Unstick: back out if pinned against something while trying to move.
      if (ai.reverseT > 0) {
        ai.reverseT -= dt;
        inp.accel = -1;
        const ang = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - car.h);
        inp.steer = clamp(ang * 2, -1, 1);
        inp.handbrake = false;
        continue;
      }
      if (targetSpeed > 3 && sp < 0.8) {
        ai.stuckT += dt;
        if (ai.stuckT > (chasing ? 1.2 : 2.5)) { ai.reverseT = 1.1; ai.stuckT = 0; ai.unstuck = (ai.unstuck || 0) + 1; }
      } else {
        ai.stuckT = Math.max(0, ai.stuckT - dt);
        if (sp > 3) ai.unstuck = 0;
      }

      const ang = wrapAngle(Math.atan2(tx - car.x, tz - car.z) - car.h);
      // ang > 0 means the target is to the left (heading increases to the left)
      inp.steer = clamp(-ang * 2.4, -1, 1);
      const err = targetSpeed - vF;
      if (err > 0) inp.accel = clamp(err * 0.45, 0, 1);
      else inp.accel = vF > 0.5 ? clamp(err * 0.35, -1, 0) : 0;
      inp.handbrake = targetSpeed < 0.2 && sp < 1;
      if (chasing && Math.abs(ang) > 1.6 && pDist < 25 && sp < 6) {
        inp.accel = -1;
        inp.steer = clamp(ang * 2, -1, 1);
      }
    }
  }

  /** Grid BFS from the junction ahead of the car to the junction nearest (x,z). */
  routeTo(car, x, z) {
    const ai = car.ai;
    const snap = (v) => clamp(Math.round((v + 160) / P), 0, 5);
    const sh = Math.sin(car.h), ch = Math.cos(car.h);
    let si = snap(car.x + sh * 20), sj = snap(car.z + ch * 20);
    const gi = snap(x), gj = snap(z);
    const prev = new Map();
    const key = (i, j) => i * 6 + j;
    const q = [[si, sj]];
    prev.set(key(si, sj), null);
    while (q.length) {
      const [i, j] = q.shift();
      if (i === gi && j === gj) break;
      for (let d = 0; d < 4; d++) {
        if (!validDir(i, j, d)) continue;
        const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
        if (prev.has(key(ni, nj))) continue;
        prev.set(key(ni, nj), [i, j]);
        q.push([ni, nj]);
      }
    }
    const nodes = [];
    let cur = [gi, gj];
    while (cur) { nodes.unshift(cur); cur = prev.get(key(cur[0], cur[1])); }
    const pts = [];
    for (let k = 0; k < nodes.length; k++) {
      const n = nodePos(nodes[k][0], nodes[k][1]);
      if (k > 0) {
        const m = nodePos(nodes[k - 1][0], nodes[k - 1][1]);
        for (let t = 8; t < P - 4; t += 8) pts.push({ x: m.x + ((n.x - m.x) * t) / P, z: m.z + ((n.z - m.z) * t) / P });
      }
      pts.push({ x: n.x, z: n.z });
    }
    pts.push({ x, z });
    ai.path = pts.filter((p) => (p.x - car.x) * sh + (p.z - car.z) * ch > -2 || Math.hypot(p.x - car.x, p.z - car.z) > 30);
  }
}
