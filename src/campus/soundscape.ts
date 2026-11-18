// Campus Quest's own sound: monsoon rain built from thousands of individual drops, Kalki's
// little single-cylinder engine with its tyres and wind, and the night around campus
// (crickets, frogs after rain, dogs, the town's traffic). Everything is synthesised at
// runtime: no audio files to download.
//
// Cost: rain is two pre-rendered stereo loops (rendered once, in slices between frames),
// the engine is a handful of oscillators and filters, the ambience a few scheduled voices.

import * as THREE from 'three';
import type { AudioEngine } from '../audio/audio.ts';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Seeded generator: the rain loops are the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface KartInput {
  on: boolean;
  /** m/s, signed. */
  speed: number;
  throttle: number;
  /** 0..1 how hard Kalki is drifting. */
  drift: number;
  airborne: boolean;
  boosting: boolean;
  surface: string;
  pos: THREE.Vector3;
}

export class CampusSound {
  private a: AudioEngine;
  private ctx: AudioContext;
  private noiseBuf: AudioBuffer | null = null;
  private brownBuf: AudioBuffer | null = null;

  constructor(audio: AudioEngine) {
    this.a = audio;
    this.ctx = audio.ctx;
  }

  private noise(): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const c = this.ctx;
    const len = c.sampleRate * 3;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i += 1) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = b;
    return b;
  }

  private brown(): AudioBuffer {
    if (this.brownBuf) return this.brownBuf;
    const c = this.ctx;
    const len = c.sampleRate * 4;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i += 1) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    this.brownBuf = b;
    return b;
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(0, Math.random() * buf.duration);
    return s;
  }

  private filter(type: BiquadFilterType, freq: number, q = 0.7, gain = 0): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  private gain(v = 0): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  // ================================================================== rain

  private rain: { light: GainNode; heavy: GainNode; out: GainNode } | null = null;
  private rainJob: { light: Float32Array[]; heavy: Float32Array[]; at: number; len: number } | null = null;
  private rainLevel = 0;
  private dripT = 0;

  /**
   * Renders one slice of the two rain loops (called between frames until done, so building them
   * never stalls a frame). Rain is mostly a continuous wash: thousands of tiny drops a second
   * that blur together, over a soft pink-noise hiss shaped like rain (little below 300 Hz, most
   * energy between 1 and 6 kHz). Only a few drops stand out, and only a rare one rings in a
   * puddle. Light: a gentle "shhh" with fine patter. Heavy: a dense roar with a low rumble.
   * Stages: for each loop (light, heavy) and channel (left, right): the bed, then the drops in
   * two halves, so no single slice does too much work.
   */
  private renderRainSlice(): boolean {
    const c = this.ctx;
    const sr = c.sampleRate;
    if (!this.rainJob) {
      // 8 s per loop: long enough that the repeat is not noticeable.
      const len = Math.floor(sr * 8);
      const mk = () => [new Float32Array(len), new Float32Array(len)];
      this.rainJob = { light: mk(), heavy: mk(), at: 0, len };
    }
    const j = this.rainJob;
    const STAGES = 12;
    const stage = j.at++;
    const which = stage < 6 ? 'light' : 'heavy';
    const heavy = which === 'heavy';
    const ch = Math.floor((stage % 6) / 3);
    const part = stage % 3; // 0: bed, 1 and 2: drops
    const d = j[which][ch];
    const len = j.len;
    const r = rng(1000 + stage * 77);
    if (part === 0) {
      // Bed: pink noise (Paul Kellet's filter), high-passed around 300 Hz and softened above
      // ~7 kHz, its loudness drifting slowly as gusts push the rain around.
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      let hp = 0;
      let prev = 0;
      let lp1 = 0;
      let lp2 = 0;
      let rumble = 0;
      let am = 1;
      let amTo = 1;
      const hpK = Math.exp((-2 * Math.PI * 300) / sr);
      const lpK = 1 - Math.exp((-2 * Math.PI * (heavy ? 8000 : 6500)) / sr);
      for (let i = 0; i < len; i += 1) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
        hp = hpK * (hp + pink - prev);
        prev = pink;
        lp1 += (hp - lp1) * lpK;
        lp2 += (lp1 - lp2) * lpK;
        // Gusts: a new target loudness every ~0.7 s, eased towards.
        if (i % Math.floor(sr * 0.7) === 0) amTo = 0.75 + r() * 0.5;
        am += (amTo - am) * 0.00004;
        let v = lp2 * (heavy ? 0.55 : 0.37) * am;
        if (heavy) {
          // The roar of a downpour on roofs and ground: a low, soft rumble.
          rumble += (w - rumble) * 0.008;
          v += rumble * 0.35 * am;
        }
        d[i] += v;
      }
    } else {
      // Drops (half of them in each of the two drop stages). Sizes are heavy-tailed: almost all
      // tiny, so they fuse into patter; a few close ones stand out. Most are a short filtered
      // tick (a drop on a leaf, paving or a roof); a rare one is the soft ring of a drop landing
      // in a puddle.
      const count = Math.floor(((heavy ? 4200 : 1700) * (len / sr)) / 2);
      for (let k = 0; k < count; k += 1) {
        const t0 = Math.floor(r() * len);
        const size = Math.pow(r(), heavy ? 6 : 5);
        const amp = 0.006 + size * (heavy ? 0.09 : 0.14);
        if (r() < (heavy ? 0.985 : 0.96)) {
          // Smaller drops are shorter and brighter; bigger ones a little duller and longer.
          const dur = Math.floor(sr * (0.0008 + size * 0.004 + r() * 0.0015));
          const cut = 0.25 + (1 - size) * 0.5 + r() * 0.2;
          let y = 0;
          let y2 = 0;
          for (let i = 0; i < dur; i += 1) {
            y += ((r() * 2 - 1) - y) * cut;
            y2 += (y - y2) * cut;
            d[(t0 + i) % len] += (y - y2 * 0.6) * amp * Math.exp((-i / dur) * 4);
          }
        } else {
          // A puddle "plip": a quiet damped tone with a slight upward glide.
          const f0 = 900 + r() * 1800;
          const dur = Math.floor(sr * (0.012 + r() * 0.02));
          let ph = 0;
          for (let i = 0; i < dur; i += 1) {
            const u = i / dur;
            ph += (2 * Math.PI * f0 * (1 + 0.15 * u)) / sr;
            d[(t0 + i) % len] += Math.sin(ph) * amp * 0.35 * Math.exp(-u * 5) * Math.min(1, i / 24);
          }
        }
      }
      if (part === 2) {
        // Seam: crossfade the loop ends (the bed is not periodic on its own).
        const fade = Math.floor(sr * 0.08);
        for (let i = 0; i < fade; i += 1) {
          const t = i / fade;
          d[i] = d[i] * t + d[len - fade + i] * (1 - t);
        }
      }
    }
    if (j.at < STAGES) return false;
    // Done: wrap the channels into buffers and start the loops.
    const buf = (pair: Float32Array[]) => {
      const b = c.createBuffer(2, len, sr);
      b.copyToChannel(pair[0] as Float32Array<ArrayBuffer>, 0);
      b.copyToChannel(pair[1] as Float32Array<ArrayBuffer>, 1);
      return b;
    };
    const out = this.gain(1);
    const light = this.gain(0);
    const heavyGain = this.gain(0);
    this.loop(buf(j.light)).connect(light).connect(out);
    this.loop(buf(j.heavy)).connect(heavyGain).connect(out);
    out.connect(this.a.buses.amb);
    this.rain = { light, heavy: heavyGain, out };
    this.rainJob = null;
    return true;
  }

  /**
   * A close drip next to the listener: water running off a roof edge or a leaf onto paving
   * (a soft filtered tap), now and then a heavier drop into a puddle (a low "plop").
   */
  private drip(level: number): void {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const p = c.createStereoPanner();
    p.pan.value = Math.random() * 1.6 - 0.8;
    const g = this.gain(0);
    g.connect(p).connect(this.a.buses.amb);
    const vol = (0.025 + Math.random() * 0.05) * (0.5 + level * 0.5);
    if (Math.random() < 0.8) {
      const s = c.createBufferSource();
      s.buffer = this.noise();
      const f = this.filter('bandpass', 1500 + Math.random() * 3000, 0.9);
      s.connect(f).connect(g);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.02 + Math.random() * 0.02);
      s.start(t, Math.random() * 2, 0.05);
    } else {
      const o = c.createOscillator();
      const f = 450 + Math.random() * 500;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.12, t + 0.035);
      const lp = this.filter('lowpass', 1600, 0.5);
      o.connect(lp).connect(g);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol * 0.6, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      o.start(t);
      o.stop(t + 0.06);
    }
  }
  /** Rain level 0..1 (0 off, 1 monsoon downpour). */
  setRain(level: number, dt: number): void {
    if (!this.a.running) return;
    this.rainLevel = level;
    if (!this.rain) {
      // Rendered a slice per frame from the start (title screen), long before the first storm.
      this.renderRainSlice();
      return;
    }
    const t = this.ctx.currentTime;
    const l = level;
    this.rain.light.gain.setTargetAtTime(smooth(0, 0.3, l) * (1 - 0.55 * smooth(0.45, 1, l)) * 0.9, t, 0.9);
    this.rain.heavy.gain.setTargetAtTime(smooth(0.3, 1, l) * 0.85, t, 0.9);
    if (l > 0.05) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = (0.15 + Math.random() * 0.7) / (0.4 + l);
        this.drip(l);
      }
    }
  }

  // ================================================================== Kalki

  private kart: {
    osc: OscillatorNode; sub: OscillatorNode; gate: OscillatorNode; whine: OscillatorNode;
    tone: BiquadFilterNode; body: GainNode; exhaustAm: GainNode; jitter: GainNode;
    rollGain: GainNode; rollFilter: BiquadFilterNode; gritGain: GainNode;
    squeal: OscillatorNode; squealGain: GainNode; squealNoise: GainNode;
    windGain: GainNode; windFilter: BiquadFilterNode; panner: PannerNode;
  } | null = null;
  private rpm = 1800;
  private popT = 0;
  private lastThrottle = 0;

  /**
   * The exhaust pulse of a small single-cylinder engine as a waveform: strong low harmonics
   * falling off with order, a resonance of the exhaust pipe around the 4th-6th harmonic and
   * a fainter one higher up, with scattered phases (a buzzy, raspy note, not a pure tone).
   */
  private exhaustWave(): PeriodicWave {
    const n = 48;
    const re = new Float32Array(n);
    const im = new Float32Array(n);
    const r = rng(77);
    for (let k = 1; k < n; k += 1) {
      const a = (1 / Math.pow(k, 0.85)) * (1 + 1.3 * Math.exp(-((k - 5) ** 2) / 4) + 0.6 * Math.exp(-((k - 13) ** 2) / 10));
      const ph = r() * Math.PI * 2;
      re[k] = a * Math.cos(ph);
      im[k] = a * Math.sin(ph);
    }
    return this.ctx.createPeriodicWave(re, im);
  }

  private ensureKart(): void {
    if (this.kart) return;
    const c = this.ctx;
    const panner = c.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4;
    panner.rolloffFactor = 1.1;
    panner.connect(this.a.buses.veh);
    const body = this.gain(0);
    // Engine: exhaust-pulse oscillator (firing rate) + a half-rate thump, through a soft clip,
    // the pipe's resonance and a throttle-opened low-pass.
    const osc = c.createOscillator();
    osc.setPeriodicWave(this.exhaustWave());
    const sub = c.createOscillator();
    sub.type = 'sine';
    // Combustion is never perfectly even: brown noise wobbles the firing rate a little.
    const jitter = this.gain(1);
    const wobble = this.loop(this.brown(), 0.6);
    wobble.connect(jitter);
    jitter.connect(osc.frequency);
    const mix = this.gain(1);
    const subG = this.gain(0.35);
    osc.connect(mix);
    sub.connect(subG).connect(mix);
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i += 1) {
      const x = (i / 511) * 2 - 1;
      curve[i] = Math.tanh(x * 2.6) * 0.8;
    }
    shaper.curve = curve;
    const pipe = this.filter('peaking', 420, 1.1, 7);
    const tone = this.filter('lowpass', 1200, 0.9);
    // Exhaust noise, gated by the firing (a square wave at the firing rate modulates it).
    const gate = c.createOscillator();
    gate.type = 'square';
    const exhaustAm = this.gain(0.3);
    const gateDepth = this.gain(0.22);
    gate.connect(gateDepth).connect(exhaustAm.gain);
    const hiss = this.loop(this.noise());
    const hissF = this.filter('bandpass', 1700, 0.8);
    hiss.connect(hissF).connect(exhaustAm).connect(tone);
    // Clutch and chain whine.
    const whine = c.createOscillator();
    whine.type = 'triangle';
    const whineG = this.gain(0.015);
    whine.connect(whineG).connect(body);
    mix.connect(shaper).connect(pipe).connect(tone).connect(body);
    body.connect(panner);
    // Tyres: a rolling hum on paving, grit on gravel and grass; a squeal when drifting.
    const roll = this.loop(this.brown(), 1.6);
    const rollFilter = this.filter('bandpass', 500, 0.6);
    const rollGain = this.gain(0);
    roll.connect(rollFilter).connect(rollGain).connect(panner);
    const grit = this.loop(this.noise(), 0.9);
    const gritF = this.filter('bandpass', 2600, 0.9);
    const gritGain = this.gain(0);
    grit.connect(gritF).connect(gritGain).connect(panner);
    const squeal = c.createOscillator();
    squeal.type = 'sine';
    squeal.frequency.value = 1250;
    const vib = c.createOscillator();
    vib.frequency.value = 7;
    const vibG = this.gain(40);
    vib.connect(vibG).connect(squeal.frequency);
    const squealGain = this.gain(0);
    squeal.connect(squealGain).connect(panner);
    const sqn = this.loop(this.noise(), 1.1);
    const sqnF = this.filter('bandpass', 2300, 3);
    const squealNoise = this.gain(0);
    sqn.connect(sqnF).connect(squealNoise).connect(panner);
    // Wind past the driver's ears (not positional: it is on you).
    const wind = this.loop(this.brown(), 1.3);
    const windFilter = this.filter('lowpass', 400, 0.5);
    const windGain = this.gain(0);
    wind.connect(windFilter).connect(windGain).connect(this.a.buses.veh);
    for (const o of [osc, sub, gate, whine, squeal, vib]) o.start();
    this.kart = { osc, sub, gate, whine, tone, body, exhaustAm, jitter, rollGain, rollFilter, gritGain, squeal, squealGain, squealNoise, windGain, windFilter, panner };
  }

  /** A single backfire pop from the exhaust (off-throttle at high revs). */
  private pop(pos: THREE.Vector3, vol: number): void {
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const p = c.createPanner();
    p.panningModel = 'equalpower';
    p.refDistance = 4;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.a.buses.veh);
    const s = c.createBufferSource();
    s.buffer = this.noise();
    const f = this.filter('lowpass', 900 + Math.random() * 900, 0.8);
    const g = this.gain(0);
    s.connect(f).connect(g).connect(p);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05 + Math.random() * 0.04);
    s.start(t, Math.random() * 2, 0.12);
  }

  /** Per frame while Kalki exists. */
  updateKart(k: KartInput, dt: number): void {
    if (!this.a.running) return;
    if (!this.kart && !k.on) return;
    this.ensureKart();
    const e = this.kart!;
    const t = this.ctx.currentTime;
    const sp = Math.abs(k.speed);
    const kmh = sp * 3.6;
    // Centrifugal clutch: below ~12 km/h the engine revs freely with the throttle; above it
    // the revs follow the wheels (no gears on a kart), plus a little slip under load.
    const idle = 1750;
    const wheelRpm = 2600 + kmh * 105;
    const free = idle + k.throttle * 3600;
    let target = kmh < 12 ? Math.max(free, wheelRpm * smooth(4, 12, kmh)) : wheelRpm + k.throttle * 450;
    if (k.airborne) target = idle + k.throttle * 6500; // wheels off the ground: it screams
    if (k.boosting) target += 900;
    target = Math.min(10500, target);
    if (!k.on) target = 0;
    this.rpm += (target - this.rpm) * Math.min(1, dt * (target > this.rpm ? 7 : 4.5));
    const rpm = Math.max(1, this.rpm);
    const fire = rpm / 60; // two-stroke: one pulse per revolution
    e.osc.frequency.setTargetAtTime(fire, t, 0.02);
    e.sub.frequency.setTargetAtTime(fire / 2, t, 0.02);
    e.gate.frequency.setTargetAtTime(fire, t, 0.02);
    e.whine.frequency.setTargetAtTime(fire * 7.5, t, 0.05);
    e.jitter.gain.setTargetAtTime(fire * 0.04, t, 0.1);
    const load = k.on ? Math.max(k.throttle, k.boosting ? 1 : 0) : 0;
    e.tone.frequency.setTargetAtTime(500 + rpm * 0.18 + load * 2200, t, 0.05);
    e.exhaustAm.gain.setTargetAtTime(0.15 + load * 0.35, t, 0.05);
    const level = k.on ? 0.13 + load * 0.16 + Math.min(0.1, rpm / 80000) : 0;
    e.body.gain.setTargetAtTime(level, t, k.on ? 0.05 : 0.35);
    e.panner.positionX.setTargetAtTime(k.pos.x, t, 0.02);
    e.panner.positionY.setTargetAtTime(k.pos.y + 0.4, t, 0.02);
    e.panner.positionZ.setTargetAtTime(k.pos.z, t, 0.02);
    // Lifting off at high revs: the exhaust crackles for a moment.
    if (k.on && this.lastThrottle > 0.6 && k.throttle < 0.2 && rpm > 5000) this.popT = 0.5;
    this.lastThrottle = k.throttle;
    if (this.popT > 0) {
      this.popT -= dt;
      if (Math.random() < dt * 18) this.pop(k.pos, 0.18 + Math.random() * 0.2);
    }
    // Tyres and wind.
    const grounded = k.airborne ? 0 : 1;
    const loose = k.surface === 'gravel' || k.surface === 'grass' || k.surface === 'mud' || k.surface === 'forest' || k.surface === 'moss';
    const sf = Math.min(1, sp / 16) * grounded;
    e.rollFilter.frequency.setTargetAtTime(250 + sp * 40, t, 0.1);
    e.rollGain.gain.setTargetAtTime(sf * (loose ? 0.12 : 0.22) * (1 + this.rainLevel * 0.6), t, 0.1);
    e.gritGain.gain.setTargetAtTime(sf * (loose ? 0.16 : 0.02 + this.rainLevel * 0.08), t, 0.1);
    const sq = k.drift * smooth(3, 10, sp) * grounded * (loose ? 0.25 : 1) * (1 - this.rainLevel * 0.7);
    e.squealGain.gain.setTargetAtTime(sq * 0.05, t, 0.06);
    e.squealNoise.gain.setTargetAtTime(sq * 0.12 + (loose ? k.drift * sf * 0.12 : 0), t, 0.06);
    e.squeal.frequency.setTargetAtTime(1150 + sp * 9, t, 0.1);
    const w = smooth(4, 22, sp);
    e.windGain.gain.setTargetAtTime(w * w * 0.25 * (k.on ? 1 : 0), t, 0.2);
    e.windFilter.frequency.setTargetAtTime(300 + sp * 45, t, 0.2);
  }

  // ================================================================== night ambience

  private amb: { crickets: GainNode; town: GainNode } | null = null;
  private voices: { pan: StereoPannerNode; g: GainNode; o: OscillatorNode; next: number; rate: number }[] = [];
  private frogT = 3;
  private dogT = 20;
  private hornT = 30;

  private ensureAmbience(): void {
    if (this.amb) return;
    const c = this.ctx;
    // A field of distant crickets: narrow-band noise around 4.5 kHz, trilled.
    const n = this.loop(this.noise());
    const bp = this.filter('bandpass', 4600, 9);
    const trill = this.gain(0.5);
    const lfo = c.createOscillator();
    lfo.frequency.value = 27;
    const lfoG = this.gain(0.5);
    lfo.connect(lfoG).connect(trill.gain);
    lfo.start();
    const crickets = this.gain(0);
    n.connect(bp).connect(trill).connect(crickets).connect(this.a.buses.amb);
    // The town beyond the wall: a low, steady traffic rumble.
    const town = this.gain(0);
    this.loop(this.brown(), 0.7).connect(this.filter('lowpass', 220, 0.5)).connect(town).connect(this.a.buses.amb);
    // A few nearby crickets, each its own voice (pulsed chirps, scheduled ahead).
    for (let i = 0; i < 4; i += 1) {
      const o = c.createOscillator();
      o.frequency.value = 4100 + Math.random() * 900;
      const g = this.gain(0);
      const pan = c.createStereoPanner();
      pan.pan.value = Math.random() * 1.8 - 0.9;
      o.connect(g).connect(pan).connect(this.a.buses.amb);
      o.start();
      this.voices.push({ pan, g, o, next: c.currentTime + Math.random() * 2, rate: 0.35 + Math.random() * 0.4 });
    }
    this.amb = { crickets, town };
  }

  private oneShot(build: (out: GainNode, t: number) => void, pan: number, vol: number, far: boolean): void {
    const c = this.ctx;
    const t = c.currentTime + 0.02;
    const out = this.gain(vol);
    const p = c.createStereoPanner();
    p.pan.value = pan;
    const lp = this.filter('lowpass', far ? 1400 : 4000, 0.6);
    out.connect(lp).connect(p).connect(this.a.buses.amb);
    out.connect(this.a.buses.reverb);
    build(out, t);
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private frog(): void {
    // Monsoon frog: a few rough, nasal croaks.
    const n = 2 + Math.floor(Math.random() * 4);
    const f = 170 + Math.random() * 90;
    this.oneShot((out, t) => {
      for (let i = 0; i < n; i += 1) {
        const at = t + i * (0.16 + Math.random() * 0.05);
        this.tone(out, at, 'sawtooth', f, f * 0.92, 0.09, 0.5);
        this.tone(out, at, 'square', f * 2.02, f * 1.9, 0.07, 0.12);
      }
    }, Math.random() * 1.6 - 0.8, 0.05, true);
  }

  private dog(): void {
    const n = 2 + Math.floor(Math.random() * 3);
    this.oneShot((out, t) => {
      for (let i = 0; i < n; i += 1) {
        const at = t + i * (0.32 + Math.random() * 0.2);
        this.tone(out, at, 'sawtooth', 560, 360, 0.14, 0.5);
        const s = this.ctx.createBufferSource();
        s.buffer = this.noise();
        const g = this.gain(0);
        s.connect(this.filter('bandpass', 900, 1)).connect(g).connect(out);
        g.gain.setValueAtTime(0.4, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
        s.start(at, Math.random() * 2, 0.15);
      }
    }, Math.random() * 1.6 - 0.8, 0.045, true);
  }

  private horn(): void {
    // A distant two-tone horn on the Lamachaur road.
    const f = 380 + Math.random() * 120;
    const dur = 0.25 + Math.random() * 0.5;
    this.oneShot((out, t) => {
      this.tone(out, t, 'square', f, f, dur, 0.3);
      this.tone(out, t, 'square', f * 1.26, f * 1.26, dur, 0.22);
    }, Math.random() * 1.4 - 0.7, 0.02, true);
  }

  /**
   * Per frame. `night` 0..1 (dark), `wet` 0..1 (rain or wet ground), `active` when playing
   * (the title screen keeps just the town and the wind).
   */
  updateAmbience(dt: number, night: number, rain: number, wet: number, active: boolean): void {
    if (!this.a.running) return;
    this.ensureAmbience();
    const c = this.ctx;
    const t = c.currentTime;
    const a = this.amb!;
    // Crickets go quiet in heavy rain and come back as it eases.
    const cr = smooth(0.35, 0.8, night) * (1 - smooth(0.2, 0.7, rain)) * (active ? 1 : 0.3);
    a.crickets.gain.setTargetAtTime(cr * 0.035, t, 1.5);
    // Kept faint: louder, it reads as a car idling next to you rather than a far-off town.
    a.town.gain.setTargetAtTime(0.012 + 0.01 * (1 - night), t, 2);
    for (const v of this.voices) {
      if (cr < 0.05) {
        v.next = Math.max(v.next, t);
        continue;
      }
      while (v.next < t + 0.6) {
        // A chirp: three or four quick pulses, then a pause.
        const pulses = 3 + Math.floor(Math.random() * 2);
        for (let i = 0; i < pulses; i += 1) {
          const at = Math.max(t, v.next) + i * 0.034;
          v.g.gain.setValueAtTime(0, at);
          v.g.gain.linearRampToValueAtTime(0.012 * cr, at + 0.006);
          v.g.gain.linearRampToValueAtTime(0, at + 0.022);
        }
        v.next = Math.max(t, v.next) + v.rate * (0.85 + Math.random() * 0.3);
      }
    }
    if (!active) return;
    this.frogT -= dt;
    if (this.frogT <= 0) {
      this.frogT = 1.5 + Math.random() * 5;
      if (night > 0.5 && wet > 0.2) this.frog();
    }
    this.dogT -= dt;
    if (this.dogT <= 0) {
      this.dogT = 25 + Math.random() * 45;
      if (night > 0.4) this.dog();
    }
    this.hornT -= dt;
    if (this.hornT <= 0) {
      this.hornT = 20 + Math.random() * 50;
      this.horn();
    }
  }
}
