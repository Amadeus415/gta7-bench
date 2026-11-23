import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, smoothstep } from './util.js';

// Sky dome, sun/moon light and fog, all driven by a 24 h clock.

const KEYS = [
  // hour, zenith, horizon, sun colour, sun intensity, hemi intensity
  [0, '#03060f', '#0d1426', '#8fa8ff', 0.25, 0.35],
  [5, '#0a1024', '#2a2c48', '#8fa8ff', 0.2, 0.4],
  [6.3, '#3a4a7a', '#f0a070', '#ffb070', 1.2, 0.8],
  [8, '#4a86d0', '#bcd6ee', '#fff0d8', 2.6, 1.15],
  [12, '#3c7fd8', '#b6d8f4', '#ffffff', 3.0, 1.25],
  [16.5, '#4682cc', '#c4d8ea', '#fff2dc', 2.7, 1.15],
  [18.6, '#3c4d86', '#f49a5a', '#ffa060', 1.6, 0.85],
  [19.6, '#151c3c', '#5a3c5a', '#ff8050', 0.5, 0.5],
  [20.6, '#050914', '#121a30', '#8fa8ff', 0.25, 0.35],
  [24, '#03060f', '#0d1426', '#8fa8ff', 0.25, 0.35],
];

const c1 = new THREE.Color(), c2 = new THREE.Color();
function sample(hour) {
  let k = 0;
  while (k < KEYS.length - 2 && KEYS[k + 1][0] <= hour) k++;
  const a = KEYS[k], b = KEYS[k + 1];
  const t = clamp((hour - a[0]) / (b[0] - a[0]), 0, 1);
  const mix = (i) => c1.set(a[i]).lerp(c2.set(b[i]), t).clone();
  return { zenith: mix(1), horizon: mix(2), sun: mix(3), sunI: lerp(a[4], b[4], t), hemiI: lerp(a[5], b[5], t) };
}

export class Sky {
  constructor(scene) {
    this.uniforms = {
      zenith: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) },
      sunCol: { value: new THREE.Color() },
      night: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 zenith, horizon, sunDir, sunCol;
        uniform float night;
        varying vec3 vDir;
        float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(horizon, zenith, pow(h, 0.55));
          if (d.y < 0.0) col = horizon * (1.0 + d.y * 0.6);
          float sd = max(dot(d, sunDir), 0.0);
          col += sunCol * (pow(sd, 900.0) * 6.0 + pow(sd, 18.0) * 0.18) * step(-0.05, sunDir.y);
          // moon opposite the sun
          float md = max(dot(d, -sunDir), 0.0);
          col += vec3(0.75, 0.8, 0.95) * pow(md, 1500.0) * 3.0 * night;
          col += vec3(0.25, 0.3, 0.45) * pow(md, 30.0) * 0.12 * night;
          // stars
          vec3 sp = floor(d * 260.0);
          float st = step(0.9965, hash(sp)) * smoothstep(0.02, 0.25, d.y);
          col += vec3(st) * night * (0.6 + 0.4 * hash(sp + 3.1));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -75; sc.right = 75; sc.top = 75; sc.bottom = -75;
    sc.near = 10; sc.far = 420;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x5a5040, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xb6d8f4, 90, 620);
    this.scene = scene;
    this.night = 0;
    this.dir = new THREE.Vector3();
  }

  update(hour, focus, camera) {
    const s = sample(hour);
    // Sun path: rises in the east (+x), sets in the west, leaning south over the sea.
    const ang = ((hour - 6) / 12) * Math.PI;
    this.dir.set(Math.cos(ang) * 0.8, Math.sin(ang), 0.45).normalize();
    const elev = this.dir.y;
    this.night = 1 - smoothstep(-0.12, 0.12, elev);
    const n = this.night;
    this.uniforms.zenith.value.copy(s.zenith);
    this.uniforms.horizon.value.copy(s.horizon);
    this.uniforms.sunCol.value.copy(s.sun);
    this.uniforms.sunDir.value.copy(this.dir);
    this.uniforms.night.value = n;
    this.dome.position.copy(camera.position);

    // At night the shadow-casting light becomes the moon, opposite the sun.
    const lightDir = elev > -0.05 ? this.dir : this.dir.clone().negate();
    const lightUp = Math.max(lightDir.y, 0.12);
    const ld = lightDir.clone().setY(lightUp).normalize();
    this.sun.position.copy(focus).addScaledVector(ld, 200);
    this.sun.target.position.copy(focus);
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI * (elev > -0.05 ? smoothstep(-0.05, 0.08, elev) : 1) + (elev > -0.05 ? 0 : 0);
    if (elev <= -0.05) this.sun.intensity = 0.32;
    this.hemi.intensity = s.hemiI;
    this.hemi.color.copy(s.zenith).lerp(new THREE.Color(0xffffff), 0.45);
    this.hemi.groundColor.set(n > 0.5 ? 0x1a1a24 : 0x5a5040);
    this.scene.fog.color.copy(s.horizon);
    this.scene.fog.near = lerp(90, 40, n);
    this.scene.fog.far = lerp(620, 420, n);
  }
}
