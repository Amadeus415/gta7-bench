// Builds the static city: ground, road markings and every building.
// Everything of one material is merged into one mesh to keep draw calls low.
import * as THREE from '../vendor/three.module.js';
import { GeoBuilder, makeRng, roundedRect } from './util.js';
import {
  asphaltTexture, sidewalkTexture, plazaTexture, grassTexture, sandTexture, plankTexture,
  concreteTexture, facadeTextures, shopTextures, signAtlas, billboardAtlas,
} from './textures.js';
import {
  LINES, PITCH, ROAD_HALF, CURB, CORNER_R, PARK, PLAZA, DOCKS, PIER, PROM, LAND,
  nodes, edges, colliders, mapShapes,
} from './world.js';

/** Materials whose glow follows the night: { mat, k } with k the full-night intensity. */
export const nightGlow = [];
export const landmarks = { station: { x: 0, z: 0 }, alleys: [], roofs: [] };

// District per block, rows north to south, columns west to east.
// I industrial, M mid-rise, T towers, Z plaza, P park, R residential, B beachfront
const DISTRICTS = ['IMTTM', 'ITZTM', 'MTPPM', 'MMTMR', 'BBBBB'];

const TINTS = {
  glass: [0x9fc4e8, 0x8fd1c9, 0xd9b48a, 0xc8ccd4, 0x7fa8a0, 0xaab4e0, 0x59677a, 0xe0c8b0],
  brick: [0xb5543c, 0x9c4a36, 0xc98a5a, 0xd8c4a0, 0x8a6a58, 0xa8a29a, 0xbf6f4a],
  concrete: [0xd8d4c8, 0xbfc4c8, 0xe2d8c0, 0xa8b0b8, 0xcfc6b8],
  stucco: [0xffc2b4, 0xb8ead2, 0xfff0c8, 0xbfe0ff, 0xffd2a0, 0xe8d0ff, 0xffffff, 0xffe08a],
  metal: [0x8fa4b4, 0xb07050, 0x6f8f7a, 0xc0c0c0, 0x4f6a8a, 0xb8a070],
};
const AWNINGS = [0xc0392b, 0x2e7d6b, 0xe0a030, 0x34568a, 0x8a3a6a, 0xeeeeee, 0x2b2b2b, 0xd96a2b];

export function buildCity(scene) {
  const rand = makeRng(20261);
  const col = new THREE.Color();

  // ------------------------------------------------------------ materials
  const lambert = (map, extra = {}) => new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra });
  const ground = {
    asphalt: { b: new GeoBuilder(), mat: lambert(asphaltTexture()) },
    sidewalk: { b: new GeoBuilder(), mat: lambert(sidewalkTexture()) },
    plaza: { b: new GeoBuilder(), mat: lambert(plazaTexture()) },
    grass: { b: new GeoBuilder(), mat: lambert(grassTexture()) },
    sand: { b: new GeoBuilder(), mat: lambert(sandTexture()) },
    plank: { b: new GeoBuilder(), mat: lambert(plankTexture()) },
    concrete: { b: new GeoBuilder(), mat: lambert(concreteTexture()) },
  };
  const marks = new GeoBuilder();

  const facades = {};
  for (const style of ['glass', 'brick', 'concrete', 'stucco', 'metal']) {
    const tex = facadeTextures(style);
    const mat = style === 'glass'
      ? new THREE.MeshStandardMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.2, metalness: 0.6, vertexColors: true })
      : new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true });
    nightGlow.push({ mat, k: style === 'glass' ? 1.5 : 1.25 });
    facades[style] = { b: new GeoBuilder(), mat };
  }
  {
    const tex = shopTextures();
    tex.map.wrapT = tex.emissive.wrapT = THREE.ClampToEdgeWrapping;
    const mat = new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0.1, vertexColors: true });
    nightGlow.push({ mat, k: 1.5, base: 0.08 });
    facades.shop = { b: new GeoBuilder(), mat };
  }
  const roof = new GeoBuilder(); // untextured trim, roofs and rooftop machinery
  const signs = new GeoBuilder();
  const bills = new GeoBuilder();
  const signTex = signAtlas();
  const signMat = new THREE.MeshLambertMaterial({ map: signTex, emissiveMap: signTex, emissive: 0xffffff, emissiveIntensity: 0.25 });
  nightGlow.push({ mat: signMat, k: 1.9, base: 0.3 });
  const billTex = billboardAtlas();
  const billMat = new THREE.MeshLambertMaterial({ map: billTex, emissiveMap: billTex, emissive: 0xffffff, emissiveIntensity: 0.05 });
  nightGlow.push({ mat: billMat, k: 0.85, base: 0.03 });

  // --------------------------------------------------------------- ground
  ground.asphalt.b.floor(-186, -186, 186, 186, 0, 0xffffff, 8);
  ground.concrete.b.floor(DOCKS.x0, DOCKS.z0, -186, DOCKS.z1, 0, 0xffffff, 6);
  // Seawalls: the land is a slab standing in the water.
  roof.box(LAND.x1 - LAND.x0, 5, LAND.z1 - LAND.z0, 0, -2.52, (LAND.z0 + LAND.z1) / 2, 0x6f6c66);
  roof.box(-192 - DOCKS.x0, 5, DOCKS.z1 - DOCKS.z0, (DOCKS.x0 - 192) / 2, -2.52, (DOCKS.z0 + DOCKS.z1) / 2, 0x6f6c66);

  const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  const curbCol = 0xc4c0b8;
  // Outer sidewalk strips and the promenade.
  ground.sidewalk.b.prism(rect(-192, -192, 192, -186), 0, CURB, 0xffffff, 8, curbCol);
  ground.sidewalk.b.prism(rect(186, -186, 192, 186), 0, CURB, 0xffffff, 8, curbCol);
  ground.sidewalk.b.prism(rect(-192, -186, -186, DOCKS.z0), 0, CURB, 0xffffff, 8, curbCol);
  ground.sidewalk.b.prism(rect(-192, DOCKS.z1, -186, 186), 0, CURB, 0xffffff, 8, curbCol);
  ground.plank.b.prism(rect(-192, PROM.z0, 192, PROM.z1), 0, CURB, 0xffffff, 2.2, 0x8a6a4a);
  // Beach, sloping into the sea.
  ground.sand.b.quad([-192, CURB, PROM.z1], [-192, CURB - 2.2, PROM.z1 + 49], [192, CURB - 2.2, PROM.z1 + 49], [192, CURB, PROM.z1], 0xffffff,
    [-16, 0, -16, 4, 16, 4, 16, 0]);

  mapShapes.push({ kind: 'rect', x0: LAND.x0, z0: LAND.z0, x1: LAND.x1, z1: PROM.z0, color: '#3d424b' });
  mapShapes.push({ kind: 'rect', x0: DOCKS.x0, z0: DOCKS.z0, x1: -186, z1: DOCKS.z1, color: '#565a60' });
  mapShapes.push({ kind: 'rect', x0: -192, z0: PROM.z0, x1: 192, z1: PROM.z1, color: '#8a7358' });
  mapShapes.push({ kind: 'rect', x0: -192, z0: PROM.z1, x1: 192, z1: PROM.z1 + 22, color: '#cdb98a' });
  mapShapes.push({ kind: 'rect', x0: PIER.x0, z0: PIER.z0, x1: PIER.x1, z1: PIER.z1, color: '#8a7358' });

  // City blocks.
  for (let bz = 0; bz < 5; bz++) {
    for (let bx = 0; bx < 5; bx++) {
      const kind = DISTRICTS[bz][bx];
      const x0 = LINES[bx] + ROAD_HALF, x1 = LINES[bx + 1] - ROAD_HALF;
      const z0 = LINES[bz] + ROAD_HALF, z1 = LINES[bz + 1] - ROAD_HALF;
      if (kind === 'P') continue;
      const g = kind === 'Z' ? ground.plaza : ground.sidewalk;
      g.b.prism(roundedRect(x0, z0, x1, z1, CORNER_R), 0, CURB, 0xffffff, 8, curbCol);
      mapShapes.push({ kind: 'rect', x0, z0, x1, z1, color: kind === 'Z' ? '#a8977e' : '#6b6f76' });
    }
  }
  // The park: a sidewalk rim around one lawn spanning two blocks.
  ground.sidewalk.b.prism(roundedRect(PARK.x0, PARK.z0, PARK.x1, PARK.z1, CORNER_R), 0, CURB, 0xffffff, 8, curbCol);
  ground.grass.b.prism(roundedRect(PARK.x0 + 3.5, PARK.z0 + 3.5, PARK.x1 - 3.5, PARK.z1 - 3.5, 2), CURB, CURB + 0.03, 0xffffff, 10, 0x4f7a38);
  mapShapes.push({ kind: 'rect', x0: PARK.x0, z0: PARK.z0, x1: PARK.x1, z1: PARK.z1, color: '#6b6f76' });
  mapShapes.push({ kind: 'rect', x0: PARK.x0 + 3.5, z0: PARK.z0 + 3.5, x1: PARK.x1 - 3.5, z1: PARK.z1 - 3.5, color: '#4f8a45' });

  // -------------------------------------------------------- road markings
  const WHITE = 0xd6d6cf, YELLOW = 0xd8b23c;
  const MY = 0.022;
  for (const [a, b] of edges) {
    const A = nodes[a], B = nodes[b];
    const horizontal = A.z === B.z;
    const mark = (sa, sb, ta, tb, c) => {
      const s0 = Math.min(sa, sb), s1 = Math.max(sa, sb), t0 = Math.min(ta, tb), t1 = Math.max(ta, tb);
      if (horizontal) marks.floor(A.x + s0, A.z + t0, A.x + s1, A.z + t1, MY, c);
      else marks.floor(A.x - t1, A.z + s0, A.x - t0, A.z + s1, MY, c);
    };
    for (let s = 13.5; s < PITCH - 15; s += 6) mark(s, s + 3, -0.09, 0.09, YELLOW);
    for (const side of [-1, 1]) {
      for (let s = 12; s < PITCH - 12.5; s += 6) mark(s, s + 0.12, side * 3.55, side * 5.9, WHITE);
      mark(12, PITCH - 12, side * 3.55 - 0.06, side * 3.55 + 0.06, WHITE);
    }
    for (const [node, near] of [[A, true], [B, false]]) {
      if (node.nb.length < 3) continue;
      const base = near ? 0 : PITCH;
      const dir = near ? 1 : -1;
      const c0 = base + dir * 7.0, c1 = base + dir * 9.4;
      for (let t = -5.5; t < 5.4; t += 1.1) mark(Math.min(c0, c1), Math.max(c0, c1), t, t + 0.55, WHITE);
      const s0 = base + dir * 10.2, s1 = base + dir * 10.6;
      if (near) mark(s0, s1, -3.5, -0.15, WHITE);
      else mark(s1, s0, 0.15, 3.5, WHITE);
    }
  }
  // Bays in front of the pier and a painted box at the docks.
  for (let x = DOCKS.x0 + 14; x < -200; x += 12) marks.floor(x, 60, x + 0.15, 100, MY, YELLOW);

  // ------------------------------------------------------------ buildings
  const SIDES = ['S', 'E', 'N', 'W'];
  const sideLen = (side, p) => (side === 'S' || side === 'N' ? p.x1 - p.x0 : p.z1 - p.z0);
  /** Point on a wall, `t` metres from its left end as seen from outside, `out` metres off it. */
  const sidePoint = (side, p, t, out = 0) => {
    if (side === 'S') return [p.x0 + t, p.z1 + out];
    if (side === 'E') return [p.x1 + out, p.z1 - t];
    if (side === 'N') return [p.x1 - t, p.z0 - out];
    return [p.x0 - out, p.z0 + t];
  };
  const faceQuad = (builder, side, p, t0, t1, y0, y1, out, c, uvs) => {
    const a = sidePoint(side, p, t0, out), b = sidePoint(side, p, t1, out);
    builder.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], c, uvs);
  };
  const inset = (p, d) => ({ x0: p.x0 + d, z0: p.z0 + d, x1: p.x1 - d, z1: p.z1 - d });

  function walls(style, p, y0, y1, tint, R) {
    const f = facades[style];
    const nV = Math.max(1, Math.round((y1 - y0) / 3.2));
    const v0 = R.int(0, 7) / 8;
    for (const side of SIDES) {
      const len = sideLen(side, p);
      const nU = Math.max(1, Math.round(len / 3));
      const u0 = R.int(0, 7) / 8;
      faceQuad(f.b, side, p, 0, len, y0, y1, 0, tint, [u0, v0, u0 + nU / 8, v0, u0 + nU / 8, v0 + nV / 8, u0, v0 + nV / 8]);
    }
  }

  let lot = null; // the buildable part of the block being filled
  const facesStreet = (side, p) =>
    (side === 'S' && p.z1 > lot.z1 - 1.5) || (side === 'N' && p.z0 < lot.z0 + 1.5) ||
    (side === 'E' && p.x1 > lot.x1 - 1.5) || (side === 'W' && p.x0 < lot.x0 + 1.5);

  function signQuad(side, p, tMid, y, w, h, index, out = 0.14) {
    const u0 = (index % 2) * 0.5, v1 = 1 - Math.floor(index / 2) / 8, v0 = v1 - 1 / 8;
    faceQuad(signs, side, p, tMid - w / 2, tMid + w / 2, y, y + h, out, 0xffffff, [u0, v0, u0 + 0.5, v0, u0 + 0.5, v1, u0, v1]);
  }

  const SHOP_H = 4.2;
  function shopBand(p, R, opts = {}) {
    const f = facades.shop;
    const tint = col.set(R.pick([0xffffff, 0xe8e0d0, 0xd8dce4, 0xf0e0d0])).clone();
    for (const side of SIDES) {
      const len = sideLen(side, p);
      const bays = Math.max(1, Math.round(len / 6));
      const u0 = R.int(0, 3) / 4;
      faceQuad(f.b, side, p, 0, len, 0, SHOP_H, 0, tint, [u0, 0, u0 + bays / 4, 0, u0 + bays / 4, 1, u0, 1]);
      if (!facesStreet(side, p) || opts.plain) continue;
      const bayW = len / bays;
      for (let i = 0; i < bays; i++) {
        const tMid = (i + 0.5) * bayW;
        const roll = R();
        if (roll < 0.42) {
          const c = R.pick(AWNINGS);
          const [ax, az] = sidePoint(side, p, tMid, 0.75);
          const alongX = side === 'S' || side === 'N';
          roof.box(alongX ? bayW * 0.8 : 1.5, 0.12, alongX ? 1.5 : bayW * 0.8, ax, 3.3, az, c);
          const [vx, vz] = sidePoint(side, p, tMid, 1.47);
          roof.box(alongX ? bayW * 0.8 : 0.06, 0.4, alongX ? 0.06 : bayW * 0.8, vx, 3.12, vz, c);
        } else if (roll < 0.8 && bayW > 4.5) {
          signQuad(side, p, tMid, 3.35, Math.min(4.6, bayW * 0.82), 1.15, R.int(0, 14));
        }
      }
    }
  }

  function solid(p, h) {
    colliders.addBox(p.x0, p.z0, p.x1, p.z1, h);
    mapShapes.push({ kind: 'rect', x0: p.x0, z0: p.z0, x1: p.x1, z1: p.z1, color: '#9aa0aa' });
  }

  function roofTop(p, y, R, o = {}) {
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    const base = o.light ? 0x9a9890 : R.pick([0x4a4c50, 0x5a5650, 0x3e4248, 0x6a665e]);
    roof.floor(p.x0, p.z0, p.x1, p.z1, y, base);
    const trim = o.trim ?? 0x8c8a84;
    const ph = o.parapet ?? 0.8;
    roof.box(w, ph, 0.3, (p.x0 + p.x1) / 2, y + ph / 2, p.z0 + 0.15, trim);
    roof.box(w, ph, 0.3, (p.x0 + p.x1) / 2, y + ph / 2, p.z1 - 0.15, trim);
    roof.box(0.3, ph, d - 0.6, p.x0 + 0.15, y + ph / 2, (p.z0 + p.z1) / 2, trim);
    roof.box(0.3, ph, d - 0.6, p.x1 - 0.15, y + ph / 2, (p.z0 + p.z1) / 2, trim);
    if (o.bare) return;
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const spot = () => [R.range(p.x0 + 2.2, p.x1 - 2.2), R.range(p.z0 + 2.2, p.z1 - 2.2)];
    if (w > 8 && d > 8) {
      for (let i = R.int(1, 3); i > 0; i--) {
        const [x, z] = spot();
        roof.box(2.2, 1.3, 1.5, x, y + 0.75, z, 0xa9adb0, R.chance(0.5) ? 0 : Math.PI / 2);
        roof.cyl(0.5, 0.5, 0.1, x, y + 1.42, z, 0x4a4d50, 10);
      }
      if (R.chance(0.6)) { const [x, z] = spot(); roof.box(3, 2.6, 3.4, x, y + 1.3, z, 0x8f8b84); }
    }
    if (o.tank) {
      const [x, z] = spot();
      for (const [dx, dz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) roof.box(0.14, 2, 0.14, x + dx, y + 1, z + dz, 0x3a3a3a);
      roof.cyl(1.4, 1.4, 2.4, x, y + 3.2, z, 0x8a5a3a, 10);
      roof.cyl(0.05, 1.55, 0.9, x, y + 4.85, z, 0x5a3c28, 10);
    }
    if (o.antenna) {
      const h = R.range(8, 16);
      roof.cyl(0.08, 0.2, h, cx, y + h / 2, cz, 0xd0d0d0, 5);
      roof.box(1.6, 0.08, 0.08, cx, y + h * 0.6, cz, 0xd0d0d0);
      landmarks.roofs.push({ x: cx, y: y + h + 0.3, z: cz });
    }
  }

  function billboard(p, y, R) {
    const side = SIDES.filter((s) => facesStreet(s, p));
    if (!side.length) return;
    const s = R.pick(side);
    const len = sideLen(s, p);
    if (len < 13) return;
    const index = R.int(0, 7);
    const u0 = (index % 2) * 0.5, v1 = 1 - Math.floor(index / 2) / 4, v0 = v1 - 0.25;
    const t = len / 2;
    faceQuad(bills, s, p, t - 5.5, t + 5.5, y + 2, y + 7.5, -0.4, 0xffffff, [u0, v0, u0 + 0.5, v0, u0 + 0.5, v1, u0, v1]);
    for (const dt of [-4, 0, 4]) {
      const [x, z] = sidePoint(s, p, t + dt, -0.75);
      roof.box(0.25, 7.5, 0.25, x, y + 3.75, z, 0x3a3d42);
    }
    const [bx, bz] = sidePoint(s, p, t, -0.56);
    const alongX = s === 'S' || s === 'N';
    roof.box(alongX ? 11.2 : 0.25, 5.7, alongX ? 0.25 : 11.2, bx, y + 4.75, bz, 0x2c2f33);
  }

  function midrise(p, H, style, R, o = {}) {
    const tint = col.set(R.pick(TINTS[style])).clone();
    shopBand(p, R);
    walls(style, p, SHOP_H, H, tint, R);
    const edge = inset(p, -0.25);
    const trim = col.copy(tint).multiplyScalar(0.8).clone();
    roof.box(edge.x1 - edge.x0, 0.5, edge.z1 - edge.z0, (p.x0 + p.x1) / 2, H - 0.05, (p.z0 + p.z1) / 2, trim);
    roof.box(edge.x1 - edge.x0, 0.22, edge.z1 - edge.z0, (p.x0 + p.x1) / 2, SHOP_H + 0.1, (p.z0 + p.z1) / 2, trim);
    roofTop(p, H + 0.21, R, { tank: style === 'brick' && R.chance(0.7), trim, antenna: R.chance(0.12) });
    if (H < 30 && R.chance(o.bill ?? 0.3)) billboard(p, H + 0.2, R);
    solid(p, H);
  }

  function tower(p, H, R) {
    const tint = col.set(R.pick(TINTS.glass)).clone();
    const podStyle = R.chance(0.5) ? 'concrete' : 'glass';
    const podTint = podStyle === 'glass' ? tint : col.set(R.pick(TINTS.concrete)).clone();
    const podH = SHOP_H + 3.2 * R.int(1, 3);
    shopBand(p, R);
    walls(podStyle, p, SHOP_H, podH, podTint, R);
    roofTop(p, podH, R, { light: true, bare: true, parapet: 1.0 });
    solid(p, podH);
    const size = Math.min(p.x1 - p.x0, p.z1 - p.z0);
    const shaft = inset(p, Math.min(R.range(2.5, 6), size * 0.16));
    const pier = col.copy(tint).multiplyScalar(0.45).clone();
    const fins = R.chance(0.55);
    const body = (q, y0, y1) => {
      walls('glass', q, y0, y1, tint, R);
      if (fins) for (const [x, z] of [[q.x0, q.z0], [q.x1, q.z0], [q.x0, q.z1], [q.x1, q.z1]]) roof.box(0.9, y1 - y0, 0.9, x, (y0 + y1) / 2, z, pier);
    };
    if (R.chance(0.55)) {
      const h1 = H * R.range(0.72, 0.88);
      body(shaft, podH, h1);
      roofTop(shaft, h1, R, { bare: true, trim: pier });
      const top = inset(shaft, Math.min(R.range(2, 4), size * 0.1));
      body(top, h1, H);
      roofTop(top, H, R, { antenna: true, trim: pier });
    } else {
      body(shaft, podH, H);
      roofTop(shaft, H, R, { antenna: R.chance(0.6), trim: pier });
      if (R.chance(0.5)) roof.box(shaft.x1 - shaft.x0 - 3, 2.6, shaft.z1 - shaft.z0 - 3, (p.x0 + p.x1) / 2, H + 1.3, (p.z0 + p.z1) / 2, pier);
    }
  }

  function stepped(p, H, R) {
    const style = R.chance(0.5) ? 'concrete' : 'brick';
    const tint = col.set(R.pick(TINTS[style])).clone();
    const trim = col.copy(tint).multiplyScalar(0.75).clone();
    shopBand(p, R);
    const size = Math.min(p.x1 - p.x0, p.z1 - p.z0);
    const step = Math.min(3, size * 0.11);
    let q = p, y = SHOP_H;
    for (const [i, frac] of [0.5, 0.8, 1].entries()) {
      const top = H * frac;
      walls(style, q, y, top, tint, R);
      roof.box(q.x1 - q.x0 + 0.5, 0.45, q.z1 - q.z0 + 0.5, (q.x0 + q.x1) / 2, top - 0.05, (q.z0 + q.z1) / 2, trim);
      roofTop(q, top + 0.18, R, { bare: i < 2, trim });
      y = top;
      q = inset(q, step);
    }
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    roof.cyl(0.05, 1.4, 9, cx, H + 4.6, cz, trim, 4, 0, Math.PI / 4);
    landmarks.roofs.push({ x: cx, y: H + 9.3, z: cz });
    solid(p, H * 0.5);
  }

  function lshape(p, H, R) {
    const style = R.chance(0.65) ? 'brick' : 'concrete';
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    const flipX = R.chance(0.5), flipZ = R.chance(0.5);
    const barZ = flipZ ? { z0: p.z1 - d * 0.45, z1: p.z1 } : { z0: p.z0, z1: p.z0 + d * 0.45 };
    const bar = { x0: p.x0, x1: p.x1, ...barZ };
    const wingZ = flipZ ? { z0: p.z0, z1: bar.z0 } : { z0: bar.z1, z1: p.z1 };
    const wing = { ...(flipX ? { x0: p.x1 - w * 0.45, x1: p.x1 } : { x0: p.x0, x1: p.x0 + w * 0.45 }), ...wingZ };
    const yard = { ...(flipX ? { x0: p.x0, x1: wing.x0 } : { x0: wing.x1, x1: p.x1 }), ...wingZ };
    midrise(bar, H, style, R, { bill: 0 });
    midrise(wing, Math.max(8, H - 3.2 * R.int(0, 2)), style, R, { bill: 0 });
    landmarks.alleys.push({ x: (yard.x0 + yard.x1) / 2, z: (yard.z0 + yard.z1) / 2, w: yard.x1 - yard.x0, d: yard.z1 - yard.z0, yard: true });
  }

  function hotel(p, H, R) {
    const tint = col.set(R.pick(TINTS.stucco)).clone();
    shopBand(p, R);
    walls('stucco', p, SHOP_H, H, tint, R);
    const floors = Math.round((H - SHOP_H) / 3.2);
    const fh = (H - SHOP_H) / floors;
    for (const side of ['S', 'N']) {
      const len = sideLen(side, p);
      for (let f = 1; f < floors; f++) {
        const y = SHOP_H + f * fh;
        const [x, z] = sidePoint(side, p, len / 2, 0.5);
        roof.box(len - 1.2, 0.14, 1.0, x, y, z, 0xf2f0ea);
        const [rx, rz] = sidePoint(side, p, len / 2, 0.97);
        roof.box(len - 1.2, 0.85, 0.06, rx, y + 0.5, rz, 0x59606a);
      }
    }
    roof.box(p.x1 - p.x0 + 0.5, 0.5, p.z1 - p.z0 + 0.5, (p.x0 + p.x1) / 2, H, (p.z0 + p.z1) / 2, 0xf2f0ea);
    roofTop(p, H + 0.26, R, { trim: 0xf2f0ea });
    if (R.chance(0.55) && p.x1 - p.x0 > 16) {
      // A rooftop sign facing the sea and the street behind.
      const idx = R.pick([7, 12, 0, 6, 14]);
      const q = inset(p, 1.2);
      for (const side of ['S', 'N']) signQuad(side, q, sideLen(side, q) / 2, H + 1.4, 11, 2.75, idx, 0.05);
      roof.box(11, 2.75, 0.3, (p.x0 + p.x1) / 2, H + 2.78, q.z1 - 0.12, 0x202226);
      roof.box(11, 2.75, 0.3, (p.x0 + p.x1) / 2, H + 2.78, q.z0 + 0.12, 0x202226);
    }
    solid(p, H);
  }

  function warehouse(p, H, R) {
    const tint = col.set(R.pick(TINTS.metal)).clone();
    walls('metal', p, 0, H, tint, R);
    const w = p.x1 - p.x0, d = p.z1 - p.z0;
    const alongX = w > d;
    const rise = 2.6;
    const rc = col.copy(tint).multiplyScalar(0.6).clone();
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    const e = 0.5; // eaves overhang
    if (alongX) {
      roof.quad([p.x0 - e, H, p.z1 + e], [p.x1 + e, H, p.z1 + e], [p.x1 + e, H + rise, cz], [p.x0 - e, H + rise, cz], rc);
      roof.quad([p.x1 + e, H, p.z0 - e], [p.x0 - e, H, p.z0 - e], [p.x0 - e, H + rise, cz], [p.x1 + e, H + rise, cz], rc);
      facades.metal.b.quad([p.x1, H, p.z1], [p.x1, H, p.z0], [p.x1, H + rise, cz], [p.x1, H + rise, cz], tint, [0, 0, 1, 0, 0.5, 0.2, 0.5, 0.2]);
      facades.metal.b.quad([p.x0, H, p.z0], [p.x0, H, p.z1], [p.x0, H + rise, cz], [p.x0, H + rise, cz], tint, [0, 0, 1, 0, 0.5, 0.2, 0.5, 0.2]);
    } else {
      roof.quad([p.x1 + e, H, p.z1 + e], [p.x1 + e, H, p.z0 - e], [cx, H + rise, p.z0 - e], [cx, H + rise, p.z1 + e], rc);
      roof.quad([p.x0 - e, H, p.z0 - e], [p.x0 - e, H, p.z1 + e], [cx, H + rise, p.z1 + e], [cx, H + rise, p.z0 - e], rc);
      facades.metal.b.quad([p.x0, H, p.z1], [p.x1, H, p.z1], [cx, H + rise, p.z1], [cx, H + rise, p.z1], tint, [0, 0, 1, 0, 0.5, 0.2, 0.5, 0.2]);
      facades.metal.b.quad([p.x1, H, p.z0], [p.x0, H, p.z0], [cx, H + rise, p.z0], [cx, H + rise, p.z0], tint, [0, 0, 1, 0, 0.5, 0.2, 0.5, 0.2]);
    }
    // Roller doors on every street side.
    for (const side of SIDES) {
      if (!facesStreet(side, p) && !p.doors) continue;
      const len = sideLen(side, p);
      for (let t = 5; t < len - 4; t += 9) {
        if (R.chance(0.3)) continue;
        faceQuad(roof, side, p, t - 2.4, t + 2.4, 0, 4.6, 0.06, R.pick([0x3c4a58, 0x6a4a3a, 0x4a4a4a, 0x2f5a4a]));
        faceQuad(roof, side, p, t - 2.7, t + 2.7, 4.6, 4.95, 0.1, 0xe0c040);
      }
    }
    solid(p, H);
  }

  function lowShop(p, R) {
    const H = SHOP_H + 2.2;
    const tint = col.set(R.pick(TINTS.concrete)).clone();
    shopBand(p, R, { plain: true });
    walls('concrete', p, SHOP_H, H, tint, R);
    for (const side of SIDES) {
      if (!facesStreet(side, p)) continue;
      const len = sideLen(side, p);
      for (let t = 4.5; t < len - 3; t += 8) signQuad(side, p, t, SHOP_H + 0.35, 5.4, 1.35, R.int(0, 14));
    }
    roofTop(p, H, R, { trim: 0x77736c });
    if (R.chance(0.5)) billboard(p, H, R);
    solid(p, H);
  }

  function station(p, R) {
    const H = 13.8;
    const tint = col.set(0xdfe3ea).clone();
    walls('concrete', p, 0, H, tint, R);
    for (const side of SIDES) {
      faceQuad(roof, side, p, 0, sideLen(side, p), 3.9, 4.5, 0.05, 0x24468f);
      if (!facesStreet(side, p)) continue;
      const len = sideLen(side, p);
      signQuad(side, p, len / 2, 4.9, 8.4, 2.1, 15);
      faceQuad(roof, side, p, len / 2 - 1.6, len / 2 + 1.6, 0, 3.2, 0.08, 0x1c2430);
      const [x, z] = sidePoint(side, p, len / 2, 1.4);
      roof.box(side === 'S' || side === 'N' ? 5 : 2.8, 0.2, side === 'S' || side === 'N' ? 2.8 : 5, x, 3.5, z, 0x24468f);
    }
    roofTop(p, H, R, { antenna: true, trim: 0x24468f });
    solid(p, H);
  }

  function parcels(l, layout) {
    const mx = (l.x0 + l.x1) / 2, mz = (l.z0 + l.z1) / 2, g = 2;
    const W = { x0: l.x0, x1: mx - g }, E = { x0: mx + g, x1: l.x1 };
    const N = { z0: l.z0, z1: mz - g }, S = { z0: mz + g, z1: l.z1 };
    const full = { x0: l.x0, x1: l.x1 }, fullZ = { z0: l.z0, z1: l.z1 };
    switch (layout) {
      case 'single': return [{ ...full, ...fullZ }];
      case 'twoX': return [{ ...W, ...fullZ }, { ...E, ...fullZ }];
      case 'twoZ': return [{ ...full, ...N }, { ...full, ...S }];
      case 'threeW': return [{ ...W, ...fullZ }, { ...E, ...N }, { ...E, ...S }];
      case 'threeN': return [{ ...full, ...N }, { ...W, ...S }, { ...E, ...S }];
      default: return [{ ...W, ...N }, { ...E, ...N }, { ...W, ...S }, { ...E, ...S }];
    }
  }

  for (let bz = 0; bz < 5; bz++) {
    for (let bx = 0; bx < 5; bx++) {
      const kind = DISTRICTS[bz][bx];
      if (kind === 'P' || kind === 'Z') continue;
      const R = makeRng(900 + bx * 17 + bz * 131);
      lot = { x0: LINES[bx] + ROAD_HALF + 4, x1: LINES[bx + 1] - ROAD_HALF - 4, z0: LINES[bz] + ROAD_HALF + 4, z1: LINES[bz + 1] - ROAD_HALF - 4 };
      const layout = kind === 'T'
        ? R.pick(['single', 'twoX', 'twoZ', 'quad', 'threeW', 'threeN'])
        : kind === 'I' ? R.pick(['twoX', 'twoZ', 'threeW'])
          : kind === 'B' ? R.pick(['twoX', 'threeN', 'quad', 'threeW'])
            : R.pick(['quad', 'threeW', 'threeN', 'quad', 'twoX', 'twoZ']);
      const list = parcels(lot, layout);
      const mx = (lot.x0 + lot.x1) / 2, mz = (lot.z0 + lot.z1) / 2;
      if (layout !== 'single') landmarks.alleys.push({ x: mx, z: mz, w: 4, d: 4 });
      list.forEach((p, i) => {
        const big = (p.x1 - p.x0) * (p.z1 - p.z0) > 1500;
        const small = (p.x1 - p.x0) * (p.z1 - p.z0) < 700;
        if (kind === 'T') {
          const H = (small ? R.range(46, 82) : big ? R.range(70, 108) : R.range(40, 76));
          const roll = R();
          if (roll < 0.62) tower(p, H, R);
          else if (roll < 0.85) stepped(p, H * 0.85, R);
          else midrise(p, R.range(22, 36), R.pick(['concrete', 'brick']), R);
        } else if (kind === 'I') {
          if (R.chance(0.7)) warehouse(p, R.range(7, 11), R);
          else midrise(p, R.range(12, 20), 'brick', R);
        } else if (kind === 'B') {
          if (R.chance(0.72)) hotel(p, R.range(18, 40), R);
          else if (R.chance(0.5)) lowShop(p, R);
          else midrise(p, R.range(14, 24), 'stucco', R);
        } else if (kind === 'R') {
          if (i === 0) {
            station(p, R);
            // where people released by Harbor Patrol find themselves: on the street outside
            const side = SIDES.find((sd) => facesStreet(sd, p)) ?? 'S';
            const [fx, fz] = sidePoint(side, p, sideLen(side, p) / 2, 2.3);
            landmarks.station = { x: fx, z: fz, heading: { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 }[side] };
          }
          else if (R.chance(0.5)) lshape(p, R.range(12, 20), R);
          else midrise(p, R.range(10, 20), R.pick(['brick', 'stucco']), R);
        } else {
          const roll = R();
          if (roll < 0.4) midrise(p, R.range(14, 32), R.pick(['brick', 'brick', 'concrete', 'stucco']), R);
          else if (roll < 0.6 && !small) lshape(p, R.range(14, 28), R);
          else if (roll < 0.75) lowShop(p, R);
          else if (roll < 0.9) stepped(p, R.range(30, 48), R);
          else tower(p, R.range(36, 56), R);
        }
      });
    }
  }

  // ------------------------------------------------------------- finalise
  const add = (geo, mat, { cast = false, receive = true } = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    m.matrixAutoUpdate = false;
    scene.add(m);
    return m;
  };
  const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true });

  /** Turn the accumulated geometry into meshes; call once all scenery is added. */
  function finish() {
    for (const g of Object.values(ground)) if (g.b.count) add(g.b.build(), g.mat);
    const markMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    add(marks.build(), markMat);
    for (const f of Object.values(facades)) if (f.b.count) add(f.b.build(), f.mat, { cast: true });
    add(roof.build(), trimMat, { cast: true });
    add(signs.build(), signMat);
    add(bills.build(), billMat);
  }

  return {
    ground, trim: roof, marks, signs, bills, trimMat, add, finish, faceQuad, signQuad,
    warehouse(p, H, R) { lot = p; p.doors = true; warehouse(p, H, R); },
  };
}
