// All sound is synthesised with the Web Audio API: engine, tyres, impacts,
// footsteps, sirens, ambience, and a small generative radio for the cars.
import { clamp, makeRng } from './util.js';

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

const STATIONS = [
  { name: 'Neon Coast 88.4', tag: 'synthwave for the coast road', bpm: 104, style: 'synth', prog: [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M']] },
  { name: 'Harbor Lo-Fi 94.7', tag: 'slow beats, salt air', bpm: 78, style: 'lofi', prog: [[50, 'm7'], [43, '7'], [48, 'M7'], [45, 'm7']] },
  { name: 'Pier Funk 101.3', tag: 'boardwalk grooves', bpm: 112, style: 'funk', prog: [[40, 'm7'], [40, 'm7'], [45, '7'], [43, '7']] },
  { name: 'Radio off', tag: '', style: null },
];
const CHORDS = { M: [0, 4, 7, 12], m: [0, 3, 7, 12], M7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10] };

export class GameAudio {
  constructor() {
    this.ok = false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.build();
      this.ok = true;
    } catch (e) {
      this.ok = false;
    }
    this.station = 0;
    this.inCar = false;
    this.beat = 0;
    this.nextTime = 0;
    this.stationName = STATIONS[0].name;
  }

  resume() {
    if (this.ok && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  build() {
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(c.destination);

    // two seconds of white noise shared by everything hissy
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = (filterType, freq, q = 1) => {
      const src = c.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = c.createBiquadFilter();
      f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      return { f, g };
    };
    this.skid = loop('bandpass', 1700, 3.5);
    this.wind = loop('lowpass', 500);
    this.city = loop('lowpass', 170);
    this.sea = loop('lowpass', 620);
    this.seaLfo = c.createOscillator();
    this.seaLfo.frequency.value = 0.13;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.012;
    this.seaLfo.connect(lfoGain); lfoGain.connect(this.sea.g.gain);
    this.seaLfo.start();

    // engine: three oscillators through a low-pass that opens with revs
    this.engFilter = c.createBiquadFilter();
    this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 400;
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master);
    this.eng = [['sawtooth', 1, 0.5], ['square', 0.5, 0.35], ['sawtooth', 2.01, 0.16]].map(([type, mult, vol]) => {
      const o = c.createOscillator();
      o.type = type;
      const g = c.createGain();
      g.gain.value = vol;
      o.connect(g); g.connect(this.engFilter);
      o.start();
      return { o, mult };
    });

    // siren and horn
    this.sirenOsc = c.createOscillator();
    this.sirenOsc.type = 'square';
    this.sirenGain = c.createGain();
    this.sirenGain.gain.value = 0;
    const sf = c.createBiquadFilter();
    sf.type = 'lowpass'; sf.frequency.value = 2200;
    this.sirenOsc.connect(sf); sf.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.hornGain = c.createGain();
    this.hornGain.gain.value = 0;
    const hf = c.createBiquadFilter();
    hf.type = 'lowpass'; hf.frequency.value = 1800;
    for (const f of [392, 494]) {
      const o = c.createOscillator();
      o.type = 'square'; o.frequency.value = f;
      o.connect(hf); o.start();
    }
    hf.connect(this.hornGain); this.hornGain.connect(this.master);

    // radio bus with a tempo delay
    this.radio = c.createGain();
    this.radio.gain.value = 0;
    this.radioTone = c.createBiquadFilter();
    this.radioTone.type = 'lowpass'; this.radioTone.frequency.value = 6500;
    this.delay = c.createDelay(1);
    this.delay.delayTime.value = 0.29;
    const fb = c.createGain();
    fb.gain.value = 0.3;
    this.delaySend = c.createGain();
    this.delaySend.gain.value = 0.35;
    this.delaySend.connect(this.delay); this.delay.connect(fb); fb.connect(this.delay); this.delay.connect(this.radio);
    this.radio.connect(this.radioTone); this.radioTone.connect(this.master);
  }

  // ------------------------------------------------------------ one-shots

  blip(freq, dur, type = 'sine', vol = 0.15, when = 0, dest = null, slideTo = null) {
    // exponential ramps cannot start from or reach zero, so silent sounds are skipped
    if (!this.ok || this.ctx.state !== 'running' || !(vol > 0.0005) || !(freq > 1)) return;
    const c = this.ctx, t = c.currentTime + when;
    const o = c.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo > 1) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.master);
    o.start(t); o.stop(t + dur + 0.05);
    return g;
  }

  burst(dur, vol, type = 'lowpass', freq = 900, when = 0, dest = null, q = 1) {
    if (!this.ok || this.ctx.state !== 'running' || !(vol > 0.0005)) return;
    const c = this.ctx, t = c.currentTime + when;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest || this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  crash(strength) {
    const v = clamp(strength / 22, 0.05, 0.6);
    this.burst(0.3 + v * 0.3, v, 'lowpass', 1100);
    this.blip(90, 0.22, 'sine', v * 0.9, 0, null, 40);
    if (strength > 9) this.burst(0.5, v * 0.35, 'highpass', 3200, 0.03);
  }
  thud(v = 0.2) { this.burst(0.12, v, 'lowpass', 500); this.blip(120, 0.1, 'sine', v, 0, null, 60); }
  step(speed) { this.burst(0.05, 0.035 + speed * 0.006, 'bandpass', 700 + Math.random() * 500, 0, null, 1.2); }
  jump() { this.blip(260, 0.12, 'sine', 0.05, 0, null, 420); }
  land(v) { this.thud(clamp(v * 0.02, 0.05, 0.25)); }
  door() { this.burst(0.07, 0.2, 'lowpass', 800); this.blip(140, 0.08, 'square', 0.06); }
  splash() { this.burst(0.9, 0.5, 'bandpass', 1300, 0, null, 0.6); this.burst(0.5, 0.3, 'lowpass', 400); }
  coin() { [1320, 1760, 2640].forEach((f, i) => this.blip(f, 0.16, 'triangle', 0.09, i * 0.06)); }
  good() { [523, 659, 784, 1047].forEach((f, i) => this.blip(f, 0.3, 'triangle', 0.12, i * 0.09)); }
  bad() { [330, 262, 196].forEach((f, i) => this.blip(f, 0.32, 'sawtooth', 0.07, i * 0.14)); }
  tick() { this.blip(1500, 0.05, 'square', 0.04); }
  checkpoint() { this.blip(880, 0.12, 'triangle', 0.12); this.blip(1320, 0.2, 'triangle', 0.12, 0.08); }
  honk(distance) {
    const v = clamp(1 - distance / 70, 0, 1) * 0.07;
    if (v > 0.004) { const p = 0.92 + Math.random() * 0.2; this.blip(392 * p, 0.34, 'square', v); this.blip(494 * p, 0.34, 'square', v); }
  }

  // ------------------------------------------------------------ continuous

  /**
   * Called every frame with the state of the world as the player hears it.
   * s: { driving, rpm, throttle, speed, slip, horn, siren (0..1), night, sea (0..1), dt }
   */
  update(s) {
    if (!this.ok || this.ctx.state !== 'running') return;
    const c = this.ctx, t = c.currentTime;
    const set = (param, v, k = 0.06) => { if (Number.isFinite(v)) param.setTargetAtTime(v, t, k); };
    const f = 48 + s.rpm * 150;
    for (const e of this.eng) set(e.o.frequency, f * e.mult, 0.04);
    set(this.engFilter.frequency, 260 + s.rpm * 2200 + s.throttle * 900);
    set(this.engGain.gain, s.driving ? 0.035 + s.throttle * 0.07 + s.rpm * 0.03 : 0, 0.08);
    set(this.skid.g.gain, clamp((s.slip - 2.2) / 9, 0, 1) * 0.16);
    set(this.skid.f.frequency, 1500 + Math.min(s.slip, 12) * 60);
    set(this.wind.g.gain, clamp(s.speed / 55, 0, 1) ** 2 * 0.14 + 0.012);
    set(this.city.g.gain, 0.05 * (1 - s.night * 0.5), 0.5);
    set(this.sea.g.gain, 0.014 + s.sea * 0.05, 0.4);
    set(this.hornGain.gain, s.horn ? 0.07 : 0, 0.012);
    set(this.sirenGain.gain, s.siren * 0.045, 0.1);
    this.sirenOsc.frequency.setValueAtTime(760 + Math.sin(t * 3.4) * 280, t);
    this.inCar = s.driving;
    set(this.radio.gain, s.driving && STATIONS[this.station].style ? 0.5 : 0, 0.15);
    this.ambience(s);
    this.pumpRadio();
  }

  ambience(s) {
    this.ambT = (this.ambT ?? 2) - s.dt;
    if (this.ambT > 0) return;
    if (s.night > 0.6) {
      // crickets
      this.ambT = 0.5 + Math.random() * 1.4;
      for (let i = 0; i < 5; i++) this.blip(4300 + Math.random() * 300, 0.035, 'sine', 0.008, i * 0.06);
    } else if (s.sea > 0.3) {
      // gulls
      this.ambT = 3 + Math.random() * 7;
      const base = 1500 + Math.random() * 500;
      for (let i = 0; i < 3; i++) this.blip(base, 0.22, 'triangle', 0.016, i * 0.3, null, base * 0.62);
    } else {
      // small birds
      this.ambT = 1.5 + Math.random() * 5;
      const base = 2600 + Math.random() * 1400;
      for (let i = 0; i < 3; i++) this.blip(base, 0.07, 'sine', 0.012, i * 0.1, null, base * 1.25);
    }
  }

  // ----------------------------------------------------------------- radio

  nextStation() {
    this.station = (this.station + 1) % STATIONS.length;
    this.beat = 0;
    this.nextTime = 0;
    this.stationName = STATIONS[this.station].name;
    this.burst(0.18, 0.08, 'bandpass', 2400, 0, null, 0.7);
    return STATIONS[this.station];
  }

  pumpRadio() {
    const st = STATIONS[this.station];
    if (!st.style || !this.inCar) { this.nextTime = 0; return; }
    const c = this.ctx;
    const sixteenth = 60 / st.bpm / 4;
    if (this.nextTime < c.currentTime) this.nextTime = c.currentTime + 0.05;
    this.delay.delayTime.value = sixteenth * 3;
    while (this.nextTime < c.currentTime + 0.18) {
      this.playStep(st, this.beat, this.nextTime - c.currentTime, sixteenth);
      this.beat++;
      const swing = st.style === 'lofi' && this.beat % 2 === 1 ? 1.24 : st.style === 'lofi' ? 0.76 : 1;
      this.nextTime += sixteenth * swing;
    }
  }

  playStep(st, step, when, six) {
    const s = step % 16, bar = Math.floor(step / 16);
    const [root, kind] = st.prog[bar % st.prog.length];
    const chord = CHORDS[kind];
    const R = makeRng(bar * 131 + s * 7 + this.station * 1000);
    const out = this.radio, wet = this.delaySend;
    const kick = () => this.blip(150, 0.2, 'sine', 0.5, when, out, 42);
    const snare = (v = 0.2) => { this.burst(0.14, v, 'highpass', 1600, when, out); this.blip(190, 0.08, 'triangle', v * 0.6, when, out); };
    const hat = (v = 0.05, d = 0.035) => this.burst(d, v, 'highpass', 7500, when, out);
    const bass = (note, d) => {
      const g = this.blip(midi(note), d, 'sawtooth', 0.2, when, null);
      if (!g) return;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 520;
      g.disconnect(); g.connect(f); f.connect(out);
    };
    if (st.style === 'synth') {
      if (s % 4 === 0) kick();
      if (s === 4 || s === 12) snare(0.22);
      if (s % 2 === 0) hat(s % 4 === 2 ? 0.07 : 0.035);
      if (s % 2 === 0) bass(root - 12 + (s % 8 === 6 ? 12 : 0), six * 1.7);
      const arp = chord[[0, 1, 2, 3, 2, 1, 2, 3][s % 8]] + 24;
      this.blip(midi(root + arp), six * 1.4, 'square', 0.035, when, wet);
      this.blip(midi(root + arp), six * 1.2, 'triangle', 0.05, when, out);
      if (s === 0) for (const n of chord.slice(0, 3)) { this.blip(midi(root + 12 + n), six * 15, 'sawtooth', 0.022, when, out); this.blip(midi(root + 12 + n) * 1.006, six * 15, 'sawtooth', 0.02, when, out); }
      if (bar % 4 >= 2 && [0, 3, 6, 10, 12].includes(s)) {
        const scale = [0, 3, 5, 7, 10, 12, 15];
        this.blip(midi(57 + 12 + scale[R.int(0, 6)]), six * 2.6, 'sawtooth', 0.04, when, wet);
      }
    } else if (st.style === 'lofi') {
      if (s === 0 || s === 7 || s === 10) kick();
      if (s === 4 || s === 12) snare(0.12);
      if (s % 2 === 0) hat(0.03, 0.05);
      if (s === 0 || s === 8 || s === 11) bass(root - 12, six * 3);
      if (s === 0 || s === 6) for (const n of chord) { this.blip(midi(root + 12 + n), six * 6, 'sine', 0.05, when, out); this.blip(midi(root + 12 + n) * 2, six * 3, 'triangle', 0.012, when, wet); }
      if ([2, 5, 9, 13, 14].includes(s) && R.chance(0.6)) {
        const scale = [0, 2, 4, 7, 9, 12, 14];
        this.blip(midi(60 + 12 + scale[R.int(0, 6)]), six * 3, 'triangle', 0.045, when, wet);
      }
      if (s % 4 === 1) this.burst(0.02, 0.012, 'highpass', 5000, when + R() * 0.1, out);
    } else {
      if (s === 0 || s === 6 || s === 10) kick();
      if (s === 4 || s === 12) snare(0.2);
      hat(s % 4 === 2 ? 0.07 : 0.03, s % 4 === 2 ? 0.09 : 0.03);
      const line = [0, null, 0, 12, null, 10, null, 7, 0, null, 12, null, 10, 7, null, 3][s];
      if (line !== null) bass(root - 12 + line, six * 1.1);
      if ([2, 5, 8, 11, 14].includes(s)) for (const n of chord.slice(1)) this.blip(midi(root + 12 + n), six * 0.9, 'square', 0.022, when, out);
      if (bar % 2 === 1 && [0, 3, 6, 8, 11].includes(s)) {
        const scale = [0, 3, 5, 7, 10, 12];
        this.blip(midi(64 + 12 + scale[R.int(0, 5)]), six * 1.8, 'triangle', 0.05, when, wet);
      }
    }
  }
}
