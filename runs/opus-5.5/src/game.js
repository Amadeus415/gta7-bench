import * as THREE from '../vendor/three.module.js';
import { rng } from './util.js';
import { replan } from './traffic.js';

const R = rng(777);

// ---------------------------------------------------------------------------
// Courier jobs: pick up a parcel at the yellow beacon, deliver it to the green
// one before the clock runs out. Fragile cargo loses value in crashes.
// ---------------------------------------------------------------------------
const CARGO = [
  { name: 'a crate of rare vinyl', fragile: false },
  { name: 'a three-tier wedding cake', fragile: true },
  { name: 'a cooler of fresh lobsters', fragile: false },
  { name: 'a suspiciously ticking briefcase', fragile: true },
  { name: 'a signed surfboard', fragile: false },
  { name: 'a crate of antique lamps', fragile: true },
  { name: 'twelve pizzas, extra cheese', fragile: false },
  { name: 'a sleepy harbour cat', fragile: true },
  { name: 'a stack of court documents', fragile: false },
  { name: 'a box of glass fishing floats', fragile: true },
];

function makeMarker(scene, color) {
  const g = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 60, 20, 1, true), beamMat);
  beam.position.y = 30;
  const ringMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.1, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.2;
  const icon = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0xc89a5a, emissive: color, emissiveIntensity: 0.4 }));
  icon.position.y = 2.2;
  g.add(beam, ring, icon);
  g.visible = false;
  scene.add(g);
  return { g, icon, ring, beamMat };
}

export class Missions {
  constructor(scene, world, hud, sound) {
    this.world = world;
    this.hud = hud;
    this.sound = sound;
    this.pick = makeMarker(scene, 0xffc83a);
    this.drop = makeMarker(scene, 0x45ff8a);
    this.state = 'idle';
    this.cool = 0;
    this.streak = 0;
    this.completed = 0;
    this.job = null;
    // 3D arrow that floats over the player and points at the objective
    const ag = new THREE.ConeGeometry(0.35, 1.1, 4);
    ag.rotateX(Math.PI / 2);
    this.arrow = new THREE.Mesh(ag, new THREE.MeshStandardMaterial({ color: 0xffd23f, emissive: 0xffa000, emissiveIntensity: 0.7 }));
    this.arrow.visible = false;
    scene.add(this.arrow);
  }

  placeAway(px, pz, min, max) {
    const ok = this.world.places.filter((p) => {
      const d = Math.hypot(p.x - px, p.z - pz);
      return d > min && d < max;
    });
    return ok.length ? R.pick(ok) : R.pick(this.world.places);
  }

  offer(px, pz, near = false) {
    const place = near ? this.placeAway(px, pz, 35, 90) : this.placeAway(px, pz, 60, 200);
    this.job = { pickup: place };
    this.state = 'offer';
    this.pick.g.position.set(place.x, this.world.groundHeight(place.x, place.z), place.z);
    this.pick.g.visible = true;
    this.drop.g.visible = false;
  }

  start(px, pz) {
    const cargo = R.pick(CARGO);
    const dest = this.placeAway(px, pz, 140, 330);
    const dist = Math.hypot(dest.x - px, dest.z - pz);
    const time = Math.round(14 + dist / 8.5);
    this.job = { ...this.job, cargo, dest, time, maxTime: time, value: Math.round(90 + dist * 1.1), damage: 0 };
    this.state = 'deliver';
    this.pick.g.visible = false;
    this.drop.g.position.set(dest.x, this.world.groundHeight(dest.x, dest.z), dest.z);
    this.drop.g.visible = true;
    this.sound.chime();
    this.hud.toast(`Picked up <b>${cargo.name}</b>${cargo.fragile ? ' — <span style="color:#ff9a6a">fragile!</span>' : ''}`, 4);
  }

  onImpact(strength) {
    if (this.state !== 'deliver' || !this.job.cargo.fragile || strength < 6) return;
    const loss = Math.min(0.3, strength * 0.025);
    this.job.damage = Math.min(0.9, this.job.damage + loss);
    this.hud.toast(`<span style="color:#ff8a6a">Cargo damaged! −${Math.round(loss * 100)}%</span>`, 2);
  }

  update(dt, s) {
    const t = performance.now() / 1000;
    for (const m of [this.pick, this.drop]) {
      if (!m.g.visible) continue;
      m.icon.rotation.y = t * 2;
      m.icon.position.y = 2.2 + Math.sin(t * 3) * 0.25;
      m.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
      m.beamMat.opacity = 0.22 + s.night * 0.2;
    }
    if (this.state === 'idle' || this.state === 'cool') {
      this.cool -= dt;
      if (this.cool <= 0) this.offer(s.px, s.pz, this.completed === 0 && this.state === 'idle');
    } else if (this.state === 'offer') {
      const p = this.job.pickup;
      if (Math.hypot(p.x - s.px, p.z - s.pz) < 4.5) this.start(s.px, s.pz);
    } else if (this.state === 'deliver') {
      const j = this.job;
      j.time -= dt;
      if (Math.hypot(j.dest.x - s.px, j.dest.z - s.pz) < 5) {
        this.streak++;
        this.completed++;
        const timeBonus = Math.round(j.time * 4);
        const pay = Math.round((j.value + timeBonus) * (1 - j.damage) * (1 + (this.streak - 1) * 0.25));
        s.addMoney(pay);
        this.sound.cash();
        this.sound.chime();
        this.hud.big('DELIVERED', `+$${pay}${this.streak > 1 ? ` · streak x${this.streak}` : ''}${j.damage > 0 ? ` · ${Math.round(j.damage * 100)}% damaged` : ''}`, '#8dff9a', 3.5);
        this.drop.g.visible = false;
        this.state = 'cool';
        this.cool = 2.5;
      } else if (j.time <= 0) {
        this.streak = 0;
        this.sound.fail();
        this.hud.big('TOO LATE', 'The client cancelled the job', '#ff6a6a', 3);
        this.drop.g.visible = false;
        this.state = 'cool';
        this.cool = 3;
      }
    }

    // floating guide arrow
    const obj = this.objective();
    this.arrow.visible = !!obj;
    if (obj) {
      this.arrow.position.set(s.px, s.py + s.arrowH + Math.sin(t * 3) * 0.1, s.pz);
      this.arrow.rotation.y = Math.atan2(obj.x - s.px, obj.z - s.pz);
      this.arrow.scale.setScalar(s.arrowS ?? 1);
    }
  }

  objective() {
    if (this.state === 'offer') return { x: this.job.pickup.x, z: this.job.pickup.z, color: '#ffc83a' };
    if (this.state === 'deliver') return { x: this.job.dest.x, z: this.job.dest.z, color: '#45ff8a' };
    return null;
  }

  hudInfo() {
    if (this.state === 'offer') return { text: `<b>Courier job</b> waiting at <b>${this.job.pickup.name}</b><br><span style="opacity:.7;font-size:13px">Follow the yellow beacon</span>`, time: null };
    if (this.state === 'deliver') {
      const j = this.job;
      return { text: `Deliver ${j.cargo.name} to <b>${j.dest.name}</b>${j.damage > 0 ? `<br><span style="color:#ff9a6a;font-size:13px">${Math.round(j.damage * 100)}% damaged</span>` : ''}`, time: Math.max(0, j.time) };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Wanted level: crimes add stars, police cars hunt you down, and staying out of
// their sight lets the heat fade. Stop near a cruiser for too long and you're
// busted.
// ---------------------------------------------------------------------------
export class Wanted {
  constructor(traffic, hud, sound) {
    this.traffic = traffic;
    this.hud = hud;
    this.sound = sound;
    this.level = 0;
    this.evadeT = 0;
    this.bustT = 0;
    this.cool = 0;
    this.spawnT = 0;
    this.flash = false;
    this.siren = 0;
  }

  add(n, reason) {
    if (this.cool > 0 && n < 2) return;
    this.cool = 1.5;
    const before = this.level;
    this.level = Math.min(5, this.level + n);
    this.evadeT = 0;
    if (this.level > before) {
      this.hud.toast(`<span style="color:#ffd23f">★ ${reason}</span>`, 2.5);
      for (const c of this.traffic.police) {
        if (c.ai && Math.hypot(c.x - this.px, c.z - this.pz) < 260) c.ai.mode = 'chase';
      }
    }
  }

  update(dt, s) {
    const T = this.traffic;
    this.px = s.px; this.pz = s.pz;
    this.cool -= dt;
    this.flash = Math.floor(performance.now() / 160) % 2 === 0;
    let nearest = 1e9;
    // Prune police that lost their driver (e.g. the player stole the car).
    T.police = T.police.filter((c) => c.driver === 'ai' && c.ai);

    if (this.level > 0) {
      const want = Math.min(5, this.level + 1);
      this.spawnT -= dt;
      if (T.police.length < want && this.spawnT <= 0) {
        const c = T.spawnPolice(s.px, s.pz, 90, 170);
        if (c) c.ai.mode = 'chase';
        this.spawnT = 3;
      }
      for (const c of T.police) {
        if (c.ai.mode !== 'chase') c.ai.mode = 'chase';
        nearest = Math.min(nearest, Math.hypot(c.x - s.px, c.z - s.pz));
      }
      // evade
      if (nearest > 75) {
        this.evadeT += dt;
        if (this.evadeT > 8) {
          this.level--;
          this.evadeT = 0;
          if (this.level === 0) this.clear(true);
          else this.hud.toast('Heat is fading…', 2);
        }
      } else this.evadeT = 0;
      // busted
      if (nearest < 9 && s.speed < 3) {
        this.bustT += dt;
        if (this.bustT > 2.2) {
          const fine = Math.min(s.money, 150 * this.level);
          s.addMoney(-fine);
          this.hud.big('BUSTED', `Fined $${fine}`, '#5aa0ff', 3.5);
          this.sound.fail();
          s.onBusted();
          this.clear(false);
        }
      } else this.bustT = Math.max(0, this.bustT - dt * 0.5);
      this.siren = nearest < 160 ? 1 - nearest / 160 : 0;
    } else {
      this.siren = 0;
      this.bustT = 0;
      // keep a couple of patrol cars around, despawn far extras
      if (T.police.length < 2) {
        this.spawnT -= dt;
        if (this.spawnT <= 0) { T.spawnPolice(s.px, s.pz, 120, 300); this.spawnT = 5; }
      }
    }
    // retire extra police that are far away
    if (T.police.length > Math.max(2, this.level + 1)) {
      for (const c of T.police) {
        if (Math.hypot(c.x - s.px, c.z - s.pz) > 140) { this.removeCar(c); break; }
      }
    }
    const on = this.level > 0;
    const { red, blue } = s.lightMats;
    red.emissiveIntensity = on ? (this.flash ? 6 : 0.2) : 0.3;
    blue.emissiveIntensity = on ? (this.flash ? 0.2 : 6) : 0.3;
  }

  clear(evaded) {
    this.level = 0;
    this.evadeT = 0;
    this.bustT = 0;
    for (const c of this.traffic.police) {
      c.ai.mode = 'patrol';
      if (!replan(c)) { c.ai.dazed = 0.1; }
    }
    if (evaded) {
      this.hud.big('LOST THEM', 'The police gave up the chase', '#ffd23f', 3);
      this.sound.chime();
    }
  }

  removeCar(c) {
    const T = this.traffic;
    c.group.parent?.remove(c.group);
    T.police = T.police.filter((x) => x !== c);
    const i = T.cars.indexOf(c);
    if (i >= 0) T.cars.splice(i, 1);
  }
}

// ---------------------------------------------------------------------------
// Harbor Sprint: a checkpoint race around the city. Drive into the cyan beacon
// on Harbor Rd to start; rings mark the route.
// ---------------------------------------------------------------------------
const ROUTE = [
  [40, 160], [96, 160], [96, 96], [96, 32], [96, -32], [32, -32], [-32, -32],
  [-96, -32], [-96, 32], [-96, 96], [-96, 160], [-60, 160],
];
const RACE_START = { x: -60, z: 163.5 };
const PAR = 58;

export class Race {
  constructor(scene, world, hud, sound) {
    this.hud = hud;
    this.sound = sound;
    this.start = makeMarker(scene, 0x3ae0ff);
    this.start.g.position.set(RACE_START.x, 0, RACE_START.z);
    this.start.g.visible = true;
    this.active = false;
    this.best = null;
    this.idx = 0;
    this.t = 0;
    this.cool = 0;
    const ringGeo = new THREE.TorusGeometry(5.2, 0.35, 8, 40);
    this.rings = [0, 1].map((k) => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshStandardMaterial({ color: 0x3ae0ff, emissive: 0x18b0ff, emissiveIntensity: k ? 0.4 : 1.4, transparent: true, opacity: k ? 0.35 : 0.9 }));
      m.visible = false;
      scene.add(m);
      return m;
    });
  }

  place(ring, i) {
    if (i >= ROUTE.length) { ring.visible = false; return; }
    const [x, z] = ROUTE[i];
    const [px, pz] = i > 0 ? ROUTE[i - 1] : [RACE_START.x, RACE_START.z];
    ring.position.set(x, 4.2, z);
    ring.rotation.y = Math.atan2(x - px, z - pz);
    ring.visible = true;
  }

  update(dt, s) {
    this.cool -= dt;
    const t = performance.now() / 1000;
    if (this.start.g.visible) {
      this.start.icon.rotation.y = t * 2;
      this.start.beamMat.opacity = 0.22 + s.night * 0.2;
    }
    if (!this.active) {
      const d = Math.hypot(s.px - RACE_START.x, s.pz - RACE_START.z);
      if (d < 5 && this.cool <= 0) {
        if (!s.inCar || s.busy) {
          if (!this.warned) this.hud.toast(!s.inCar ? 'Harbor Sprint: come back in a car!' : 'Finish your delivery first.', 2);
          this.warned = true;
          return;
        }
        this.active = true;
        this.idx = 0;
        this.t = 0;
        this.start.g.visible = false;
        this.place(this.rings[0], 0);
        this.place(this.rings[1], 1);
        this.hud.big('HARBOR SPRINT', `${ROUTE.length} checkpoints · par ${PAR}s${this.best ? ` · best ${this.best.toFixed(1)}s` : ''}`, '#3ae0ff', 2.5);
        this.sound.chime();
      } else if (d > 8) this.warned = false;
      return;
    }
    this.t += dt;
    const [cx, cz] = ROUTE[this.idx];
    if (Math.hypot(s.px - cx, s.pz - cz) < 7.5) {
      this.idx++;
      this.sound.tone(880 + this.idx * 30, 0.15, 0.12, 'triangle');
      if (this.idx >= ROUTE.length) return this.finish(s);
      this.place(this.rings[0], this.idx);
      this.place(this.rings[1], this.idx + 1);
    }
    if (!s.inCar && this.t > 1) this.abort('You left your car. Race abandoned.');
    else if (this.t > 180) this.abort('Out of time. Race abandoned.');
  }

  finish(s) {
    const time = this.t;
    const record = this.best == null || time < this.best;
    if (record) this.best = time;
    const pay = time < PAR ? 400 : time < PAR * 1.3 ? 200 : 75;
    s.addMoney(pay);
    this.hud.big('FINISHED', `${time.toFixed(1)}s${record ? ' · new record!' : ` · best ${this.best.toFixed(1)}s`} · +$${pay}`, '#3ae0ff', 4);
    this.sound.cash();
    this.sound.chime();
    this.reset();
  }

  abort(msg) {
    this.hud.toast(msg, 2.5);
    this.sound.fail();
    this.reset();
  }

  reset() {
    this.active = false;
    this.cool = 4;
    for (const r of this.rings) r.visible = false;
    this.start.g.visible = true;
  }

  objective() {
    if (this.active) return { x: ROUTE[this.idx][0], z: ROUTE[this.idx][1], color: '#3ae0ff' };
    return null;
  }

  hudInfo() {
    if (!this.active) return null;
    const sub = `${this.best ? `best ${this.best.toFixed(1)}s · ` : ''}par ${PAR}s`;
    return { text: `<b>Harbor Sprint</b> · checkpoint ${this.idx + 1}/${ROUTE.length}<br><span style="opacity:.7;font-size:13px">${sub}</span>`, time: this.t, up: true };
  }
}
