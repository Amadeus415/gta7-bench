// Procedural audio: engine hum, chimes, footsteps, impacts. No assets.
export class SoundFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.ready = false;
  }

  ensure() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);

      // engine: sawtooth -> lowpass -> gain
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 55;
      this.engineFilter = this.ctx.createBiquadFilter();
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 420;
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
      this.engineOsc.start();
      this.ready = true;
    } catch (e) { /* audio unavailable */ }
  }

  resume() {
    this.ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setEngine(speedNorm, inCar) {
    if (!this.ready) return;
    try {
      const t = this.ctx.currentTime;
      if (!inCar) { this.engineGain.gain.setTargetAtTime(0, t, 0.1); return; }
      this.engineOsc.frequency.setTargetAtTime(52 + speedNorm * 175, t, 0.06);
      this.engineFilter.frequency.setTargetAtTime(320 + speedNorm * 900, t, 0.08);
      this.engineGain.gain.setTargetAtTime(0.05 + speedNorm * 0.05, t, 0.09);
    } catch (e) {}
  }

  chime(kind = 1) {
    this.resume();
    if (!this.ready) return;
    try {
      const t = this.ctx.currentTime;
      const notes = kind === 1 ? [740, 988] : [660, 880, 1320];
      notes.forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t + i * 0.09);
        g.gain.linearRampToValueAtTime(0.22, t + i * 0.09 + 0.03);
        g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.55);
        o.connect(g).connect(this.master);
        o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.6);
      });
    } catch (e) {}
  }

  jump() { this.blip('sine', 420, 640, 0.12, 0.12); }
  enter() { this.blip('triangle', 300, 200, 0.16, 0.18); }
  exit() { this.blip('triangle', 220, 340, 0.16, 0.18); }

  thud(strength = 0.5) {
    this.resume();
    if (!this.ready) return;
    try {
      const t = this.ctx.currentTime;
      const len = 0.18;
      const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * len), this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      }
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.4 * strength, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 320 + strength * 240;
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
    } catch (e) {}
  }

  footstep(phase, moveAmount) {
    // subtle tick when the swing passes zero
    if (moveAmount < 0.15 || !this.ready) return;
    try {
      const prev = this._lastStepPhase ?? 0;
      const now = phase;
      const prevSin = Math.sin(prev), nowSin = Math.sin(now);
      if (prevSin * nowSin < 0) {
        const t = this.ctx.currentTime;
        const buf = this.ctx.createBuffer(1, 220, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.5);
        const src = this.ctx.createBufferSource(); src.buffer = buf;
        const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 480;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.08, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        src.connect(f).connect(g).connect(this.master);
        src.start(t);
      }
      this._lastStepPhase = now;
    } catch (e) {}
  }

  blip(type, f0, f1, dur, vol) {
    this.resume();
    if (!this.ready) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (e) {}
  }
}
