import * as THREE from '../vendor/three.module.js';
import { buildWorld, SEA_Z } from './world.js';
import { Sky } from './sky.js';
import { Car, CAR_COLORS, LIGHT_MATS, collideCars } from './car.js';
import { Player } from './player.js';
import { Traffic } from './traffic.js';
import { Character, randomLook } from './character.js';
import { HUD } from './hud.js';
import { Sound } from './audio.js';
import { Missions, Wanted, Race } from './game.js';
import { TrafficLights } from './lights.js';
import { clamp, damp, dampAngle, rng, wrapAngle } from './util.js';

// ---------------------------------------------------------------------------
// Halcyon Bay: renderer, world, actors and the main loop.
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1600);

const world = buildWorld(scene);
const sky = new Sky(scene);
const hud = new HUD(world);
const sound = new Sound();
const R = rng(31337);

// ---- actors ----
const START = { x: 23.2, z: -80, h: 0 };
const START_CAR = { x: 26, z: -79.5, h: 0 };
const cars = [];
const startCar = new Car(scene, 'sports', 0xd8342c, START_CAR.x, START_CAR.z, START_CAR.h, world);
cars.push(startCar);

// Parked cars at the kerb around town.
const parkTypes = ['sedan', 'compact', 'pickup', 'van', 'sports', 'sedan', 'compact', 'taxi'];
const spots = world.parkSpots.filter((s) => Math.hypot(s.x - START.x, s.z - START.z) > 45);
for (let k = 0; k < 14 && spots.length; k++) {
  const s = spots.splice(Math.floor(R() * spots.length), 1)[0];
  const type = parkTypes[k % parkTypes.length];
  cars.push(new Car(scene, type, type === 'taxi' ? 0xf2c230 : R.pick(CAR_COLORS), s.x, s.z, s.h, world));
}
// A second car near the start, parked behind, so there's a choice.
cars.push(new Car(scene, 'pickup', 0x2e86de, 26, -86.5, 0, world));

const traffic = new Traffic(scene, world, cars);
// keep the start car's lane clear: no traffic spawns on that block
traffic.spawnTraffic(24, START.x, START.z, (s) => s.i === 3 && s.j <= 1 && s.d === 1);
traffic.spawnPolice(START.x, START.z, 120, 260);
traffic.spawnPolice(START.x, START.z, 120, 260);
traffic.spawnPeds(44);

const player = new Player(scene, world);
player.place(START.x, START.z, START.h);

const missions = new Missions(scene, world, hud, sound);
const wanted = new Wanted(traffic, hud, sound);
const race = new Race(scene, world, hud, sound);
const lights = new TrafficLights(scene, world);

// ---- game state ----
const state = {
  mode: 'foot',
  car: null,
  money: 250,
  hour: 11.0,
  hoursPerSec: 24 / 420, // a full day every 7 minutes
};
const addMoney = (v) => { state.money = Math.max(0, state.money + v); };

// headlight for whichever car the player drives
const headlight = new THREE.SpotLight(0xfff0d0, 0, 70, 0.55, 0.55, 1.6);
headlight.position.set(0, 0.8, 1.5);
headlight.target.position.set(0, 0, 14);
scene.add(headlight);
// a few real lights borrowed by the street lamps nearest the camera at night
const lampLights = [];
for (let i = 0; i < 4; i++) {
  const l = new THREE.PointLight(0xffc77a, 0, 22, 1.6);
  scene.add(l);
  lampLights.push(l);
}

// ---- skid marks: a ring buffer of dark quads laid behind sliding rear wheels ----
const skids = (() => {
  const N = 700;
  const geo = new THREE.PlaneGeometry(0.26, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0x0d0d0d, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) mesh.setMatrixAt(i, zero);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);
  let idx = 0;
  const last = [null, null];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
  return {
    update(car, on) {
      if (!car || !on) { last[0] = last[1] = null; return; }
      const sh = Math.sin(car.h), ch = Math.cos(car.h);
      const W = car.spec.wid / 2 - 0.15, back = -car.wheelbase / 2;
      [[W, 0], [-W, 1]].forEach(([side, k]) => {
        const x = car.x + sh * back - ch * -side, z = car.z + ch * back + sh * -side;
        const prev = last[k];
        if (prev) {
          const dx = x - prev.x, dz = z - prev.z, d = Math.hypot(dx, dz);
          if (d < 0.35) return;
          if (d < 3) {
            q.setFromAxisAngle(up, Math.atan2(dx, dz));
            p.set((x + prev.x) / 2, car.y + 0.03, (z + prev.z) / 2);
            sc.set(1, 1, d + 0.05);
            mesh.setMatrixAt(idx, m.compose(p, q, sc));
            idx = (idx + 1) % N;
            mesh.instanceMatrix.needsUpdate = true;
          }
        }
        last[k] = { x, z };
      });
    },
  };
})();

// ---- input ----
const keys = {};
let horn = null;
const BLOCK = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'];
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  sound.start();
  if (BLOCK.includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyF': toggleVehicle(); break;
    case 'KeyH': hud.helpOn = !hud.helpOn; hud.helpDirty = true; break;
    case 'KeyT': state.hour = (state.hour + 2) % 24; hud.toast(`Time skips ahead…`, 1.2); break;
    case 'KeyM': sound.muted = !sound.muted; hud.toast(sound.muted ? 'Sound off' : 'Sound on', 1.2); break;
    case 'KeyQ': sound.horn(); horn = { x: focusX(), z: focusZ() }; break;
    case 'KeyC': cam.far = !cam.far; break;
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; sound.start(); });
window.addEventListener('pointerup', () => { drag = null; });
window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag = { x: e.clientX, y: e.clientY };
  if (state.mode === 'foot') player.h -= dx * 0.006;
  else cam.lookYaw -= dx * 0.006;
  cam.pitch = clamp(cam.pitch + dy * 0.004, -0.3, 0.7);
});
canvas.addEventListener('wheel', (e) => { cam.zoom = clamp(cam.zoom + Math.sign(e.deltaY) * 0.1, 0.7, 1.8); }, { passive: true });

const key = (...codes) => codes.some((c) => keys[c]);
const focusX = () => (state.car ? state.car.x : player.x);
const focusZ = () => (state.car ? state.car.z : player.z);

// ---- entering / leaving vehicles ----
function nearestCar(maxGap) {
  let best = null, bd = maxGap;
  for (const c of cars) {
    const l = c.local(player.x, player.z);
    const gf = Math.max(0, Math.abs(l.f) - c.spec.len / 2), gr = Math.max(0, Math.abs(l.r) - c.spec.wid / 2);
    const d = Math.hypot(gf, gr);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

function toggleVehicle() {
  if (state.mode === 'foot') {
    const c = nearestCar(3.2);
    if (!c || player.knockT > 0) return;
    if (c.driver === 'ai') {
      // pull the driver out; they run off shouting
      const sh = Math.sin(c.h), ch = Math.cos(c.h);
      const look = randomLook(R);
      const ped = { ch: new Character(look), x: c.x + ch * (c.spec.wid / 2 + 0.7), z: c.z - sh * (c.spec.wid / 2 + 0.7), y: 0.15, h: c.h + Math.PI / 2, speed: 1.4, state: 'flee', fleeT: 8, vx: 0, vy: 0, vz: 0, cw: R() < 0.5, t: 0 };
      scene.add(ped.ch.root);
      ped.bi = clamp(Math.round((ped.x + 128) / 64), 0, 4);
      ped.bj = clamp(Math.round((ped.z + 128) / 64), 0, 4);
      ped.nextCorner = 0;
      ped.target = traffic.cornerPos(ped.bi, ped.bj, 0);
      traffic.peds.push(ped);
      if (c.type === 'police') wanted.add(2, 'Stole a police cruiser!');
      else if (traffic.police.some((p) => Math.hypot(p.x - c.x, p.z - c.z) < 50)) wanted.add(1, 'Carjacking witnessed by police');
      else hud.toast('Carjacked a ' + c.spec.name + '!', 2);
      traffic.police = traffic.police.filter((p) => p !== c);
    }
    c.driver = 'player';
    c.ai = null;
    c.input.accel = 0; c.input.steer = 0; c.input.handbrake = false;
    state.car = c;
    state.mode = 'car';
    player.char.root.visible = false;
    cam.yaw = c.h;
    sound.door();
    hud.toast(`<b>${c.spec.name}</b>`, 1.5);
  } else {
    const c = state.car;
    const sh = Math.sin(c.h), ch = Math.cos(c.h);
    const W = c.spec.wid / 2 + 0.55, L = c.spec.len / 2 + 0.6;
    // left door first (left = -right = (ch, -sh)), then the other sides
    const tries = [[ch * W, -sh * W], [-ch * W, sh * W], [-sh * L, -ch * L], [sh * L, ch * L]];
    let spot = null;
    for (const [ox, oz] of tries) {
      const x = c.x + ox, z = c.z + oz;
      if (world.groundHeight(x, z) < 0) continue;
      const blocked = world.grid.query(x, z, 0.5).some((col) => col.h > c.y + 0.4 && !col.stand && hits(x, z, col)) ||
        cars.some((o) => o !== c && o.contains(x, z, 0.3));
      if (!blocked) { spot = { x, z }; break; }
    }
    if (!spot) spot = { x: c.x, z: c.z, top: true };
    c.driver = null;
    c.input.accel = 0; c.input.steer = 0; c.input.handbrake = false;
    state.car = null;
    state.mode = 'foot';
    player.place(spot.x, spot.z, c.h);
    if (spot.top) player.y = c.y + c.spec.hgt;
    player.char.root.visible = true;
    cam.yaw = c.h;
    sound.door();
  }
}
function hits(x, z, c) {
  if (c.circle) return Math.hypot(x - c.x, z - c.z) < c.r + 0.4;
  return x > c.x0 - 0.4 && x < c.x1 + 0.4 && z > c.z0 - 0.4 && z < c.z1 + 0.4;
}

// ---- collisions between actors ----
function onCarHit(a, b, speed) {
  const pc = state.car;
  if (speed > 2.5) {
    const d = Math.hypot(a.x - camera.position.x, a.z - camera.position.z);
    if (d < 60) sound.crash(speed * (1 - d / 60));
  }
  if (pc && (a === pc || b === pc)) {
    const other = a === pc ? b : a;
    shake = Math.min(1, shake + speed * 0.05);
    missions.onImpact(speed);
    const atFault = pc.speed > 4 && pc.speed >= other.speed;
    if (other.type === 'police' && speed > 3 && atFault) wanted.add(1, 'Rammed a police car');
    else if (speed > 9 && atFault && traffic.police.some((p) => Math.hypot(p.x - pc.x, p.z - pc.z) < 45)) wanted.add(1, 'Reckless driving');
  }
  for (const c of [a, b]) {
    if (c.ai && speed > 4 && c.ai.mode !== 'chase') { c.ai.dazed = 1.5 + Math.random(); c.ai.honk = 0.5; }
  }
}
function onPedHit(p, car) {
  const d = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
  if (d < 50) sound.thud();
  if (car === state.car) {
    wanted.add(1, 'Hit a pedestrian');
    shake = Math.min(1, shake + 0.3);
  }
}

// ---- camera ----
const cam = { yaw: START.h, lookYaw: 0, pitch: 0.12, far: false, zoom: 1, fov: 62, pos: new THREE.Vector3(), target: new THREE.Vector3() };
let shake = 0;
const tmpV = new THREE.Vector3();
function updateCamera(dt) {
  const c = state.car;
  let tx, ty, tz, yaw, dist, height;
  if (c) {
    tx = c.x; ty = c.y + 1.3; tz = c.z;
    yaw = c.h;
    // look along the velocity when sliding or reversing slowly
    const sp = c.speed;
    if (sp > 4 && c.fwdSpeed > 0) yaw = c.h + wrapAngle(Math.atan2(c.vx, c.vz) - c.h) * 0.35;
    dist = ((cam.far ? 10 : 6.8) + Math.min(sp, 40) * 0.05) * cam.zoom;
    height = (cam.far ? 3.4 : 2.3) * cam.zoom;
    cam.yaw = dampAngle(cam.yaw, yaw + cam.lookYaw, 4.5, dt);
    if (!drag) cam.lookYaw = damp(cam.lookYaw, 0, 1.2, dt);
    cam.fov = damp(cam.fov, 62 + Math.min(sp, 50) * 0.32, 3, dt);
  } else {
    tx = player.x; ty = player.y + 1.55; tz = player.z;
    yaw = player.h;
    dist = 4.6 * cam.zoom;
    height = 1.0 * cam.zoom;
    cam.yaw = dampAngle(cam.yaw, yaw, 6, dt);
    cam.fov = damp(cam.fov, 60, 3, dt);
  }
  cam.target.set(tx, ty, tz);
  const ph = cam.pitch;
  const desired = tmpV.set(
    tx - Math.sin(cam.yaw) * dist * Math.cos(ph),
    ty + height * 0.6 + Math.sin(ph) * dist,
    tz - Math.cos(cam.yaw) * dist * Math.cos(ph),
  );
  // pull in when a building is in the way
  const steps = 12;
  let ok = 1;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = tx + (desired.x - tx) * t, y = ty + (desired.y - ty) * t, z = tz + (desired.z - tz) * t;
    if (world.solidAt(x, y, z)) { ok = (i - 1) / steps; break; }
  }
  desired.set(tx + (desired.x - tx) * ok, ty + (desired.y - ty) * ok, tz + (desired.z - tz) * ok);
  desired.y = Math.max(desired.y, world.groundHeight(desired.x, desired.z) + 0.4);
  camera.position.copy(desired);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake * 0.5;
    camera.position.y += (Math.random() - 0.5) * shake * 0.5;
    shake = Math.max(0, shake - dt * 2.5);
  }
  const ahead = c ? 2.5 : 1.2;
  camera.lookAt(tx + Math.sin(cam.yaw) * ahead, ty + (c ? 0.2 : 0.1), tz + Math.cos(cam.yaw) * ahead);
  camera.fov = cam.fov;
  camera.updateProjectionMatrix();
}

// ---- test hook ----
window.__bench = {
  state() {
    if (state.mode === 'car' && state.car) {
      const c = state.car;
      return { mode: 'car', x: c.x, y: c.y, z: c.z, speed: c.speed };
    }
    return { mode: 'foot', x: player.x, y: player.y, z: player.z, speed: player.groundSpeed };
  },
};

window.__dbg = { race, renderer, cars, traffic, player, state, camera, cam, wanted, missions, world, sky };

// ---- main loop ----
let last = performance.now();
let elapsed = 0;
let lampT = 0;
let stepPhase = 0;
const nearestLamps = [];
hud.toast('Welcome to <b>Halcyon Bay</b>. Press <b>F</b> to take the car, then chase the <span style="color:#ffc83a">yellow beacon</span> for a courier job, or the <span style="color:#3ae0ff">cyan</span> one on the waterfront for a race.', 8);

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0)) dt = 1 / 60;
  dt = Math.min(dt, 1 / 20);
  elapsed += dt;
  update(dt);
  const dc = window.__dbgCam;
  if (dc) { camera.position.set(dc[0], dc[1], dc[2]); camera.lookAt(dc[3], dc[4], dc[5]); }
  renderer.render(scene, camera);
}

function update(dt) {
  state.hour = (state.hour + dt * state.hoursPerSec) % 24;
  const pc = state.car;

  if (state.mode === 'foot') {
    const fwd = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0);
    const turn = (key('KeyA', 'ArrowLeft') ? 1 : 0) - (key('KeyD', 'ArrowRight') ? 1 : 0);
    const res = player.update(dt, { fwd, turn, strafe: 0, run: key('ShiftLeft', 'ShiftRight'), jump: key('Space') }, cars);
    if (res === 'splash') {
      sound.splash();
      hud.toast('Splash! You climb back onto the promenade.', 2.5);
      player.place(clamp(player.x, -170, 170), 185, Math.PI);
    }
    if (player.onGround && player.groundSpeed > 0.5) {
      stepPhase += dt * player.groundSpeed * 0.9;
      if (stepPhase > 1) { stepPhase = 0; sound.step(); }
    }
  } else if (pc) {
    pc.input.accel = (key('KeyW', 'ArrowUp') ? 1 : 0) - (key('KeyS', 'ArrowDown') ? 1 : 0);
    pc.input.steer = (key('KeyD', 'ArrowRight') ? 1 : 0) - (key('KeyA', 'ArrowLeft') ? 1 : 0);
    pc.input.handbrake = key('Space');
  }

  lights.update(dt);
  traffic.updateDrivers(dt, { player, playerCar: pc, wanted: wanted.level, lights });

  const SUB = 2;
  for (let s = 0; s < SUB; s++) {
    for (const c of cars) {
      if (c.speed < 0.01 && c.input.accel === 0 && !c.driver) continue;
      const imp = c.step(dt / SUB);
      if (imp > 2.5) {
        const d = Math.hypot(c.x - camera.position.x, c.z - camera.position.z);
        if (d < 60) sound.crash(imp * (1 - d / 60));
        if (c === pc) { shake = Math.min(1, shake + imp * 0.05); missions.onImpact(imp); }
        if (c.ai && imp > 5 && c.ai.mode !== 'chase') c.ai.dazed = 1;
      }
    }
    collideCars(cars, onCarHit);
  }
  for (const c of cars) {
    c.sync(dt);
    // keep cars out of the sea
    if (c.z > SEA_Z - 1 && world.groundHeight(c.x, c.z) < 0) { c.z = SEA_Z - 1.5; c.vz = -Math.abs(c.vz) * 0.3; }
  }

  skids.update(pc, pc && pc.speed > 4 && (pc.slip > 3 || pc.input.handbrake));

  // cars running over the player on foot
  if (state.mode === 'foot' && player.knockT <= 0) {
    for (const c of cars) {
      if (c.speed > 4.5 && c.contains(player.x, player.z, 0.2) && player.y < c.y + c.spec.hgt - 0.3) {
        player.knock(c.vx * 0.7, c.vz * 0.7);
        sound.thud();
        shake = 0.6;
        hud.toast('Ouch! Watch the traffic.', 1.5);
        break;
      }
    }
  }
  if (state.mode === 'foot') player.sync(dt);

  traffic.updatePeds(dt, { player: state.mode === 'foot' ? player : null, playerCar: pc, camX: camera.position.x, camZ: camera.position.z, onPedHit, honk: horn });
  horn = null;

  const fx = focusX(), fz = focusZ();
  const fy = pc ? pc.y : player.y;
  wanted.update(dt, {
    px: fx, pz: fz, speed: pc ? pc.speed : player.groundSpeed, money: state.money, addMoney,
    lightMats: LIGHT_MATS,
    onBusted: () => { if (pc) { pc.vx = pc.vz = 0; } },
  });
  race.update(dt, { px: fx, pz: fz, inCar: !!pc, busy: missions.state === 'deliver', addMoney, night: sky.night });
  missions.update(dt, { px: fx, py: fy, pz: fz, addMoney, night: sky.night, arrowH: pc ? pc.spec.hgt + 1.3 : 2.45, arrowS: pc ? 1 : 0.4 });

  updateCamera(dt);

  // lighting and atmosphere
  sky.update(state.hour, tmpFocus.set(fx, 0, fz), camera);
  const n = sky.night;
  world.update(dt, elapsed, n);
  LIGHT_MATS.head.emissiveIntensity = 0.4 + n * 3;
  LIGHT_MATS.tail.emissiveIntensity = 0.4 + n * 1.2;
  LIGHT_MATS.beam.opacity = n * 0.35;
  LIGHT_MATS.sign.emissiveIntensity = 0.6 + n * 2;
  if (pc) {
    headlight.intensity = n * 900;
    const sh = Math.sin(pc.h), ch = Math.cos(pc.h);
    headlight.position.set(pc.x + sh * 2, pc.y + 0.9, pc.z + ch * 2);
    headlight.target.position.set(pc.x + sh * 20, 0, pc.z + ch * 20);
    headlight.target.updateMatrixWorld();
  } else headlight.intensity = 0;
  lampT -= dt;
  if (lampT <= 0) {
    lampT = 0.4;
    nearestLamps.length = 0;
    const cx = camera.position.x, cz = camera.position.z;
    const sorted = world.lamps.filter((l) => !l.broken).map((l) => ({ l, d: (l.hx - fx) ** 2 + (l.hz - fz) ** 2 + ((l.hx - cx) ** 2 + (l.hz - cz) ** 2) * 0.3 })).sort((a, b) => a.d - b.d);
    for (let i = 0; i < lampLights.length; i++) nearestLamps.push(sorted[i].l);
  }
  lampLights.forEach((L, i) => {
    const l = nearestLamps[i];
    if (!l) return;
    L.position.set(l.hx, 5.8, l.hz);
    L.intensity = n * 55;
  });

  // HUD
  let prompt = null;
  if (state.mode === 'foot') {
    const c = nearestCar(3.2);
    if (c) prompt = `Press <b>F</b> to ${c.driver === 'ai' ? 'carjack' : 'drive'} the ${c.spec.name}`;
  }
  const mi = race.hudInfo() || missions.hudInfo();
  const sp = pc ? pc.fwdSpeed : 0;
  const gear = pc ? (sp < -0.5 ? 'R' : Math.abs(sp) < 0.5 ? 'N' : String(Math.min(6, 1 + Math.floor(Math.abs(sp) / 9)))) : '';
  hud.update(dt, {
    mode: state.mode, hour: state.hour, money: state.money, wanted: wanted.level, evading: wanted.evadeT > 0.5,
    mission: mi, prompt, speed: pc ? pc.speed : 0, carName: pc ? pc.spec.name : '', gear,
    camYaw: cam.yaw, heading: pc ? pc.h : player.h, px: fx, pz: fz, cars, peds: traffic.peds,
    objective: race.objective() || missions.objective(),
    extras: race.active ? [] : [{ x: -60, z: 163.5, color: '#3ae0ff', small: true }], flash: wanted.flash, location: world.locationName(fx, fz),
  });
  const harbor = clamp(1 - (SEA_Z - fz) / 60, 0, 1);
  sound.update({ inCar: !!pc, speed: pc ? pc.fwdSpeed : 0, throttle: pc ? Math.abs(pc.input.accel) : 0, slip: pc ? pc.slip : 0, siren: wanted.siren, harbor });
}
const tmpFocus = new THREE.Vector3();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

updateCamera(1 / 60);
requestAnimationFrame(frame);
