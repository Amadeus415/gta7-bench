// All sound is synthesised with WebAudio. The context starts on the first key
// press or click, since browsers block audio before a user gesture.

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(ctx.destination);

    // white noise buffer shared by several voices
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine: two detuned oscillators through a lowpass
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 600;
    this.engFilter.Q.value = 3;
    this.eng1 = ctx.createOscillator();
    this.eng1.type = 'sawtooth';
    this.eng2 = ctx.createOscillator();
    this.eng2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.eng1.connect(this.engFilter);
    this.eng2.connect(g2).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.eng1.start();
    this.eng2.start();

    // tyre screech: band-passed noise
    this.skid = this.loopNoise('bandpass', 1800, 6);
    // wind/road roar
    this.roar = this.loopNoise('lowpass', 400, 0.7);
    // city ambience: soft brown-ish rumble
    this.amb = this.loopNoise('lowpass', 220, 0.5);
    this.amb.gain.gain.value = 0.05;
    // waves near the harbour
    this.waves = this.loopNoise('lowpass', 700, 0.4);

    // siren
    this.sirGain = ctx.createGain();
    this.sirGain.gain.value = 0;
    this.sir = ctx.createOscillator();
    this.sir.type = 'square';
    const sirF = ctx.createBiquadFilter();
    sirF.type = 'lowpass';
    sirF.frequency.value = 1600;
    this.sir.connect(sirF).connect(this.sirGain).connect(this.master);
    this.sir.start();
  }

  loopNoise(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(f).connect(gain).connect(this.master);
    src.start();
    return { src, filter: f, gain };
  }

  set(param, v, t = 0.08) {
    param.setTargetAtTime(v, this.ctx.currentTime, t);
  }

  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (s.inCar) {
      // fake gearbox: rpm climbs then drops at each shift
      const sp = Math.abs(s.speed);
      const gears = [0, 7, 14, 23, 33, 46, 80];
      let g = 1;
      while (g < gears.length - 1 && sp > gears[g]) g++;
      const lo = gears[g - 1], hi = gears[g];
      const rpm = 0.25 + 0.75 * ((sp - lo) / (hi - lo));
      const f = 38 + rpm * 85 + s.throttle * 12;
      this.set(this.eng1.frequency, f, 0.05);
      this.set(this.eng2.frequency, f * 0.502, 0.05);
      this.set(this.engFilter.frequency, 300 + rpm * 900 + s.throttle * 700, 0.05);
      this.set(this.engGain.gain, 0.09 + s.throttle * 0.08, 0.1);
      this.set(this.skid.gain.gain, Math.min(0.22, Math.max(0, s.slip - 2.5) * 0.03), 0.05);
      this.set(this.roar.gain.gain, Math.min(0.12, sp * 0.003), 0.2);
    } else {
      this.set(this.engGain.gain, 0, 0.15);
      this.set(this.skid.gain.gain, 0, 0.05);
      this.set(this.roar.gain.gain, 0, 0.2);
    }
    this.set(this.waves.gain.gain, s.harbor * 0.12, 0.5);
    this.set(this.amb.gain.gain, 0.04 + (1 - s.harbor) * 0.03, 0.5);
    // siren: two-tone wail
    if (s.siren > 0) {
      const w = Math.sin(t * 5.5) > 0 ? 720 : 960;
      this.set(this.sir.frequency, w, 0.04);
      this.set(this.sirGain.gain, s.siren * 0.05, 0.1);
    } else this.set(this.sirGain.gain, 0, 0.2);
    this.master.gain.value = this.muted ? 0 : 0.5;
  }

  burst(dur, freq, vol, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  tone(freq, dur, vol = 0.15, type = 'sine', when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  crash(strength) { this.burst(0.35 + strength * 0.02, 900, Math.min(0.9, 0.15 + strength * 0.05)); this.tone(70, 0.25, Math.min(0.4, strength * 0.03), 'triangle'); }
  thud() { this.burst(0.15, 300, 0.4); }
  door() { this.burst(0.08, 1200, 0.25); this.tone(140, 0.1, 0.1, 'square'); }
  step() { this.burst(0.05, 2500, 0.05, 'highpass'); }
  horn() { this.tone(392, 0.35, 0.12, 'square'); this.tone(330, 0.35, 0.12, 'square'); }
  chime() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 0.12, 'triangle', i * 0.09)); }
  fail() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 0.12, 'sawtooth', i * 0.14)); }
  splash() { this.burst(0.9, 1200, 0.6); }
  cash() { [1319, 1568].forEach((f, i) => this.tone(f, 0.12, 0.1, 'square', i * 0.07)); }
}
