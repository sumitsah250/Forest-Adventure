// Procedural sound: everything is synthesised with WebAudio at runtime, so the
// mix is consistent and there are no licensing questions. Positional sources use
// HRTF panners with distance attenuation.

import * as THREE from 'three';
import type { SfxApi } from '../game/mystery.ts';
import type { GunSound } from '../weapons/defs.ts';

export type GunMech =
  | 'magOut' | 'magIn' | 'slideRack' | 'slideRelease' | 'dry' | 'pumpBack' | 'pumpForward'
  | 'boltOpen' | 'boltClose' | 'cylinderOpen' | 'cylinderClose' | 'shellIn' | 'roundIn' | 'speedloader'
  | 'draw' | 'holster' | 'pickup' | 'ammo' | 'eject';

type Surface = 'gravel' | 'mud' | 'forest' | 'moss' | 'rock' | 'water' | 'grass' | 'wood' | 'metal';

export class AudioEngine implements SfxApi {
  readonly ctx: AudioContext;
  private master: GainNode;
  private sfx: GainNode;
  private amb: GainNode;
  private veh: GainNode;
  private guns: GainNode;
  private echo: DelayNode;
  private reverb: ConvolverNode;
  private reverbSend: GainNode;
  private white: AudioBuffer;
  private pink: AudioBuffer;
  private brown: AudioBuffer;
  private started = false;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rustleGain!: GainNode;
  private creek: { panner: PannerNode; gain: GainNode }[] = [];
  private loops = new Map<string, { stop: () => void }>();
  private engine: { osc: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode; noiseGain: GainNode; panner: PannerNode; tyreGain: GainNode; tyreFilter: BiquadFilterNode } | null = null;
  private birdTimer = 3;
  private peckTimer = 25;
  private owlTimer = 40;
  dusk = 0;
  private listenerPos = new THREE.Vector3();
  private volume = 0.8;

  constructor() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain();
    this.amb = c.createGain();
    this.veh = c.createGain();
    this.guns = c.createGain();
    this.guns.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.veh.connect(this.master);
    this.guns.connect(this.master);
    // Echo off the valley walls: a darkened, decaying repeat for gunshots.
    this.echo = c.createDelay(1.5);
    this.echo.delayTime.value = 0.38;
    const echoFb = c.createGain();
    echoFb.gain.value = 0.32;
    const echoLp = c.createBiquadFilter();
    echoLp.type = 'lowpass';
    echoLp.frequency.value = 1100;
    const echoOut = c.createGain();
    echoOut.gain.value = 0.45;
    this.echo.connect(echoLp).connect(echoFb).connect(this.echo);
    echoLp.connect(echoOut).connect(this.master);
    this.amb.gain.value = 0.9;
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(2.4, 2.8);
    this.reverbSend = c.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.white = this.noise('white', 2);
    this.pink = this.noise('pink', 4);
    this.brown = this.noise('brown', 4);
    this.setVolume(0.8);
  }

  setVolume(v: number): void {
    this.volume = v;
    this.master.gain.value = v * 0.9;
  }

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => undefined);
    if (this.started) return;
    this.started = true;
    this.startAmbience();
  }

  suspend(on: boolean): void {
    if (on) this.ctx.suspend().catch(() => undefined);
    else this.ctx.resume().catch(() => undefined);
  }

  // ------------------------------------------------------------ buffers

  private noise(kind: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i += 1) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the ends so loops are seamless.
    const fade = Math.floor(c.sampleRate * 0.05);
    for (let i = 0; i < fade; i += 1) {
      const t = i / fade;
      d[i] = d[i] * t + d[len - fade + i] * (1 - t);
    }
    return buf;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.5;
    }
    return buf;
  }

  private src(buf: AudioBuffer, loop = true): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    return s;
  }

  private panner(pos?: THREE.Vector3, ref = 4, rolloff = 1.2): PannerNode {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 400;
    if (pos) this.setPos(p, pos);
    return p;
  }

  private setPos(p: PannerNode, v: THREE.Vector3): void {
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setTargetAtTime(v.x, t, 0.03);
      p.positionY.setTargetAtTime(v.y, t, 0.03);
      p.positionZ.setTargetAtTime(v.z, t, 0.03);
    } else p.setPosition(v.x, v.y, v.z);
  }

  // ------------------------------------------------------------ ambience

  private startAmbience(): void {
    const c = this.ctx;
    // Wind: brown noise through a slowly moving low-pass.
    const wind = this.src(this.brown);
    this.windFilter = c.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.16;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.amb);
    wind.start();
    // Needle and leaf rustle: band-passed pink noise that swells with gusts.
    const rustle = this.src(this.pink);
    rustle.playbackRate.value = 0.93;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3800;
    bp.Q.value = 0.55;
    this.rustleGain = c.createGain();
    this.rustleGain.gain.value = 0.05;
    rustle.connect(bp).connect(this.rustleGain).connect(this.amb);
    rustle.start();
    // Creek: three positional sources that follow the nearest stretch of water.
    for (let i = 0; i < 3; i += 1) {
      const s = this.src(i === 1 ? this.pink : this.brown);
      s.playbackRate.value = 0.8 + i * 0.15;
      const f = c.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = i === 1 ? 1400 : 650;
      f.Q.value = 0.45;
      const gain = c.createGain();
      gain.gain.value = i === 1 ? 0.22 : 0.45;
      const p = this.panner(new THREE.Vector3(0, -1000, 0), 5, 1.5);
      s.connect(f).connect(gain).connect(p).connect(this.amb);
      s.start(0, Math.random() * 3);
      this.creek.push({ panner: p, gain });
    }
  }

  /** Per-frame update: listener, gusts, creek emitters, wildlife. */
  update(dt: number, camera: THREE.Camera, gust: number, canopy: number, creekPoints: THREE.Vector3[]): void {
    if (!this.started) return;
    const l = this.ctx.listener;
    const p = camera.position;
    this.listenerPos.copy(p);
    const f = new THREE.Vector3();
    camera.getWorldDirection(f);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
      l.upX.setTargetAtTime(up.x, t, 0.02);
      l.upY.setTargetAtTime(up.y, t, 0.02);
      l.upZ.setTargetAtTime(up.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, up.x, up.y, up.z);
    }
    const height = Math.max(0, p.y - 10);
    this.windGain.gain.setTargetAtTime(0.1 + gust * 0.12 + Math.min(0.12, height * 0.004), t, 0.5);
    this.windFilter.frequency.setTargetAtTime(300 + gust * 380 + height * 6, t, 0.6);
    this.rustleGain.gain.setTargetAtTime((0.02 + gust * 0.06) * (0.4 + canopy * 0.8), t, 0.4);
    creekPoints.forEach((cp, i) => {
      const e = this.creek[i];
      if (e) this.setPos(e.panner, cp);
    });
    // Wildlife.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = (2.5 + Math.random() * 7) * (1 + this.dusk * 3);
      if (Math.random() > this.dusk * 0.7) this.bird();
    }
    this.peckTimer -= dt;
    if (this.peckTimer <= 0) {
      this.peckTimer = 30 + Math.random() * 50;
      if (this.dusk < 0.6) this.woodpecker();
    }
    this.owlTimer -= dt;
    if (this.owlTimer <= 0) {
      this.owlTimer = 25 + Math.random() * 35;
      if (this.dusk > 0.5) this.owl();
    }
  }

  private randomAround(minR: number, maxR: number, height: [number, number]): THREE.Vector3 {
    const a = Math.random() * Math.PI * 2;
    const r = minR + Math.random() * (maxR - minR);
    return new THREE.Vector3(this.listenerPos.x + Math.cos(a) * r, this.listenerPos.y + height[0] + Math.random() * (height[1] - height[0]), this.listenerPos.z + Math.sin(a) * r);
  }

  private bird(): void {
    const c = this.ctx;
    const pos = this.randomAround(12, 55, [4, 16]);
    const out = c.createGain();
    out.gain.value = 0.2;
    const p = this.panner(pos, 8, 1.1);
    out.connect(p).connect(this.amb);
    out.connect(this.reverbSend);
    const t0 = c.currentTime + 0.05;
    const kind = Math.random();
    const note = (t: number, f0: number, f1: number, dur: number, vol = 1, type: OscillatorType = 'sine') => {
      const o = c.createOscillator();
      o.type = type;
      const g = c.createGain();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    if (kind < 0.35) {
      // Thrush-like phrase.
      let t = t0;
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i += 1) {
        const base = 1800 + Math.random() * 1700;
        const d = 0.09 + Math.random() * 0.16;
        note(t, base, base * (0.85 + Math.random() * 0.4), d, 0.5 + Math.random() * 0.4);
        t += d + 0.04 + Math.random() * 0.08;
      }
    } else if (kind < 0.6) {
      // Two-note whistle.
      note(t0, 3900, 3800, 0.32, 0.45);
      note(t0 + 0.42, 3350, 3250, 0.38, 0.4);
    } else if (kind < 0.85) {
      // Fast trill.
      const n = 10 + Math.floor(Math.random() * 10);
      const base = 4800 + Math.random() * 1500;
      for (let i = 0; i < n; i += 1) note(t0 + i * 0.045, base, base * 1.12, 0.035, 0.3);
    } else {
      // Distant crow.
      out.gain.value = 0.12;
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i += 1) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1300;
        bp.Q.value = 3;
        const g = c.createGain();
        const t = t0 + i * 0.5;
        o.frequency.setValueAtTime(620, t);
        o.frequency.linearRampToValueAtTime(480, t + 0.32);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.5, t + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
        o.connect(bp).connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.4);
      }
    }
  }

  private woodpecker(): void {
    const c = this.ctx;
    const pos = this.randomAround(40, 90, [5, 12]);
    const out = c.createGain();
    out.gain.value = 0.5;
    out.connect(this.panner(pos, 10, 1)).connect(this.amb);
    out.connect(this.reverbSend);
    const n = 12 + Math.floor(Math.random() * 8);
    const t0 = c.currentTime + 0.05;
    for (let i = 0; i < n; i += 1) this.click(out, t0 + i * 0.055, 900, 0.025, 0.6);
  }

  private owl(): void {
    const c = this.ctx;
    const pos = this.randomAround(50, 110, [6, 14]);
    const out = c.createGain();
    out.gain.value = 0.18;
    out.connect(this.panner(pos, 12, 0.9)).connect(this.amb);
    out.connect(this.reverbSend);
    const t0 = c.currentTime + 0.05;
    for (const [dt, f, d] of [[0, 390, 0.35], [0.55, 400, 0.18], [0.85, 380, 0.5]] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.6, t0 + dt + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + d);
      o.connect(g).connect(out);
      o.start(t0 + dt);
      o.stop(t0 + dt + d + 0.05);
    }
  }

  private click(dest: AudioNode, t: number, freq: number, dur: number, vol: number): void {
    const c = this.ctx;
    const s = this.src(this.white, false);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, dur + 0.02);
  }

  private burst(dest: AudioNode, t: number, o: { buf?: AudioBuffer; type: BiquadFilterType; freq: number; q?: number; attack?: number; dur: number; vol: number }): void {
    const c = this.ctx;
    const s = this.src(o.buf ?? this.white, false);
    const f = c.createBiquadFilter();
    f.type = o.type;
    f.frequency.value = o.freq;
    f.Q.value = o.q ?? 0.8;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol, t + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 1.5, o.dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, f0: number, f1: number, dur: number, vol: number, type: OscillatorType = 'sine'): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ footsteps

  footstep(surface: Surface, intensity: number, pos: THREE.Vector3): void {
    if (!this.started) return;
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const out = c.createGain();
    out.gain.value = 0.32 * (0.6 + intensity * 0.6);
    const p = this.panner(pos.clone().add(new THREE.Vector3(0, 0.05, 0)), 2, 1);
    out.connect(p).connect(this.sfx);
    const v = 0.85 + Math.random() * 0.3;
    switch (surface) {
      case 'gravel':
        for (let i = 0; i < 5; i += 1) this.burst(out, t + i * 0.012 + Math.random() * 0.01, { type: 'bandpass', freq: 2200 + Math.random() * 2500, q: 1.1, dur: 0.035, vol: 0.5 * v });
        this.tone(out, t, 90, 60, 0.07, 0.35);
        break;
      case 'mud':
        this.burst(out, t, { buf: this.brown, type: 'lowpass', freq: 420, dur: 0.16, vol: 0.9 * v, attack: 0.02 });
        this.tone(out, t + 0.02, 140, 70, 0.12, 0.25);
        break;
      case 'water':
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1300, q: 0.6, dur: 0.32, vol: 0.9 * v, attack: 0.01 });
        this.burst(out, t + 0.05, { buf: this.white, type: 'highpass', freq: 3000, dur: 0.18, vol: 0.25 * v });
        break;
      case 'wood':
        this.tone(out, t, 160, 95, 0.13, 0.55 * v);
        this.burst(out, t, { type: 'bandpass', freq: 2600, q: 2, dur: 0.03, vol: 0.4 * v });
        break;
      case 'metal':
        this.tone(out, t, 420, 400, 0.18, 0.2 * v, 'triangle');
        this.burst(out, t, { type: 'bandpass', freq: 3200, q: 3, dur: 0.05, vol: 0.4 * v });
        break;
      case 'rock':
        this.burst(out, t, { type: 'bandpass', freq: 3600, q: 1.5, dur: 0.04, vol: 0.45 * v });
        this.tone(out, t, 220, 150, 0.05, 0.3 * v);
        break;
      case 'grass':
      case 'moss':
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1500, q: 0.6, dur: 0.13, vol: 0.45 * v, attack: 0.015 });
        this.tone(out, t, 80, 55, 0.08, 0.25);
        break;
      default:
        // Needles and leaf litter: soft crunch with a few twig snaps.
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1900, q: 0.7, dur: 0.11, vol: 0.55 * v, attack: 0.01 });
        for (let i = 0; i < 3; i += 1) this.burst(out, t + Math.random() * 0.06, { type: 'bandpass', freq: 3000 + Math.random() * 2000, q: 2, dur: 0.012, vol: 0.25 * v });
        this.tone(out, t, 85, 55, 0.08, 0.3);
    }
  }

  // ------------------------------------------------------------ vehicle

  engineStart(pos: THREE.Vector3): void {
    if (!this.started) return;
    const c = this.ctx;
    const t = c.currentTime;
    const out = c.createGain();
    out.gain.value = 0.35;
    out.connect(this.panner(pos, 4, 1)).connect(this.veh);
    // Starter whine with compression pulses, then the engine catches.
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(140, t);
    o.frequency.linearRampToValueAtTime(190, t + 0.7);
    const trem = c.createGain();
    const lfo = c.createOscillator();
    lfo.frequency.value = 9;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain).connect(trem.gain);
    trem.gain.value = 0.5;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, t + 0.65);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    o.connect(trem).connect(lp).connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + 0.9);
    lfo.stop(t + 0.9);
    this.ensureEngine();
  }

  private ensureEngine(): void {
    if (this.engine) return;
    const c = this.ctx;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 1.2;
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i += 1) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    const gain = c.createGain();
    gain.gain.value = 0;
    const panner = this.panner(undefined, 5, 1);
    const osc: OscillatorNode[] = [];
    const types: OscillatorType[] = ['sawtooth', 'sawtooth', 'square'];
    const mix = c.createGain();
    mix.gain.value = 0.3;
    types.forEach((type, i) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = 40 * (i === 2 ? 0.5 : i + 1);
      const g = c.createGain();
      g.gain.value = i === 0 ? 0.6 : i === 1 ? 0.25 : 0.35;
      o.connect(g).connect(mix);
      o.start();
      osc.push(o);
    });
    const noise = this.src(this.brown);
    const noiseGain = c.createGain();
    noiseGain.gain.value = 0.2;
    noise.connect(noiseGain).connect(mix);
    noise.start();
    mix.connect(shaper).connect(filter).connect(gain).connect(panner).connect(this.veh);
    // Tyre noise.
    const tyre = this.src(this.pink);
    const tyreFilter = c.createBiquadFilter();
    tyreFilter.type = 'bandpass';
    tyreFilter.frequency.value = 1200;
    tyreFilter.Q.value = 0.7;
    const tyreGain = c.createGain();
    tyreGain.gain.value = 0;
    tyre.connect(tyreFilter).connect(tyreGain).connect(panner);
    tyre.start();
    this.engine = { osc, filter, gain, noiseGain, panner, tyreGain, tyreFilter };
  }

  /** Engine and tyres; rpm drives pitch, load drives timbre and loudness. */
  updateEngine(on: boolean, rpm: number, load: number, speed: number, surface: string, pos: THREE.Vector3, inside: boolean): void {
    if (!this.started) return;
    if (!this.engine && !on) return;
    this.ensureEngine();
    const e = this.engine!;
    const t = this.ctx.currentTime;
    const f = rpm / 20;
    e.osc[0].frequency.setTargetAtTime(f, t, 0.03);
    e.osc[1].frequency.setTargetAtTime(f * 2.01, t, 0.03);
    e.osc[2].frequency.setTargetAtTime(f * 0.5, t, 0.03);
    e.filter.frequency.setTargetAtTime(260 + rpm * 0.22 + load * 900, t, 0.05);
    e.noiseGain.gain.setTargetAtTime(0.12 + load * 0.3, t, 0.05);
    const level = on ? (0.16 + load * 0.16 + Math.min(0.12, rpm / 30000)) * (inside ? 0.8 : 1) : 0;
    e.gain.gain.setTargetAtTime(level, t, on ? 0.08 : 0.4);
    this.setPos(e.panner, pos);
    const sp = Math.min(1, Math.abs(speed) / 18);
    const freq = surface === 'gravel' ? 1500 : surface === 'mud' ? 450 : surface === 'water' ? 900 : 1000;
    e.tyreFilter.frequency.setTargetAtTime(freq, t, 0.1);
    e.tyreGain.gain.setTargetAtTime(sp * (surface === 'water' ? 0.9 : surface === 'gravel' ? 0.55 : 0.35), t, 0.1);
  }

  impact(strength: number, pos: THREE.Vector3): void {
    if (!this.started) return;
    const out = this.ctx.createGain();
    out.gain.value = Math.min(1, strength);
    out.connect(this.panner(pos, 4, 1)).connect(this.sfx);
    const t = this.ctx.currentTime;
    this.burst(out, t, { buf: this.brown, type: 'lowpass', freq: 380, dur: 0.35, vol: 0.9 });
    this.tone(out, t, 70, 40, 0.3, 0.6);
    this.burst(out, t, { type: 'bandpass', freq: 2400, q: 1, dur: 0.12, vol: 0.25 });
  }

  // ------------------------------------------------------------ one-shots

  play(name: string, pos?: THREE.Vector3, gain = 1): void {
    if (!this.started) return;
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const out = c.createGain();
    out.gain.value = gain;
    if (pos) out.connect(this.panner(pos, 3, 1)).connect(this.sfx);
    else out.connect(this.sfx);
    switch (name) {
      case 'clue': {
        out.connect(this.reverbSend);
        this.tone(out, t, 659, 659, 0.9, 0.12);
        this.tone(out, t + 0.16, 880, 880, 1.2, 0.1);
        break;
      }
      case 'objective':
        out.connect(this.reverbSend);
        this.tone(out, t, 220, 220, 1.4, 0.12);
        this.tone(out, t, 330, 330, 1.4, 0.08);
        break;
      case 'doorOpen':
        this.tone(out, t, 210, 260, 0.45, 0.12, 'triangle');
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 900, dur: 0.4, vol: 0.25 });
        break;
      case 'doorClose':
      case 'thunk':
        this.tone(out, t, 120, 60, 0.18, 0.6);
        this.burst(out, t, { buf: this.brown, type: 'lowpass', freq: 600, dur: 0.15, vol: 0.6 });
        break;
      case 'paper':
        for (let i = 0; i < 4; i += 1) this.burst(out, t + i * 0.07, { type: 'highpass', freq: 3500, dur: 0.08, vol: 0.25 });
        break;
      case 'rummage':
        for (let i = 0; i < 7; i += 1) this.burst(out, t + i * 0.09 + Math.random() * 0.05, { buf: this.pink, type: 'bandpass', freq: 800 + Math.random() * 1600, dur: 0.09, vol: 0.35 });
        break;
      case 'keys':
        for (let i = 0; i < 6; i += 1) this.tone(out, t + i * 0.04 + Math.random() * 0.03, 3200 + Math.random() * 1800, 3000, 0.12, 0.08, 'triangle');
        break;
      case 'click':
        this.burst(out, t, { type: 'bandpass', freq: 2500, q: 3, dur: 0.03, vol: 0.5 });
        break;
      case 'switch':
        this.tone(out, t, 180, 90, 0.12, 0.5, 'square');
        this.burst(out, t, { buf: this.brown, type: 'lowpass', freq: 500, dur: 0.12, vol: 0.4 });
        break;
      case 'pour':
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 600, q: 0.8, attack: 0.15, dur: 2.0, vol: 0.4 });
        break;
      case 'slosh':
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 500, q: 1, attack: 0.05, dur: 0.5, vol: 0.4 });
        this.tone(out, t, 150, 90, 0.2, 0.3);
        break;
      case 'unlock':
        this.burst(out, t, { type: 'bandpass', freq: 3000, q: 4, dur: 0.04, vol: 0.6 });
        this.burst(out, t + 0.12, { type: 'bandpass', freq: 2200, q: 4, dur: 0.05, vol: 0.6 });
        for (let i = 0; i < 5; i += 1) this.tone(out, t + 0.25 + i * 0.05, 2400 + Math.random() * 900, 2200, 0.1, 0.06, 'triangle');
        break;
      case 'gate': {
        // A long rusty creak.
        const o = c.createOscillator();
        o.type = 'sawtooth';
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 900;
        bp.Q.value = 6;
        const g = c.createGain();
        o.frequency.setValueAtTime(70, t);
        for (let i = 1; i < 12; i += 1) o.frequency.setValueAtTime(60 + Math.random() * 40, t + i * 0.12);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
        o.connect(bp).connect(g).connect(out);
        o.start(t);
        o.stop(t + 1.6);
        break;
      }
      case 'knock':
        for (let i = 0; i < 3; i += 1) {
          this.tone(out, t + i * 0.22, 150, 90, 0.12, 0.8);
          this.burst(out, t + i * 0.22, { type: 'bandpass', freq: 1800, q: 2, dur: 0.03, vol: 0.4 });
        }
        break;
      case 'radioBeep':
        this.tone(out, t, 1250, 1250, 0.12, 0.08, 'square');
        this.burst(out, t + 0.12, { type: 'bandpass', freq: 2000, dur: 0.25, vol: 0.12 });
        break;
      case 'generatorStart': {
        for (let i = 0; i < 3; i += 1) {
          this.burst(out, t + i * 0.55, { buf: this.pink, type: 'bandpass', freq: 1200, q: 1, dur: 0.25, vol: 0.4 });
          this.tone(out, t + i * 0.55 + 0.2, 60, 35, 0.25, 0.5, 'square');
        }
        break;
      }
      default:
        break;
    }
  }

  // ------------------------------------------------------------ firearms

  /**
   * One gunshot. Layers: supersonic crack, body thump at the gun's own
   * frequency, low boom, and a long tail into the reverb and valley echo.
   * Distant shots arrive later (speed of sound) and lose their highs.
   */
  gunshot(snd: GunSound, pos: THREE.Vector3, shooterIsPlayer: boolean): void {
    if (!this.started) return;
    const c = this.ctx;
    const dist = pos.distanceTo(this.listenerPos);
    const delay = shooterIsPlayer ? 0 : Math.min(0.6, dist / 343);
    const t = c.currentTime + 0.005 + delay;
    const out = c.createGain();
    out.gain.value = snd.level * (shooterIsPlayer ? 0.9 : 1.1);
    const air = c.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(900, 16000 * Math.exp(-dist / 160));
    const pan = this.panner(pos, shooterIsPlayer ? 3 : 8, shooterIsPlayer ? 1 : 0.9);
    out.connect(air).connect(pan).connect(this.guns);
    const send = c.createGain();
    send.gain.value = 0.35 + snd.tail * 0.12;
    out.connect(send);
    send.connect(this.reverbSend);
    send.connect(this.echo);
    const j = 0.92 + Math.random() * 0.16;
    this.burst(out, t, { buf: this.white, type: 'highpass', freq: 2600 * j, q: 0.7, attack: 0.0008, dur: 0.035 + snd.crack * 0.02, vol: 0.9 * snd.crack });
    this.burst(out, t, { buf: this.white, type: 'bandpass', freq: snd.body * j, q: 0.85, attack: 0.001, dur: 0.12 + snd.boom * 0.06, vol: 1.0 });
    this.burst(out, t + 0.002, { buf: this.pink, type: 'lowpass', freq: 1800, attack: 0.002, dur: 0.22, vol: 0.55 });
    this.tone(out, t, 150 * j, 42, 0.16 + snd.boom * 0.12, 0.9 * snd.boom);
    this.burst(out, t + 0.02, { buf: this.brown, type: 'lowpass', freq: 650, attack: 0.03, dur: snd.tail, vol: 0.32 });
    if (shooterIsPlayer && snd.action === 'slide') this.gunMech('eject', pos);
  }

  /** Handling noises: magazines, slides, pumps, bolts, cylinders, shells. */
  gunMech(kind: GunMech, pos: THREE.Vector3): void {
    if (!this.started) return;
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const out = c.createGain();
    out.gain.value = 0.55;
    out.connect(this.panner(pos, 2, 1.1)).connect(this.sfx);
    const click = (dt: number, f: number, v: number, d = 0.03, q = 3) => this.burst(out, t + dt, { type: 'bandpass', freq: f, q, dur: d, vol: v });
    const clunk = (dt: number, f: number, v: number) => this.tone(out, t + dt, f, f * 0.6, 0.07, v, 'triangle');
    switch (kind) {
      case 'magOut': click(0, 2400, 0.5); click(0.05, 1500, 0.4, 0.06, 1.5); break;
      case 'magIn': click(0, 1800, 0.6, 0.04, 2); clunk(0.01, 240, 0.35); click(0.06, 3200, 0.45); break;
      case 'slideRack': click(0, 2600, 0.5, 0.05, 1.5); click(0.13, 3100, 0.7, 0.04, 2); clunk(0.13, 300, 0.3); break;
      case 'slideRelease': click(0, 3000, 0.7, 0.04, 2); clunk(0, 320, 0.3); break;
      case 'dry': click(0, 3600, 0.55, 0.018, 5); break;
      case 'pumpBack': this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1400, q: 1.2, dur: 0.09, vol: 0.5 }); click(0.07, 2200, 0.6, 0.03, 2); clunk(0.07, 200, 0.3); break;
      case 'pumpForward': this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1700, q: 1.2, dur: 0.08, vol: 0.45 }); click(0.06, 2800, 0.7, 0.03, 2); clunk(0.06, 260, 0.3); break;
      case 'boltOpen': click(0, 2000, 0.5, 0.03, 2); this.burst(out, t + 0.05, { buf: this.pink, type: 'bandpass', freq: 2400, q: 1.5, dur: 0.12, vol: 0.35 }); break;
      case 'boltClose': this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 2600, q: 1.5, dur: 0.1, vol: 0.35 }); click(0.1, 2200, 0.6, 0.03, 2); clunk(0.1, 280, 0.25); break;
      case 'cylinderOpen': click(0, 2600, 0.5, 0.03, 3); this.tone(out, t + 0.02, 1900, 1700, 0.12, 0.08, 'triangle'); break;
      case 'cylinderClose': click(0, 2200, 0.7, 0.03, 2); clunk(0, 300, 0.25); break;
      case 'speedloader': for (let i = 0; i < 6; i += 1) click(i * 0.012, 3000 + Math.random() * 800, 0.3, 0.02, 4); break;
      case 'shellIn': click(0, 1700, 0.45, 0.04, 2); clunk(0.02, 220, 0.3); break;
      case 'roundIn': click(0, 2600, 0.45, 0.03, 3); break;
      case 'draw': this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 900, q: 0.8, dur: 0.18, vol: 0.35, attack: 0.03 }); click(0.12, 2600, 0.25); break;
      case 'holster': this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 800, q: 0.8, dur: 0.2, vol: 0.3, attack: 0.03 }); clunk(0.15, 180, 0.2); break;
      case 'pickup': this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1100, q: 0.8, dur: 0.25, vol: 0.35, attack: 0.02 }); click(0.1, 2400, 0.45); clunk(0.12, 220, 0.3); break;
      case 'ammo': for (let i = 0; i < 5; i += 1) this.tone(out, t + i * 0.035 + Math.random() * 0.02, 2800 + Math.random() * 900, 2600, 0.08, 0.06, 'triangle'); break;
      case 'eject': click(0.05, 3200, 0.4); break;
      default: break;
    }
  }

  /** Bullet striking a surface near the listener. */
  bulletImpact(surface: string, pos: THREE.Vector3): void {
    if (!this.started) return;
    if (pos.distanceTo(this.listenerPos) > 70) return;
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const out = c.createGain();
    out.gain.value = 0.5;
    out.connect(this.panner(pos, 3, 1.1)).connect(this.sfx);
    switch (surface) {
      case 'steel':
        // Ringing steel plate.
        out.gain.value = 0.9;
        this.tone(out, t, 1180, 1160, 0.9, 0.35, 'sine');
        this.tone(out, t, 2950, 2900, 0.5, 0.12, 'sine');
        this.burst(out, t, { type: 'highpass', freq: 3000, dur: 0.02, vol: 0.6 });
        break;
      case 'metal':
        this.tone(out, t, 800 + Math.random() * 600, 700, 0.25, 0.2, 'triangle');
        this.burst(out, t, { type: 'highpass', freq: 3000, dur: 0.03, vol: 0.5 });
        break;
      case 'wood':
        this.tone(out, t, 260, 140, 0.08, 0.5);
        this.burst(out, t, { type: 'bandpass', freq: 1800, q: 1, dur: 0.05, vol: 0.5 });
        break;
      case 'water':
        this.burst(out, t, { buf: this.pink, type: 'bandpass', freq: 1500, q: 0.7, dur: 0.25, vol: 0.6, attack: 0.005 });
        break;
      case 'rock':
      case 'gravel':
        this.burst(out, t, { type: 'bandpass', freq: 3800, q: 1.4, dur: 0.04, vol: 0.6 });
        if (Math.random() < 0.35) this.tone(out, t + 0.02, 2600 + Math.random() * 1500, 900, 0.35, 0.07, 'sine');
        break;
      default:
        this.burst(out, t, { buf: this.brown, type: 'lowpass', freq: 700, dur: 0.1, vol: 0.7 });
        this.burst(out, t, { type: 'bandpass', freq: 1500, q: 1, dur: 0.04, vol: 0.3 });
    }
  }

  /** A round passing close to the listener. */
  whizz(pos: THREE.Vector3): void {
    if (!this.started) return;
    const c = this.ctx;
    const t = c.currentTime + 0.005;
    const out = c.createGain();
    out.gain.value = 0.35;
    out.connect(this.panner(pos, 1, 1)).connect(this.sfx);
    this.burst(out, t, { buf: this.white, type: 'bandpass', freq: 4200, q: 2, dur: 0.09, vol: 0.6, attack: 0.03 });
    this.tone(out, t, 1800, 900, 0.1, 0.1, 'sine');
  }

  /** Short confirmation tick when a shot connects with a target. */
  hitTick(heavy: boolean): void {
    if (!this.started) return;
    const out = this.ctx.createGain();
    out.gain.value = 0.18;
    out.connect(this.sfx);
    const t = this.ctx.currentTime + 0.01;
    this.tone(out, t, heavy ? 520 : 1400, heavy ? 380 : 1300, 0.06, heavy ? 0.6 : 0.35, 'triangle');
  }

  /** Being hit: a dull thump and a breath. */
  playerHurt(): void {
    if (!this.started) return;
    const out = this.ctx.createGain();
    out.gain.value = 0.5;
    out.connect(this.sfx);
    const t = this.ctx.currentTime + 0.01;
    this.burst(out, t, { buf: this.brown, type: 'lowpass', freq: 300, dur: 0.25, vol: 0.9 });
    this.burst(out, t + 0.08, { buf: this.pink, type: 'bandpass', freq: 700, q: 0.7, dur: 0.35, vol: 0.25, attack: 0.05 });
  }

  setLoop(name: string, on: boolean, pos?: THREE.Vector3): void {
    if (!on) {
      this.loops.get(name)?.stop();
      this.loops.delete(name);
      return;
    }
    if (!this.started || this.loops.has(name)) return;
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    const p = pos ? this.panner(pos, name === 'generator' ? 4 : 2, 1.3) : null;
    if (p) out.connect(p).connect(this.sfx);
    else out.connect(this.sfx);
    const nodes: (AudioScheduledSourceNode)[] = [];
    if (name === 'generator') {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = 58;
      const o2 = c.createOscillator();
      o2.type = 'sawtooth';
      o2.frequency.value = 117;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 700;
      const n = this.src(this.brown);
      const ng = c.createGain();
      ng.gain.value = 0.4;
      const g1 = c.createGain();
      g1.gain.value = 0.15;
      o.connect(g1);
      o2.connect(g1);
      n.connect(ng).connect(g1);
      g1.connect(lp).connect(out);
      nodes.push(o, o2, n);
      out.gain.setTargetAtTime(0.5, c.currentTime, 0.4);
    } else if (name === 'static') {
      const n = this.src(this.white);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2200;
      bp.Q.value = 0.8;
      const g1 = c.createGain();
      g1.gain.value = 0.18;
      const lfo = c.createOscillator();
      lfo.frequency.value = 6.5;
      const lg = c.createGain();
      lg.gain.value = 0.08;
      lfo.connect(lg).connect(g1.gain);
      n.connect(bp).connect(g1).connect(out);
      nodes.push(n, lfo);
      out.gain.setTargetAtTime(0.7, c.currentTime, 0.1);
    }
    for (const n of nodes) n.start();
    this.loops.set(name, {
      stop: () => {
        out.gain.setTargetAtTime(0, c.currentTime, 0.15);
        setTimeout(() => nodes.forEach((n) => n.stop()), 600);
      },
    });
  }

  get muted(): boolean {
    return this.volume <= 0;
  }
}
