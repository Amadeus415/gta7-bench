// Things to do: courier runs, street sprints, tokens, stunt jumps, and the
// heat system that sends Harbor Patrol after you.
import * as THREE from '../vendor/three.module.js';
import { clamp, makeRng } from './util.js';
import { nodes, edges, nearestNode, LANE, PITCH, groundHeight, DOCKS, districtAt, colliders } from './world.js';
import { landmarks } from './city.js';

const JOB_SPOTS = [
  { type: 'courier', x: -70, z: 180 + LANE, label: 'C' },
  { type: 'sprint', x: -36 + LANE, z: 128, label: 'S' },
  { type: 'courier', x: -12, z: -36 + LANE, label: 'C' },
  { type: 'sprint', x: 180 + LANE, z: 58, label: 'S' },
  { type: 'courier', x: 108 - LANE, z: -120, label: 'C' },
];

const TOKEN_SPOTS = [
  [-104, 193.5], [36, 236], [29.5, 287], [-150, 213], [150, 211], [12, 0], [63, -3.5], [0, -61], [-22, -95],
  [-244.5, -112], [-250, -12], [-240, 104], [0, -189], [189, 0], [-189, 150], [120, 196],
  [36, 301, 4.2], [96, -3, 2.7], [-203, -75, 4.7], [-236, 26, 4.6],
];

const beamMats = [];
let gradientTex = null;
/** White fading to clear from bottom to top, shared by every marker beam. */
function beamGradient() {
  if (gradientTex) return gradientTex;
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 128, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 4, 128);
  gradientTex = new THREE.CanvasTexture(c);
  gradientTex.colorSpace = THREE.SRGBColorSpace;
  return gradientTex;
}

function makeMarker(color, radius = 3.2) {
  const g = new THREE.Group();
  const flat = new THREE.MeshBasicMaterial({ color, toneMapped: false });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.13, 6, 40).rotateX(Math.PI / 2), flat);
  ring.position.y = 0.1;
  const beamMat = new THREE.MeshBasicMaterial({ color, map: beamGradient(), transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.8, radius * 0.8, 30, 24, 1, true), beamMat);
  beam.position.y = 15;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), flat);
  gem.position.y = 3.4;
  g.add(ring, beam, gem);
  g.userData = { ring, gem, beam };
  beamMats.push(beamMat);
  return g;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const clock = (t) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, '0')}`;

export class Game {
  constructor({ scene, player, traffic, crowd, hud, audio, fx }) {
    Object.assign(this, { scene, player, traffic, crowd, hud, audio, fx });
    this.R = makeRng(777);
    this.cash = 0;
    this.heat = 0; this.unseen = 0; this.bust = 0; this.crimeCool = 0; this.cooling = false;
    this.job = null;
    this.cut = null; // a fade-out / teleport / fade-in sequence in progress
    this.t = 0;
    this.best = {};
    try { this.best = JSON.parse(localStorage.getItem('port-vesper-best') || '{}'); } catch (e) { this.best = {}; }
    this.blipList = [];
    this.lastDistrict = '';
    this.hintT = 0;

    // Job markers.
    this.spots = JOB_SPOTS.map((s) => {
      const m = makeMarker(s.type === 'courier' ? 0xffc23d : 0x45d8ff);
      m.position.set(s.x, groundHeight(s.x, s.z), s.z);
      scene.add(m);
      return { ...s, marker: m, cool: 0 };
    });
    this.target = makeMarker(0xffc23d, 3.6);
    this.target.visible = false;
    scene.add(this.target);
    const gateMat = new THREE.MeshBasicMaterial({ color: 0x45d8ff, toneMapped: false });
    const gateDim = new THREE.MeshBasicMaterial({ color: 0x45d8ff, transparent: true, opacity: 0.3, depthWrite: false });
    this.gate = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.32, 8, 40), gateMat);
    this.gateNext = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.24, 8, 40), gateDim);
    this.gate.visible = this.gateNext.visible = false;
    scene.add(this.gate, this.gateNext);

    // Tokens: hand-placed spots plus a few tucked down alleys.
    const spots = TOKEN_SPOTS.map((s) => s.slice());
    for (const a of landmarks.alleys) {
      if (spots.length >= 24) break;
      if (!colliders.resolve(a.x, a.z, 0.8, 0, {})) spots.push([a.x, a.z]);
    }
    const tokenMat = new THREE.MeshStandardMaterial({ color: 0xffd447, emissive: 0xffa010, emissiveIntensity: 0.9, metalness: 0.8, roughness: 0.25 });
    this.tokens = spots.map(([x, z, y]) => {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), tokenMat);
      m.scale.set(1, 1.35, 0.42);
      const py = y ?? groundHeight(x, z) + 1.15;
      m.position.set(x, py, z);
      m.castShadow = true;
      scene.add(m);
      return { x, y: py, z, mesh: m, got: false, air: y !== undefined };
    });
    this.found = 0;
  }

  /** Marker beams are solid by day and faint after dark, when they would glare. */
  setNight(n) {
    for (const m of beamMats) m.opacity = 0.5 - n * 0.36;
  }

  pay(amount, why) {
    this.cash += amount;
    this.hud.cashBump();
    this.hud.feed(`<b>+${money(amount)}</b> ${why}`);
  }

  /** Something illegal happened: raise the heat. */
  crime(points, why) {
    if (this.cut) return;
    const before = Math.floor(this.heat);
    this.heat = Math.min(5, this.heat + points);
    this.unseen = 0;
    const now = Math.floor(this.heat);
    if (now > before) {
      this.hud.feed(`<span style="color:#ffcf5a">★ ${why}</span>`);
      if (before === 0) this.hud.toast('HEAT', 'Harbor Patrol is on its way. Lose them.', 'bad', 2.6);
      this.audio.bad();
    }
  }

  get heatLevel() { return Math.floor(this.heat + 1e-6); }

  // ------------------------------------------------------------------ jobs

  randomCurb(px, pz, minD, maxD) {
    for (let i = 0; i < 80; i++) {
      const [a, b] = this.R.pick(edges);
      const A = nodes[a], B = nodes[b];
      const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
      const s = this.R.range(20, PITCH - 20), side = this.R.chance(0.5) ? 1 : -1;
      const x = A.x + dx * s - dz * side * LANE, z = A.z + dz * s + dx * side * LANE;
      const d = Math.hypot(x - px, z - pz);
      if (d >= minD && d <= maxD) return { x, z };
    }
    return { x: 0, z: -36 + LANE };
  }

  startCourier(spot) {
    const p = this.player;
    this.job = { type: 'courier', leg: 0, legs: 3, earned: 0, timer: 0, total: 0 };
    spot.cool = 8;
    this.nextDrop(p.x, p.z);
    this.hud.toast('COURIER RUN', 'Three parcels, three addresses, one ticking clock.', 'good', 3);
    this.audio.good();
  }

  nextDrop(px, pz) {
    const j = this.job;
    const drop = this.randomCurb(px, pz, 130, 300);
    j.tx = drop.x; j.tz = drop.z;
    const dist = Math.abs(drop.x - px) + Math.abs(drop.z - pz);
    j.legDist = dist;
    j.timer = dist / 9.5 + 11;
    j.district = districtAt(drop.x, drop.z);
    this.target.position.set(drop.x, groundHeight(drop.x, drop.z), drop.z);
    this.target.visible = true;
  }

  /** Driving a Vesper Cab? Press E to pick up fares until you leave the car. */
  startTaxi() {
    if (this.job || this.cut || this.player.mode !== 'car' || !this.player.car.spec.taxi) return;
    this.job = { type: 'taxi', phase: 'pickup', fares: 0, earned: 0, timer: 0, car: this.player.car };
    this.nextFare();
    this.hud.toast('TAXI SHIFT', 'Collect the fare at the marker. Quick trips tip better.', 'good', 3);
    this.audio.good();
  }

  nextFare() {
    const j = this.job, p = this.player;
    const spot = this.randomCurb(p.x, p.z, j.phase === 'pickup' ? 50 : 140, j.phase === 'pickup' ? 150 : 320);
    j.tx = spot.x; j.tz = spot.z;
    j.district = districtAt(spot.x, spot.z);
    j.legDist = Math.abs(spot.x - p.x) + Math.abs(spot.z - p.z);
    if (j.phase === 'dropoff') j.timer = j.legDist / 10 + 8;
    this.target.position.set(spot.x, groundHeight(spot.x, spot.z), spot.z);
    this.target.visible = true;
  }

  updateTaxi(dt) {
    const p = this.player, j = this.job;
    if (p.car !== j.car) {
      this.endJob('SHIFT OVER', j.fares ? `${j.fares} fare${j.fares > 1 ? 's' : ''} · ${money(j.earned)}` : 'No fares this time.', j.fares ? 'good' : 'bad');
      return;
    }
    if (j.phase === 'dropoff') j.timer -= dt;
    if (Math.hypot(p.x - j.tx, p.z - j.tz) > 5 || p.speed > 5) return;
    if (j.phase === 'pickup') {
      j.phase = 'dropoff';
      this.audio.door();
      this.nextFare();
      this.hud.feed(`Passenger aboard · to <b>${j.district}</b>`);
    } else {
      const tip = Math.min(60, Math.max(0, Math.round(j.timer) * 2));
      const fare = Math.round((45 + j.legDist * 0.3) / 5) * 5 + tip;
      j.fares++; j.earned += fare;
      this.pay(fare, tip ? `fare + ${money(tip)} tip` : 'fare');
      this.audio.coin();
      j.phase = 'pickup';
      this.nextFare();
    }
  }

  startSprint(spot) {
    const start = nearestNode(spot.x, spot.z).id;
    // A random walk over the street grid that avoids doubling straight back.
    const path = [start];
    const behind = nodes[start].nb.find((n) => Math.abs(nodes[n].x - nodes[start].x) < 1 && nodes[n].z > nodes[start].z);
    let prev = behind ?? -1, cur = start;
    const used = new Set();
    for (let i = 0; i < 8; i++) {
      let opts = nodes[cur].nb.filter((n) => n !== prev && !used.has(`${cur}-${n}`));
      if (!opts.length) opts = nodes[cur].nb.filter((n) => n !== prev);
      const n = this.R.pick(opts);
      used.add(`${cur}-${n}`); used.add(`${n}-${cur}`);
      path.push(n);
      prev = cur; cur = n;
    }
    const first = Math.hypot(nodes[path[0]].x - spot.x, nodes[path[0]].z - spot.z);
    const length = first + (path.length - 1) * PITCH;
    this.job = { type: 'sprint', path, index: 0, time: 0, par: Math.round(length / 15.5 + 6), key: `sprint${this.spots.indexOf(spot)}`, name: districtAt(spot.x, spot.z) };
    spot.cool = 8;
    this.placeGates();
    this.hud.toast('STREET SPRINT', `${path.length} gates. Beat ${clock(this.job.par)} for the big purse.`, 'cool', 3);
    this.audio.good();
  }

  placeGates() {
    const j = this.job;
    const put = (mesh, i) => {
      if (i >= j.path.length) { mesh.visible = false; return; }
      const n = nodes[j.path[i]];
      const from = i === 0 ? this.player : nodes[j.path[i - 1]];
      mesh.position.set(n.x, 5.4, n.z);
      mesh.rotation.y = Math.atan2(n.x - from.x, n.z - from.z);
      mesh.visible = true;
    };
    put(this.gate, j.index);
    put(this.gateNext, j.index + 1);
    if (j.index < j.path.length) { j.tx = nodes[j.path[j.index]].x; j.tz = nodes[j.path[j.index]].z; }
  }

  endJob(message, sub, kind) {
    this.job = null;
    this.target.visible = false;
    this.gate.visible = this.gateNext.visible = false;
    if (message) this.hud.toast(message, sub, kind, 3.4);
  }

  updateJob(dt) {
    const p = this.player, j = this.job;
    if (!j) {
      for (const s of this.spots) {
        s.cool -= dt;
        s.marker.visible = s.cool <= 0;
        if (s.cool > 0 || Math.hypot(p.x - s.x, p.z - s.z) > 3.6 || Math.abs(p.y - s.marker.position.y) > 3) continue;
        if (s.type === 'courier') this.startCourier(s);
        else if (p.mode === 'car') this.startSprint(s);
        else this.hintT = 0.5;
        break;
      }
      return;
    }
    for (const s of this.spots) s.marker.visible = false;
    if (j.type === 'taxi') this.updateTaxi(dt);
    else if (j.type === 'courier') {
      j.timer -= dt;
      if (j.timer < 10 && Math.floor(j.timer) !== Math.floor(j.timer + dt)) this.audio.tick();
      if (Math.hypot(p.x - j.tx, p.z - j.tz) < 4.6) {
        const reward = Math.round((60 + j.legDist * 0.22 + Math.max(0, j.timer) * 2) / 5) * 5;
        j.leg++; j.earned += reward;
        this.pay(reward, `parcel ${j.leg} of ${j.legs}`);
        this.audio.coin();
        this.fx.burst(26, j.tx, p.y + 1, j.tz, 5, 6, 0.9, 0.3, 1, 0.8, 0.3, 0.9, 9, 1);
        if (j.leg >= j.legs) {
          this.pay(150, 'run complete');
          this.audio.good();
          this.endJob('DELIVERED', `Courier run paid ${money(j.earned + 150)}`, 'good');
        } else this.nextDrop(p.x, p.z);
      } else if (j.timer <= 0) {
        this.audio.bad();
        this.endJob('TOO SLOW', 'The parcel went back to the depot.', 'bad');
      }
    } else if (j.type === 'sprint') {
      j.time += dt;
      if (Math.hypot(p.x - j.tx, p.z - j.tz) < 9) {
        j.index++;
        this.audio.checkpoint();
        if (j.index >= j.path.length) {
          const t = j.time;
          const prize = t <= j.par ? 450 : t <= j.par * 1.25 ? 250 : 100;
          const medal = t <= j.par ? 'GOLD' : t <= j.par * 1.25 ? 'SILVER' : 'BRONZE';
          this.pay(prize, `sprint · ${medal.toLowerCase()}`);
          const old = this.best[j.key];
          const record = !old || t < old;
          if (record) { this.best[j.key] = Math.round(t * 10) / 10; try { localStorage.setItem('port-vesper-best', JSON.stringify(this.best)); } catch (e) { /* private mode */ } }
          this.audio.good();
          this.endJob(medal, `${t.toFixed(1)} s${record ? ' · new best' : ''} · ${money(prize)}`, 'cool');
        } else this.placeGates();
      } else if (j.time > j.par * 2.5) {
        this.audio.bad();
        this.endJob('SPRINT OVER', 'The crowd went home.', 'bad');
      }
    }
  }

  // ---------------------------------------------------------------- police

  updateHeat(dt) {
    const p = this.player;
    this.crimeCool -= dt;
    const level = this.heatLevel;
    if (level === 0) {
      this.heat = Math.max(0, this.heat - dt * 0.02);
      this.bust = 0; this.cooling = false;
      this.warn = '';
      return;
    }
    let seen = false, close = false;
    for (const d of this.traffic.police()) {
      if (d.mode !== 'chase') continue;
      if (d.seesPlayer) seen = true;
      if (Math.hypot(d.car.x - p.x, d.car.z - p.z) < 7.5 && d.car !== p.car) close = true;
    }
    this.unseen = seen ? 0 : this.unseen + dt;
    this.cooling = this.unseen > 2;
    if (this.unseen > 9 + level * 2) {
      this.heat = 0;
      this.hud.toast('IN THE CLEAR', 'Harbor Patrol lost your trail.', 'cool', 2.6);
      this.audio.good();
      return;
    }
    const slow = p.speed < 2.4;
    this.bust = close && slow ? this.bust + dt : Math.max(0, this.bust - dt * 1.5);
    this.warn = this.bust > 0.25 ? 'They have you boxed in — move!' : '';
    if (this.bust > (p.mode === 'car' ? 2.3 : 1.3)) this.startCut('busted');
  }

  // ------------------------------------------------------------- cutaways

  startCut(type) {
    if (this.cut) return;
    this.cut = { type, t: 0, done: false };
    this.hud.fade(true);
    if (type === 'busted') { this.hud.toast('BUSTED', '', 'bad', 3.2); this.audio.bad(); }
    else { this.hud.toast('SPLASH!', 'Port Vesper does not have a swimming licence for you.', 'cool', 3.2); this.audio.splash(); }
  }

  updateCut(dt) {
    const c = this.cut, p = this.player;
    c.t += dt;
    if (!c.done && c.t > 0.75) {
      c.done = true;
      if (p.mode === 'car') { const car = p.car; p.exit(); if (c.type === 'swim') car.y = -20; }
      if (c.type === 'busted') {
        const fine = Math.min(this.cash, 120 * this.heatLevel);
        this.cash -= fine;
        if (fine) this.hud.feed(`<span style="color:#ff6b4a">−${money(fine)} fine</span>`);
        const s = landmarks.station;
        p.teleport(s.x, s.z, s.heading);
        this.heat = 0; this.bust = 0; this.unseen = 0;
        if (this.job) this.endJob(null);
      } else {
        // back to the nearest dry land
        let x = clamp(p.x, -184, 184), z = clamp(p.z, -188, 195);
        if (p.x < -192 && p.z > DOCKS.z0 && p.z < DOCKS.z1) { x = DOCKS.x0 + 8; z = clamp(p.z, DOCKS.z0 + 6, DOCKS.z1 - 6); }
        else if (p.z > 196) z = 194;
        else if (p.x > 186) x = 189; else if (p.x < -186) x = -189; else if (p.z < -186) z = -189;
        p.teleport(x, z, Math.atan2(-x, -z));
      }
    }
    if (c.t > 1.5) { this.hud.fade(false); this.cut = null; }
  }

  // ---------------------------------------------------------------- update

  update(dt, camYaw) {
    this.t += dt;
    const p = this.player;
    if (this.cut) { this.updateCut(dt); return; }
    this.updateJob(dt);
    this.updateHeat(dt);

    // tokens
    for (const k of this.tokens) {
      if (k.got) continue;
      k.mesh.rotation.y = this.t * 2.2 + k.x;
      k.mesh.position.y = k.y + Math.sin(this.t * 2.4 + k.z) * 0.14;
      const dx = p.x - k.x, dz = p.z - k.z, dy = p.y + 1 - k.y;
      const r = p.mode === 'car' ? 3.1 : 1.5;
      if (dx * dx + dz * dz < r * r && Math.abs(dy) < (k.air ? 3.4 : 2.2)) {
        k.got = true; k.mesh.visible = false;
        this.found++;
        this.pay(k.air ? 150 : 50, k.air ? 'stunt token' : 'token');
        this.audio.coin();
        this.fx.burst(22, k.x, k.y, k.z, 4, 5, 0.8, 0.28, 1, 0.82, 0.25, 0.95, 8, 1);
        if (this.found === this.tokens.length) { this.pay(2000, 'every token found'); this.hud.toast('COMPLETIONIST', 'All tokens collected.', 'good', 4); }
      }
    }

    // stunt jumps
    if (p.mode === 'car') {
      const car = p.car;
      if (car.landed > 0 && car.airTime > 0.75) {
        const bonus = Math.round((car.airTime * 90) / 10) * 10;
        this.pay(bonus, `air time ${car.airTime.toFixed(1)} s`);
        if (car.airTime > 1.25) this.hud.toast('BIG AIR', `${car.airTime.toFixed(1)} seconds off the ground`, 'cool', 2.2);
        this.audio.coin();
      }
      if (car.underwater()) this.startCut('swim');
    } else if (p.underwater()) this.startCut('swim');

    const district = districtAt(p.x, p.z);
    if (district !== this.lastDistrict) {
      if (this.lastDistrict && this.t > 6 && !this.job) this.hud.feed(`<span style="letter-spacing:.14em;text-transform:uppercase">${district}</span>`);
      this.lastDistrict = district;
    }
    this.hintT -= dt;
  }

  /** What the objective panel should say right now. */
  objective(camYaw) {
    const p = this.player, j = this.job;
    const toward = (x, z) => {
      const d = Math.hypot(x - p.x, z - p.z);
      return { dist: `${Math.round(d)} m`, angle: camYaw - Math.atan2(x - p.x, z - p.z) };
    };
    if (j && j.type === 'courier') {
      return { kicker: `Courier run · parcel ${j.leg + 1} of ${j.legs}`, text: `Deliver to ${j.district}`, ...toward(j.tx, j.tz), timer: clock(j.timer), low: j.timer < 10 };
    }
    if (j && j.type === 'taxi') {
      const pick = j.phase === 'pickup';
      return { kicker: `Taxi shift · ${j.fares} fare${j.fares === 1 ? '' : 's'} · ${money(j.earned)}`, text: pick ? `Collect a passenger in ${j.district}` : `Drop off in ${j.district} — stop in the marker`, ...toward(j.tx, j.tz), timer: pick ? '' : clock(j.timer), low: !pick && j.timer < 6 };
    }
    if (j && j.type === 'sprint') {
      return { kicker: `Street sprint · gate ${j.index + 1} of ${j.path.length}`, text: `Par ${clock(j.par)}`, ...toward(j.tx, j.tz), timer: `${j.time.toFixed(1)}`, low: j.time > j.par };
    }
    if (this.heatLevel > 0) {
      return { kicker: 'Wanted', text: this.cooling ? 'Stay out of sight…' : 'Shake Harbor Patrol', dist: '', timer: '', angle: null };
    }
    let best = null, bd = Infinity;
    for (const s of this.spots) {
      if (s.cool > 0) continue;
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return { kicker: 'Free roam', text: 'The city is yours', dist: '', timer: '', angle: null };
    const name = best.type === 'courier' ? 'Courier run' : 'Street sprint';
    const text = this.hintT > 0 && best.type === 'sprint' ? 'Bring a car to start the sprint' : `${name} nearby — drive into the ${best.type === 'courier' ? 'gold' : 'blue'} beam`;
    return { kicker: 'Find work', text, ...toward(best.x, best.z), timer: '' };
  }

  /** Blips for the minimap. */
  blips() {
    const out = this.blipList;
    out.length = 0;
    const p = this.player, j = this.job;
    if (j) out.push({ x: j.tx, z: j.tz, kind: 'target', pin: true });
    else for (const s of this.spots) if (s.cool <= 0) out.push({ x: s.x, z: s.z, kind: s.type, label: s.label, pin: true });
    for (const k of this.tokens) if (!k.got) out.push({ x: k.x, z: k.z, kind: 'token' });
    for (const d of this.traffic.police()) if (d.mode === 'chase') out.push({ x: d.car.x, z: d.car.z, kind: 'cop', pin: true });
    return out;
  }

  bestText() {
    const times = Object.values(this.best);
    return times.length ? `Best sprint ${Math.min(...times).toFixed(1)} s` : '';
  }
}

