// Particles (smoke, sparks, spray, dust) and tyre marks.
import * as THREE from '../vendor/three.module.js';

export class Particles {
  constructor(scene, max = 1100) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.data = new Float32Array(max * 2); // size, additive
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.span = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4));
    geo.setAttribute('aData', new THREE.BufferAttribute(this.data, 2));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 620 }, uLight: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute vec4 aColor;
        attribute vec2 aData;
        uniform float uScale, uLight;
        varying vec4 vColor;
        varying float vAdd;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aData.x * uScale / max(-mv.z, 0.1);
          vAdd = aData.y;
          vColor = vec4(aColor.rgb * mix(uLight, 1.0, aData.y), aColor.a);
        }`,
      fragmentShader: /* glsl */ `
        varying vec4 vColor;
        varying float vAdd;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.12, d) * vColor.a;
          gl_FragColor = vec4(vColor.rgb * a, a * (1.0 - vAdd));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  /** Spawn one particle. `add` = 1 makes it glow (additive) instead of occluding. */
  emit(x, y, z, vx, vy, vz, life, size, grow, r, g, b, alpha, gravity = 0, drag = 0, add = 0) {
    const i = this.next;
    this.next = (i + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = alpha;
    this.data[i * 2] = size; this.data[i * 2 + 1] = add;
    this.life[i] = life; this.span[i] = life; this.grow[i] = grow; this.alpha[i] = alpha;
    this.grav[i] = gravity; this.drag[i] = drag;
  }

  burst(n, x, y, z, speed, up, life, size, r, g, b, alpha, gravity, add = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.283, s = speed * (0.3 + Math.random() * 0.7);
      this.emit(x, y, z, Math.cos(a) * s, up * (0.4 + Math.random() * 0.6), Math.sin(a) * s, life * (0.6 + Math.random() * 0.4), size, size * 0.8, r, g, b, alpha, gravity, 0.5, add);
    }
  }

  update(dt) {
    const { pos, vel, col, data, life } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) { data[i * 2] = 0; col[i * 4 + 3] = 0; continue; }
      const k = Math.max(0, 1 - this.drag[i] * dt);
      vel[i * 3] *= k; vel[i * 3 + 2] *= k;
      vel[i * 3 + 1] = vel[i * 3 + 1] * k - this.grav[i] * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      data[i * 2] += this.grow[i] * dt;
      const t = life[i] / this.span[i];
      col[i * 4 + 3] = this.alpha[i] * Math.min(1, t * 2.2);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aData.needsUpdate = true;
  }
}

/** A ring buffer of dark quads laid on the road where tyres slide. */
export class SkidMarks {
  constructor(scene, max = 700) {
    this.max = max;
    this.next = 0;
    this.pos = new Float32Array(max * 12);
    const idx = [];
    for (let i = 0; i < max; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setIndex(idx);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    const material = new THREE.MeshBasicMaterial({ color: 0x0c0c0e, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    scene.add(this.mesh);
    this.dirty = false;
  }

  /** One segment of rubber from (x0, z0) to (x1, z1), `w` wide, at height y. */
  add(x0, z0, x1, z1, y, w = 0.24) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.02 || len > 3) return;
    const px = (-dz / len) * w * 0.5, pz = (dx / len) * w * 0.5;
    const o = this.next * 12, p = this.pos;
    this.next = (this.next + 1) % this.max;
    p[o] = x0 - px; p[o + 1] = y; p[o + 2] = z0 - pz;
    p[o + 3] = x0 + px; p[o + 4] = y; p[o + 5] = z0 + pz;
    p[o + 6] = x1 + px; p[o + 7] = y; p[o + 8] = z1 + pz;
    p[o + 9] = x1 - px; p[o + 10] = y; p[o + 11] = z1 - pz;
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    this.mesh.geometry.attributes.position.needsUpdate = true;
    this.dirty = false;
  }
}
