// Simple circle-vs-world collision helpers.
export function pushOutOfBoxes(pos, r, boxes) {
  let hit = false;
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 < 1e-6) {
        // center inside box: push out along smallest axis
        const dl = pos.x - b.minX, dr = b.maxX - pos.x;
        const dn = pos.z - b.minZ, df = b.maxZ - pos.z;
        const m = Math.min(dl, dr, dn, df);
        if (m === dl) pos.x = b.minX - r;
        else if (m === dr) pos.x = b.maxX + r;
        else if (m === dn) pos.z = b.minZ - r;
        else pos.z = b.maxZ + r;
      } else {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * r;
        pos.z = cz + (dz / d) * r;
      }
      hit = true;
    }
  }
  return hit;
}

export function pushOutOfCircles(pos, r, circles) {
  let hit = false;
  for (const c of circles) {
    const dx = pos.x - c.x, dz = pos.z - c.z;
    const min = c.r + r;
    const d2 = dx * dx + dz * dz;
    if (d2 < min * min && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = c.x + (dx / d) * min;
      pos.z = c.z + (dz / d) * min;
      hit = true;
    }
  }
  return hit;
}

export function clampToWorld(pos, limit) {
  let hit = false;
  if (pos.x > limit) { pos.x = limit; hit = true; }
  if (pos.x < -limit) { pos.x = -limit; hit = true; }
  if (pos.z > limit) { pos.z = limit; hit = true; }
  if (pos.z < -limit) { pos.z = -limit; hit = true; }
  return hit;
}

export function insideWorld(pos, world, margin = 0) {
  for (const s of world.slabColliders) {
    if (pos.x > s.xMin - margin && pos.x < s.xMax + margin && pos.z > s.zMin - margin && pos.z < s.zMax + margin) return true;
  }
  return false;
}
