// A small HDR pipeline: render the scene to a float target, pull out the
// bright parts, blur them at three sizes, and add them back as bloom before
// tone mapping. Falls back to plain rendering if the GPU cannot do it.
import * as THREE from '../vendor/three.module.js';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
    this.bright = mat(/* glsl */ `
      uniform sampler2D tSrc; uniform float uThreshold; varying vec2 vUv;
      void main(){
        vec3 c = min(texture2D(tSrc, vUv).rgb, vec3(24.0));
        float l = max(c.r, max(c.g, c.b));
        gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 1.2, l), 1.0);
      }`, { tSrc: { value: null }, uThreshold: { value: 1.2 } });
    this.blur = mat(/* glsl */ `
      uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
      void main(){
        vec3 c = texture2D(tSrc, vUv).rgb * 0.227027;
        c += (texture2D(tSrc, vUv + uDir * 1.384615).rgb + texture2D(tSrc, vUv - uDir * 1.384615).rgb) * 0.316216;
        c += (texture2D(tSrc, vUv + uDir * 3.230769).rgb + texture2D(tSrc, vUv - uDir * 3.230769).rgb) * 0.070270;
        gl_FragColor = vec4(c, 1.0);
      }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.composite = new THREE.ShaderMaterial({
      vertexShader: VERT, depthTest: false, depthWrite: false,
      uniforms: { tScene: { value: null }, tB0: { value: null }, tB1: { value: null }, tB2: { value: null }, uBloom: { value: 0.5 }, uVignette: { value: 0.55 } },
      fragmentShader: /* glsl */ `
        uniform sampler2D tScene, tB0, tB1, tB2; uniform float uBloom, uVignette; varying vec2 vUv;
        void main(){
          vec3 col = texture2D(tScene, vUv).rgb;
          vec3 bloom = texture2D(tB0, vUv).rgb * 0.55 + texture2D(tB1, vUv).rgb * 0.8 + texture2D(tB2, vUv).rgb;
          col += bloom * uBloom;
          vec2 q = vUv - 0.5;
          col *= 1.0 - dot(q, q) * uVignette;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.size = new THREE.Vector2();
    try {
      this.build();
    } catch (e) {
      this.enabled = false;
    }
  }

  build() {
    const r = this.renderer;
    r.getDrawingBufferSize(this.size);
    const w = Math.max(2, this.size.x), h = Math.max(2, this.size.y);
    this.dispose();
    const opts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { ...opts, depthBuffer: true, samples: 4 });
    this.mips = [2, 4, 8].map((d) => {
      const mw = Math.max(2, Math.round(w / d)), mh = Math.max(2, Math.round(h / d));
      return { a: new THREE.WebGLRenderTarget(mw, mh, opts), b: new THREE.WebGLRenderTarget(mw, mh, opts), w: mw, h: mh };
    });
  }

  dispose() {
    if (this.sceneRT) this.sceneRT.dispose();
    if (this.mips) for (const m of this.mips) { m.a.dispose(); m.b.dispose(); }
  }

  resize() {
    if (this.enabled) this.build();
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.camera);
  }

  /** `night` (0..1) makes lights bloom harder after dark. */
  render(scene, camera, night) {
    const r = this.renderer;
    if (!this.enabled) { r.setRenderTarget(null); r.render(scene, camera); return; }
    r.setRenderTarget(this.sceneRT);
    r.render(scene, camera);
    this.bright.uniforms.tSrc.value = this.sceneRT.texture;
    this.bright.uniforms.uThreshold.value = 2.1 - night * 1.25;
    this.pass(this.bright, this.mips[0].a);
    for (let i = 0; i < this.mips.length; i++) {
      const m = this.mips[i];
      if (i > 0) {
        // carry the previous level down, blurring as it goes
        this.blur.uniforms.tSrc.value = this.mips[i - 1].a.texture;
        this.blur.uniforms.uDir.value.set(0.5 / m.w, 0.5 / m.h);
        this.pass(this.blur, m.a);
      }
      this.blur.uniforms.tSrc.value = m.a.texture;
      this.blur.uniforms.uDir.value.set(1 / m.w, 0);
      this.pass(this.blur, m.b);
      this.blur.uniforms.tSrc.value = m.b.texture;
      this.blur.uniforms.uDir.value.set(0, 1 / m.h);
      this.pass(this.blur, m.a);
    }
    const u = this.composite.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tB0.value = this.mips[0].a.texture; u.tB1.value = this.mips[1].a.texture; u.tB2.value = this.mips[2].a.texture;
    u.uBloom.value = 0.3 + night * 0.5;
    this.pass(this.composite, null);
  }
}
