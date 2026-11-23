// The city's layout as data: street grid, road graph, ground heights,
// static colliders and the shapes drawn on the minimap. No rendering here.
import { clamp } from './util.js';

export const LINES = [-180, -108, -36, 36, 108, 180]; // road centre lines, both axes
export const GRID = LINES.length;
export const PITCH = 72;
export const ROAD_HALF = 6; // curb to road centre
export const CURB = 0.15; // sidewalk height above the road
export const SIDEWALK = 4;
export const LANE = 1.75; // centre of the driving lane, from road centre
export const PARK_LANE = 4.8; // centre of the curbside parking lane
export const CORNER_R = 3;

export const PARK = { x0: -30, x1: 102, z0: -30, z1: 30 };
export const PLAZA = { x0: -30, x1: 30, z0: -102, z1: -42 };
export const DOCKS = { x0: -262, x1: -186, z0: -150, z1: 110 };
export const PIER = { x0: 26, x1: 46, z0: 200, z1: 292 };
export const PROM = { z0: 186, z1: 200 };
export const BEACH_END = 219; // invisible wall in the shallows
export const WATER_Y = -0.45;
export const LAND = { x0: -192, x1: 192, z0: -192, z1: 200 };

export const SPAWN = { x: -128, z: 180 + PARK_LANE, heading: Math.PI / 2 };

// ------------------------------------------------------------ road graph

export const nodes = [];
for (let j = 0; j < GRID; j++) {
  for (let i = 0; i < GRID; i++) nodes.push({ id: i + j * GRID, i, j, x: LINES[i], z: LINES[j], nb: [] });
}
export const nodeId = (i, j) => i + j * GRID;
const removed = new Set([`${nodeId(3, 2)}-${nodeId(3, 3)}`]); // swallowed by the park
function link(a, b) {
  if (removed.has(`${a}-${b}`) || removed.has(`${b}-${a}`)) return;
  nodes[a].nb.push(b);
  nodes[b].nb.push(a);
}
for (let j = 0; j < GRID; j++) {
  for (let i = 0; i < GRID; i++) {
    if (i + 1 < GRID) link(nodeId(i, j), nodeId(i + 1, j));
    if (j + 1 < GRID) link(nodeId(i, j), nodeId(i, j + 1));
  }
}
export const edges = [];
for (const n of nodes) for (const m of n.nb) if (m > n.id) edges.push([n.id, m]);

export function nearestNode(x, z) {
  const i = clamp(Math.round((x + 180) / PITCH), 0, GRID - 1);
  const j = clamp(Math.round((z + 180) / PITCH), 0, GRID - 1);
  return nodes[nodeId(i, j)];
}

/** Breadth-first route between two nodes; returns the list of node ids after `from`. */
export function route(from, to) {
  if (from === to) return [];
  const prev = new Int16Array(nodes.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let q = 0; q < queue.length; q++) {
    const n = queue[q];
    if (n === to) break;
    for (const m of nodes[n].nb) if (prev[m] < 0) { prev[m] = n; queue.push(m); }
  }
  if (prev[to] < 0) return [];
  const path = [];
  for (let n = to; n !== from; n = prev[n]) path.push(n);
  return path.reverse();
}

// --------------------------------------------------------- traffic lights

const CYCLE = 22;
/** 'g', 'y' or 'r' for traffic arriving at `node` along the x axis (`alongX`) or z axis. */
export function lightState(node, alongX, time) {
  if (node.nb.length < 3) return 'g';
  const t = (time + ((node.i * 7 + node.j * 11) % CYCLE)) % CYCLE;
  // 0-8 z green, 8-10 z yellow, 10-11 all red, 11-19 x green, 19-21 x yellow, 21-22 all red
  if (alongX) return t >= 11 && t < 19 ? 'g' : t >= 19 && t < 21 ? 'y' : 'r';
  return t < 8 ? 'g' : t < 10 ? 'y' : 'r';
}

// ---------------------------------------------------------- ground height

function onRoadLine(v) {
  const k = Math.round((v + 180) / PITCH);
  return k >= 0 && k < GRID && Math.abs(v - (k * PITCH - 180)) < ROAD_HALF;
}

/** Local lumps on top of the base ground: bandstand, fountain steps and the like. */
export const raised = []; // { x, z, r, h }

/** Height of the walkable ground, ignoring ramps. */
export function baseHeight(x, z) {
  let h = flatHeight(x, z);
  for (let i = 0; i < raised.length; i++) {
    const p = raised[i];
    const dx = x - p.x, dz = z - p.z;
    if (dx * dx + dz * dz < p.r * p.r) h += p.h;
  }
  return h;
}

function flatHeight(x, z) {
  if (x < -186) {
    if (x > DOCKS.x0 && z > DOCKS.z0 && z < DOCKS.z1) return 0;
    return CURB;
  }
  if (x > 186 || z < -186) return CURB;
  if (z > 186) {
    if (z <= PROM.z1) return CURB;
    if (x > PIER.x0 && x < PIER.x1) return CURB;
    return CURB - (z - PROM.z1) * 0.045;
  }
  if (onRoadLine(z)) return 0;
  const inPark = x > PARK.x0 && x < PARK.x1 && z > PARK.z0 && z < PARK.z1;
  if (onRoadLine(x) && !inPark) return 0;
  // Inside a block: shave the rounded corners.
  let x0, x1, z0, z1;
  if (inPark) ({ x0, x1, z0, z1 } = PARK);
  else {
    const kx = Math.floor((x + 180) / PITCH), kz = Math.floor((z + 180) / PITCH);
    x0 = kx * PITCH - 180 + ROAD_HALF; x1 = x0 + PITCH - 2 * ROAD_HALF;
    z0 = kz * PITCH - 180 + ROAD_HALF; z1 = z0 + PITCH - 2 * ROAD_HALF;
  }
  const ex = Math.min(x - x0, x1 - x), ez = Math.min(z - z0, z1 - z);
  if (ex < CORNER_R && ez < CORNER_R) {
    const a = CORNER_R - ex, b = CORNER_R - ez;
    if (a * a + b * b > CORNER_R * CORNER_R) return 0;
  }
  return CURB;
}

/**
 * Stunt ramps: wedges that rise along their heading. Kept apart from the base
 * height so cars can be launched by the slope without hopping over curbs.
 */
export const ramps = []; // { x, z, heading, len, width, height, sin, cos }
export function addRamp(x, z, heading, len, width, height) {
  ramps.push({ x, z, heading, len, width, height, sin: Math.sin(heading), cos: Math.cos(heading) });
}
/** Ramp height at a point; `out.gx/gz` receive the slope when on a ramp. */
export function rampHeight(x, z, out) {
  for (let i = 0; i < ramps.length; i++) {
    const r = ramps[i];
    const dx = x - r.x, dz = z - r.z;
    const along = dx * r.sin + dz * r.cos;
    if (along < 0 || along > r.len) continue;
    const side = -dx * r.cos + dz * r.sin;
    if (Math.abs(side) > r.width / 2) continue;
    const slope = r.height / r.len;
    if (out) { out.gx = r.sin * slope; out.gz = r.cos * slope; }
    return along * slope;
  }
  if (out) { out.gx = 0; out.gz = 0; }
  return 0;
}

export const groundHeight = (x, z) => baseHeight(x, z) + rampHeight(x, z, null);

// --------------------------------------------------------------- colliders

const CELL = 12;
const cellKey = (ix, iz) => (ix + 512) * 1024 + (iz + 512);

class Colliders {
  constructor() {
    this.boxes = [];
    this.tall = []; // boxes high enough to block sight lines and the camera
    this.circles = [];
    this.grid = new Map();
    this.stamp = 0;
    this.found = [];
  }

  insert(item, x0, z0, x1, z1) {
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++) {
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
        const k = cellKey(ix, iz);
        let list = this.grid.get(k);
        if (!list) this.grid.set(k, (list = []));
        list.push(item);
      }
    }
  }

  /** Axis-aligned box from the ground up to height `h`. */
  addBox(x0, z0, x1, z1, h = 100) {
    const b = { box: true, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), h, q: 0 };
    this.boxes.push(b);
    if (h > 3.5) this.tall.push(b);
    this.insert(b, b.x0, b.z0, b.x1, b.z1);
    return b;
  }

  addCircle(x, z, r, h = 100) {
    const c = { box: false, x, z, r, h, q: 0 };
    this.circles.push(c);
    this.insert(c, x - r, z - r, x + r, z + r);
    return c;
  }

  query(x, z, r) {
    const found = this.found;
    found.length = 0;
    const stamp = ++this.stamp;
    for (let ix = Math.floor((x - r) / CELL); ix <= Math.floor((x + r) / CELL); ix++) {
      for (let iz = Math.floor((z - r) / CELL); iz <= Math.floor((z + r) / CELL); iz++) {
        const list = this.grid.get(cellKey(ix, iz));
        if (!list) continue;
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (it.q !== stamp) { it.q = stamp; found.push(it); }
        }
      }
    }
    return found;
  }

  /**
   * Push a circle out of everything solid. `feet` is the height of its
   * underside, so low obstacles can be cleared by jumping.
   * Writes the corrected position and the last contact normal into `out`.
   */
  resolve(x, z, r, feet, out) {
    out.hit = false;
    out.nx = 0;
    out.nz = 0;
    out.depth = 0;
    const list = this.query(x, z, r);
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      if (feet >= it.h) continue;
      let nx, nz, pen;
      if (it.box) {
        const cx = clamp(x, it.x0, it.x1), cz = clamp(z, it.z0, it.z1);
        let dx = x - cx, dz = z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          nx = dx / d; nz = dz / d; pen = r - d;
        } else {
          // Centre is inside: leave through the nearest face.
          const l = x - it.x0, rr = it.x1 - x, t = z - it.z0, b = it.z1 - z;
          const m = Math.min(l, rr, t, b);
          nx = 0; nz = 0;
          if (m === l) nx = -1; else if (m === rr) nx = 1; else if (m === t) nz = -1; else nz = 1;
          pen = m + r;
        }
      } else {
        const dx = x - it.x, dz = z - it.z;
        const d2 = dx * dx + dz * dz;
        const rr = r + it.r;
        if (d2 >= rr * rr) continue;
        const d = Math.sqrt(d2) || 1e-4;
        nx = dx / d; nz = dz / d; pen = rr - d;
      }
      x += nx * pen;
      z += nz * pen;
      out.hit = true;
      if (pen > out.depth) { out.depth = pen; out.nx = nx; out.nz = nz; }
    }
    out.x = x;
    out.z = z;
    return out.hit;
  }

  /** Fraction (0..1) along the segment at which a tall box is first hit, or 1. */
  raycast(x0, z0, x1, z1) {
    const dx = x1 - x0, dz = z1 - z0;
    let best = 1;
    for (let i = 0; i < this.tall.length; i++) {
      const b = this.tall[i];
      let t0 = 0, t1 = best;
      if (Math.abs(dx) < 1e-9) { if (x0 < b.x0 || x0 > b.x1) continue; }
      else {
        let a = (b.x0 - x0) / dx, c = (b.x1 - x0) / dx;
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) { if (z0 < b.z0 || z0 > b.z1) continue; }
      else {
        let a = (b.z0 - z0) / dz, c = (b.z1 - z0) / dz;
        if (a > c) { const s = a; a = c; c = s; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
        if (t0 > t1) continue;
      }
      if (t0 < best) best = t0;
    }
    return best;
  }

  clearSight(x0, z0, x1, z1) {
    return this.raycast(x0, z0, x1, z1) >= 1;
  }
}

export const colliders = new Colliders();

// ------------------------------------------------------------------ misc

/** Shapes for the minimap, appended while the city is being built. */
export const mapShapes = []; // { kind: 'rect' | 'circle', ..., color }

export function districtAt(x, z) {
  if (x < -186) return 'Ironside Docks';
  if (z > PROM.z1) return x > PIER.x0 - 4 && x < PIER.x1 + 4 ? 'Sundown Pier' : 'Vesper Beach';
  if (z > 172) return 'The Promenade';
  if (x > PARK.x0 && x < PARK.x1 && z > PARK.z0 && z < PARK.z1) return 'Lantern Park';
  if (x > PLAZA.x0 && x < PLAZA.x1 && z > PLAZA.z0 && z < PLAZA.z1) return 'Meridian Plaza';
  if (z > 108) return 'Coral Row';
  if (x < -108) return 'Foundry Row';
  if (x > 108) return 'Eastside';
  if (z < -108) return 'Northgate';
  return 'Downtown';
}

/** True where pedestrians and props must not be dropped by accident: the water. */
export function onLand(x, z) {
  if (x > DOCKS.x0 && x < -186 && z > DOCKS.z0 && z < DOCKS.z1) return true;
  if (x > PIER.x0 && x < PIER.x1 && z >= PROM.z1 && z < PIER.z1) return true;
  return x > LAND.x0 && x < LAND.x1 && z > LAND.z0 && z < BEACH_END;
}
