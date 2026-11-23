import * as THREE from '../vendor/three.module.js';

// ---------------------------------------------------------------- city layout
export const ROAD_HALF = 6;                 // road half-width (12 m)
export const ROADS = [-112, -56, 0, 56, 112];
export const SLAB_H = 0.12;
export const WORLD_LIMIT = 165;             // keep the player inside
export const ROAD_LEN = 224;

const SPECIAL = new Map([['0,0', 'park'], ['3,3', 'plaza']]);

const seededRandom = (() => {
  let s = 987654321;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
})();
const rand = (a, b) => a + seededRandom() * (b - a);

// ------------------------------------------------------------ canvas textures
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function noiseCanvas(w, h, base, spread, alpha) {
  const [c, ctx] = makeCanvas(w, h);
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * spread;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i+1] = Math.max(0, Math.min(255, d[i+1] + n));
    d[i+2] = Math.max(0, Math.min(255, d[i+2] + n));
  }
  ctx.putImageData(img, 0, 0);
  if (alpha) { ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fillRect(0, 0, w, h); }
  return c;
}

function asphaltTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#3b3e46'; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    const g = 48 + Math.random() * 26;
    ctx.fillStyle = `rgb(${g},${g},${g + 4})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(30, 30);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sidewalkTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#8f949c'; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 60; i++) {
    const g = 120 + Math.random() * 40;
    ctx.fillStyle = `rgba(${g},${g},${g + 6},0.5)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
  }
  // expansion joints
  ctx.strokeStyle = 'rgba(60,64,72,0.55)'; ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 128, 128);
  for (let i = 1; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(128, i * 32); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function grassTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#3e7a3c'; ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1600; i++) {
    const g = 78 + Math.random() * 52;
    ctx.fillStyle = `rgb(${40 + Math.random() * 30},${g},${42 + Math.random() * 22})`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(9, 9);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function pavementTexture() {
  const [c, ctx] = makeCanvas(128, 128);
  ctx.fillStyle = '#a49d91'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(80,75,66,0.6)'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * 32, 0); ctx.lineTo(i * 32, 128); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 32); ctx.lineTo(128, i * 32); ctx.stroke();
  }
  for (let i = 0; i < 500; i++) {
    const g = 130 + Math.random() * 30;
    ctx.fillStyle = `rgba(${g},${g - 4},${g - 10},0.35)`;
    ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function dashTexture() {
  const [c, ctx] = makeCanvas(8, 64);
  ctx.clearRect(0, 0, 8, 64);
  ctx.fillStyle = '#e8d26a';
  ctx.fillRect(0, 0, 8, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 26);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildingTexture(variant) {
  // 6 facade variants: 3 colors x warm/cool
  const bases = ['#7d6a72', '#5d6b7d', '#7a7061', '#6a5f72', '#556b5f', '#746055'];
  const accents = ['#e8c66a', '#a5d8e8', '#e8e0c8', '#e8a5a5'];
  const base = bases[variant % bases.length];
  const wall = accents[variant % accents.length];
  const [c, ctx] = makeCanvas(128, 256);
  ctx.fillStyle = base; ctx.fillRect(0, 0, 128, 256);
  // subtle vertical shading
  for (let y = 0; y < 256; y += 4) {
    ctx.fillStyle = `rgba(0,0,0,${0.03 * (y / 256)})`;
    ctx.fillRect(0, y, 128, 4);
  }
  // slab lines
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
  for (let y = 0; y <= 256; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(128, y); ctx.stroke(); }
  const [ec, ectx] = makeCanvas(128, 256);
  ectx.fillStyle = '#000'; ectx.fillRect(0, 0, 128, 256);
  const cols = 5, rows = 10;
  const ww = 128 / cols, hh = 256 / rows;
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const px = x * ww + ww * 0.26, py = y * hh + hh * 0.28;
      const pw = ww * 0.48, ph = hh * 0.4;
      const lit = Math.random() < 0.62;
      ctx.fillStyle = lit ? '#ffd98a' : '#2b313c';
      ctx.fillRect(px, py, pw, ph);
      if (lit) { ectx.fillStyle = wall; ectx.fillRect(px, py, pw, ph); }
      ctx.strokeStyle = 'rgba(20,22,28,0.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(px, py, pw, ph);
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  const emissive = new THREE.CanvasTexture(ec);
  emissive.colorSpace = THREE.SRGBColorSpace;
  return { map, emissive };
}

// ---------------------------------------------------------------- builders
function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  const boxColliders = [];
  const circleColliders = [];
  const slabColliders = []; // sidewalk tops (for ground height)
  const lampHeadMaterials = [];

  // ground + roads
  const asphalt = asphaltTexture();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_LEN + 160, ROAD_LEN + 160),
    new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.94, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const dashes = dashTexture();
  const dashMat = new THREE.MeshBasicMaterial({ map: dashes, transparent: true, depthWrite: false });
  for (const cx of ROADS) {
    for (const vertical of [true, false]) {
      const geo = vertical
        ? new THREE.PlaneGeometry(0.35, ROAD_LEN)
        : new THREE.PlaneGeometry(ROAD_LEN, 0.35);
      const d = new THREE.Mesh(geo, dashMat);
      d.rotation.x = -Math.PI / 2;
      if (vertical) { d.position.set(cx, 0.02, 0); }
      else {
        d.rotation.z = Math.PI / 2;
        d.position.set(0, 0.02, cx);
      }
      group.add(d);
    }
  }

  const sidewalkTex = sidewalkTexture();
  const sidewalkMat = new THREE.MeshStandardMaterial({ map: sidewalkTex, roughness: 0.9 });
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 0.95 });
  const pavementMat = new THREE.MeshStandardMaterial({ map: pavementTexture(), roughness: 0.9 });

  const slabSize = 44;

  // blocks
  const blockCenters = [];
  const blocks = [];
  const buildingMats = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const xMin = ROADS[i] + ROAD_HALF, xMax = ROADS[i + 1] - ROAD_HALF;
      const zMin = ROADS[j] + ROAD_HALF, zMax = ROADS[j + 1] - ROAD_HALF;
      const cx = (xMin + xMax) / 2, cz = (zMin + zMax) / 2;
      const special = SPECIAL.get(`${i},${j}`);
      const blockEntry = { i, j, type: special || 'block', xMin, xMax, zMin, zMax, cx, cz, buildings: [] };
      blockCenters.push({ i, j, xMin, xMax, zMin, zMax, cx, cz });
      blocks.push(blockEntry);
      if (special === 'park') continue; // built later
      if (special === 'plaza') continue;
      const spawnBlock = (i === 2 && j === 1); // keep the spawn block clear
      // slab
      const slab = box(slabSize, SLAB_H, slabSize, sidewalkMat);
      slab.position.set(cx, SLAB_H / 2, cz);
      slab.receiveShadow = true;
      slab.castShadow = false;
      group.add(slab);
      slabColliders.push({ xMin, xMax, zMin, zMax });
      if (spawnBlock) continue; // no buildings in the spawn block
      // buildings: 2x2 quadrants with random fill
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (seededRandom() < 0.22) continue; // empty lot
        const bw = rand(15, 21), bd = rand(15, 21);
        const bh = rand(13, 46);
        const bx = cx + dx * 11.5, bz = cz + dz * 11.5;
        const variant = Math.floor(seededRandom() * 6);
        const { map, emissive } = buildingTexture(variant);
        const mat = new THREE.MeshStandardMaterial({
          map, emissiveMap: emissive, emissive: new THREE.Color('#ffc06a'),
          emissiveIntensity: 0, roughness: 0.82, metalness: 0.05,
        });
        const b = box(bw, bh, bd, mat);
        b.position.set(bx, SLAB_H + bh / 2, bz);
        group.add(b);
        boxColliders.push({ minX: bx - bw / 2, maxX: bx + bw / 2, minZ: bz - bd / 2, maxZ: bz + bd / 2 });
        b.userData.isBuilding = true;
        buildingMats.push(mat);
        blockEntry.buildings.push({ x: bx, z: bz, w: bw, d: bd, h: bh });
      }
    }
  }

  // ---- park block (0,0)
  const park = blockCenters.find((b) => b.i === 0 && b.j === 0);
  const parkSlab = box(slabSize, SLAB_H, slabSize, grassMat);
  parkSlab.position.set(park.cx, SLAB_H / 2, park.cz);
  parkSlab.receiveShadow = true; parkSlab.castShadow = false;
  group.add(parkSlab);
  slabColliders.push({ xMin: park.xMin, xMax: park.xMax, zMin: park.zMin, zMax: park.zMax });

  const pondPos = { x: park.cx + 9, z: park.cz - 8 };
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(5.5, 28),
    new THREE.MeshStandardMaterial({ color: '#2f6f8f', roughness: 0.16, metalness: 0.35 })
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(pondPos.x, SLAB_H + 0.02, pondPos.z);
  pond.receiveShadow = true;
  group.add(pond);
  circleColliders.push({ x: pondPos.x, z: pondPos.z, r: 5.8 });

  // path cross
  const pathMat = new THREE.MeshStandardMaterial({ color: '#b8ae9a', roughness: 0.9 });
  for (const [w, d, px, pz, rot] of [[44, 3, park.cx, park.cz, 0], [3, 44, park.cx, park.cz, 1]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, d), pathMat);
    p.position.set(px, SLAB_H + 0.03, pz);
    p.receiveShadow = true;
    group.add(p);
  }

  // trees
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4230', roughness: 0.9 });
  const leafMats = [new THREE.MeshStandardMaterial({ color: '#2e6b34', roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: '#3a7d3c', roughness: 0.85 }),
    new THREE.MeshStandardMaterial({ color: '#2c5830', roughness: 0.85 })];
  for (let i = 0; i < 11; i++) {
    const tx = park.cx + rand(-17, 17), tz = park.cz + rand(-17, 17);
    if (Math.hypot(tx - pondPos.x, tz - pondPos.z) < 9) continue;
    if (Math.abs(tx - park.cx) < 4.5 && Math.abs(tz - park.cz) < 22) continue; // keep path clear
    if (Math.abs(tz - park.cz) < 4.5 && Math.abs(tx - park.cx) < 22) continue;
    if (Math.hypot(tx - pondPos.x, tz - pondPos.z) > 30) continue;
    const th = rand(2.6, 4.2);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, th, 7), trunkMat);
    trunk.position.set(tx, SLAB_H + th / 2, tz);
    trunk.castShadow = true;
    group.add(trunk);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.7, 2.4), 1), leafMats[i % 3]);
    crown.position.set(tx, SLAB_H + th + rand(0.7, 1.1), tz);
    crown.scale.y = 1.25;
    crown.castShadow = true;
    group.add(crown);
    circleColliders.push({ x: tx, z: tz, r: 0.7 });
  }

  // benches
  const benchMat = new THREE.MeshStandardMaterial({ color: '#6d5338', roughness: 0.8 });
  for (const [bx, bz, rot] of [[park.cx - 12, park.cz - 14, 0], [park.cx + 14, park.cz + 13, 1.2], [park.cx - 15, park.cz + 12, 2.4]]) {
    const bench = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.6), benchMat);
    seat.position.y = 0.48; seat.castShadow = true;
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.12), benchMat);
    back.position.set(0, 0.78, -0.28); back.castShadow = true;
    bench.add(seat, back);
    for (const sx of [-0.9, 0.9]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.45, 0.5), new THREE.MeshStandardMaterial({ color: '#3c3f47' }));
      leg.position.set(sx, 0.23, 0);
      bench.add(leg);
    }
    bench.position.set(bx, SLAB_H, bz);
    bench.rotation.y = rot;
    group.add(bench);
    boxColliders.push({ minX: bx - 1.3, maxX: bx + 1.3, minZ: bz - 1.3, maxZ: bz + 1.3 });
  }

  // ---- plaza block (3,3)
  const plaza = blockCenters.find((b) => b.i === 3 && b.j === 3);
  const plazaSlab = box(slabSize, SLAB_H, slabSize, pavementMat);
  plazaSlab.position.set(plaza.cx, SLAB_H / 2, plaza.cz);
  plazaSlab.receiveShadow = true; plazaSlab.castShadow = false;
  group.add(plazaSlab);
  slabColliders.push({ xMin: plaza.xMin, xMax: plaza.xMax, zMin: plaza.zMin, zMax: plaza.zMax });

  // fountain
  const fountainBase = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.7, 1.0, 22),
    new THREE.MeshStandardMaterial({ color: '#b7b0a4', roughness: 0.75 })
  );
  fountainBase.position.set(plaza.cx, SLAB_H + 0.5, plaza.cz);
  fountainBase.castShadow = true; fountainBase.receiveShadow = true;
  group.add(fountainBase);
  const fountainWater = new THREE.Mesh(
    new THREE.CylinderGeometry(2.9, 2.9, 0.25, 22),
    new THREE.MeshStandardMaterial({ color: '#3f8fbf', roughness: 0.12, metalness: 0.3, emissive: new THREE.Color('#1e5a78'), emissiveIntensity: 0.35 })
  );
  fountainWater.position.set(plaza.cx, SLAB_H + 0.95, plaza.cz);
  group.add(fountainWater);
  circleColliders.push({ x: plaza.cx, z: plaza.cz, r: 3.9 });

  // planters + bushes
  const planterMat = new THREE.MeshStandardMaterial({ color: '#7c5a44', roughness: 0.85 });
  const bushMat = new THREE.MeshStandardMaterial({ color: '#2f6b34', roughness: 0.9 });
  for (const [dx, dz] of [[-15, -15], [15, -15], [-15, 15], [15, 15]]) {
    const px = plaza.cx + dx, pz = plaza.cz + dz;
    const planter = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 2.6), planterMat);
    planter.position.set(px, SLAB_H + 0.4, pz);
    planter.castShadow = true;
    group.add(planter);
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), bushMat);
    bush.position.set(px, SLAB_H + 1.45, pz);
    bush.castShadow = true;
    group.add(bush);
    boxColliders.push({ minX: px - 1.4, maxX: px + 1.4, minZ: pz - 1.4, maxZ: pz + 1.4 });
  }

  // ---- lamps (intersections)
  const lampPoleMat = new THREE.MeshStandardMaterial({ color: '#2c3038', roughness: 0.6, metalness: 0.5 });
  for (const rx of ROADS) {
    for (const rz of ROADS) {
      if (Math.abs(rx) < 1 && Math.abs(rz) < 1) continue; // keep main cross clean
      for (const [sx, sz] of [[1, 1], [-1, 1]]) {
        if (seededRandom() < 0.42) continue;
        const lx = rx + sx * (ROAD_HALF + 1.6), lz = rz + sz * (ROAD_HALF + 1.6);
        if (Math.abs(lx) > ROADS[4]) continue;
        const poleH = 4.6;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, poleH, 6), lampPoleMat);
        pole.position.set(lx, SLAB_H + poleH / 2, lz);
        pole.castShadow = true;
        group.add(pole);
        const headMat = new THREE.MeshStandardMaterial({ color: '#f4e9d0', emissive: new THREE.Color('#ffd98a'), emissiveIntensity: 0.35 });
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), headMat);
        head.position.set(lx, SLAB_H + poleH + 0.15, lz);
        group.add(head);
        lampHeadMaterials.push(headMat);
      }
    }
  }

  scene.add(group);

  const groundHeight = (x, z) => {
    for (const s of slabColliders) {
      if (x >= s.xMin && x <= s.xMax && z >= s.zMin && z <= s.zMax) return SLAB_H;
    }
    return 0;
  };

  // park + plaza block entries carry their key spots for the minimap
  const parkEntry = blocks.find((b) => b.i === 0 && b.j === 0);
  const plazaEntry = blocks.find((b) => b.i === 3 && b.j === 3);

  return {
    group,
    boxColliders, circleColliders, slabColliders,
    buildingMats, lampHeadMaterials,
    groundHeight,
    blocks,
    roads: ROADS,
    park: { pos: { x: parkEntry.cx, z: parkEntry.cz }, pondPos },
    plaza: { pos: { x: plazaEntry.cx, z: plazaEntry.cz }, fountain: { x: plazaEntry.cx, z: plazaEntry.cz, r: 3.9 } },
    pondPos,
    parkedCars: PARKED_CARS,
  };
}

export const PARKED_CARS = [
  { x: 5.5, z: -40, heading: 0, color: '#e0694f', name: 'starter' },   // spawn
  { x: -61.5, z: -95, heading: Math.PI, color: '#4f8fd6', name: 'blue' },
  { x: -95, z: 61.5, heading: -Math.PI / 2, color: '#6f8f4f', name: 'green' },
  { x: 61.5, z: 75, heading: 0, color: '#c9b458', name: 'yellow' },
];

export function pickMissionPoint(excludeMinX, excludeMaxX, excludeMinZ, excludeMaxZ) {
  // random point on a sidewalk-ish spot in a block interior
  for (let attempt = 0; attempt < 24; attempt++) {
    const i = Math.floor(Math.random() * 4);
    const j = Math.floor(Math.random() * 4);
    const xMin = ROADS[i] + ROAD_HALF + 3.5, xMax = ROADS[i + 1] - ROAD_HALF - 3.5;
    const zMin = ROADS[j] + ROAD_HALF + 3.5, zMax = ROADS[j + 1] - ROAD_HALF - 3.5;
    const x = xMin + Math.random() * (xMax - xMin);
    const z = zMin + Math.random() * (zMax - zMin);
    if (x >= excludeMinX && x <= excludeMaxX && z >= excludeMinZ && z <= excludeMaxZ) continue;
    return { x, z };
  }
  return { x: 0, z: 30 };
}
