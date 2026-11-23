// Port Vesper: entry point. Builds the world, then runs the frame loop that
// ties input, physics, AI, camera, effects, HUD and sound together.
import * as THREE from '../vendor/three.module.js';
import { clamp, damp, dampAngle, lerp, wrapAngle } from './util.js';
import { SPAWN, groundHeight, colliders, districtAt, nearestNode, PLAZA, DOCKS } from './world.js';
import { buildCity, nightGlow } from './city.js';
import { buildScenery } from './scenery.js';
import { Sky } from './sky.js';
import { Particles, SkidMarks } from './fx.js';
import { props } from './props.js';
import { Traffic } from './traffic.js';
import { setCarLights } from './vehicles.js';
import { Crowd } from './people.js';
import { Player } from './player.js';
import { Hud } from './hud.js';
import { GameAudio } from './audio.js';
import { Game } from './game.js';
import { Post } from './post.js';

// The test hook exists from the first moment; the frame loop keeps it current.
const bench = { mode: 'foot', x: SPAWN.x + 0.5, y: 0.15, z: SPAWN.z + 1.8, speed: 0 };
window.__bench = { state: () => ({ mode: bench.mode, x: bench.x, y: bench.y, z: bench.z, speed: bench.speed }) };

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const post = new Post(renderer);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.25, 3200);
camera.userData.dir = { x: 1, z: 0 };

const sky = new Sky(scene, renderer, Number(params.get('hour') ?? 15.8));
const city = buildCity(scene);
const fx = new Particles(scene);
const skids = new SkidMarks(scene);
const scenery = buildScenery(scene, city);
city.finish();

const traffic = new Traffic(scene);
const heroCar = traffic.populate();
const crowd = new Crowd(scene, 60);
const player = new Player(scene, bench.x, bench.z, SPAWN.heading);
const hud = new Hud();
const audio = new GameAudio();
const game = new Game({ scene, player, traffic, crowd, hud, audio, fx });

// Headlights for whichever car the player is driving.
const headlight = new THREE.SpotLight(0xfff0d0, 0, 70, 0.55, 0.7, 1.3);
scene.add(headlight, headlight.target);

// ------------------------------------------------------------------ input
const keys = new Set();
const input = { forward: false, back: false, left: false, right: false, run: false, jump: false };
let actionPressed = false, radioPressed = false, hornPressed = false;
window.addEventListener('keydown', (e) => {
  audio.resume();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF' || e.code === 'Enter') actionPressed = true;
  if (e.code === 'KeyR') radioPressed = true;
  if (e.code === 'KeyE') game.startTaxi();
  if (e.code === 'KeyH') hornPressed = true;
  if (e.code === 'KeyC') cam.zoom = (cam.zoom + 1) % 3;
  if (e.code === 'Tab') hud.toggleHelp();
  if (e.code === 'KeyB') post.enabled = !post.enabled && !!post.sceneRT;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
let dragging = false;
canvas.addEventListener('pointerdown', (e) => { dragging = true; audio.resume(); canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  cam.orbitYaw -= e.movementX * 0.006;
  cam.orbitPitch = clamp(cam.orbitPitch + e.movementY * 0.004, -0.3, 0.9);
  cam.orbitIdle = 0;
});
canvas.addEventListener('wheel', (e) => { cam.wheel = clamp(cam.wheel + e.deltaY * 0.001, -0.4, 1.2); }, { passive: true });
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  post.resize();
});

function readInput() {
  input.forward = keys.has('KeyW') || keys.has('ArrowUp');
  input.back = keys.has('KeyS') || keys.has('ArrowDown');
  input.left = keys.has('KeyA') || keys.has('ArrowLeft');
  input.right = keys.has('KeyD') || keys.has('ArrowRight');
  input.run = keys.has('ShiftLeft') || keys.has('ShiftRight');
  input.jump = keys.has('Space');
}

// ----------------------------------------------------------------- camera
const cam = { yaw: SPAWN.heading, orbitYaw: 0.5, orbitPitch: 0.06, orbitIdle: 9, pull: 1, shake: 0, zoom: 0, wheel: 0, ty: 0.15, dist: 5.4, fov: 60 };
const ZOOMS = [1, 1.45, 0.72];
const _look = new THREE.Vector3();

function updateCamera(dt) {
  const inCar = player.mode === 'car';
  const car = player.car;
  let want = player.heading;
  let follow = 3.4;
  if (inCar) {
    if (car.speed > 6 && car.forward > 0) want = car.heading + wrapAngle(Math.atan2(car.vx, car.vz) - car.heading) * 0.45;
    follow = 2.6 + Math.min(car.speed * 0.1, 3.4);
    if (car.forward < -1) follow = 0.6;
  }
  cam.yaw = dampAngle(cam.yaw, want, follow, dt);
  cam.orbitIdle += dt;
  if (cam.orbitIdle > 2.2 && !dragging && player.speed > 1) {
    cam.orbitYaw = damp(cam.orbitYaw, 0, 2.5, dt);
    cam.orbitPitch = damp(cam.orbitPitch, 0, 2.5, dt);
  }
  const yaw = cam.yaw + cam.orbitYaw;
  const pitch = clamp((inCar ? 0.19 : 0.2) + cam.orbitPitch, -0.12, 1.25);
  const wantDist = (inCar ? 7.2 + car.speed * 0.045 : 5.2) * ZOOMS[cam.zoom] * (1 + cam.wheel);
  cam.dist = damp(cam.dist, wantDist, 4, dt);
  cam.ty = damp(cam.ty, player.y, inCar ? 9 : 7, dt);
  const tx = player.x, ty = cam.ty + (inCar ? 1.25 : 1.5), tz = player.z;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const back = cam.dist * Math.cos(pitch);
  let cx = tx - sin * back, cz = tz - cos * back;
  let cy = ty + cam.dist * Math.sin(pitch) + (inCar ? 0.5 : 0.25);
  // do not let buildings come between the camera and the player
  const hit = colliders.raycast(tx, tz, cx, cz);
  const pull = hit < 1 ? Math.max(0.16, hit - 0.05) : 1;
  cam.pull = pull < cam.pull ? pull : damp(cam.pull, pull, 3, dt);
  cx = tx + (cx - tx) * cam.pull; cz = tz + (cz - tz) * cam.pull;
  cy = ty + (cy - ty) * Math.max(cam.pull, 0.5);
  cy = Math.max(cy, groundHeight(cx, cz) + 0.5);
  if (cam.shake > 0.001) {
    cx += (Math.random() - 0.5) * cam.shake; cy += (Math.random() - 0.5) * cam.shake; cz += (Math.random() - 0.5) * cam.shake;
    cam.shake *= Math.exp(-7 * dt);
  }
  camera.position.set(cx, cy, cz);
  const ahead = inCar ? 3.5 : 1.2;
  camera.lookAt(_look.set(tx + sin * ahead, ty + (inCar ? 0.1 : 0.15), tz + cos * ahead));
  const fov = inCar ? 58 + Math.min(car.speed * 0.36, 20) : 58;
  cam.fov = damp(cam.fov, fov, 3, dt);
  if (Math.abs(cam.fov - camera.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  camera.userData.dir.x = sin; camera.userData.dir.z = cos;
  return yaw;
}

// ---------------------------------------------------------------- effects
const _w = { x: 0, z: 0 };

function carEffects(car, dt, near) {
  car.sync(dt);
  if (!near) { car.lastSkid[0] = car.lastSkid[1] = null; return; }
  const spec = car.spec;
  const sliding = car.grounded && (car.slip > 3 || (car.handbrake && car.speed > 4));
  for (let i = 0; i < 2; i++) {
    car.point(i ? spec.width / 2 - 0.16 : -(spec.width / 2 - 0.16), -spec.wb / 2, _w);
    if (sliding) {
      const last = car.lastSkid[i];
      if (last && !car.offroad) skids.add(last.x, last.z, _w.x, _w.z, car.y + 0.03);
      car.lastSkid[i] = car.lastSkid[i] || { x: 0, z: 0 };
      car.lastSkid[i].x = _w.x; car.lastSkid[i].z = _w.z;
      if (Math.random() < 0.55) {
        if (car.offroad) fx.emit(_w.x, car.y + 0.2, _w.z, car.vx * 0.2, 1.2, car.vz * 0.2, 0.8, 0.35, 1.1, 0.5, 0.44, 0.33, 0.11, -0.3, 1);
        else fx.emit(_w.x, car.y + 0.15, _w.z, car.vx * 0.15 + (Math.random() - 0.5), 0.9, car.vz * 0.15 + (Math.random() - 0.5), 1.0, 0.4, 1.3, 0.62, 0.62, 0.65, 0.1, -0.4, 1);
      }
    } else {
      car.lastSkid[i] = null;
      if (car.offroad && car.speed > 7 && car.grounded && Math.random() < 0.3) {
        fx.emit(_w.x, car.y + 0.15, _w.z, car.vx * 0.25, 1, car.vz * 0.25, 0.7, 0.3, 1.0, 0.5, 0.44, 0.33, 0.09, -0.2, 1);
      }
    }
  }
  const mine = car === player.car;
  if (car.impact > 3) {
    car.crashCool = car.crashCool ?? 0;
    if (game.t - car.crashCool > 0.14) {
      car.crashCool = game.t;
      const d = Math.hypot(car.x - player.x, car.z - player.z);
      audio.crash(car.impact * clamp(1 - d / 70, 0, 1));
      fx.burst(Math.min(14, 3 + car.impact), car.impactX, car.y + 0.6, car.impactZ, 5, 4, 0.5, 0.11, 1, 0.75, 0.3, 1, 12, 1);
      if (mine) cam.shake = Math.min(0.7, cam.shake + car.impact * 0.03);
    }
  }
  if (car.landed > 3.5) {
    fx.burst(10, car.x, car.y + 0.2, car.z, 4, 1.5, 0.8, 0.5, 0.5, 0.48, 0.44, 0.16, 1.5);
    const d = Math.hypot(car.x - player.x, car.z - player.z);
    audio.thud(clamp(car.landed * 0.03, 0.05, 0.35) * clamp(1 - d / 60, 0, 1));
    if (mine) cam.shake = Math.min(0.6, cam.shake + car.landed * 0.035);
  }
}

function onCrash(a, b, strength, x, z) {
  const d = Math.hypot(x - player.x, z - player.z);
  if (d < 80) {
    audio.crash(strength * clamp(1 - d / 70, 0, 1));
    fx.burst(Math.min(16, 4 + strength), x, a.y + 0.7, z, 5.5, 4.5, 0.5, 0.12, 1, 0.78, 0.35, 1, 12, 1);
  }
  const mine = a === player.car ? a : b === player.car ? b : null;
  if (!mine) return;
  const other = mine === a ? b : a;
  cam.shake = Math.min(0.7, cam.shake + strength * 0.03);
  if (game.crimeCool > 0 || strength < 5) return;
  if (other.spec.police && other.driver && mine.speed > other.speed) { game.crime(1, 'rammed a patrol car'); game.crimeCool = 2; }
  else if (other.driver && other.driver !== 'player' && !other.spec.police) { game.crime(0.34, 'reckless driving'); game.crimeCool = 1.2; }
}

function onPedHit(ped, car) {
  const d = Math.hypot(ped.x - player.x, ped.z - player.z);
  audio.thud(0.3 * clamp(1 - d / 50, 0, 1));
  if (car === player.car) { game.crime(1, 'knocked someone over'); cam.shake = Math.min(0.5, cam.shake + 0.15); }
}

function onPropHit(prop, speed, car) {
  const d = Math.hypot(prop.x - player.x, prop.z - player.z);
  audio.thud(clamp(speed * 0.02, 0.05, 0.3) * clamp(1 - d / 50, 0, 1));
  if (car === player.car) cam.shake = Math.min(0.4, cam.shake + 0.05);
}

player.onStep = (speed) => audio.step(speed);
player.onJump = () => audio.jump();
player.onLand = (v) => audio.land(v);
player.onHit = () => { audio.thud(0.35); cam.shake = 0.5; };

/** F: get into the nearest car, or out of the one being driven. */
function action() {
  if (game.cut || player.down) return;
  if (player.mode === 'car') {
    player.exit();
    audio.door();
    return;
  }
  const car = player.nearestCar(traffic.cars);
  if (!car) return;
  if (car.driver && car.driver !== 'player') {
    const wasPolice = car.spec.police;
    traffic.evict(car);
    // the previous driver tumbles out and legs it
    const ped = crowd.borrow(player.x, player.z);
    if (ped) {
      car.point(-(car.spec.width / 2 + 0.8), 0.2, _w);
      ped.x = _w.x; ped.z = _w.z; ped.y = groundHeight(ped.x, ped.z);
      crowd.rehome(ped);
      ped.scare(car.x, car.z, Math.sin(car.heading), Math.cos(car.heading), 3.5);
    }
    game.crime(wasPolice ? 2 : 1, wasPolice ? 'stole a patrol car' : 'car theft');
  }
  player.enter(car);
  audio.door();
  hud.feed(`<span style="letter-spacing:.12em;text-transform:uppercase">${car.spec.name}</span>`);
}

// -------------------------------------------------------------- the loop
const ctx = {
  time: 0, px: 0, pz: 0, pvx: 0, pvz: 0, pSpeed: 0, playerNode: 0, cars: traffic.cars, walkers: [], camera, heatLevel: 0, keep: heroCar,
  onHonk: (car) => audio.honk(Math.hypot(car.x - player.x, car.z - player.z)),
};
const focus = new THREE.Vector3();
let last = performance.now();
let lastPx = player.x, lastPz = player.z;
let frameCount = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = clamp((now - last) / 1000, 0.001, 0.05);
  last = now;
  frameCount++;
  readInput();
  const frozen = !!game.cut;
  if (frozen) { input.forward = input.back = input.left = input.right = input.jump = false; actionPressed = false; }

  if (actionPressed) { actionPressed = false; action(); }
  if (radioPressed) {
    radioPressed = false;
    if (player.mode === 'car') { const st = audio.nextStation(); hud.feed(`<span style="color:#6fc3ff">♪ ${st.name}</span>${st.tag ? ` · ${st.tag}` : ''}`); }
  }

  if (hornPressed) {
    hornPressed = false;
    // people ahead of a honking car get out of the way
    if (player.mode === 'car') {
      const c = player.car;
      for (const p of crowd.people) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const ahead = dx * c.sin + dz * c.cos;
        if (p.visible && ahead > 0 && ahead < 16 && Math.abs(-dx * c.cos + dz * c.sin) < 4) p.scare(c.x, c.z, c.sin, c.cos, 1.4);
      }
    }
  }

  if (player.mode === 'car') player.updateDrive(input);
  else player.updateFoot(dt, input, traffic.cars);

  // AI decisions, then physics (in two half-steps, for stable collisions).
  ctx.time = traffic.time;
  ctx.px = player.x; ctx.pz = player.z;
  ctx.pvx = (player.x - lastPx) / dt; ctx.pvz = (player.z - lastPz) / dt;
  lastPx = player.x; lastPz = player.z;
  ctx.pSpeed = player.speed;
  ctx.playerNode = nearestNode(player.x, player.z).id;
  ctx.heatLevel = game.heatLevel;
  ctx.keep = player.car || ctx.keep;
  ctx.walkers.length = 0;
  for (const p of crowd.people) if (p.visible) ctx.walkers.push(p);
  if (player.mode === 'foot') ctx.walkers.push(player);
  traffic.update(dt, ctx);
  traffic.step(dt, onCrash);
  if (player.mode === 'car') player.updateDrive(input);

  props.hitByCars(traffic.cars, onPropHit);
  props.update(dt, fx);
  crowd.update(dt, player.x, player.z, traffic.cars, onPedHit);

  const camYaw = updateCamera(dt);
  game.update(dt, camYaw);
  game.setNight(sky.env.night);

  // light, sky and everything that glows at night
  sky.speed = keys.has('KeyT') ? 45 : 1;
  focus.set(player.x + camera.userData.dir.x * 22, player.y, player.z + camera.userData.dir.z * 22);
  sky.update(dt, focus, camera);
  const env = sky.env;
  env.nearPlaza = Math.abs(player.x - 0) < 110 && Math.abs(player.z - (PLAZA.z0 + PLAZA.z1) / 2) < 110;
  scenery.update(dt, traffic.time, env, fx);
  for (const g of nightGlow) g.mat.emissiveIntensity = (g.base ?? 0) + g.k * env.night;
  setCarLights(env.night, traffic.time);
  fx.material.uniforms.uLight.value = env.particleLight;
  fx.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));

  const lit = env.night > 0.3;
  for (const car of traffic.cars) {
    const dx = car.x - player.x, dz = car.z - player.z;
    car.lit = lit;
    car.beam.visible = lit && (car.driver !== null);
    carEffects(car, dt, dx * dx + dz * dz < 110 * 110);
  }
  if (player.mode === 'car' && env.night > 0.05) {
    const c = player.car;
    headlight.intensity = 420 * env.night;
    headlight.position.set(c.x + c.sin * 1.6, c.y + 0.9, c.z + c.cos * 1.6);
    headlight.target.position.set(c.x + c.sin * 22, c.y - 0.5, c.z + c.cos * 22);
    headlight.target.updateMatrixWorld();
  } else headlight.intensity = 0;

  fx.update(dt);
  skids.update();

  // HUD
  const near = player.mode === 'foot' && !player.down ? player.nearestCar(traffic.cars) : null;
  const car = player.car;
  hud.update({
    dt, mode: player.mode, carName: car ? car.spec.name : '',
    district: districtAt(player.x, player.z), clock: sky.clock(),
    cash: game.cash, heat: game.heatLevel, cooling: game.cooling, tokens: game.found, tokenTotal: game.tokens.length, best: game.bestText(),
    prompt: near ? `<kbd>F</kbd>${near.driver ? 'Take' : 'Drive'} the ${near.spec.name}` : car && car.spec.taxi && !game.job ? '<kbd>E</kbd>Start a taxi shift' : '',
    warn: game.warn,
    objective: game.objective(camYaw),
    speed: player.speed, rpm: car ? car.rpm : 0, gear: car ? car.gear : 1, reverse: car ? car.forward < -0.5 : false,
    radio: car ? `♪ ${audio.stationName}` : '',
    px: player.x, pz: player.z, heading: player.heading, camYaw, blips: game.blips(),
  });

  // sound
  let siren = 0;
  for (const d of traffic.drivers) {
    if (!d.car.siren) continue;
    siren = Math.max(siren, clamp(1 - Math.hypot(d.car.x - player.x, d.car.z - player.z) / 130, 0, 1));
  }
  audio.update({
    dt, driving: player.mode === 'car', rpm: car ? car.rpm : 0, throttle: car ? Math.abs(car.throttle) : 0, speed: player.speed,
    slip: car ? car.slip + (car.handbrake && car.speed > 4 ? 3 : 0) : 0, horn: player.mode === 'car' && keys.has('KeyH'), siren, night: env.night,
    sea: clamp((player.z - 150) / 45, 0, 1) + (player.x < DOCKS.x1 ? 0.5 : 0),
  });

  bench.mode = player.mode;
  bench.x = player.x; bench.y = player.y; bench.z = player.z;
  bench.speed = player.mode === 'car' ? player.car.speed : player.speed;

  post.render(scene, camera, env.night);
}

// Pose everything once so the very first frame is complete, then run.
player.updateFoot(0.016, input, traffic.cars);
cam.ty = player.y;
window.__game = { player, traffic, game, sky, crowd, renderer, cam, post };
requestAnimationFrame((t) => { last = t; frame(t); });
