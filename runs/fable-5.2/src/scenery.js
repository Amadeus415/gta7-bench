// Everything that dresses the city: street furniture, trees, the park, the
// plaza, the pier with its wheel, the docks, the beach, the sea and the horizon.
import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, makeRng, mat, circlePoints, TAU, clamp } from './util.js';
import { glowTexture, containerTexture } from './textures.js';
import {
  LINES, ROAD_HALF, CURB, PARK, PLAZA, DOCKS, PIER, PROM, SPAWN, WATER_Y,
  nodes, colliders, mapShapes, raised, addRamp, lightState, baseHeight,
} from './world.js';
import { nightGlow, landmarks } from './city.js';
import { props } from './props.js';

const _c = new THREE.Color();

/** Collects instances of one geometry, then becomes a single InstancedMesh. */
class Scatter {
  constructor(geo, material, { cast = true, receive = false } = {}) {
    this.geo = geo; this.material = material; this.items = []; this.cast = cast; this.receive = receive;
  }
  add(x, y, z, ry = 0, sx = 1, sy = sx, sz = sx, color = null) {
    this.items.push([x, y, z, ry, sx, sy, sz, color]);
    return this.items.length - 1;
  }
  build(scene) {
    const mesh = new THREE.InstancedMesh(this.geo, this.material, Math.max(1, this.items.length));
    mesh.count = this.items.length;
    this.items.forEach(([x, y, z, ry, sx, sy, sz, color], i) => {
      mesh.setMatrixAt(i, mat(x, y, z, 0, ry, 0, sx, sy, sz));
      if (color !== null) mesh.setColorAt(i, _c.set(color));
      else if (mesh.instanceColor) mesh.setColorAt(i, _c.set(0xffffff));
    });
    mesh.castShadow = this.cast;
    mesh.receiveShadow = this.receive;
    mesh.matrixAutoUpdate = false;
    scene.add(mesh);
    return mesh;
  }
}

function broadleafGeo(R, tall) {
  const b = new GeoBuilder();
  const ico = new THREE.IcosahedronGeometry(1, 1);
  if (tall) {
    b.cyl(0.11, 0.2, 3, 0, 1.5, 0, 0x5a4030, 6);
    b.add(ico, mat(0, 5.6, 0, 0, 0, 0, 1.25, 3.6, 1.25), 0x3f7a3a);
    b.add(ico, mat(0.2, 4.2, 0.1, 0, 1, 0, 1.4, 2.2, 1.4), 0x4a8a40);
    return b.build();
  }
  b.cyl(0.13, 0.22, 2.8, 0, 1.4, 0, 0x5a4030, 6);
  b.cyl(0.07, 0.11, 1.4, 0.45, 2.9, 0.1, 0x5a4030, 5, 0, 0, -0.6);
  for (const [x, y, z, r, c] of [[0, 3.9, 0, 1.7, 0x4f8a3a], [1.05, 3.4, 0.3, 1.2, 0x447a34], [-0.85, 3.5, -0.6, 1.15, 0x5a9a42], [0.1, 4.95, 0.2, 1.05, 0x66a84c], [-0.2, 3.3, 0.95, 1.0, 0x3f7030]]) {
    b.add(ico, mat(x, y, z, 0, R() * 6, 0, r, r * 0.85, r), c);
  }
  return b.build();
}

function palmGeo() {
  const b = new GeoBuilder();
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) {
    const lean = 0.035 * i;
    b.cyl(0.15 - i * 0.008, 0.18 - i * 0.008, 1.42, x + lean * 0.7, y + 0.7, 0, i % 2 ? 0x8a7052 : 0x7c6448, 6, 0, 0, -lean);
    x += lean * 1.4; y += 1.38;
  }
  const box = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + (i % 2) * 0.2;
    const t1 = 0.15 + (i % 3) * 0.14, L1 = 1.9, L2 = 1.7, t2 = t1 + 0.75;
    const g = i % 2 ? 0x3f8a3c : 0x4f9a44;
    const mx = Math.sin(a), mz = Math.cos(a);
    b.add(box, mat(x + mx * Math.cos(t1) * L1 / 2, y - Math.sin(t1) * L1 / 2, mz * Math.cos(t1) * L1 / 2, t1, a, 0, 0.55, 0.04, L1), g);
    const ex = mx * Math.cos(t1) * L1, ey = -Math.sin(t1) * L1, ez = mz * Math.cos(t1) * L1;
    b.add(box, mat(x + ex + mx * Math.cos(t2) * L2 / 2, y + ey - Math.sin(t2) * L2 / 2, ez + mz * Math.cos(t2) * L2 / 2, t2, a, 0, 0.42, 0.04, L2), g);
  }
  const ico = new THREE.IcosahedronGeometry(1, 0);
  for (const [dx, dz] of [[0.2, 0.1], [-0.15, 0.2], [0, -0.22]]) b.add(ico, mat(x + dx, y - 0.25, dz, 0, 0, 0, 0.16, 0.16, 0.16), 0x5a3c22);
  return b.build();
}

export function buildScenery(scene, city) {
  const R = makeRng(4242);
  const { ground, trim, signs, bills } = city;
  const time = { value: 0 };

  // ---------------------------------------------------------- materials
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  treeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        float sway = max(position.y - 1.6, 0.0);
        #ifdef USE_INSTANCING
          float ph = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.17;
        #else
          float ph = 0.0;
        #endif
        transformed.x += sin(uTime * 1.3 + ph) * 0.035 * sway;
        transformed.z += cos(uTime * 1.05 + ph * 1.3) * 0.025 * sway;
      }`,
    );
  };
  const glowTex = glowTexture();
  const poolMat = new THREE.MeshBasicMaterial({ map: glowTex, color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const dotMat = new THREE.MeshBasicMaterial({ color: 0x555555 });
  const waterFlat = new THREE.MeshStandardMaterial({ color: 0x2a6f8f, roughness: 0.08, metalness: 0.5 });

  const trees = new Scatter(broadleafGeo(R, false), treeMat);
  const tallTrees = new Scatter(broadleafGeo(R, true), treeMat);
  const palms = new Scatter(palmGeo(), treeMat);
  const lampGeo = (() => {
    const b = new GeoBuilder();
    b.cyl(0.07, 0.11, 6.3, 0, 3.15, 0, 0x2f3338, 6);
    b.cyl(0.17, 0.21, 0.5, 0, 0.25, 0, 0x2f3338, 6);
    b.box(0.09, 0.09, 1.9, 0, 6.25, 0.9, 0x2f3338);
    b.box(0.38, 0.13, 0.85, 0, 6.2, 1.75, 0x3a3f45);
    return b.build();
  })();
  const lamps = new Scatter(lampGeo, city.trimMat);
  const globeGeo = (() => {
    const b = new GeoBuilder();
    b.cyl(0.06, 0.09, 3.3, 0, 1.65, 0, 0x26302c, 6);
    b.cyl(0.14, 0.18, 0.3, 0, 0.15, 0, 0x26302c, 6);
    b.cyl(0.2, 0.08, 0.12, 0, 3.3, 0, 0x26302c, 6);
    return b.build();
  })();
  const globes = new Scatter(globeGeo, city.trimMat);
  const dots = new Scatter(new THREE.SphereGeometry(1, 10, 8), dotMat, { cast: false });
  const flowers = new Scatter(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshLambertMaterial(), { cast: false });
  const pools = new Scatter(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, { cast: false });
  const benchGeo = (() => {
    const b = new GeoBuilder();
    b.box(1.9, 0.07, 0.5, 0, 0.46, 0, 0x8a5a36);
    b.box(1.9, 0.5, 0.07, 0, 0.82, -0.26, 0x8a5a36, 0, -0.18);
    for (const x of [-0.8, 0.8]) { b.box(0.08, 0.46, 0.5, x, 0.23, 0, 0x2c2f33); b.box(0.08, 0.6, 0.08, x, 0.75, -0.27, 0x2c2f33); }
    return b.build();
  })();
  const benches = new Scatter(benchGeo, city.trimMat);

  const spawnClear = (x, z) => Math.hypot(x - SPAWN.x, z - SPAWN.z - 2) < 4.5;

  function streetLamp(x, z, facing) {
    if (spawnClear(x, z)) return;
    const y = baseHeight(x, z);
    lamps.add(x, y, z, facing);
    const hx = x + Math.sin(facing) * 1.75, hz = z + Math.cos(facing) * 1.75;
    dots.add(hx, y + 6.11, hz, facing, 0.16, 0.05, 0.36, 0xffe6bd);
    pools.add(x + Math.sin(facing) * 2.6, CURB + 0.07, z + Math.cos(facing) * 2.6, 0, 13, 1, 13);
    colliders.addCircle(x, z, 0.2);
  }
  function globeLamp(x, z, scale = 7) {
    const y = baseHeight(x, z);
    globes.add(x, y, z);
    dots.add(x, y + 3.55, z, 0, 0.27, 0.27, 0.27, 0xfff0cf);
    pools.add(x, y + 0.06, z, 0, scale, 1, scale);
    colliders.addCircle(x, z, 0.16);
  }
  function tree(x, z, kind = 0, s = 1) {
    if (spawnClear(x, z)) return;
    const y = baseHeight(x, z);
    const tint = R.pick([0xffffff, 0xe6f0d0, 0xd0e8c0, 0xf0f0b0, 0xc8dcc0, 0xfff0d0]);
    if (kind === 2) palms.add(x, y, z, R() * TAU, s, s * R.range(0.85, 1.15), s, tint);
    else if (kind === 1) tallTrees.add(x, y, z, R() * TAU, s, s * R.range(0.9, 1.2), s, tint);
    else trees.add(x, y, z, R() * TAU, s, s * R.range(0.85, 1.15), s, tint);
    colliders.addCircle(x, z, kind === 2 ? 0.22 : 0.28);
  }
  function bench(x, z, facing) {
    benches.add(x, baseHeight(x, z), z, facing);
    colliders.addCircle(x, z, 0.75, 0.9);
  }

  // Walk the rim of a block: `t` metres along a side, `inDist` metres in from the curb.
  const rim = (side, r, t, inDist) => {
    if (side === 0) return [r.x0 + t, r.z1 - inDist, 0];
    if (side === 1) return [r.x1 - inDist, r.z1 - t, Math.PI / 2];
    if (side === 2) return [r.x1 - t, r.z0 + inDist, Math.PI];
    return [r.x0 + inDist, r.z0 + t, -Math.PI / 2];
  };

  // ------------------------------------------------- sidewalks of every block
  const blocks = [];
  for (let bz = 0; bz < 5; bz++) for (let bx = 0; bx < 5; bx++) {
    if (bz === 2 && (bx === 2 || bx === 3)) continue;
    blocks.push({ x0: LINES[bx] + ROAD_HALF, x1: LINES[bx + 1] - ROAD_HALF, z0: LINES[bz] + ROAD_HALF, z1: LINES[bz + 1] - ROAD_HALF, bx, bz, plaza: bx === 2 && bz === 1 });
  }
  blocks.push({ ...PARK, park: true });
  const BIN_COLORS = [0x2f6b4a, 0x3a3f45, 0x2e5d8a];
  for (const r of blocks) {
    for (let side = 0; side < 4; side++) {
      const len = side % 2 === 0 ? r.x1 - r.x0 : r.z1 - r.z0;
      for (let t = 15; t < len - 6; t += 30) { const [x, z, f] = rim(side, r, t, 0.75); streetLamp(x, z, f); }
      const beach = r.bz === 4;
      for (let t = 8; t < len - 6; t += 7.4) {
        if (Math.abs(((t - 15) % 30)) < 3 || R.chance(r.park ? 0.15 : 0.42)) continue;
        const [x, z] = rim(side, r, t, 1.25);
        tree(x, z, beach ? 2 : R.chance(0.25) ? 1 : 0, R.range(0.85, 1.1));
        trim.floor(x - 0.6, z - 0.6, x + 0.6, z + 0.6, CURB + 0.012, 0x4a3c2e);
      }
      if (r.park) continue;
      if (R.chance(0.6)) { const [x, z] = rim(side, r, R.range(18, len - 18), 0.85); if (!spawnClear(x, z)) props.add('hydrant', x, z); }
      for (const t of [6.4, len - 6.4]) if (R.chance(0.55)) { const [x, z, f] = rim(side, r, t, 0.95); props.add('bin', x, z, f, R.pick(BIN_COLORS)); }
      if (R.chance(0.4)) { const [x, z, f] = rim(side, r, R.range(24, len - 24), 0.9); props.add('mailbox', x, z, f); }
      if (!r.plaza && R.chance(0.45)) { const [x, z, f] = rim(side, r, len / 2 + R.range(-6, 6), 3.45); bench(x, z, f); }
      if (R.chance(0.3)) {
        const t0 = R.range(12, len - 16);
        for (let k = 0; k < 3; k++) { const [x, z, f] = rim(side, r, t0 + k * 0.75, 3.4); props.add('crate', x, z, f + R.range(-0.3, 0.3)); }
      }
    }
  }

  // ------------------------------------------------------- traffic signals
  const signals = [];
  const bulbs = new Scatter(new THREE.BoxGeometry(0.2, 0.2, 0.07), new THREE.MeshBasicMaterial({ toneMapped: false }), { cast: false });
  for (const n of nodes) {
    if (n.nb.length < 3) continue;
    for (const m of n.nb) {
      const dx = Math.sign(n.x - nodes[m].x), dz = Math.sign(n.z - nodes[m].z);
      const rx = -dz, rz = dx;
      const px = n.x - dx * 8.3 + rx * 7.3, pz = n.z - dz * 8.3 + rz * 7.3;
      const y = baseHeight(px, pz);
      trim.cyl(0.09, 0.13, 5.6, px, y + 2.8, pz, 0x2a2d31, 6);
      const ax = px - rx * 2.3, az = pz - rz * 2.3;
      trim.box(dx ? 0.12 : 4.7, 0.12, dx ? 4.7 : 0.12, ax, y + 5.5, az, 0x2a2d31);
      colliders.addCircle(px, pz, 0.2);
      const ry = dx ? Math.PI / 2 : 0;
      const sig = { node: n, alongX: dx !== 0, idx: [], state: '' };
      for (const [hx, hz, hy] of [[px - rx * 4.4, pz - rz * 4.4, y + 4.85], [px - dx * 0.24, pz - dz * 0.24, y + 3.1]]) {
        trim.box(dx ? 0.3 : 0.42, 1.2, dx ? 0.42 : 0.3, hx, hy, hz, 0x1b1d20);
        for (let k = 0; k < 3; k++) sig.idx.push(bulbs.add(hx - dx * 0.17, hy + 0.37 - k * 0.37, hz - dz * 0.17, ry));
      }
      signals.push(sig);
    }
  }

  // ------------------------------------------------------------ promenade
  for (let x = -168; x <= 180; x += 24) streetLamp(x, PROM.z0 + 0.75, Math.PI);
  for (let x = -174; x <= 186; x += 12) {
    if (x > PIER.x0 - 6 && x < PIER.x1 + 6) continue;
    if ((x + 174) % 24 === 0) { tree(x, PROM.z0 + 2.2, 2, R.range(0.95, 1.2)); trim.floor(x - 0.7, PROM.z0 + 1.5, x + 0.7, PROM.z0 + 2.9, CURB + 0.012, 0x6a5238); }
    else if (!spawnClear(x, PROM.z1 - 3)) bench(x, PROM.z1 - 1.6, 0);
  }
  for (let x = -150; x < 190; x += 48) props.add('bin', x + 3, PROM.z1 - 1.5, 0, 0x2e5d8a);
  // North, east and west rims: a railing over the water.
  const rail = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, y = baseHeight(cx, cz);
    trim.box(alongX ? len : 0.08, 0.08, alongX ? 0.08 : len, cx, y + 1.05, cz, 0x4a4f55);
    trim.box(alongX ? len : 0.05, 0.05, alongX ? 0.05 : len, cx, y + 0.6, cz, 0x4a4f55);
    for (let d = 0; d <= len + 0.01; d += 2.4) {
      const k = d / len;
      trim.box(0.1, 1.1, 0.1, x0 + (x1 - x0) * k, y + 0.55, z0 + (z1 - z0) * k, 0x4a4f55);
    }
  };
  const wall = (x0, z0, x1, z1, visible = true) => {
    if (visible) rail(x0, z0, x1, z1);
    const pad = 3;
    if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) colliders.addBox(Math.min(x0, x1), z0 - (z0 < 0 ? pad : 0), Math.max(x0, x1), z0 + (z0 < 0 ? 0 : pad));
    else colliders.addBox(x0 - (x0 < 0 ? pad : 0), Math.min(z0, z1), x0 + (x0 < 0 ? 0 : pad), Math.max(z0, z1));
  };
  wall(-191.6, -191.6, 191.6, -191.6);
  wall(191.6, -191.6, 191.6, PROM.z1);
  wall(-191.6, -191.6, -191.6, DOCKS.z0);
  wall(-191.6, DOCKS.z1, -191.6, PROM.z1);
  colliders.addBox(-196, PROM.z1, -192, 260); // the beach ends at low breakwaters
  colliders.addBox(192, PROM.z1, 196, 260);
  for (const x of [-193.5, 193.5]) trim.box(3, 2.4, 52, x, -0.4, PROM.z1 + 25, 0x6a665e);

  // ----------------------------------------------------------------- park
  {
    const P = PARK, y = CURB + 0.045;
    const gravel = 0xd9ccb4;
    const paths = [[P.x0 + 3.5, -1.6, P.x1 - 3.5, 1.6], [-9.3, P.z0 + 3.5, -6.7, P.z1 - 3.5], [34, P.z0 + 3.5, 38, P.z1 - 3.5], [86.7, P.z0 + 3.5, 89.3, P.z1 - 3.5]];
    for (const [x0, z0, x1, z1] of paths) ground.sand.b.floor(x0, z0, x1, z1, y, gravel, 5);
    const pond = { x: 63, z: -13.5, rx: 12, rz: 7.5 };
    trim.prism(circlePoints(pond.x, pond.z, pond.rx + 0.7, 28, pond.rz + 0.7), CURB, CURB + 0.32, 0x9a958a);
    const pondGeo = new GeoBuilder().prism(circlePoints(pond.x, pond.z, pond.rx, 28, pond.rz), CURB + 0.3, CURB + 0.34, 0xffffff).build();
    const pondMesh = new THREE.Mesh(pondGeo, waterFlat);
    scene.add(pondMesh);
    for (const [dx, r] of [[-5.5, 7], [0, 8.2], [5.5, 7]]) colliders.addCircle(pond.x + dx, pond.z, r, 0.55);
    mapShapes.push({ kind: 'circle', x: pond.x, z: pond.z, r: 10, color: '#3f7fa8' });
    // Lily pads and a little island of reeds.
    for (let i = 0; i < 12; i++) {
      const a = R() * TAU, d = Math.sqrt(R());
      trim.cyl(0.35, 0.35, 0.02, pond.x + Math.cos(a) * d * (pond.rx - 1.5), CURB + 0.36, pond.z + Math.sin(a) * d * (pond.rz - 1.2), 0x4f9a50, 7);
    }

    // Bandstand.
    const gz = { x: 12, z: 0, r: 4.2 };
    raised.push({ x: gz.x, z: gz.z, r: gz.r, h: 0.3 });
    trim.prism(circlePoints(gz.x, gz.z, gz.r, 8), CURB, CURB + 0.3, 0xa07850, 1, 0xe8e2d6);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8) * TAU;
      const px = gz.x + Math.cos(a) * 3.8, pz = gz.z + Math.sin(a) * 3.8;
      trim.cyl(0.11, 0.13, 3.4, px, CURB + 2, pz, 0xf2efe8, 6);
      colliders.addCircle(px, pz, 0.16);
    }
    trim.cyl(0.25, 4.9, 2.1, gz.x, CURB + 4.75, gz.z, 0x9c3f34, 8, 0, Math.PI / 8);
    trim.cyl(0.08, 0.08, 1.0, gz.x, CURB + 6.2, gz.z, 0xe0c060, 5);
    // Strings of lanterns fan out from the bandstand roof: Lantern Park.
    const LANTERN = [0xff6a4a, 0xffb84a, 0xffe07a, 0xff8a6a, 0xff5a7a];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      const ex = gz.x + Math.cos(a) * 15, ez = gz.z + Math.sin(a) * 13;
      trim.cyl(0.07, 0.09, 4.6, ex, CURB + 2.3, ez, 0x3a2f28, 5);
      colliders.addCircle(ex, ez, 0.14);
      for (let k = 1; k < 9; k++) {
        const u = k / 9;
        const lx = gz.x + Math.cos(a) * (4.4 + (15 - 4.4) * u), lz = gz.z + Math.sin(a) * (4.4 + (13 - 4.4) * u);
        const ly = CURB + 4.5 - Math.sin(u * Math.PI) * 0.9;
        dots.add(lx, ly, lz, 0, 0.17, 0.21, 0.17, LANTERN[(i + k) % LANTERN.length]);
      }
      pools.add(gz.x + Math.cos(a) * 10, CURB + 0.08, gz.z + Math.sin(a) * 9, 0, 9, 1, 9);
    }
    mapShapes.push({ kind: 'circle', x: gz.x, z: gz.z, r: 4, color: '#c9a070' });

    for (let x = P.x0 + 12; x < P.x1 - 8; x += 13) {
      if (Math.abs(x - gz.x) < 8) continue;
      globeLamp(x, (x / 13) % 2 > 1 ? 2.3 : -2.3, 8);
      if (Math.abs(x - 36) > 5) bench(x + 5, x % 2 ? 2.6 : -2.6, x % 2 ? Math.PI : 0);
    }
    for (const [fx, fz] of [[-18, -14], [-19, 14], [24, 15], [48, 14], [76, 15], [95, -15], [26, -16]]) {
      trim.prism(circlePoints(fx, fz, 1.9, 10), CURB, CURB + 0.16, 0x4a3826);
      for (let k = 0; k < 16; k++) {
        const a = R() * TAU, d = Math.sqrt(R()) * 1.6;
        flowers.add(fx + Math.cos(a) * d, CURB + 0.3, fz + Math.sin(a) * d, 0, 0.17, 0.14, 0.17, R.pick([0xff5a7a, 0xffd447, 0xff8a3c, 0xe8e8ff, 0xc060ff]));
      }
    }
    const placed = [];
    for (let i = 0; i < 400 && placed.length < 62; i++) {
      const x = R.range(P.x0 + 6, P.x1 - 6), z = R.range(P.z0 + 6, P.z1 - 6);
      if (paths.some(([x0, z0, x1, z1]) => x > x0 - 2 && x < x1 + 2 && z > z0 - 2 && z < z1 + 2)) continue;
      if (((x - pond.x) / (pond.rx + 2.5)) ** 2 + ((z - pond.z) / (pond.rz + 2.5)) ** 2 < 1) continue;
      if (Math.hypot(x - gz.x, z - gz.z) < 15 && Math.hypot(x - gz.x, z - gz.z) > 0) { if (Math.hypot(x - gz.x, z - gz.z) < 8 || R.chance(0.6)) continue; }
      if (x > 91.5 && x < 100.5) continue; // keep the run-up and landing of the grass ramp clear
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < 4.5)) continue;
      placed.push([x, z]);
      tree(x, z, R.chance(0.3) ? 1 : 0, R.range(0.9, 1.45));
    }
    addRamp(96, 12, Math.PI, 7, 4.6, 1.5); // a cheeky grass kicker by the east path
    rampMesh(96, 12, Math.PI, 7, 4.6, 1.5);
  }

  // ---------------------------------------------------------------- plaza
  let ring;
  {
    const cx = 0, cz = -72;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      trim.box(2.05, 0.75, 0.6, cx + Math.cos(a) * 6, CURB + 0.37, cz + Math.sin(a) * 6, 0xbdb6a8, -a + Math.PI / 2);
    }
    const basin = new THREE.Mesh(new GeoBuilder().prism(circlePoints(cx, cz, 5.9, 24), CURB, CURB + 0.52, 0xffffff).build(), waterFlat);
    scene.add(basin);
    colliders.addCircle(cx, cz, 6.3, 0.9);
    trim.cyl(1.7, 2.1, 1.3, cx, CURB + 0.65, cz, 0xa8a296, 10);
    trim.cyl(0.07, 0.95, 26, cx, CURB + 14.2, cz, 0xeeeae0, 4, 0, Math.PI / 4);
    landmarks.roofs.push({ x: cx, y: CURB + 27.6, z: cz });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xe8b84a, roughness: 0.25, metalness: 0.9, emissive: 0xffa030, emissiveIntensity: 0 });
    nightGlow.push({ mat: ringMat, k: 0.7 });
    ring = new THREE.Mesh(new THREE.TorusGeometry(4.3, 0.2, 8, 48), ringMat);
    ring.position.set(cx, CURB + 10, cz);
    ring.castShadow = true;
    scene.add(ring);
    mapShapes.push({ kind: 'circle', x: cx, z: cz, r: 6, color: '#3f7fa8' });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16;
      bench(cx + Math.cos(a) * 10, cz + Math.sin(a) * 10, Math.atan2(-Math.cos(a), -Math.sin(a)));
    }
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const px = cx + sx * 18, pz = cz + sz * 18;
      trim.box(3.6, 0.75, 3.6, px, CURB + 0.37, pz, 0xb0aa9c);
      trim.box(3.1, 0.1, 3.1, px, CURB + 0.76, pz, 0x4a3826);
      colliders.addBox(px - 1.8, pz - 1.8, px + 1.8, pz + 1.8, 0.95);
      trees.add(px, CURB + 0.75, pz, R() * TAU, 1.25, 1.3, 1.25, 0xf0f0c0);
      globeLamp(cx + sx * 24.5, cz + sz * 11);
    }
    // Cafe corners with parasols.
    const UMB = [0xd9412b, 0xf2ead8, 0x2e7d6b, 0xe0a030];
    for (const [qx, qz] of [[-1, 1], [1, -1]]) {
      for (let i = 0; i < 5; i++) {
        const tx = cx + qx * (4.5 + (i % 3) * 5.4 + R.range(-0.5, 0.5)), tz = cz + qz * (22.4 + Math.floor(i / 3) * 4.2 + R.range(-0.3, 0.3));
        trim.cyl(0.55, 0.55, 0.06, tx, CURB + 0.76, tz, 0xe8e4da, 10);
        trim.cyl(0.05, 0.05, 2.5, tx, CURB + 1.25, tz, 0x555555, 5);
        trim.cyl(0.05, 1.7, 0.6, tx, CURB + 2.6, tz, UMB[(i + (qx > 0 ? 1 : 0)) % UMB.length], 8);
        colliders.addCircle(tx, tz, 0.3);
        for (let k = 0; k < 2; k++) { const a = R() * TAU; props.add('chair', tx + Math.cos(a) * 1.05, tz + Math.sin(a) * 1.05, -a + Math.PI / 2); }
      }
    }
    // A kiosk with a striped canopy.
    const kx = cx + 20, kz = cz + 19;
    trim.box(4.2, 2.7, 3, kx, CURB + 1.35, kz, 0x2e5d6b);
    trim.box(5, 0.16, 3.8, kx, CURB + 2.8, kz, 0xf2ead8);
    for (let i = 0; i < 5; i++) trim.box(0.5, 0.18, 3.82, kx - 2 + i, CURB + 2.8, kz, 0xd9412b);
    city.signQuad('N', { x0: kx - 2.1, x1: kx + 2.1, z0: kz - 1.5, z1: kz + 1.5 }, 2.1, CURB + 1.5, 3.4, 0.85, 0);
    colliders.addBox(kx - 2.1, kz - 1.5, kx + 2.1, kz + 1.5);
    for (let i = 0; i < 5; i++) {
      const fx = cx - 24 + i * 4.2, fz = cz - 26.5;
      trim.cyl(0.05, 0.07, 8, fx, CURB + 4, fz, 0xd8d8d8, 5);
      trim.box(0.05, 2.4, 1.1, fx, CURB + 6.7, fz + 0.6, [0xd9412b, 0xe8b84a, 0x2e7d6b, 0x34568a, 0x8a3a6a][i]);
      colliders.addCircle(fx, fz, 0.12);
    }
  }

  // ----------------------------------------------------------------- pier
  let wheel;
  const gondolas = [];
  {
    const { x0, x1, z0, z1 } = PIER;
    const cx = (x0 + x1) / 2;
    ground.plank.b.prism([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], CURB - 0.55, CURB, 0xffffff, 2.2, 0x6a4a30);
    for (let z = z0 + 6; z < z1; z += 11) for (const x of [x0 + 1, cx, x1 - 1]) trim.cyl(0.38, 0.38, 6, x, -2.7, z, 0x4a3828, 7);
    const gap = [cx - 3.2, cx + 3.2]; // the end rail is open where the ramp is
    const piece = (ax, az, bx, bz) => {
      const alongX = Math.abs(bx - ax) > Math.abs(bz - az), len = Math.hypot(bx - ax, bz - az);
      trim.box(alongX ? len : 0.12, 0.1, alongX ? 0.12 : len, (ax + bx) / 2, CURB + 1.05, (az + bz) / 2, 0xf2efe8);
      trim.box(alongX ? len : 0.07, 0.07, alongX ? 0.07 : len, (ax + bx) / 2, CURB + 0.58, (az + bz) / 2, 0xf2efe8);
      for (let d = 0; d <= len + 0.01; d += 2.3) trim.box(0.13, 1.1, 0.13, ax + ((bx - ax) * d) / len, CURB + 0.55, az + ((bz - az) * d) / len, 0xf2efe8);
      colliders.addBox(Math.min(ax, bx) - 0.25, Math.min(az, bz) - 0.25, Math.max(ax, bx) + 0.25, Math.max(az, bz) + 0.25);
    };
    piece(x0 + 0.2, z0 + 1, x0 + 0.2, z1 - 0.2);
    piece(x1 - 0.2, z0 + 1, x1 - 0.2, z1 - 0.2);
    piece(x0 + 0.2, z1 - 0.2, gap[0], z1 - 0.2);
    piece(gap[1], z1 - 0.2, x1 - 0.2, z1 - 0.2);
    addRamp(cx, z1 - 8.2, 0, 8, 5.6, 2.3);
    rampMesh(cx, z1 - 8.2, 0, 8, 5.6, 2.3);
    // Entrance arch carrying the pier's sign.
    for (const x of [x0 + 0.9, x1 - 0.9]) { trim.box(1.1, 7, 1.1, x, CURB + 3.5, z0 + 2, 0xf2efe8); colliders.addBox(x - 0.6, z0 + 1.4, x + 0.6, z0 + 2.6); }
    trim.box(x1 - x0 - 0.7, 0.5, 0.9, cx, CURB + 7.2, z0 + 2, 0xd9412b);
    const sign = { x0: cx - 5.5, x1: cx + 5.5, z0: z0 + 1.75, z1: z0 + 2.25 };
    const u0 = 0.5, v1 = 1 - 0.25, v0 = v1 - 0.25; // the "Sundown Pier" poster in the billboard atlas
    city.faceQuad(bills, 'N', sign, 0, 11, CURB + 7.5, CURB + 13, 0.02, 0xffffff, [u0, v0, u0 + 0.5, v0, u0 + 0.5, v1, u0, v1]);
    city.faceQuad(bills, 'S', sign, 0, 11, CURB + 7.5, CURB + 13, 0.02, 0xffffff, [u0, v0, u0 + 0.5, v0, u0 + 0.5, v1, u0, v1]);
    trim.box(11.3, 5.8, 0.4, cx, CURB + 10.25, z0 + 2, 0x2c2f33);
    // Striped stalls down both sides.
    const STALL = [[0xd9412b, 0xf2ead8], [0x2e7d6b, 0xf2ead8], [0xe0a030, 0xf2ead8], [0x34568a, 0xf2ead8]];
    for (let i = 0; i < 6; i++) {
      const left = i % 2 === 0;
      const sx = left ? x0 + 2.6 : x1 - 2.6, sz = z0 + 16 + i * 8.5;
      const [a, b] = STALL[i % 4];
      trim.box(3.2, 2.2, 3.4, sx, CURB + 1.1, sz, b);
      trim.box(3.25, 0.9, 3.45, sx, CURB + 0.45, sz, a);
      trim.cyl(0.1, 2.9, 1.5, sx, CURB + 2.95, sz, a, 4, 0, Math.PI / 4);
      colliders.addBox(sx - 1.7, sz - 1.8, sx + 1.7, sz + 1.8);
      dots.add(sx + (left ? 1.75 : -1.75), CURB + 2.05, sz, 0, 0.1, 0.1, 1.5, 0xffe2a0);
    }
    for (let z = z0 + 10; z < z1 - 26; z += 14) {
      for (const x of [x0 + 0.8, x1 - 0.8]) {
        trim.cyl(0.06, 0.08, 4.4, x, CURB + 2.2, z, 0xf2efe8, 5);
        dots.add(x, CURB + 4.55, z, 0, 0.24, 0.24, 0.24, 0xfff0cf);
        pools.add(x + (x < cx ? 2 : -2), CURB + 0.07, z, 0, 9, 1, 9);
      }
      // festoon lights across the deck
      for (let k = 1; k < 12; k++) {
        const u = k / 12;
        dots.add(x0 + 0.8 + (x1 - x0 - 1.6) * u, CURB + 4.4 - Math.sin(u * Math.PI) * 1.0, z, 0, 0.1, 0.1, 0.1, [0xff6a4a, 0xffe07a, 0x7ad8ff, 0xff8ad0][k % 4]);
      }
    }

    // The wheel.
    const wz = z1 - 26, wy = CURB + 15.4, WR = 13;
    const st = new GeoBuilder();
    const torus = new THREE.TorusGeometry(WR, 0.16, 6, 56);
    const inner = new THREE.TorusGeometry(WR * 0.55, 0.1, 5, 40);
    for (const dz of [-1.25, 1.25]) {
      st.add(torus, mat(0, 0, dz), 0xf4f1ea);
      st.add(inner, mat(0, 0, dz), 0xf4f1ea);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        st.box(0.1, WR, 0.1, Math.cos(a) * WR / 2, Math.sin(a) * WR / 2, dz, i % 2 ? 0xd9412b : 0xf4f1ea, 0, 0, a - Math.PI / 2);
      }
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      st.box(0.12, 0.12, 2.5, Math.cos(a) * WR, Math.sin(a) * WR, 0, 0x8a8f96);
    }
    st.cyl(0.7, 0.7, 3.4, 0, 0, 0, 0xd9412b, 12, Math.PI / 2);
    wheel = new THREE.Group();
    wheel.position.set(cx, wy, wz);
    const wheelMesh = new THREE.Mesh(st.build(), city.trimMat);
    wheelMesh.castShadow = true;
    wheel.add(wheelMesh);
    const wb = new GeoBuilder();
    const dot = new THREE.IcosahedronGeometry(1, 0);
    const WCOL = [0xfff0c0, 0xff6a8a, 0x7ad8ff, 0xffd447];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      for (let k = 2; k <= 10; k++) for (const dz of [-1.35, 1.35]) wb.add(dot, mat(Math.cos(a) * WR * k / 10, Math.sin(a) * WR * k / 10, dz, 0, 0, 0, 0.13, 0.13, 0.13), WCOL[k % 4]);
    }
    for (let i = 0; i < 56; i++) {
      const a = (i / 56) * TAU;
      for (const dz of [-1.42, 1.42]) wb.add(dot, mat(Math.cos(a) * WR, Math.sin(a) * WR, dz, 0, 0, 0, 0.15, 0.15, 0.15), WCOL[i % 4]);
    }
    const wheelBulbMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    wheel.add(new THREE.Mesh(wb.build(), wheelBulbMat));
    wheel.userData.bulbMat = wheelBulbMat;
    const cabGeo = (() => {
      const g = new GeoBuilder();
      g.box(0.06, 1.0, 0.06, 0, -0.5, 0, 0x8a8f96);
      g.box(1.7, 1.0, 1.7, 0, -1.9, 0, 0xffffff);
      g.box(1.8, 0.12, 1.8, 0, -1.0, 0, 0xffffff);
      g.box(0.08, 0.8, 0.08, -0.8, -1.4, -0.8, 0xdddddd); g.box(0.08, 0.8, 0.08, 0.8, -1.4, -0.8, 0xdddddd);
      g.box(0.08, 0.8, 0.08, -0.8, -1.4, 0.8, 0xdddddd); g.box(0.08, 0.8, 0.08, 0.8, -1.4, 0.8, 0xdddddd);
      return g.build();
    })();
    const CAB = [0xd9412b, 0xe8b84a, 0x2e9d8b, 0x4a7fd0, 0xd060a0, 0xf2ead8].map((c) => new THREE.MeshLambertMaterial({ color: c, vertexColors: true }));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      const g = new THREE.Mesh(cabGeo, CAB[i % CAB.length]);
      g.position.set(Math.cos(a) * WR, Math.sin(a) * WR, 0);
      g.castShadow = true;
      wheel.add(g);
      gondolas.push(g);
    }
    scene.add(wheel);
    for (const dz of [-2.1, 2.1]) for (const s of [-1, 1]) {
      trim.box(0.55, 16.4, 0.55, cx + s * 3.05, CURB + 7.7, wz + dz, 0xf4f1ea, 0, 0, s * 0.378);
      colliders.addBox(cx + s * 6.1 - 0.5, wz + dz - 0.5, cx + s * 6.1 + 0.5, wz + dz + 0.5);
    }
    trim.box(12.6, 0.9, 5.2, cx, CURB + 0.45, wz, 0x8a6a4a);
    trim.box(3, 2.4, 2.2, cx - 4.2, CURB + 2.1, wz, 0x34568a);
    colliders.addBox(cx - 6.3, wz - 2.6, cx + 6.3, wz + 2.6, 1.1);
    pools.add(cx, CURB + 0.08, wz, 0, 30, 1, 30);
    mapShapes.push({ kind: 'circle', x: cx, z: wz, r: 6, color: '#d9d2c2' });
  }

  // ---------------------------------------------------------------- beach
  {
    const UMB = [0xd9412b, 0xf2ead8, 0x2e9d8b, 0xe8b84a, 0x4a7fd0, 0xff8a6a];
    for (let i = 0; i < 22; i++) {
      const x = -176 + i * 16.6 + R.range(-3, 3), z = R.range(204, 210);
      if (x > PIER.x0 - 5 && x < PIER.x1 + 5) continue;
      const y = baseHeight(x, z);
      const c = UMB[i % UMB.length];
      trim.cyl(0.04, 0.04, 2.3, x, y + 1.15, z, 0xdddddd, 5);
      trim.cyl(0.05, 1.5, 0.5, x, y + 2.35, z, c, 8);
      colliders.addCircle(x, z, 0.12);
      for (const dx of [-1.1, 1.1]) {
        trim.box(0.7, 0.12, 1.9, x + dx, y + 0.3, z + 0.4, i % 2 ? 0xf2ead8 : c, 0, -0.045);
        trim.box(0.7, 0.5, 0.1, x + dx, y + 0.55, z - 0.5, i % 2 ? 0xf2ead8 : c, 0, -0.5);
      }
      if (R.chance(0.4)) props.add('ball', x + R.range(-2.5, 2.5), z + 2.5, 0, UMB[(i + 2) % UMB.length]);
    }
    for (const x of [-150, -96, -30, 86, 128, 168]) {
      for (let k = 0; k < 3; k++) tree(x + R.range(-4, 4), R.range(201.5, 205), 2, R.range(0.9, 1.3));
    }
    // Lifeguard hut on stilts.
    const lx = -60, lz = 207, ly = baseHeight(lx, lz);
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) trim.box(0.16, 2.6, 0.16, lx + dx, ly + 1.3, lz + dz, 0xe8e2d6);
    trim.box(3, 0.16, 3.4, lx, ly + 2.6, lz, 0xe8e2d6);
    trim.box(2.6, 1.9, 2.2, lx, ly + 3.6, lz - 0.4, 0xd9412b);
    trim.box(3.2, 0.14, 3.2, lx, ly + 4.65, lz - 0.2, 0xf2ead8, 0, 0.1);
    colliders.addBox(lx - 1.4, lz - 1.4, lx + 1.4, lz + 1.4);
    // Volleyball net.
    for (const dx of [-4.5, 4.5]) { trim.cyl(0.06, 0.06, 2.5, 110 + dx, baseHeight(110, 208) + 1.25, 208, 0xeeeeee, 5); colliders.addCircle(110 + dx, 208, 0.1); }
    trim.box(9, 0.9, 0.03, 110, baseHeight(110, 208) + 2.0, 208, 0xf8f8f8);
    props.add('ball', 108, 210, 0, 0xf2ead8);
  }

  // ---------------------------------------------------------------- docks
  const beaconSpots = [];
  {
    const D = DOCKS;
    const boxMat = new THREE.MeshLambertMaterial({ map: containerTexture(), vertexColors: true });
    boxMat.map.repeat.set(5, 1);
    const cb = new GeoBuilder();
    const CC = [0xc0392b, 0x2e6da4, 0x2e8b57, 0xd98a2b, 0x7f8388, 0x8a3a6a, 0xe0c040, 0x3d8f96];
    const stack = (x, z, alongX, n) => {
      const w = alongX ? 12 : 2.5, d = alongX ? 2.5 : 12;
      for (let k = 0; k < n; k++) cb.box(w, 2.6, d, x, 1.3 + k * 2.6, z, R.pick(CC), 0);
      colliders.addBox(x - w / 2, z - d / 2, x + w / 2, z + d / 2, n * 2.6);
      mapShapes.push({ kind: 'rect', x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, color: '#8a6f5a' });
    };
    for (let row = 0; row < 3; row++) for (let i = 0; i < 4; i++) {
      const x = D.x0 + 9 + row * 15, z = D.z0 + 12 + i * 13.2;
      stack(x, z, false, R.int(1, 3));
      if (R.chance(0.75)) stack(x + 2.8, z, false, R.int(1, 3));
    }
    for (let i = 0; i < 3; i++) { stack(D.x0 + 12 + i * 13.5, 96, true, R.int(1, 3)); stack(D.x0 + 12 + i * 13.5, 99, true, R.int(1, 2)); }
    stack(-203, -76, true, 1); // the one you are meant to jump
    addRamp(-203, -52, Math.PI, 9, 5.5, 2.5);
    rampMesh(-203, -52, Math.PI, 9, 5.5, 2.5);
    addRamp(-236, 48, Math.PI, 10, 6, 2.9);
    rampMesh(-236, 48, Math.PI, 10, 6, 2.9);
    const boxes = new THREE.Mesh(cb.build(), boxMat);
    boxes.castShadow = true; boxes.receiveShadow = true;
    scene.add(boxes);

    // Gantry crane straddling the quay.
    const gx = D.x0 + 12, gz = -12, GC = 0xd96a2b;
    for (const [dx, dz] of [[-7, -9], [7, -9], [-7, 9], [7, 9]]) {
      trim.box(1.3, 30, 1.3, gx + dx, 15, gz + dz, GC);
      colliders.addBox(gx + dx - 0.8, gz + dz - 0.8, gx + dx + 0.8, gz + dz + 0.8);
    }
    for (const dz of [-9, 9]) { trim.box(15.3, 1.4, 1.3, gx, 29.5, gz + dz, GC); trim.box(15.3, 1, 1, gx, 12, gz + dz, GC); }
    for (const dx of [-7, 7]) trim.box(1.3, 1.4, 19.3, gx + dx, 29.5, gz, GC);
    trim.box(64, 1.8, 2.2, gx - 14, 31.2, gz, GC);
    trim.box(1, 9, 1, gx, 36, gz, GC);
    trim.box(40, 0.3, 0.3, gx - 20, 38, gz, 0x3a3d42, 0, 0, 0.21);
    trim.box(4, 3, 3.4, gx - 6, 29, gz, 0xe8e2d6);
    trim.box(0.15, 14, 0.15, gx - 30, 23.5, gz, 0x2a2d31);
    trim.box(12, 2.6, 2.5, gx - 30, 15.2, gz, 0x2e6da4);
    beaconSpots.push([gx, 40.8, gz], [gx - 45.5, 32.6, gz]);

    // A freighter alongside.
    const sx = D.x0 - 15, sz = -70;
    trim.box(17, 9, 118, sx, 2.2, sz, 0x23364a);
    trim.box(17.2, 2.4, 118.2, sx, -1.2, sz, 0x8a2f26);
    trim.box(17.4, 1, 119, sx, 7, sz, 0x1b2836);
    trim.box(13, 12, 14, sx, 13, sz - 44, 0xe8e6e0);
    trim.box(15, 1.2, 16, sx, 19.4, sz - 44, 0xd0cec8);
    trim.cyl(1.9, 2.3, 6, sx, 23, sz - 46, 0xd9412b, 10);
    trim.cyl(0.08, 0.08, 9, sx, 24.5, sz - 39, 0xdddddd, 5);
    for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) {
      const n = R.int(1, 3);
      for (let h = 0; h < n; h++) cb2(sx - 3.6 + k * 7.2, 8 + 1.3 + h * 2.6, sz - 26 + i * 13.2);
    }
    function cb2(x, y, z) { trim.box(6.6, 2.55, 12, x, y, z, R.pick(CC)); }
    beaconSpots.push([sx, 29.2, sz - 39]);

    // Quay edge: a lip, bollards, and walls so nothing rolls into the harbour.
    trim.box(1, 0.5, D.z1 - D.z0, D.x0 + 0.5, 0.25, (D.z0 + D.z1) / 2, 0xd8c040);
    colliders.addBox(D.x0 - 3, D.z0, D.x0 + 1, D.z1);
    trim.box(-192 - D.x0, 0.5, 1, (D.x0 - 192) / 2, 0.25, D.z0 + 0.5, 0xa8a49c);
    colliders.addBox(D.x0, D.z0 - 3, -192, D.z0 + 1);
    trim.box(-192 - D.x0, 0.5, 1, (D.x0 - 192) / 2, 0.25, D.z1 - 0.5, 0xa8a49c);
    colliders.addBox(D.x0, D.z1 - 1, -192, D.z1 + 3);
    for (let z = D.z0 + 10; z < D.z1; z += 20) { trim.cyl(0.3, 0.38, 0.75, D.x0 + 1.6, 0.37, z, 0x2a2d31, 8); colliders.addCircle(D.x0 + 1.6, z, 0.4, 0.8); }

    // Sheds.
    city.warehouse({ x0: D.x0 + 6, x1: D.x0 + 40, z0: 62, z1: 86 }, 9.5, makeRng(71));
    city.warehouse({ x0: -222, x1: -198, z0: -144, z1: -100 }, 8.5, makeRng(72));
    // Floodlight masts.
    for (const [mx, mz] of [[-210, 20], [-232, -86], [-240, 104], [-198, 66]]) {
      trim.cyl(0.14, 0.22, 16, mx, 8, mz, 0x4a4f55, 6);
      trim.box(2.6, 0.5, 0.5, mx, 16, mz, 0x2a2d31);
      colliders.addCircle(mx, mz, 0.3);
      for (const dx of [-0.9, 0, 0.9]) dots.add(mx + dx, 15.7, mz, 0, 0.3, 0.12, 0.3, 0xe8f0ff);
      pools.add(mx, 0.08, mz, 0, 44, 1, 44);
    }
    // Things to scatter with a bumper.
    for (let i = 0; i < 9; i++) props.add('barrel', -214 + (i % 3) * 1.1, 22 + Math.floor(i / 3) * 1.1, 0, i % 2 ? 0x2e6da4 : 0xd98a2b);
    for (let i = 0; i < 6; i++) props.add('cone', -209 + i * 2.4, -38, 0);
    for (let i = 0; i < 6; i++) props.add('cone', -197 + (i % 2) * 12, -44 - Math.floor(i / 2) * 3, 0);
    for (let i = 0; i < 8; i++) props.add('crate', -228 + (i % 4) * 1.15, 6 + Math.floor(i / 4) * 1.15, R() * 0.4);
    for (let i = 0; i < 5; i++) props.add('barrel', -246 + i * 1.2, 56, 0, 0xc0392b);
  }

  // Road works on one street: cones and barriers to clatter through.
  for (let i = 0; i < 7; i++) props.add('cone', 108 - 4.6, -80 + i * 2.6, 0);
  for (let i = 0; i < 3; i++) props.add('barrier', 108 - 5.2, -62 + i * 2.4, Math.PI / 2);
  for (let i = 0; i < 5; i++) props.add('cone', -70 + i * 2.2, 36 + 4.9, 0);

  // ------------------------------------------------------------ ramp mesh
  function rampMesh(x, z, heading, len, width, height) {
    const s = Math.sin(heading), c = Math.cos(heading);
    const y = baseHeight(x, z);
    const P = (along, side, h) => [x + s * along - c * side, y + h, z + c * along + s * side];
    const w = width / 2;
    trim.quad(P(0, -w, 0.02), P(0, w, 0.02), P(len, w, height), P(len, -w, height), 0xe0b030);
    for (let k = 1; k < 5; k++) {
      const a = (len * k) / 5;
      trim.quad(P(a - 0.25, -w, (height * (a - 0.25)) / len + 0.03), P(a - 0.25, w, (height * (a - 0.25)) / len + 0.03), P(a + 0.25, w, (height * (a + 0.25)) / len + 0.03), P(a + 0.25, -w, (height * (a + 0.25)) / len + 0.03), 0x2c2f33);
    }
    trim.quad(P(len, -w, height), P(len, w, height), P(len, w, 0), P(len, -w, 0), 0x3a3d42);
    trim.quad(P(0, w, 0), P(len, w, 0), P(len, w, height), P(len, w, height), 0x8a7a40);
    trim.quad(P(len, -w, 0), P(0, -w, 0), P(len, -w, height), P(len, -w, height), 0x8a7a40);
  }

  // ----------------------------------------------------------- lighthouse
  const beam = new THREE.Group();
  let beamMat;
  {
    const lx = 150, lz = 318;
    const rock = new THREE.IcosahedronGeometry(1, 1);
    trim.add(rock, mat(lx, -1.5, lz, 0, 0.4, 0, 13, 4, 11), 0x6a6862);
    trim.add(rock, mat(lx + 7, -1.2, lz + 4, 0, 1.4, 0, 6, 2.6, 5), 0x5c5a55);
    for (let i = 0; i < 5; i++) trim.cyl(2.1 - i * 0.2, 2.3 - i * 0.2, 4.4, lx, 3.2 + i * 4.4, lz, i % 2 ? 0xd9412b : 0xf2efe8, 12);
    trim.cyl(2.3, 2.3, 0.3, lx, 23.2, lz, 0x2a2d31, 12);
    trim.cyl(0.05, 1.6, 1.6, lx, 26.6, lz, 0xd9412b, 10);
    dots.add(lx, 24.5, lz, 0, 0.9, 1.1, 0.9, 0xfff2c0);
    beam.position.set(lx, 24.5, lz);
    beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const cone = new THREE.ConeGeometry(9, 150, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 75);
    beam.add(new THREE.Mesh(cone, beamMat));
    const back = new THREE.Mesh(cone, beamMat);
    back.rotation.y = Math.PI;
    beam.add(back);
    scene.add(beam);
    mapShapes.push({ kind: 'circle', x: lx, z: lz, r: 5, color: '#d9d2c2' });
  }

  // ---------------------------------------------------------------- boats
  const boats = [];
  {
    const hull = new GeoBuilder();
    hull.box(2.4, 1.1, 6.4, 0, 0.35, 0, 0xf4f1ea);
    hull.box(1.7, 1.1, 1.7, 0, 0.35, 3.2, 0xf4f1ea, Math.PI / 4);
    hull.box(2.45, 0.2, 6.45, 0, 0.72, 0, 0x34568a);
    hull.box(1.5, 0.7, 2.4, 0, 1.2, -0.8, 0xe8e2d6);
    hull.cyl(0.07, 0.09, 9.5, 0, 5.4, 0.6, 0xdddddd, 5);
    hull.quad([0, 1.6, 0.45], [0, 1.6, -2.9], [0, 9.8, 0.45], [0, 9.8, 0.45], 0xffffff);
    hull.quad([0, 1.6, -2.9], [0, 1.6, 0.45], [0, 9.8, 0.45], [0, 9.8, 0.45], 0xffffff);
    hull.quad([0, 1.4, 0.8], [0, 8.6, 0.75], [0, 1.4, 3.6], [0, 1.4, 3.6], 0xffd0c0);
    hull.quad([0, 8.6, 0.75], [0, 1.4, 0.8], [0, 1.4, 3.6], [0, 1.4, 3.6], 0xffd0c0);
    const geo = hull.build();
    for (const [x, z, ry] of [[-110, 272, 0.6], [96, 262, -1.1], [232, 120, 2.2], [-40, 330, 2.6], [230, -80, 0.3], [-90, -232, 1.2]]) {
      const m = new THREE.Mesh(geo, city.trimMat);
      m.position.set(x, WATER_Y, z);
      m.rotation.y = ry;
      m.userData.ph = R() * TAU;
      scene.add(m);
      boats.push(m);
    }
  }

  // -------------------------------------------------------------- the sea
  const sea = new THREE.ShaderMaterial({
    uniforms: {
      uTime: time,
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uDeep: { value: new THREE.Color(0x0b3a52) },
      uSky: { value: new THREE.Color(0x88aacc) },
      uFogColor: { value: new THREE.Color(0x88aacc) },
      uFogNear: { value: 100 },
      uFogFar: { value: 1200 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uFogNear, uFogFar;
      uniform vec3 uSunDir, uSunColor, uDeep, uSky, uFogColor;
      varying vec3 vWorld;
      vec2 wave(vec2 p, vec2 dir, float freq, float speed, float amp) {
        return dir * cos(dot(p, dir) * freq + uTime * speed) * amp;
      }
      void main() {
        vec3 toCam = cameraPosition - vWorld;
        float dist = length(toCam);
        vec3 v = toCam / dist;
        vec2 p = vWorld.xz;
        vec2 d = wave(p, vec2(0.8, 0.6), 0.18, 0.9, 0.10) + wave(p, vec2(-0.6, 0.8), 0.41, 1.3, 0.09)
               + wave(p, vec2(0.25, -0.97), 0.9, 1.9, 0.08) + wave(p, vec2(0.97, 0.2), 2.1, 2.6, 0.07)
               + wave(p, vec2(-0.7, -0.7), 4.3, 3.4, 0.05);
        d *= 1.0 / (1.0 + dist * 0.012);
        vec3 n = normalize(vec3(-d.x, 1.0, -d.y));
        float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);
        vec3 col = mix(uDeep, uSky, clamp(fres * 0.72 + 0.04, 0.0, 1.0));
        col += uDeep * 0.5 * smoothstep(0.0, 1.0, d.x * 3.0 + d.y * 3.0 + 0.2);
        vec3 r = reflect(-v, n);
        float spec = pow(max(dot(r, uSunDir), 0.0), 180.0);
        col += uSunColor * spec * 1.6;
        col += uSunColor * pow(max(dot(r, uSunDir), 0.0), 12.0) * 0.08;
        float fog = smoothstep(uFogNear, uFogFar, dist);
        col = mix(col, uFogColor, fog);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(4200, 4200).rotateX(-Math.PI / 2), sea);
  seaMesh.position.y = WATER_Y;
  scene.add(seaMesh);

  // ----------------------------------------------------- hills on the horizon
  let hillMesh;
  {
    const hb = new GeoBuilder();
    const hr = makeRng(5);
    for (const [radius, scale, c] of [[1250, 1, 0x53687a], [1050, 0.6, 0x3f5568]]) {
      const N = 120;
      const hs = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * TAU;
        const north = clamp(0.55 - Math.cos(a - Math.PI / 2) * 0.6, 0.12, 1); // lower toward the open sea
        hs.push((40 + 150 * Math.abs(Math.sin(a * 3.1 + radius) * Math.cos(a * 7.3)) + hr() * 50) * scale * north);
      }
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * TAU, a1 = ((i + 1) / N) * TAU;
        const h0 = hs[i], h1 = hs[(i + 1) % N];
        hb.quad([Math.cos(a1) * radius, -6, Math.sin(a1) * radius], [Math.cos(a0) * radius, -6, Math.sin(a0) * radius],
          [Math.cos(a0) * radius, h0, Math.sin(a0) * radius], [Math.cos(a1) * radius, h1, Math.sin(a1) * radius], c);
      }
    }
    const hills = new THREE.Mesh(hb.build(), new THREE.MeshBasicMaterial({ vertexColors: true }));
    scene.add(hills);
    hillMesh = hills;
  }

  // -------------------------------------------------------------- beacons
  for (const r of landmarks.roofs) beaconSpots.push([r.x, r.y, r.z]);
  const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff2a1a, toneMapped: false });
  const beacons = new Scatter(new THREE.SphereGeometry(0.28, 6, 5), beaconMat, { cast: false });
  for (const [x, y, z] of beaconSpots) beacons.add(x, y, z);

  // ---------------------------------------------------------------- build
  trees.build(scene); tallTrees.build(scene); palms.build(scene);
  lamps.build(scene); globes.build(scene); benches.build(scene); flowers.build(scene);
  dots.build(scene);
  // A soft halo on every lamp and lantern, as camera-facing points.
  const haloMats = [];
  const haloSet = (filter, size) => {
    const hp = [], hc = [];
    for (const [x, y, z, , sx, , , color] of dots.items) {
      if (!filter(sx)) continue;
      hp.push(x, y, z);
      _c.set(color ?? 0xffffff);
      hc.push(_c.r, _c.g, _c.b);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(hc, 3));
    const material = new THREE.PointsMaterial({ map: glowTex, size, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const points = new THREE.Points(geo, material);
    points.renderOrder = 4;
    scene.add(points);
    haloMats.push({ material, points });
  };
  haloSet((sx) => sx >= 0.14, 2.3);
  haloSet((sx) => sx < 0.14, 0.9);
  const poolMesh = pools.build(scene);
  poolMesh.renderOrder = 2;
  const bulbMesh = bulbs.build(scene);
  beacons.build(scene);
  props.build(scene);

  const OFF = { r: new THREE.Color(0x3a0c08), y: new THREE.Color(0x3a2c06), g: new THREE.Color(0x06301a) };
  const ON = { r: new THREE.Color(0xff2418), y: new THREE.Color(0xffb400), g: new THREE.Color(0x18ff7a) };
  let signalTimer = 0;

  return {
    hills: hillMesh,
    sea,
    /** Advance animated scenery. `env` carries the current light and sky state. */
    update(dt, t, env, fx) {
      time.value = t;
      const n = env.night;
      // lamps
      poolMat.opacity = n * 0.5;
      for (const h of haloMats) { h.material.opacity = n * 0.5; h.points.visible = n > 0.02; }
      poolMesh.visible = n > 0.02;
      const lampOn = 0.3 + n * 2.6;
      dotMat.color.setScalar(lampOn);
      wheel.userData.bulbMat.color.setScalar(0.45 + n * 2.4);
      beaconMat.color.setRGB(1, 0.16, 0.1).multiplyScalar(Math.sin(t * 3.2) > 0.2 ? 1 : 0.18);
      // traffic signals
      signalTimer -= dt;
      if (signalTimer <= 0) {
        signalTimer = 0.2;
        let dirty = false;
        for (const s of signals) {
          const st = lightState(s.node, s.alongX, t);
          if (st === s.state) continue;
          s.state = st;
          dirty = true;
          for (let i = 0; i < s.idx.length; i++) {
            const lamp = 'ryg'[i % 3];
            bulbMesh.setColorAt(s.idx[i], lamp === st ? ON[lamp] : OFF[lamp]);
          }
        }
        if (dirty) bulbMesh.instanceColor.needsUpdate = true;
      }
      // wheel, sculpture, lighthouse, boats
      wheel.rotation.z += dt * 0.11;
      for (const g of gondolas) g.rotation.z = -wheel.rotation.z;
      ring.rotation.set(Math.sin(t * 0.21) * 0.5 + 0.9, t * 0.33, 0);
      beam.rotation.y = t * 0.55;
      beamMat.opacity = n * 0.055;
      beam.visible = n > 0.03;
      for (const b of boats) {
        b.position.y = WATER_Y + Math.sin(t * 0.9 + b.userData.ph) * 0.12;
        b.rotation.z = Math.sin(t * 0.7 + b.userData.ph) * 0.05;
        b.rotation.x = Math.sin(t * 0.53 + b.userData.ph * 2) * 0.03;
      }
      // fountain
      if (fx && env.nearPlaza) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * TAU, sp = 1.2 + Math.random() * 1.6;
          fx.emit(0 + Math.cos(a) * 0.9, CURB + 1.4, -72 + Math.sin(a) * 0.9, Math.cos(a) * sp, 6.5 + Math.random() * 2, Math.sin(a) * sp, 1.5, 0.22, 0.25, 0.8, 0.9, 1.0, 0.5, 11, 0.2);
        }
      }
      // sea and horizon follow the sky
      sea.uniforms.uSunDir.value.copy(env.lightDir);
      sea.uniforms.uSunColor.value.copy(env.sunGlint);
      sea.uniforms.uSky.value.copy(env.horizon).lerp(env.zenith, 0.45);
      sea.uniforms.uDeep.value.copy(env.seaDeep);
      sea.uniforms.uFogColor.value.copy(env.fogColor);
      sea.uniforms.uFogNear.value = env.fogNear;
      sea.uniforms.uFogFar.value = env.fogFar;
      hillMesh.material.color.copy(env.hillTint);
      waterFlat.color.copy(env.seaDeep).lerp(env.horizon, 0.35);
    },
  };
}

