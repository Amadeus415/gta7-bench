import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, rng, mat, col, clamp } from './util.js';
import { makeTextures } from './textures.js';

// ---------------------------------------------------------------------------
// City layout. Six avenues (constant x) cross six streets (constant z); the 5x5
// blocks between them are 50 m footprints with 4 m sidewalks. The harbour lies
// past the last street, at +z.
// ---------------------------------------------------------------------------
export const LINES = [-160, -96, -32, 32, 96, 160];
export const BLOCKS = [-128, -64, 0, 64, 128];
export const ROAD_HALF = 7;
export const BLOCK_HALF = 25;
export const LOT_HALF = 21;
export const LANE = 3.5;
export const CURB_PARK = 6;
export const SLAB = 0.15;
export const SEA_Z = 190;
export const BOUND = 181;
export const PIER = { x0: -6, x1: 6, z1: 262 };
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

export const AVENUES = ['Marlow Ave', 'Kestrel Ave', 'Juniper Ave', 'Osprey Ave', 'Calder Ave', 'Wren Ave'];
export const STREETS = ['North Loop', 'Foundry St', 'Copper St', 'Lantern St', 'Tidewater St', 'Harbor Rd'];

export const nodePos = (i, j) => ({ x: LINES[i], z: LINES[j] });
export const validDir = (i, j, d) => {
  const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
  return ni >= 0 && ni < 6 && nj >= 0 && nj < 6;
};
export const headingOf = (dx, dz) => Math.atan2(dx, dz);

const BLOCK_TYPE = (bi, bj) => {
  if (bi === 2 && bj === 2) return 'park';
  if (bi === 1 && bj === 3) return 'plaza';
  if (bj === 4 && (bi === 0 || bi === 4 || bi === 1)) return 'warehouse';
  return 'city';
};

// ---------------------------------------------------------------------------
// Static collision: boxes and circles in a uniform hash grid.
// ---------------------------------------------------------------------------
class Grid {
  constructor(cell = 16) {
    this.cell = cell;
    this.map = new Map();
    this.stamp = 0;
    this.out = [];
  }
  key(i, j) { return (i + 500) * 1000 + (j + 500); }
  add(c) {
    const s = this.cell;
    const x0 = c.circle ? c.x - c.r : c.x0, x1 = c.circle ? c.x + c.r : c.x1;
    const z0 = c.circle ? c.z - c.r : c.z0, z1 = c.circle ? c.z + c.r : c.z1;
    for (let i = Math.floor(x0 / s); i <= Math.floor(x1 / s); i++) {
      for (let j = Math.floor(z0 / s); j <= Math.floor(z1 / s); j++) {
        const k = this.key(i, j);
        let arr = this.map.get(k);
        if (!arr) this.map.set(k, (arr = []));
        arr.push(c);
      }
    }
  }
  query(x, z, r) {
    const s = this.cell, out = this.out;
    out.length = 0;
    const st = ++this.stamp;
    for (let i = Math.floor((x - r) / s); i <= Math.floor((x + r) / s); i++) {
      for (let j = Math.floor((z - r) / s); j <= Math.floor((z + r) / s); j++) {
        const arr = this.map.get(this.key(i, j));
        if (!arr) continue;
        for (const c of arr) {
          if (c._s !== st && !c.dead) { c._s = st; out.push(c); }
        }
      }
    }
    return out;
  }
}

/** Push needed to move circle (x,z,r) out of collider c, or null. */
export function circleHit(x, z, r, c) {
  if (c.circle) {
    const dx = x - c.x, dz = z - c.z;
    const d2 = dx * dx + dz * dz, rr = r + c.r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2) || 0.0001;
    return { nx: dx / d, nz: dz / d, depth: rr - d };
  }
  const px = clamp(x, c.x0, c.x1), pz = clamp(z, c.z0, c.z1);
  const dx = x - px, dz = z - pz;
  const d2 = dx * dx + dz * dz;
  if (d2 > 0) {
    if (d2 >= r * r) return null;
    const d = Math.sqrt(d2);
    return { nx: dx / d, nz: dz / d, depth: r - d };
  }
  // Centre inside the box: leave by the nearest face.
  const l = x - c.x0, rgt = c.x1 - x, t = z - c.z0, b = c.z1 - z;
  const m = Math.min(l, rgt, t, b);
  if (m === l) return { nx: -1, nz: 0, depth: l + r };
  if (m === rgt) return { nx: 1, nz: 0, depth: rgt + r };
  if (m === t) return { nx: 0, nz: -1, depth: t + r };
  return { nx: 0, nz: 1, depth: b + r };
}

// ---------------------------------------------------------------------------
export function buildWorld(scene) {
  const R = rng(20261121);
  const T = makeTextures();
  const grid = new Grid(16);
  const world = {
    grid,
    colliders: [],
    buildings: [], // minimap rects
    lamps: [],
    places: [],
    blocks: [],
    parkSpots: [],
    pondMeshes: [],
    T,
  };

  const addBox = (x0, z0, x1, z1, h, opts = {}) => {
    const c = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), h, stand: opts.stand ?? false };
    world.colliders.push(c);
    grid.add(c);
    return c;
  };
  const addCircle = (x, z, r, h, opts = {}) => {
    const c = { circle: true, x, z, r, h, stand: opts.stand ?? false };
    world.colliders.push(c);
    grid.add(c);
    return c;
  };
  world.addBox = addBox;

  // ---- materials ----
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    road: std({ map: T.road, roughness: 0.92 }),
    asphalt: std({ map: T.asphalt, roughness: 0.92 }),
    paint: std({ color: 0xe9e6dc, roughness: 0.8 }),
    concrete: std({ map: T.concrete, vertexColors: true, roughness: 0.95 }),
    grass: std({ map: T.grass, vertexColors: true, roughness: 1 }),
    plaza: std({ map: T.plaza, vertexColors: true, roughness: 0.85 }),
    wood: std({ map: T.wood, vertexColors: true, roughness: 0.9 }),
    roof: std({ vertexColors: true, roughness: 0.9 }),
    prop: std({ vertexColors: true, roughness: 0.75, metalness: 0.05 }),
    metal: std({ vertexColors: true, roughness: 0.4, metalness: 0.6 }),
  };
  const facadeMat = {};
  for (const k of ['office', 'brick', 'warehouse']) {
    facadeMat[k] = std({
      map: T.facades[k].map,
      emissiveMap: T.facades[k].emi,
      emissive: 0xffffff,
      emissiveIntensity: 0,
      vertexColors: true,
      roughness: k === 'office' ? 0.45 : 0.85,
      metalness: k === 'office' ? 0.15 : 0,
    });
  }
  world.facadeMat = facadeMat;

  const B = {
    road: new GeoBuilder(), asphalt: new GeoBuilder(), paint: new GeoBuilder(),
    concrete: new GeoBuilder(), grass: new GeoBuilder(), plaza: new GeoBuilder(), wood: new GeoBuilder(),
    roof: new GeoBuilder(), prop: new GeoBuilder(), metal: new GeoBuilder(),
    office: new GeoBuilder(), brick: new GeoBuilder(), warehouse: new GeoBuilder(),
  };
  const WHITE = col(0xffffff);
  const Y = 0.012;

  // ---- roads ----
  for (let j = 0; j < 6; j++) {
    for (let i = 0; i < 5; i++) {
      // Street along x at z = LINES[j]
      const x0 = LINES[i] + ROAD_HALF, x1 = LINES[i + 1] - ROAD_HALF, zc = LINES[j];
      const z0 = zc - ROAD_HALF, z1 = zc + ROAD_HALF;
      B.road.tri([x0, Y, z1], [x1, Y, z1], [x1, Y, z0], [1, x0 / 12], [1, x1 / 12], [0, x1 / 12], WHITE);
      B.road.tri([x0, Y, z1], [x1, Y, z0], [x0, Y, z0], [1, x0 / 12], [0, x1 / 12], [0, x0 / 12], WHITE);
      // Avenue along z at x = LINES[j]
      const xc = LINES[j], za = LINES[i] + ROAD_HALF, zb = LINES[i + 1] - ROAD_HALF;
      const xa = xc - ROAD_HALF, xb = xc + ROAD_HALF;
      B.road.tri([xa, Y, zb], [xb, Y, zb], [xb, Y, za], [0, zb / 12], [1, zb / 12], [1, za / 12], WHITE);
      B.road.tri([xa, Y, zb], [xb, Y, za], [xa, Y, za], [0, zb / 12], [1, za / 12], [0, za / 12], WHITE);
    }
  }
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const x = LINES[i], z = LINES[j];
      B.asphalt.box(x - ROAD_HALF, 0, z - ROAD_HALF, x + ROAD_HALF, Y, z + ROAD_HALF, WHITE, { sides: false, topS: 1 / 8 });
      // Zebra crossings on every arm of the junction.
      for (let d = 0; d < 4; d++) {
        if (!validDir(i, j, d)) continue;
        const [dx, dz] = DIRS[d];
        for (let s = -5.5; s <= 5.5; s += 1.1) {
          const cx = x + dx * (ROAD_HALF + 1.8) + (dz !== 0 ? s : 0);
          const cz = z + dz * (ROAD_HALF + 1.8) + (dx !== 0 ? s : 0);
          const hx = dx !== 0 ? 1.4 : 0.28, hz = dz !== 0 ? 1.4 : 0.28;
          B.paint.box(cx - hx, 0, cz - hz, cx + hx, Y + 0.004, cz + hz, WHITE, { sides: false });
        }
      }
    }
  }

  // ---- blocks ----
  const CURB = col(0x9a978f);
  const SIDEWALK = col(0xffffff);
  const LOT = col(0xd8d4cc);
  const facadeTints = ['#d9c7a8', '#b5aca1', '#9aa7b4', '#e3d7c3', '#b98466', '#8b9a9e', '#efe6d8', '#a8775a', '#7e8ea5', '#cfd4d6', '#c9a27c', '#9fb1a1'];
  const roofCols = [0x55585c, 0x6a6560, 0x4a4d52, 0x5f6a6e];

  const towerCenter = { x: 96, z: -96 };

  function addBuilding(x0, z0, x1, z1, h, style, opts = {}) {
    const tint = opts.tint ?? col(R.pick(facadeTints));
    const b = B[style];
    const uOff = R.int(0, 7) / 8;
    b.box(x0, SLAB, z0, x1, h, z1, tint, { top: false, uS: 1 / 32, vS: 1 / 28, uOff });
    let top = h, tx0 = x0, tz0 = z0, tx1 = x1, tz1 = z1;
    if (opts.setback) {
      const s = opts.setback;
      tx0 += s; tz0 += s; tx1 -= s; tz1 -= s;
      top = opts.h2;
      roofSlab(x0, z0, x1, z1, h);
      b.box(tx0, h, tz0, tx1, top, tz1, tint, { top: false, uS: 1 / 32, vS: 1 / 28, uOff });
    }
    roofSlab(tx0, tz0, tx1, tz1, top);
    // Rooftop clutter.
    const w = tx1 - tx0, d = tz1 - tz0;
    if (top > 10) {
      const n = R.int(1, 3);
      for (let k = 0; k < n; k++) {
        const ax = tx0 + 2 + R() * (w - 5), az = tz0 + 2 + R() * (d - 5);
        B.metal.box(ax, top, az, ax + 1.8, top + 1.1, az + 1.3, col(0xa9adb1));
      }
      if (style === 'brick' && R() < 0.6) {
        const ax = tx0 + 3 + R() * (w - 6), az = tz0 + 3 + R() * (d - 6);
        for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]]) {
          B.prop.box(ax + lx - 0.08, top, az + lz - 0.08, ax + lx + 0.08, top + 2, az + lz + 0.08, col(0x4a3b2e));
        }
        B.prop.geo(new THREE.CylinderGeometry(1.3, 1.3, 2.2, 12), mat(ax, top + 3.1, az), col(0x7a5a3e));
        B.prop.geo(new THREE.ConeGeometry(1.45, 0.9, 12), mat(ax, top + 4.65, az), col(0x5a4330));
      }
      if (top > 55 && R() < 0.7) {
        const ax = (tx0 + tx1) / 2, az = (tz0 + tz1) / 2;
        B.metal.box(ax - 0.15, top, az - 0.15, ax + 0.15, top + 9 + R() * 6, az + 0.15, col(0xcccccc));
        world.beacons.push(new THREE.Vector3(ax, top + 12, az));
      }
    }
    addBox(x0, z0, x1, z1, h + 1, { stand: false });
    world.buildings.push({ x0, z0, x1, z1, h });
  }
  world.beacons = [];

  function roofSlab(x0, z0, x1, z1, h) {
    const rc = col(R.pick(roofCols));
    B.roof.box(x0, h - 0.01, z0, x1, h + 0.02, z1, rc, { sides: false });
    const p = 0.35, ph = 0.7, pc = col(0x77736e);
    B.roof.box(x0, h, z0, x1, h + ph, z0 + p, pc);
    B.roof.box(x0, h, z1 - p, x1, h + ph, z1, pc);
    B.roof.box(x0, h, z0, x0 + p, h + ph, z1, pc);
    B.roof.box(x1 - p, h, z0, x1, h + ph, z1, pc);
  }

  const trees = []; // {x,z,s,type}
  const benches = []; // {x,z,ry}

  for (let bi = 0; bi < 5; bi++) {
    for (let bj = 0; bj < 5; bj++) {
      const cx = BLOCKS[bi], cz = BLOCKS[bj];
      const type = BLOCK_TYPE(bi, bj);
      world.blocks.push({ bi, bj, cx, cz, type });
      // Raised slab: curb sides plus a sidewalk ring.
      B.concrete.box(cx - BLOCK_HALF, 0, cz - BLOCK_HALF, cx + BLOCK_HALF, SLAB, cz + BLOCK_HALF, CURB, { top: false });
      const o = BLOCK_HALF, n = LOT_HALF;
      B.concrete.box(cx - o, 0, cz - o, cx + o, SLAB, cz - n, SIDEWALK, { sides: false });
      B.concrete.box(cx - o, 0, cz + n, cx + o, SLAB, cz + o, SIDEWALK, { sides: false });
      B.concrete.box(cx - o, 0, cz - n, cx - n, SLAB, cz + n, SIDEWALK, { sides: false });
      B.concrete.box(cx + n, 0, cz - n, cx + o, SLAB, cz + n, SIDEWALK, { sides: false });
      const inner = type === 'park' ? B.grass : type === 'plaza' ? B.plaza : B.concrete;
      inner.box(cx - n, 0, cz - n, cx + n, SLAB, cz + n, type === 'city' || type === 'warehouse' ? LOT : WHITE, { sides: false, topS: type === 'park' ? 1 / 8 : type === 'plaza' ? 1 / 6 : 1 / 4 });

      // Street lamps around the block, arms reaching over the road.
      for (let side = 0; side < 4; side++) {
        const [nx, nz] = DIRS[side];
        for (const t of [-14, 2, 16]) {
          const tt = side % 2 ? -t : t;
          const lx = cx + nx * 24.3 + (nz !== 0 ? tt : 0);
          const lz = cz + nz * 24.3 + (nx !== 0 ? tt : 0);
          world.lamps.push({ x: lx, z: lz, dx: nx, dz: nz });
          addCircle(lx, lz, 0.18, 7).lamp = world.lamps.length - 1;
        }
        if (type !== 'city' || R() < 0.45) {
          for (const t of [-6, 9]) {
            const tx = cx + nx * 24.2 + (nz !== 0 ? t : 0), tz = cz + nz * 24.2 + (nx !== 0 ? t : 0);
            trees.push({ x: tx, z: tz, s: 0.75 + R() * 0.2, type: 'round', street: true });
          }
        }
      }

      if (type === 'city') {
        const d = Math.hypot(cx - towerCenter.x, cz - towerCenter.z);
        const base = 8 + 78 * Math.exp(-d / 85);
        const lots = splitLots(R);
        for (const L of lots) {
          const gap = 1.2;
          const x0 = cx + L[0] + gap, x1 = cx + L[2] - gap, z0 = cz + L[1] + gap, z1 = cz + L[3] - gap;
          const area = (x1 - x0) * (z1 - z0);
          let h = Math.max(7, base * (0.45 + R() * 0.85) * (area > 500 ? 1.1 : 0.9));
          h = Math.round(h / 3.5) * 3.5 + SLAB;
          const style = h > 32 ? (R() < 0.8 ? 'office' : 'brick') : R() < 0.7 ? 'brick' : 'office';
          const minSide = Math.min(x1 - x0, z1 - z0);
          if (h > 30 && minSide > 12 && R() < 0.6) {
            addBuilding(x0, z0, x1, z1, Math.round((h * 0.45) / 3.5) * 3.5 + SLAB, style, { setback: 2 + R() * 2, h2: h });
          } else addBuilding(x0, z0, x1, z1, h, style);
        }
      } else if (type === 'warehouse') {
        if (R() < 0.5) {
          addBuilding(cx - 19, cz - 19, cx + 19, cz + 4, 10.65, 'warehouse');
          addBuilding(cx - 19, cz + 7, cx + 3, cz + 19, 7.15, 'warehouse');
        } else {
          addBuilding(cx - 19, cz - 19, cx - 1, cz + 19, 10.65, 'warehouse');
          addBuilding(cx + 2, cz - 19, cx + 19, cz + 2, 7.15, 'warehouse');
        }
        // A stack of shipping containers in the yard.
        containerStack(cx + 10, cz + 12, R() < 0.5 ? 0 : Math.PI / 2);
      } else if (type === 'park') buildPark(cx, cz);
      else if (type === 'plaza') buildPlaza(cx, cz);
    }
  }

  function containerStack(x, z, ry) {
    const cols = [0xb8452f, 0x2f6fb8, 0x3b8f4a, 0xd19a2a, 0x7a3fa0, 0x2a9aa0];
    const along = ry === 0;
    for (let k = 0; k < 3; k++) {
      const ox = along ? 0 : (k - 1) * 2.6, oz = along ? (k - 1) * 2.6 : 0;
      const hx = along ? 3 : 1.2, hz = along ? 1.2 : 3;
      const levels = 1 + ((k * 7 + Math.floor(x)) % 2);
      for (let l = 0; l < levels; l++) {
        const c = col(cols[(k * 3 + l + Math.abs(Math.floor(z))) % cols.length]);
        B.metal.box(x + ox - hx, SLAB + l * 2.6, z + oz - hz, x + ox + hx, SLAB + (l + 1) * 2.6 - 0.05, z + oz + hz, c);
      }
      addBox(x + ox - hx, z + oz - hz, x + ox + hx, z + oz + hz, SLAB + levels * 2.6, { stand: true });
    }
  }

  function buildPark(cx, cz) {
    const PATH = col(0xd9d2c3);
    // cross paths and a ring
    B.concrete.box(cx - 21, 0, cz - 1.6, cx + 21, SLAB + 0.01, cz + 1.6, PATH, { sides: false });
    B.concrete.box(cx - 1.6, 0, cz - 21, cx + 1.6, SLAB + 0.01, cz + 21, PATH, { sides: false });
    // pond
    const px = cx - 10, pz = cz + 10;
    B.prop.geo(new THREE.CylinderGeometry(6.6, 6.8, 0.45, 32, 1, true), mat(px, SLAB + 0.12, pz), col(0x8d8a84));
    B.prop.geo(new THREE.TorusGeometry(6.6, 0.25, 6, 32), mat(px, SLAB + 0.34, pz, 0, 1, 1, 1, Math.PI / 2), col(0xa19d95));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(6.5, 32), null);
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(px, SLAB + 0.2, pz);
    world.pondMeshes.push(pond);
    addCircle(px, pz, 6.8, 1.2);
    // obelisk monument at the crossing
    B.prop.box(cx - 1.4, SLAB, cz - 1.4, cx + 1.4, SLAB + 0.8, cz + 1.4, col(0x9c958a));
    B.prop.taper(cx - 0.7, cx + 0.7, cz - 0.7, cz + 0.7, SLAB + 0.8, SLAB + 9, [0.35, 0.35, 0.35, 0.35], col(0xcfc8bb));
    B.prop.geo(new THREE.ConeGeometry(0.5, 1, 4), mat(cx, SLAB + 9.5, cz, Math.PI / 4), col(0xd8b860));
    addBox(cx - 1.4, cz - 1.4, cx + 1.4, cz + 1.4, SLAB + 0.8, { stand: true });
    addCircle(cx, cz, 0.8, 10);
    // gazebo
    const gx = cx + 11, gz = cz - 11;
    B.prop.geo(new THREE.CylinderGeometry(4.2, 4.4, 0.4, 8), mat(gx, SLAB + 0.2, gz), col(0xbdb6aa));
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      const ux = gx + Math.cos(a) * 3.7, uz = gz + Math.sin(a) * 3.7;
      B.prop.box(ux - 0.13, SLAB + 0.4, uz - 0.13, ux + 0.13, SLAB + 3.4, uz + 0.13, col(0xf2efe8));
      addCircle(ux, uz, 0.2, 4);
    }
    B.prop.geo(new THREE.ConeGeometry(5, 2.2, 8), mat(gx, SLAB + 4.5, gz, Math.PI / 8), col(0x3f6b5a));
    addBox(gx - 4, gz - 4, gx + 4, gz + 4, SLAB + 0.4, { stand: true });
    world.places.push({ name: 'Greenway Park', x: cx + 2.5, z: cz + 2.5 });
    // trees
    let placed = 0, tries = 0;
    while (placed < 26 && tries++ < 400) {
      const x = cx + (R() * 2 - 1) * 19, z = cz + (R() * 2 - 1) * 19;
      if (Math.abs(x - cx) < 3.5 || Math.abs(z - cz) < 3.5) continue;
      if (Math.hypot(x - px, z - pz) < 9) continue;
      if (Math.hypot(x - gx, z - gz) < 6.5) continue;
      if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5)) continue;
      trees.push({ x, z, s: 0.9 + R() * 0.7, type: R() < 0.25 ? 'pine' : 'round' });
      placed++;
    }
    for (const t of [-15, -8, 8, 15]) {
      benches.push({ x: cx + t, z: cz + 2.6, ry: Math.PI });
      benches.push({ x: cx + 2.6, z: cz + t, ry: -Math.PI / 2 });
    }
  }

  function buildPlaza(cx, cz) {
    // fountain
    const STONE = col(0xcdbfa6);
    B.prop.geo(new THREE.CylinderGeometry(6.2, 6.4, 0.7, 40), mat(cx, SLAB + 0.35, cz), STONE);
    B.prop.geo(new THREE.CylinderGeometry(0.8, 1.1, 2.4, 16), mat(cx, SLAB + 1.4, cz), STONE);
    B.prop.geo(new THREE.CylinderGeometry(2.4, 0.9, 0.5, 24), mat(cx, SLAB + 2.7, cz), STONE);
    B.prop.geo(new THREE.CylinderGeometry(0.35, 0.5, 1.4, 12), mat(cx, SLAB + 3.6, cz), STONE);
    const water = new THREE.Mesh(new THREE.CircleGeometry(5.8, 40), null);
    water.rotation.x = -Math.PI / 2;
    water.position.set(cx, SLAB + 0.62, cz);
    world.pondMeshes.push(water);
    addCircle(cx, cz, 6.3, SLAB + 0.7, { stand: true });
    addCircle(cx, cz, 1.2, 5);
    world.fountain = { x: cx, z: cz, y: SLAB + 4.3 };
    // kiosks
    addBuilding(cx - 20, cz - 20, cx - 12, cz - 13, 4.35, 'brick', { tint: col('#e9b872') });
    addBuilding(cx + 12, cz + 13, cx + 20, cz + 20, 4.35, 'brick', { tint: col('#8fc1b5') });
    // planters with trees
    for (const [ox, oz] of [[-12, 0], [12, 0], [0, -12], [0, 12], [-12, 12], [12, -12]]) {
      B.prop.box(cx + ox - 1.3, SLAB, cz + oz - 1.3, cx + ox + 1.3, SLAB + 0.6, cz + oz + 1.3, col(0x8e8578));
      addBox(cx + ox - 1.3, cz + oz - 1.3, cx + ox + 1.3, cz + oz + 1.3, SLAB + 0.6, { stand: true });
      trees.push({ x: cx + ox, z: cz + oz, s: 0.9, type: 'round', y: SLAB + 0.6, noCollide: true });
    }
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      benches.push({ x: cx + Math.cos(a) * 8.6, z: cz + Math.sin(a) * 8.6, ry: Math.PI / 2 - a + Math.PI });
    }
    world.places.push({ name: 'Fountain Plaza', x: cx + 8, z: cz - 8 });
  }

  // ---- outer ring, harbour promenade, pier ----
  const ringIn = LINES[5] + ROAD_HALF; // 167
  {
    // sidewalk + verge on the three land sides
    const S = SLAB;
    const strips = [
      [-BOUND, -BOUND, BOUND, -ringIn], // north
      [-BOUND, -ringIn, -ringIn, ringIn], // west
      [ringIn, -ringIn, BOUND, ringIn], // east
    ];
    for (const [x0, z0, x1, z1] of strips) B.grass.box(x0, 0, z0, x1, S, z1, WHITE, { topS: 1 / 8 });
    // sidewalk edge on the inner side of the verge
    B.concrete.box(-ringIn - 4, 0, -ringIn - 4, ringIn + 4, S + 0.005, -ringIn, SIDEWALK, { sides: false });
    B.concrete.box(-ringIn - 4, 0, -ringIn, -ringIn, S + 0.005, ringIn, SIDEWALK, { sides: false });
    B.concrete.box(ringIn, 0, -ringIn, ringIn + 4, S + 0.005, ringIn, SIDEWALK, { sides: false });
    B.concrete.box(-ringIn, 0, -ringIn, ringIn, S, -ringIn + 0.001, CURB, { top: false });
    // boundary wall
    const WALL = col(0xb4ada2);
    const walls = [
      [-BOUND - 1, -BOUND - 1, BOUND + 1, -BOUND],
      [-BOUND - 1, -BOUND, -BOUND, SEA_Z],
      [BOUND, -BOUND, BOUND + 1, SEA_Z],
    ];
    for (const [x0, z0, x1, z1] of walls) {
      B.prop.box(x0, 0, z0, x1, 2.4, z1, WALL, {});
      addBox(x0, z0, x1, z1, 3);
    }
    // promenade
    B.concrete.box(-BOUND, 0, ringIn, BOUND, S, 182, SIDEWALK, { topS: 1 / 4 });
    B.wood.box(-BOUND, 0, 182, BOUND, S, SEA_Z, WHITE, { topS: 1 / 4, sides: false });
    B.concrete.box(-BOUND, -3, SEA_Z - 0.2, BOUND, S - 0.01, SEA_Z + 0.2, col(0x8f8a82), { top: false });
    // pier
    B.wood.box(PIER.x0, -0.6, SEA_Z, PIER.x1, S, PIER.z1, WHITE, { topS: 1 / 4, uS: 1 / 4, vS: 1 / 4 });
    for (let z = SEA_Z + 4; z < PIER.z1; z += 6) {
      for (const x of [PIER.x0 + 0.4, PIER.x1 - 0.4]) {
        B.prop.geo(new THREE.CylinderGeometry(0.25, 0.25, 4, 8), mat(x, -2.4, z), col(0x4a3a2a));
      }
    }
    // railings
    const RAIL = col(0xe8e8e8);
    const rail = (x0, z0, x1, z1) => {
      const along = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = along ? x1 - x0 : z1 - z0;
      for (let t = 0; t <= len; t += 2.5) {
        const px = along ? x0 + t : x0, pz = along ? z0 : z0 + t;
        B.metal.box(px - 0.05, S, pz - 0.05, px + 0.05, S + 1.05, pz + 0.05, RAIL);
      }
      if (along) {
        B.metal.box(x0, S + 1, z0 - 0.06, x1, S + 1.1, z0 + 0.06, RAIL);
        B.metal.box(x0, S + 0.5, z0 - 0.03, x1, S + 0.55, z0 + 0.03, RAIL);
      } else {
        B.metal.box(x0 - 0.06, S + 1, z0, x0 + 0.06, S + 1.1, z1, RAIL);
        B.metal.box(x0 - 0.03, S + 0.5, z0, x0 + 0.03, S + 0.55, z1, RAIL);
      }
      addBox(Math.min(x0, x1) - 0.2, Math.min(z0, z1) - 0.2, Math.max(x0, x1) + 0.2, Math.max(z0, z1) + 0.2, 3);
    };
    rail(-BOUND, SEA_Z - 0.3, PIER.x0, SEA_Z - 0.3);
    rail(PIER.x1, SEA_Z - 0.3, BOUND, SEA_Z - 0.3);
    rail(PIER.x0 + 0.2, SEA_Z, PIER.x0 + 0.2, PIER.z1);
    rail(PIER.x1 - 0.2, SEA_Z, PIER.x1 - 0.2, PIER.z1);
    rail(PIER.x0, PIER.z1 - 0.2, PIER.x1, PIER.z1 - 0.2);

    // palms and benches along the promenade
    for (let x = -172; x <= 172; x += 16) {
      if (Math.abs(x) < 14) continue;
      trees.push({ x, z: 176, s: 0.9 + R() * 0.35, type: 'palm' });
      benches.push({ x: x + 8, z: 187.5, ry: 0 });
    }
    // harbour lamps
    for (let x = -168; x <= 168; x += 24) {
      world.lamps.push({ x, z: 183, dx: 0, dz: -1 });
      addCircle(x, 183, 0.18, 7).lamp = world.lamps.length - 1;
    }

    // shipping containers on the west quay
    containerStack(-150, 174, Math.PI / 2);
    containerStack(-128, 174, Math.PI / 2);

    // lighthouse at the end of the pier
    const lx = 0, lz = PIER.z1 - 8;
    B.prop.geo(new THREE.CylinderGeometry(3.2, 3.4, 1.2, 20), mat(lx, S + 0.6, lz), col(0x9b958c));
    for (let k = 0; k < 6; k++) {
      const r0 = 2.3 - k * 0.14, r1 = 2.3 - (k + 1) * 0.14;
      B.prop.geo(new THREE.CylinderGeometry(r1, r0, 2.6, 20), mat(lx, S + 1.2 + k * 2.6 + 1.3, lz), col(k % 2 ? 0xc0392b : 0xf4f1ea));
    }
    const topY = S + 1.2 + 6 * 2.6;
    B.prop.geo(new THREE.CylinderGeometry(2.0, 2.0, 0.3, 20), mat(lx, topY + 0.15, lz), col(0x333333));
    B.prop.geo(new THREE.ConeGeometry(1.6, 1.6, 20), mat(lx, topY + 3.2, lz), col(0xc0392b));
    world.lighthouse = { x: lx, y: topY + 1.3, z: lz };
    addCircle(lx, lz, 3.3, S + 1.2, { stand: true });
    addCircle(lx, lz, 2.4, 30);
    world.places.push({ name: 'Pier 9 Lighthouse', x: 0, z: PIER.z1 - 16 });
    world.places.push({ name: 'Harbor Promenade', x: -60, z: 178 });
    world.places.push({ name: 'Container Quay', x: -139, z: 172 });
  }

  // ---- trees (instanced) ----
  {
    const round = trees.filter((t) => t.type === 'round');
    const pine = trees.filter((t) => t.type === 'pine');
    const palm = trees.filter((t) => t.type === 'palm');
    // scattered countryside trees outside the wall
    const far = [];
    for (let k = 0; k < 220; k++) {
      const a = R() * Math.PI * 2, d = 200 + R() * 220;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (z > SEA_Z - 10) continue;
      far.push({ x, z, s: 1 + R() * 1.2, type: R() < 0.5 ? 'pine' : 'round' });
    }
    round.push(...far.filter((t) => t.type === 'round'));
    pine.push(...far.filter((t) => t.type === 'pine'));

    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 3, 6);
    trunkGeo.translate(0, 1.5, 0);
    const trunkMat = std({ color: 0x5b4330, roughness: 1 });
    const canopyGeo = new THREE.IcosahedronGeometry(2.1, 1);
    canopyGeo.translate(0, 4.2, 0);
    const pineGeo = new THREE.ConeGeometry(1.9, 5.5, 7);
    pineGeo.translate(0, 4.6, 0);
    const leafMat = std({ color: 0xffffff, roughness: 0.9, flatShading: true });

    const all = [...round, ...pine];
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all.length + palm.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, leafMat, round.length);
    const pines = new THREE.InstancedMesh(pineGeo, leafMat, pine.length);
    const greens = [0x4f8a3a, 0x5d9a3f, 0x3f7a35, 0x6aa548, 0x7a9a3a];
    const c = new THREE.Color();
    let ti = 0;
    round.forEach((t, i) => {
      const lift = t.street ? 2.3 : 0;
      trunks.setMatrixAt(ti++, mat(t.x, t.y ?? SLAB, t.z, 0, t.s, t.s * (t.street ? 2.0 : 1), t.s));
      canopies.setMatrixAt(i, mat(t.x, (t.y ?? SLAB) + lift, t.z, R() * 6, t.s * (0.9 + R() * 0.2), t.s * (0.85 + R() * 0.3), t.s));
      canopies.setColorAt(i, c.setHex(R.pick(greens)));
    });
    pine.forEach((t, i) => {
      trunks.setMatrixAt(ti++, mat(t.x, t.y ?? SLAB, t.z, 0, t.s, t.s, t.s));
      pines.setMatrixAt(i, mat(t.x, t.y ?? SLAB, t.z, R() * 6, t.s, t.s * (0.9 + R() * 0.3), t.s));
      pines.setColorAt(i, c.setHex(0x2f5f3a).offsetHSL(0, 0, (R() - 0.5) * 0.08));
    });
    // palms: tall bent trunk + fronds
    const palmTrunk = new THREE.CylinderGeometry(0.18, 0.28, 7, 7);
    palmTrunk.translate(0, 3.5, 0);
    const pt = new THREE.InstancedMesh(palmTrunk, std({ color: 0x8a6e4e, roughness: 1 }), palm.length);
    const fb = new GeoBuilder();
    const FROND = col(0xffffff);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const m = new THREE.Matrix4().makeRotationY(a).multiply(new THREE.Matrix4().makeRotationX(0.5)).multiply(new THREE.Matrix4().makeTranslation(0, 0, 1.6));
      fb.geo(new THREE.BoxGeometry(0.7, 0.06, 3.4), m, FROND);
    }
    const fronds = new THREE.InstancedMesh(fb.build(), std({ color: 0x4f8f3a, roughness: 0.9, side: THREE.DoubleSide }), palm.length);
    palm.forEach((t, i) => {
      const lean = (R() - 0.5) * 0.15;
      pt.setMatrixAt(i, mat(t.x, SLAB, t.z, 0, t.s, t.s, t.s, lean, lean));
      fronds.setMatrixAt(i, mat(t.x + Math.sin(lean) * 7 * t.s * 0, SLAB + 7 * t.s, t.z, R() * 6, t.s, t.s, t.s));
    });
    for (const m of [trunks, canopies, pines, pt, fronds]) {
      m.castShadow = true;
      m.receiveShadow = true;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      scene.add(m);
    }
    trunks.count = ti;
    for (const t of trees) {
      if (!t.noCollide) addCircle(t.x, t.z, t.type === 'palm' ? 0.35 : 0.3 * t.s + 0.05, 8);
    }
    world.trees = trees;
  }

  // ---- benches (merged) ----
  for (const b of benches) {
    const m = new THREE.Matrix4().makeRotationY(b.ry).setPosition(b.x, SLAB, b.z);
    const part = (x0, y0, z0, x1, y1, z1, c) => {
      const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
      g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      B.prop.geo(g, m, c);
    };
    const WOOD = col(0x9a6a3e), IRON = col(0x2d3033);
    part(-0.9, 0.42, -0.25, 0.9, 0.48, 0.2, WOOD);
    part(-0.9, 0.5, 0.18, 0.9, 0.9, 0.24, WOOD);
    part(-0.85, 0, -0.25, -0.75, 0.45, 0.22, IRON);
    part(0.75, 0, -0.25, 0.85, 0.45, 0.22, IRON);
    const r = Math.abs(Math.sin(b.ry)) > 0.5;
    addBox(b.x - (r ? 0.3 : 0.95), b.z - (r ? 0.95 : 0.3), b.x + (r ? 0.3 : 0.95), b.z + (r ? 0.95 : 0.3), SLAB + 0.5, { stand: true });
  }

  // ---- street lamps (instanced) ----
  {
    const n = world.lamps.length;
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.11, 6.4, 6);
    poleGeo.translate(0, 3.2, 0);
    const armGeo = new THREE.BoxGeometry(0.08, 0.08, 1.6);
    armGeo.translate(0, 6.3, 0.75);
    const headGeo = new THREE.BoxGeometry(0.34, 0.14, 0.6);
    headGeo.translate(0, 6.22, 1.5);
    const lampMetal = std({ color: 0x3a3f45, roughness: 0.5, metalness: 0.6 });
    const pb = new GeoBuilder();
    pb.geo(poleGeo, new THREE.Matrix4(), col(0xffffff));
    pb.geo(armGeo, new THREE.Matrix4(), col(0xffffff));
    const poles = new THREE.InstancedMesh(pb.build(), lampMetal, n);
    world.lampHeadMat = std({ color: 0x777777, emissive: 0xffd9a0, emissiveIntensity: 0.2 });
    const heads = new THREE.InstancedMesh(headGeo, world.lampHeadMat, n);
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    world.poolMat = new THREE.MeshBasicMaterial({ map: T.glow, color: 0xffc77a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
    const pools = new THREE.InstancedMesh(poolGeo, world.poolMat, n);
    world.lamps.forEach((l, i) => {
      const ry = Math.atan2(l.dx, l.dz);
      poles.setMatrixAt(i, mat(l.x, SLAB, l.z, ry));
      heads.setMatrixAt(i, mat(l.x, SLAB, l.z, ry));
      l.hx = l.x + l.dx * 1.5;
      l.hz = l.z + l.dz * 1.5;
      pools.setMatrixAt(i, mat(l.hx, 0.06, l.hz, 0, 11, 1, 11));
    });
    poles.castShadow = true;
    scene.add(poles, heads, pools);
    pools.renderOrder = 2;

    // Knocked-over lamps: hide the instance, drop a loose copy that topples.
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const poleGeoAll = poles.geometry;
    world.fallen = [];
    world.breakLamp = (c, vx, vz) => {
      const l = world.lamps[c.lamp];
      if (!l || l.broken) return;
      l.broken = true;
      c.dead = true;
      for (const m of [poles, heads, pools]) {
        m.setMatrixAt(c.lamp, zero);
        m.instanceMatrix.needsUpdate = true;
      }
      const g = new THREE.Group();
      g.position.set(l.x, SLAB, l.z);
      const inner = new THREE.Group();
      inner.rotation.y = Math.atan2(l.dx, l.dz);
      const pm = new THREE.Mesh(poleGeoAll, lampMetal);
      pm.castShadow = true;
      inner.add(pm, new THREE.Mesh(headGeo, world.lampHeadMat));
      g.add(inner);
      // topple in the direction of travel
      const yaw = Math.atan2(vx, vz);
      const pivot = new THREE.Group();
      pivot.rotation.y = yaw;
      pivot.position.copy(g.position);
      g.position.set(0, 0, 0);
      inner.rotation.y -= yaw;
      pivot.add(g);
      scene.add(pivot);
      world.fallen.push({ g, t: 0 });
    };
  }

  // ---- ground, sea, mountains ----
  {
    const g = new THREE.PlaneGeometry(2400, 1200 + SEA_Z);
    g.rotateX(-Math.PI / 2);
    g.translate(0, -0.02, (SEA_Z - 1200) / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 300, uv.getY(i) * 170);
    const ground = new THREE.Mesh(g, std({ map: T.grass, color: 0x9ab07a, roughness: 1 }));
    ground.receiveShadow = true;
    scene.add(ground);

    T.waterNormal.repeat.set(160, 120);
    world.waterMat = std({ color: 0x1b5b78, roughness: 0.12, metalness: 0.1, normalMap: T.waterNormal, normalScale: new THREE.Vector2(0.6, 0.6) });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1400), world.waterMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -1.1, SEA_Z + 700);
    sea.receiveShadow = true;
    scene.add(sea);
    for (const p of world.pondMeshes) {
      p.material = world.waterMat;
      scene.add(p);
    }

    // distant hills
    const hills = new GeoBuilder();
    for (let k = 0; k < 34; k++) {
      const a = (k / 34) * Math.PI * 2 + R() * 0.1;
      const d = 520 + R() * 160;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const isle = z > 300;
      if (isle && R() < 0.5) continue;
      const h = isle ? 30 + R() * 40 : 60 + R() * 110;
      const r = isle ? 60 + R() * 60 : 90 + R() * 90;
      hills.geo(new THREE.ConeGeometry(r, h, 7, 2), mat(x, h / 2 - 3, z, R() * 3), col(isle ? 0x6f8a6a : 0x5f7a6a));
    }
    const hm = new THREE.Mesh(hills.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
    scene.add(hm);
  }

  // boats bobbing in the harbour
  world.boats = [];
  {
    const hullCols = [0xf4f1ea, 0x2c5f8a, 0xb8452f, 0xf0c94a];
    const spots = [[-40, 215, 0.3], [30, 228, -0.4], [70, 210, 1.2], [-90, 235, 2.1], [120, 250, 0.8]];
    spots.forEach(([x, z, ry], k) => {
      const b = new GeoBuilder();
      const hc = col(hullCols[k % hullCols.length]);
      b.taper(-1.3, 1.3, -3.5, 3.5, -0.6, 0.7, [-0.15, -0.15, -0.2, 0.9], hc);
      b.hexa([[-0.4, -0.6, 3.5], [0.4, -0.6, 3.5], [0, -0.6, 5], [0, -0.6, 5], [-1.45, 0.7, 3.5], [1.45, 0.7, 3.5], [0, 0.7, 5.6], [0, 0.7, 5.6]], hc);
      b.box(-0.9, 0.7, -2.2, 0.9, 1.9, 0.4, col(0xf4f1ea));
      b.box(-0.95, 1.3, -2.25, 0.95, 1.7, 0.45, col(0x22313f), { top: false });
      const m = new THREE.Mesh(b.build(), M.prop);
      m.position.set(x, -1.1, z);
      m.rotation.y = ry;
      m.castShadow = true;
      scene.add(m);
      world.boats.push({ m, phase: k * 1.7 });
    });
  }

  // ---- emit merged meshes ----
  const emit = (b, m, opts = {}) => {
    if (!b.pos.length) return;
    const mesh = new THREE.Mesh(b.build(), m);
    mesh.receiveShadow = true;
    mesh.castShadow = opts.cast ?? false;
    scene.add(mesh);
    return mesh;
  };
  emit(B.road, M.road);
  emit(B.asphalt, M.asphalt);
  const paint = emit(B.paint, M.paint);
  if (paint) paint.renderOrder = 1;
  M.paint.polygonOffset = true;
  M.paint.polygonOffsetFactor = -1;
  emit(B.concrete, M.concrete);
  emit(B.grass, M.grass);
  emit(B.plaza, M.plaza);
  emit(B.wood, M.wood, { cast: true });
  emit(B.roof, M.roof, { cast: true });
  emit(B.prop, M.prop, { cast: true });
  emit(B.metal, M.metal, { cast: true });
  for (const k of ['office', 'brick', 'warehouse']) emit(B[k], facadeMat[k], { cast: true });

  // ---- named places along the streets (mission destinations) ----
  for (const blk of world.blocks) {
    if (blk.type !== 'city' && blk.type !== 'warehouse') continue;
    for (let side = 0; side < 4; side++) {
      const [nx, nz] = DIRS[side];
      const x = blk.cx + nx * 23, z = blk.cz + nz * 23;
      const road = nx !== 0 ? AVENUES[blk.bi + (nx > 0 ? 1 : 0)] : STREETS[blk.bj + (nz > 0 ? 1 : 0)];
      const num = 100 + Math.round(((nx !== 0 ? z : x) + 200) * 2.5);
      world.places.push({ name: `${num} ${road}`, x, z });
    }
  }

  // ---- curb parking spots ----
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      for (let d = 0; d < 2; d++) {
        if (!validDir(i, j, d)) continue;
        const [dx, dz] = DIRS[d];
        const A = nodePos(i, j);
        for (const side of [1, -1]) {
          const t = 22 + R() * 20;
          const hd = side > 0 ? headingOf(dx, dz) : headingOf(-dx, -dz);
          const fx = Math.sin(hd), fz = Math.cos(hd);
          const rx = -fz, rz = fx;
          world.parkSpots.push({ x: A.x + dx * t + rx * CURB_PARK, z: A.z + dz * t + rz * CURB_PARK, h: hd });
        }
      }
    }
  }

  // ---- helpers ----
  world.groundHeight = (x, z) => {
    if (z > SEA_Z) {
      if (x >= PIER.x0 && x <= PIER.x1 && z <= PIER.z1) return SLAB;
      return -1.1;
    }
    const ax = Math.abs(x);
    if (z >= ringIn || ax >= ringIn || z <= -ringIn) return SLAB;
    const bi = clamp(Math.round((x + 128) / 64), 0, 4), bj = clamp(Math.round((z + 128) / 64), 0, 4);
    if (Math.abs(x - BLOCKS[bi]) <= BLOCK_HALF && Math.abs(z - BLOCKS[bj]) <= BLOCK_HALF) return SLAB;
    return 0;
  };

  world.locationName = (x, z) => {
    if (z > SEA_Z - 0.5 && Math.abs(x) < 8) return 'Pier 9';
    if (z > ringIn) return 'Harbor Promenade';
    if (Math.abs(x) > ringIn || z < -ringIn) return 'City Limits';
    const bi = clamp(Math.round((x + 128) / 64), 0, 4), bj = clamp(Math.round((z + 128) / 64), 0, 4);
    const inBlock = Math.abs(x - BLOCKS[bi]) <= BLOCK_HALF && Math.abs(z - BLOCKS[bj]) <= BLOCK_HALF;
    const t = BLOCK_TYPE(bi, bj);
    if (inBlock && t === 'park') return 'Greenway Park';
    if (inBlock && t === 'plaza') return 'Fountain Plaza';
    // nearest road
    let best = '', bd = 1e9;
    LINES.forEach((L, k) => {
      if (Math.abs(x - L) < bd) { bd = Math.abs(x - L); best = AVENUES[k]; }
      if (Math.abs(z - L) < bd) { bd = Math.abs(z - L); best = STREETS[k]; }
    });
    const district = bj === 4 ? 'Dockside' : bi >= 3 && bj <= 1 ? 'Downtown' : bi <= 1 && bj <= 1 ? 'Old Town' : 'Midtown';
    return `${best}, ${district}`;
  };

  // Point inside a building (used for the camera).
  world.solidAt = (x, y, z) => {
    for (const c of grid.query(x, z, 0.3)) {
      if (c.h < y) continue;
      if (c.circle) continue;
      if (x > c.x0 - 0.3 && x < c.x1 + 0.3 && z > c.z0 - 0.3 && z < c.z1 + 0.3) return true;
    }
    return false;
  };

  // ---- animated bits ----
  world.fountainParticles = null;
  if (world.fountain) {
    const N = 260;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xcfeeff, size: 0.16, transparent: true, opacity: 0.8, depthWrite: false }));
    pts.frustumCulled = false;
    scene.add(pts);
    const seeds = [];
    for (let i = 0; i < N; i++) seeds.push({ a: R() * Math.PI * 2, s: 1.6 + R() * 0.9, t: R() * 1.4 });
    world.fountainParticles = { pts, seeds };
  }
  if (world.lighthouse) {
    const L = world.lighthouse;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 2.2, 16), new THREE.MeshStandardMaterial({ color: 0x223344, emissive: 0xfff2c0, emissiveIntensity: 0.3, roughness: 0.2 }));
    glass.position.set(L.x, L.y, L.z);
    scene.add(glass);
    const beamGeo = new THREE.ConeGeometry(6, 90, 24, 1, true);
    beamGeo.translate(0, -45, 0);
    beamGeo.rotateZ(Math.PI / 2);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const beam = new THREE.Group();
    const b1 = new THREE.Mesh(beamGeo, beamMat);
    const b2 = new THREE.Mesh(beamGeo, beamMat);
    b2.rotation.y = Math.PI;
    beam.add(b1, b2);
    beam.position.set(L.x, L.y, L.z);
    scene.add(beam);
    world.lighthouseFx = { glass, beam, beamMat };
  }

  world.update = (dt, time, night) => {
    T.waterNormal.offset.set(time * 0.012, time * 0.02);
    for (const m of Object.values(facadeMat)) m.emissiveIntensity = night * 1.1;
    world.lampHeadMat.emissiveIntensity = 0.15 + night * 3;
    world.poolMat.opacity = night * 0.55;
    for (const f of world.fallen) {
      if (f.t >= 1) continue;
      f.t = Math.min(1, f.t + dt * 1.4);
      // accelerate like a falling pole, with a small bounce at the end
      const e = f.t * f.t;
      f.g.rotation.x = e * (Math.PI / 2 - 0.03) - (f.t > 0.9 ? Math.sin((f.t - 0.9) * 31) * 0.04 : 0);
    }
    for (const b of world.boats) {
      b.m.position.y = -1.0 + Math.sin(time * 1.1 + b.phase) * 0.12;
      b.m.rotation.z = Math.sin(time * 0.9 + b.phase) * 0.04;
      b.m.rotation.x = Math.sin(time * 0.7 + b.phase * 2) * 0.03;
    }
    if (world.fountainParticles) {
      const { pts, seeds } = world.fountainParticles;
      const p = pts.geometry.attributes.position;
      const F = world.fountain;
      for (let i = 0; i < seeds.length; i++) {
        const s = seeds[i];
        s.t += dt;
        if (s.t > 1.4) s.t -= 1.4;
        const t = s.t;
        const r = s.s * t;
        p.setXYZ(i, F.x + Math.cos(s.a) * r, F.y + 3.2 * t - 4.9 * t * t, F.z + Math.sin(s.a) * r);
      }
      p.needsUpdate = true;
    }
    if (world.lighthouseFx) {
      const fx = world.lighthouseFx;
      fx.beam.rotation.y = time * 0.9;
      fx.beamMat.opacity = night * 0.16;
      fx.glass.material.emissiveIntensity = 0.3 + night * 4;
    }
  };

  return world;
}

/** Splits a 42x42 lot area (local coords) into building rectangles. */
function splitLots(R) {
  const H = LOT_HALF;
  const p = R();
  const m = (R() - 0.5) * 10;
  const m2 = (R() - 0.5) * 10;
  if (p < 0.12) return [[-H, -H, H, H]];
  if (p < 0.35) return [[-H, -H, m, H], [m, -H, H, H]];
  if (p < 0.55) return [[-H, -H, H, m], [-H, m, H, H]];
  if (p < 0.8) return [[-H, -H, m, m2], [m, -H, H, m2], [-H, m2, m, H], [m, m2, H, H]];
  return [[-H, -H, m, H], [m, -H, H, m2], [m, m2, H, H]];
}
