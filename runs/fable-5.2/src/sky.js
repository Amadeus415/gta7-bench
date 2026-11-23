// Sky dome, sun and moon, and the day/night cycle that drives all lighting.
import * as THREE from '../vendor/three.module.js';
import { clamp, lerp, smoothstep } from './util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const DAY_ZENITH = C(0.14, 0.36, 0.8), DAY_HORIZON = C(0.6, 0.77, 0.94);
const DUSK_ZENITH = C(0.16, 0.17, 0.4), DUSK_HORIZON = C(1.0, 0.5, 0.24);
const NIGHT_ZENITH = C(0.008, 0.014, 0.045), NIGHT_HORIZON = C(0.035, 0.05, 0.12);
const SUN_LOW = C(1.0, 0.46, 0.2), SUN_HIGH = C(1.0, 0.95, 0.86), MOON = C(0.5, 0.62, 1.0);

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uZenith, uHorizon, uSunDir, uSunColor, uMoonDir, uCloudLit, uCloudDark;
  uniform float uStars, uTime, uGlow;
  varying vec3 vDir;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
    return s;
  }
  float hash3(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(h, 0.42));
    float sd = max(dot(d, uSunDir), 0.0);
    // warm bloom around the sun, strongest near the horizon
    col += uSunColor * (pow(sd, 6.0) * 0.22 + pow(sd, 40.0) * 0.4) * uGlow;
    col += uSunColor * smoothstep(0.99975, 0.99988, sd) * 14.0;
    // moon
    float md = dot(d, uMoonDir);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9993, 0.9996, md) * 1.6 * uStars;
    col += vec3(0.3, 0.4, 0.6) * pow(max(md, 0.0), 300.0) * 0.4 * uStars;
    // stars
    if (uStars > 0.01 && d.y > 0.0) {
      vec3 q = d * 260.0;
      vec3 g = floor(q);
      float s = hash3(g);
      float tw = 0.7 + 0.3 * sin(uTime * 2.0 + s * 90.0);
      float dotShape = smoothstep(0.42, 0.1, length(fract(q) - 0.5));
      col += vec3(0.9, 0.95, 1.0) * step(0.9965, s) * dotShape * tw * uStars * smoothstep(0.0, 0.25, d.y) * 2.2;
    }
    // drifting clouds on a flat layer overhead
    if (d.y > 0.01) {
      vec2 uv = d.xz / (d.y + 0.12) * 0.9 + vec2(uTime * 0.006, uTime * 0.002);
      float c = fbm(uv * 1.6);
      float cover = smoothstep(0.46, 0.78, c) * smoothstep(0.01, 0.14, d.y);
      float shade = smoothstep(0.5, 0.95, fbm(uv * 1.6 + 0.35));
      vec3 cc = mix(uCloudLit, uCloudDark, shade * 0.7);
      cc += uSunColor * pow(sd, 8.0) * 0.5 * uGlow;
      col = mix(col, cc, cover * 0.88);
    } else {
      col = mix(col, uHorizon * 0.8, smoothstep(0.0, -0.2, d.y));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Sky {
  constructor(scene, renderer, startHour = 15.8) {
    this.scene = scene;
    this.renderer = renderer;
    this.hour = startHour;
    this.speed = 1; // multiplier, raised while the player fast-forwards time

    this.uniforms = {
      uZenith: { value: C(0, 0, 0) }, uHorizon: { value: C(0, 0, 0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: C(1, 1, 1) },
      uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
      uCloudLit: { value: C(1, 1, 1) }, uCloudDark: { value: C(0.6, 0.6, 0.7) },
      uStars: { value: 0 }, uTime: { value: 0 }, uGlow: { value: 1 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }),
    );
    this.dome.scale.setScalar(900);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.light = new THREE.DirectionalLight(0xffffff, 3);
    this.light.castShadow = true;
    const sh = this.light.shadow;
    sh.mapSize.set(4096, 4096);
    this.shadowHalf = 80;
    sh.camera.left = -this.shadowHalf; sh.camera.right = this.shadowHalf;
    sh.camera.top = this.shadowHalf; sh.camera.bottom = -this.shadowHalf;
    sh.camera.near = 10; sh.camera.far = 520;
    sh.camera.updateProjectionMatrix();
    sh.bias = -0.0004;
    sh.normalBias = 0.045;
    scene.add(this.light, this.light.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.Fog(0xaaccee, 140, 1500);

    // A tiny scene rendered into a cube map so paint and glass have a sky to reflect.
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envUniforms = { uZenith: { value: C(0, 0, 0) }, uHorizon: { value: C(0, 0, 0) }, uGround: { value: C(0, 0, 0) }, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: C(0, 0, 0) } };
    this.envScene = new THREE.Scene();
    this.envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), new THREE.ShaderMaterial({
      uniforms: this.envUniforms, side: THREE.BackSide,
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir);
          vec3 col = d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.45)) : mix(uHorizon * 0.7, uGround, smoothstep(0.0, -0.25, d.y));
          col += uSunColor * pow(max(dot(d, uSunDir), 0.0), 24.0) * 1.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })));
    this.envTarget = null;
    this.envKey = -1;

    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    /** The light state other modules read every frame. */
    this.env = {
      night: 0, dayness: 1, lightDir: new THREE.Vector3(0, 1, 0), sunGlint: C(1, 1, 1),
      horizon: C(0, 0, 0), zenith: C(0, 0, 0), seaDeep: C(0, 0, 0), fogColor: C(0, 0, 0), hillTint: C(1, 1, 1),
      fogNear: 140, fogFar: 1500, nearPlaza: false, particleLight: 1,
    };
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3(); this._c = new THREE.Vector3();
    this.update(0, new THREE.Vector3(), null);
  }

  /** "17:42" style clock text. */
  clock() {
    const h = Math.floor(this.hour), m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt, focus, camera) {
    const env = this.env;
    // Daylight hours pass slowly; the night is hurried along.
    const rate = lerp(1 / 12.5, 1 / 45, env.dayness);
    this.hour = (this.hour + dt * rate * this.speed) % 24;
    this.uniforms.uTime.value += dt;

    const a = ((this.hour - 6) / 12) * Math.PI;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.85, 0.36).normalize();
    const am = ((((this.hour + 6) % 24)) / 12) * Math.PI;
    this.moonDir.set(Math.cos(am) * 0.8, Math.sin(am) * 0.75, -0.42).normalize();
    const sy = this.sunDir.y;

    const day = smoothstep(-0.1, 0.24, sy);
    const dusk = Math.pow(clamp(1 - Math.abs(sy - 0.03) / 0.3, 0, 1), 1.4);
    env.dayness = day;
    env.night = 1 - smoothstep(-0.12, 0.1, sy);

    const u = this.uniforms;
    u.uZenith.value.copy(NIGHT_ZENITH).lerp(DAY_ZENITH, day).lerp(DUSK_ZENITH, dusk * 0.55);
    u.uHorizon.value.copy(NIGHT_HORIZON).lerp(DAY_HORIZON, day).lerp(DUSK_HORIZON, dusk * 0.72);
    const sunCol = this._sun || (this._sun = C(1, 1, 1));
    sunCol.copy(SUN_LOW).lerp(SUN_HIGH, smoothstep(0.02, 0.42, sy));
    u.uSunDir.value.copy(this.sunDir);
    u.uSunColor.value.copy(sunCol).multiplyScalar(smoothstep(-0.08, 0.02, sy));
    u.uMoonDir.value.copy(this.moonDir);
    u.uStars.value = Math.pow(1 - day, 2.5);
    u.uGlow.value = 0.5 + dusk * 1.2;
    u.uCloudLit.value.copy(u.uHorizon.value).lerp(sunCol, 0.55 * day).multiplyScalar(0.55 + 0.75 * day).addScalar(0.02 + day * 0.18);
    u.uCloudDark.value.copy(u.uZenith.value).lerp(u.uHorizon.value, 0.5).multiplyScalar(0.75);

    // One directional light plays both sun and moon; they swap while both are dark.
    const sunI = smoothstep(-0.04, 0.14, sy) * 3.3;
    const moonI = smoothstep(0.02, 0.2, this.moonDir.y) * (1 - day) * 0.8;
    const useSun = sunI >= moonI;
    env.lightDir.copy(useSun ? this.sunDir : this.moonDir);
    this.light.color.copy(useSun ? sunCol : MOON);
    this.light.intensity = Math.max(sunI, moonI);
    env.sunGlint.copy(useSun ? sunCol : MOON).multiplyScalar(useSun ? smoothstep(-0.02, 0.1, sy) : moonI * 0.9);

    this.hemi.color.setRGB(lerp(0.3, 0.72, day), lerp(0.38, 0.84, day), lerp(0.68, 1.0, day)).lerp(DUSK_HORIZON, dusk * 0.25);
    this.hemi.groundColor.setRGB(lerp(0.12, 0.42, day), lerp(0.13, 0.38, day), lerp(0.2, 0.32, day));
    this.hemi.intensity = lerp(0.85, 1.35, day);

    env.horizon.copy(u.uHorizon.value);
    env.zenith.copy(u.uZenith.value);
    env.fogColor.copy(u.uHorizon.value).lerp(u.uZenith.value, 0.18);
    env.fogNear = lerp(90, 160, day);
    env.fogFar = lerp(1100, 1700, day);
    env.seaDeep.setRGB(lerp(0.004, 0.012, day), lerp(0.016, 0.17, day), lerp(0.04, 0.27, day)).lerp(DUSK_HORIZON, dusk * 0.12);
    env.hillTint.copy(u.uZenith.value).lerp(u.uHorizon.value, 0.45).multiplyScalar(lerp(1.6, 0.92, day));
    env.particleLight = lerp(0.2, 1, day);
    this.scene.fog.color.copy(env.fogColor);
    this.scene.fog.near = env.fogNear;
    this.scene.fog.far = env.fogFar;

    // Shadow frustum follows the player, snapped to shadow texels so edges do not crawl.
    const d = env.lightDir;
    const right = this._a.set(d.z, 0, -d.x).normalize();
    const up = this._b.crossVectors(d, right).normalize();
    const texel = (this.shadowHalf * 2) / this.light.shadow.mapSize.x;
    const fr = Math.round(focus.dot(right) / texel) * texel;
    const fu = Math.round(focus.dot(up) / texel) * texel;
    const fd = focus.dot(d);
    const tgt = this._c.set(0, 0, 0).addScaledVector(right, fr).addScaledVector(up, fu).addScaledVector(d, fd);
    this.light.target.position.copy(tgt);
    this.light.position.copy(tgt).addScaledVector(d, 260);
    this.light.target.updateMatrixWorld();

    if (camera) this.dome.position.copy(camera.position);

    // Refresh the reflection map when the light has shifted noticeably.
    const key = Math.round(day * 14) * 100 + Math.round(dusk * 8);
    if (key !== this.envKey) {
      this.envKey = key;
      const e = this.envUniforms;
      e.uZenith.value.copy(u.uZenith.value);
      e.uHorizon.value.copy(u.uHorizon.value);
      e.uGround.value.setRGB(0.16, 0.16, 0.17).multiplyScalar(0.15 + day * 0.85);
      e.uSunDir.value.copy(env.lightDir);
      e.uSunColor.value.copy(env.sunGlint);
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene, 0.03);
      this.scene.environment = this.envTarget.texture;
      if (old) old.dispose();
    }
  }
}
