import * as THREE from '../vendor/three.module.js';
import { buildWorld, PARKED_CARS } from './world.js';
import { Vehicle } from './vehicle.js';
import { Character, setFootstepHook } from './player.js';
import { initLife, updateLife } from './life.js';
import { MissionManager } from './missions.js';
import { SoundFX } from './audio.js';
import { HUD } from './hud.js';

// ---------------------------------------------------------------- renderer
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.domElement.classList.add('game');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#87b4e0');
scene.fog = new THREE.Fog('#87b4e0', 60, 250);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 700);

// ---------------------------------------------------------------- lights
const sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 5;
sun.shadow.camera.far = 420;
sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
sun.shadow.bias = -0.0025;
scene.add(sun);
scene.add(sun.target);

const moon = new THREE.DirectionalLight(0x7fa3d8, 0.0);
moon.castShadow = false;
scene.add(moon);
scene.add(moon.target);

const hemi = new THREE.HemisphereLight(0x9db4d0, 0x2c2a26, 0.6);
scene.add(hemi);

// ---------------------------------------------------------------- world
const world = buildWorld(scene);

// parked cars (enterable). Each keeps a dynamic circle collider.
const parkedCars = PARKED_CARS.map((c) => {
  const v = new Vehicle(c.color, { name: c.name, x: c.x, z: c.z, heading: c.heading });
  v.enterable = true;
  v.circle = { x: c.x, z: c.z, r: 2.3 };
  scene.add(v.group);
  // headlight spot (night only, active car)
  const headlight = new THREE.SpotLight(0xffe9b0, 0, 48, 0.44, 0.5, 1.5);
  headlight.position.set(0, 0.62, 2.0);
  headlight.target.position.set(0, 0.15, 14);
  v.group.add(headlight, headlight.target);
  v.headlight = headlight;
  return v;
});

// traffic + peds
const life = initLife(scene);

// player (starts next to the starter car, facing it)
const START = parkedCars[0];
const player = new Character(START.x + 1.85, START.z + 0.35, START.heading);
scene.add(player.group);

// sound + HUD
const fx = new SoundFX();
setFootstepHook(fx);
const mission = new MissionManager(world);
mission.setupBeacon(scene);
const hud = new HUD(scene, world, mission);
hud.setTraffic(life.traffic);
hud.setPeds(life.peds);
hud.setVehicles(parkedCars);

// ---------------------------------------------------------------- state
let mode = 'foot';           // 'foot' | 'car'
let activeCar = null;
let camYaw = player.heading;
let camDist = 6.8;
let camHeight = 2.5;
let camLookY = 1.5;
let phase = 0.32;             // day/night cycle (~180 s)
const CYCLE = 180;

const keys = {};
const fwdKey = () => keys['KeyW'] || keys['ArrowUp'];
const backKey = () => keys['KeyS'] || keys['ArrowDown'];
const leftKey = () => keys['KeyA'] || keys['ArrowLeft'];
const rightKey = () => keys['KeyD'] || keys['ArrowRight'];
const runKey = () => keys['ShiftLeft'] || keys['ShiftRight'];
const handbrakeKey = () => !!keys['Space'];

function setFootModePos() {
  // place the player beside the active car (tries both sides); face the car
  const car = activeCar;
  if (!car) return;
  const right = car.right;
  let placed = false;
  for (const side of [1, -1]) {
    const px = car.x + right.x * 3.1 * side;
    const pz = car.z + right.z * 3.1 * side;
    if (Math.abs(px) > 160 || Math.abs(pz) > 160) continue;
    let bad = false;
    for (const b of world.boxColliders) {
      if (px > b.minX - 0.6 && px < b.maxX + 0.6 && pz > b.minZ - 0.6 && pz < b.maxZ + 0.6) { bad = true; break; }
    }
    if (!bad) {
      for (const c of world.circleColliders) {
        if (Math.hypot(px - c.x, pz - c.z) < c.r + 0.6) { bad = true; break; }
      }
    }
    for (const other of parkedCars) {
      if (other === car) continue;
      if (Math.hypot(px - other.x, pz - other.z) < other.circle.r + 0.6) { bad = true; break; }
    }
    if (bad) continue;
    player.setPos(px, pz, car.heading);
    player.airY = 0; player.grounded = true; player.speed = 0;
    placed = true;
    break;
  }
  if (!placed) {
    // last resort: keep the player just behind the car
    player.setPos(car.x - Math.sin(car.heading) * 3.4, car.z - Math.cos(car.heading) * 3.4, car.heading);
    player.airY = 0; player.grounded = true; player.speed = 0;
  }
}

function tryEnterCar() {
  let best = null, bestD = 3.4;
  for (const c of parkedCars) {
    if (!c.enterable) continue;
    const d = Math.hypot(c.x - player.x, c.z - player.z);
    if (d < bestD) { best = c; bestD = d; }
  }
  if (!best) return;
  activeCar = best;
  mode = 'car';
  best.speed = 0; best.steer = 0; best.lastHit = 0;
  fx.enter();
  player.group.visible = false;
  camYaw = best.heading;
}

function tryExitCar() {
  const car = activeCar;
  if (!car) return;
  setFootModePos();
  car.speed = 0;
  car.headlight.intensity = 0;
  car.headlight.visible = false;
  activeCar = null;
  mode = 'foot';
  player.group.visible = true;
  fx.exit();
}

// ---------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  keys[e.code] = true;
  fx.resume();
  if (e.repeat) return;
  if (e.code === 'Space' && mode === 'foot') { player.jump(); fx.jump(); }
  if (e.code === 'KeyF') {
    if (mode === 'foot') tryEnterCar();
    else tryExitCar();
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k of Object.keys(keys)) keys[k] = false; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- bench hook
const bench = {
  state() {
    if (mode === 'car' && activeCar) {
      return { mode: 'car', x: activeCar.x, y: 0, z: activeCar.z, speed: Math.abs(activeCar.speed) };
    }
    return { mode: 'foot', x: player.x, y: world.groundHeight(player.x, player.z) + player.airY, z: player.z, speed: Math.abs(player.speed) };
  },
};
window.__bench = bench;

// ---------------------------------------------------------------- helpers
const daySky = new THREE.Color('#8fb8e6');
const duskSky = new THREE.Color('#e8975a');
const nightSky = new THREE.Color('#0b0f22');
const sky = new THREE.Color();
const fog = scene.fog;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const dampAngle = (cur, target, lambda, dt) => {
  let diff = target - cur;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return cur + diff * Math.min(1, lambda * dt);
};

function updateDayNight(dt) {
  phase = (phase + dt / CYCLE) % 1;
  const a = (phase - 0.25) * Math.PI * 2;
  const elevation = Math.sin(a);
  const dayF = clamp01((elevation + 0.06) / 0.3);
  const duskF = clamp01(1 - Math.abs(elevation - 0.08) / 0.15);
  sky.copy(nightSky).lerp(daySky, dayF);
  sky.lerp(duskSky, duskF * 0.45 * (1 - dayF * 0.4));
  scene.background = sky;
  fog.color.copy(sky);
  fog.near = 70 - (1 - dayF) * 18;
  fog.far = 255 - (1 - dayF) * 70;

  sun.intensity = Math.max(0, elevation) * 3.4;
  const az = a;
  const sunDir = {
    x: Math.sin(az) * Math.cos(a), y: Math.max(0.12, elevation), z: Math.cos(az) * Math.cos(a),
  };
  sun.position.set(
    (mode === 'car' && activeCar ? activeCar.x : player.x) + sunDir.x * 190,
    sunDir.y * 190,
    (mode === 'car' && activeCar ? activeCar.z : player.z) + sunDir.z * 190,
  );
  sun.target.position.set(mode === 'car' && activeCar ? activeCar.x : player.x, 0, mode === 'car' && activeCar ? activeCar.z : player.z);
  sun.target.updateMatrixWorld();

  moon.intensity = (1 - dayF) * 0.45;
  moon.position.set(player.x - sunDir.x * 120, 100, player.z - sunDir.z * 120);
  moon.target.position.set(player.x, 0, player.z);
  moon.target.updateMatrixWorld();

  hemi.intensity = 0.22 + dayF * 0.5;
  hemi.color.setHSL(0.58, 0.28, 0.55 + dayF * 0.18);

  const nightF = 1 - dayF;
  for (const m of world.lampHeadMaterials) m.emissiveIntensity = 0.3 + nightF * 2.3;
  for (const m of world.buildingMats) m.emissiveIntensity = nightF * 1.45;
  return { nightF, dayF };
}

function updateTrafficAndPeds(dt) {
  const playerPos = mode === 'car' && activeCar ? { x: activeCar.x, z: activeCar.z } : { x: player.x, z: player.z };
  updateLife(life, dt, world, playerPos, mode);
}

// ---------------------------------------------------------------- game loop
let last = performance.now();

hud.bannerShow('Lumen City — open-world courier', 3.4);

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  const { nightF } = updateDayNight(dt);

  // mission
  const missionPoint = mission.target();
  const px = mode === 'car' && activeCar ? activeCar.x : player.x;
  const pz = mode === 'car' && activeCar ? activeCar.z : player.z;
  const playerPos = { x: px, z: pz };

  const missionResult = mission.update(dt, playerPos, fx);
  if (missionResult) {
    if (missionResult.kind === 'pickup') {
      hud.bannerShow('Package picked up!', 2.2);
      hud.setMissionFlash('Package secured — deliver it!');
    } else {
      hud.bannerShow('Delivered! +250', 2.4);
      hud.setMissionFlash('Delivered! +250');
    }
  }

  // vehicle / player
  let speed = 0;
  if (mode === 'car' && activeCar) {
    const input = {
      throttle: (fwdKey() ? 1 : 0) + (backKey() ? -1 : 0),
      steer: (rightKey() ? 1 : 0) - (leftKey() ? 1 : 0),
      handbrake: !!keys['Space'],
    };
    // world with only non-active cars as obstacles
    const staticCircles = world.circleColliders;
    const othersCircles = [];
    for (const c of parkedCars) {
      if (c === activeCar) continue;
      c.circle.x = c.x; c.circle.z = c.z;
      othersCircles.push(c.circle);
    }
    speed = activeCar.update(dt, input, { ...world, circleColliders: [...staticCircles, ...othersCircles] }, fx);
    activeCar.circle.x = activeCar.x; activeCar.circle.z = activeCar.z;
    activeCar.headlight.intensity = nightF > 0.25 ? 55 * nightF : 0;
    activeCar.headlight.visible = nightF > 0.25;
    for (const c of parkedCars) {
      if (c !== activeCar) { c.headlight.intensity = 0; c.headlight.visible = false; }
    }
    // simple traffic bump
    for (const t of life.traffic) {
      const dx = activeCar.x - t.group.position.x, dz = activeCar.z - t.group.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 3.6 && d > 0.01) {
        const push = (3.6 - d) * 0.55;
        activeCar.x += (dx / d) * push;
        activeCar.z += (dz / d) * push;
        activeCar.speed *= 0.75;
        if (activeCar.lastHit <= 0) { fx.thud(0.5); activeCar.lastHit = 0.5; }
      }
    }
    speed = Math.abs(activeCar.speed);
  } else {
    const input = { forward: fwdKey(), back: backKey(), left: leftKey(), right: rightKey(), run: runKey() };
    const othersCircles = [];
    for (const c of parkedCars) {
      c.circle.x = c.x; c.circle.z = c.z;
      othersCircles.push(c.circle);
    }
    speed = player.update(dt, input, { ...world, circleColliders: [...world.circleColliders, ...othersCircles] }, fx);
    // engine off while on foot
    fx.setEngine(0, false);
  }

  // engine sound follows speed
  if (mode === 'car' && activeCar) fx.setEngine(Math.abs(activeCar.speed) / activeCar.maxSpeed, true);

  // life
  updateTrafficAndPeds(dt);

  // camera
  const target = mode === 'car' && activeCar ? { x: activeCar.x, z: activeCar.z, h: activeCar.heading } : { x: player.x, z: player.z, h: player.heading };
  camYaw = dampAngle(camYaw, target.h, mode === 'car' ? 5.5 : 6.5, dt);
  const wantDist = mode === 'car' ? 8.4 : 6.8;
  const wantHeight = mode === 'car' ? 3.5 : 2.55;
  const wantLook = mode === 'car' ? 1.1 : 1.55;
  camDist = THREE.MathUtils.damp(camDist, wantDist, 3.2, dt);
  camHeight = THREE.MathUtils.damp(camHeight, wantHeight, 3.2, dt);
  camLookY = THREE.MathUtils.damp(camLookY, wantLook, 3.2, dt);
  const camAhead = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
  const camX = target.x - camAhead.x * camDist;
  const camZ = target.z - camAhead.z * camDist;
  const camY = camHeight + (mode === 'foot' ? world.groundHeight(player.x, player.z) : 0);
  camera.position.set(camX, camY, camZ);
  camera.lookAt(target.x, camLookY, target.z);

  // FOV boost with speed
  const fovT = mode === 'car' ? 55 + clamp01(Math.abs(activeCar ? activeCar.speed : 0) / 34) * 9 : 55;
  camera.fov = THREE.MathUtils.damp(camera.fov, fovT, 5, dt);
  camera.updateProjectionMatrix();

  // HUD
  const nearCar = mode === 'foot' && parkedCars.some((c) => Math.hypot(c.x - player.x, c.z - player.z) < 3.4);
  hud.update(dt, {
    mode,
    x: px, y: mode === 'foot' ? world.groundHeight(player.x, player.z) + player.airY : 0, z: pz,
    speed: speed,
    heading: target.h,
    score: mission.score,
    deliveries: mission.deliveries,
    missionPoint,
    nearCar,
    playerPos,
  });

  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
