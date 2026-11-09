// Gunshot synthesis, sample by sample, from the physics of a real shot. Pure
// math (no Web Audio), so it runs at startup in the browser and in Node tests.
//
// Layers, in the order they reach the ear:
//  - Supersonic crack (rifles, some pistol loads): an N-wave, a near-instant
//    pressure jump that falls through zero and snaps back, ~0.3-0.6 ms long.
//  - Muzzle blast: a Friedlander pulse (sharp rise, exponential fall into a
//    longer negative phase). This is the "punch"; its length sets the pitch.
//  - Blast turbulence: a few milliseconds of broadband noise.
//  - Body: the gun's own ring, a resonance around `body` Hz.
//  - Thump: a low sine that sweeps down, felt as much as heard (`boom`).
//  - Soft saturation: real shots clip microphones and ears.
//  - Ground reflection a few milliseconds later, duller.
//  - Slap echoes off nearby tree lines (50-250 ms).
//  - Forest reverb tail that darkens as it decays (`tail` seconds).
//  - Mechanical action noise for semi-automatics (slide/bolt cycling).
// The valley echo, distance delay and distance muffling are added live.

import type { GunSound } from '../weapons/defs.ts';

/** Small RBJ biquad, processed sample by sample. */
class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(type: 'lowpass' | 'highpass' | 'bandpass', freq: number, q: number, sr: number) {
    const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    let b0: number;
    let b1: number;
    let b2: number;
    if (type === 'lowpass') {
      b0 = (1 - cos) / 2;
      b1 = 1 - cos;
      b2 = (1 - cos) / 2;
    } else if (type === 'highpass') {
      b0 = (1 + cos) / 2;
      b1 = -(1 + cos);
      b2 = (1 + cos) / 2;
    } else {
      b0 = alpha;
      b1 = 0;
      b2 = -alpha;
    }
    const a0 = 1 + alpha;
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Seeded random in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One gunshot, mono, peak-normalised to about 0.97. `rnd` varies each take. */
export function synthGunshot(snd: GunSound, sr: number, rnd: () => number): Float32Array {
  const len = Math.ceil(sr * (0.3 + snd.tail * 0.85));
  const dry = new Float32Array(len);
  const noise = () => rnd() * 2 - 1;
  const jit = (k: number) => 1 + (rnd() * 2 - 1) * k;
  const at = (s: number) => Math.round(s * sr);

  // --- supersonic crack (N-wave), slightly ahead of the blast
  const supersonic = snd.crack > 0.6;
  let o = 0;
  if (supersonic) {
    const n = Math.max(4, at(0.00028 + 0.00025 * snd.crack));
    const a = 0.85 * snd.crack;
    for (let i = 0; i < n; i += 1) dry[i] += a * (1 - (2 * i) / (n - 1));
    // Shock "sizzle": a burst of very bright noise riding the crack.
    const hp = new Biquad('highpass', 4500, 0.7, sr);
    for (let i = 0; i < at(0.006); i += 1) dry[i] += 0.35 * snd.crack * hp.run(noise()) * Math.exp(-i / (sr * 0.0012));
    o = at(0.0007);
  }

  // --- muzzle blast: Friedlander pulse
  const td = (0.55 / snd.body) * jit(0.06);
  const b = 1.35;
  const blastN = at(td * 14);
  for (let i = 0; i < blastN && o + i < len; i += 1) {
    const t = i / sr;
    dry[o + i] += 1.15 * (1 - t / td) * Math.exp((-b * t) / td);
  }

  // --- turbulence: broadband noise, a few ms
  {
    const lp = new Biquad('lowpass', Math.min(12000, snd.body * (10 + 6 * snd.crack)), 0.6, sr);
    const hp = new Biquad('highpass', 140, 0.7, sr);
    const tau = 0.0035 + 0.007 * snd.boom;
    const n = at(tau * 7);
    for (let i = 0; i < n && o + i < len; i += 1) {
      const env = (1 - Math.exp(-i / (sr * 0.00015))) * Math.exp(-i / (sr * tau));
      dry[o + i] += (0.6 + 0.6 * snd.crack) * env * hp.run(lp.run(noise()));
    }
  }

  // --- body: the gun's resonance
  {
    const bp = new Biquad('bandpass', snd.body * jit(0.05), 2.2, sr);
    const bp2 = new Biquad('bandpass', snd.body * 2.3 * jit(0.05), 3, sr);
    const tau = 0.01 + 0.028 * snd.boom;
    const n = at(tau * 7);
    for (let i = 0; i < n && o + i < len; i += 1) {
      const x = noise() * Math.exp(-i / (sr * tau * 0.35));
      dry[o + i] += 2.4 * bp.run(x) * Math.exp(-i / (sr * tau)) + 0.9 * bp2.run(x) * Math.exp(-i / (sr * tau * 0.6));
    }
  }

  // --- soft saturation (loudness and punch without harsh clipping)
  const drive = 1.15 + 0.35 * snd.boom;
  const norm = Math.tanh(drive);
  for (let i = 0; i < len; i += 1) dry[i] = Math.tanh(drive * dry[i]) / norm;

  // --- thump: low sweep, felt in the chest (added after saturation so it stays clean)
  {
    const f0 = (120 + snd.body * 0.08) * jit(0.05);
    const f1 = 36;
    const tau = 0.014 + 0.03 * snd.boom;
    const n = at(tau * 6);
    let ph = 0;
    for (let i = 0; i < n && o + i < len; i += 1) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t / 0.028);
      ph += (2 * Math.PI * f) / sr;
      const env = (1 - Math.exp(-t / 0.0012)) * Math.exp(-t / tau);
      // Supersonic rifles put their energy into the crack and blast, not the thump.
      dry[o + i] += (0.12 + 0.3 * snd.boom) * (1.15 - 0.5 * snd.crack) * env * Math.sin(ph);
    }
  }

  // --- mechanical action for semi-automatics: the slide or bolt carrier cycling
  if (snd.action === 'slide' || snd.action === 'none') {
    const clicks = snd.action === 'slide' ? [[0.038, 2900, 0.09], [0.07, 2300, 0.07]] : [[0.03, 2600, 0.035]];
    for (const [t0, f, a] of clicks) {
      const bp = new Biquad('bandpass', f * jit(0.08), 4, sr);
      const s0 = at(t0 * jit(0.08));
      for (let i = 0; i < at(0.012) && s0 + i < len; i += 1) dry[s0 + i] += a * 4 * bp.run(noise()) * Math.exp(-i / (sr * 0.0025));
    }
  }

  const out = new Float32Array(len);
  out.set(dry);

  // --- ground reflection: the same shot a few ms later, duller
  {
    const d = at(0.0038 * jit(0.15));
    const lp = new Biquad('lowpass', 2600, 0.7, sr);
    for (let i = 0; i + d < len && i < at(0.25); i += 1) out[i + d] += 0.5 * lp.run(dry[i]);
  }

  // --- slap echoes off tree lines
  {
    const count = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < count; k += 1) {
      const d = at(0.05 + rnd() * 0.2);
      const g = (0.05 + rnd() * 0.06) * (0.6 + 0.4 * snd.boom);
      const lp = new Biquad('lowpass', 1400 + rnd() * 1600, 0.7, sr);
      const hp = new Biquad('highpass', 160, 0.7, sr);
      for (let i = 0; i < at(0.06) && i + d < len; i += 1) out[i + d] += g * hp.run(lp.run(dry[i]));
    }
  }

  // --- forest reverb tail: dense noise, darkening as it decays
  {
    const tau = 0.07 + 0.3 * snd.tail;
    const amp = 0.035 + 0.025 * snd.boom;
    const start = at(0.006);
    let y = 0;
    let y2 = 0;
    for (let i = start; i < len; i += 1) {
      const t = (i - start) / sr;
      const cutoff = 300 + 3200 * Math.exp(-t / (0.12 + 0.25 * snd.tail));
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sr);
      y += a * (noise() - y);
      y2 += a * (y - y2);
      const env = (1 - Math.exp(-t / 0.012)) * Math.exp(-t / tau);
      out[i] += amp * 2.2 * env * y2;
    }
  }

  // Fade the very end and normalise.
  const fade = at(0.05);
  for (let i = 0; i < fade; i += 1) out[len - 1 - i] *= i / fade;
  let peak = 0;
  for (let i = 0; i < len; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  const k = peak > 0 ? 0.97 / peak : 1;
  for (let i = 0; i < len; i += 1) out[i] *= k;
  return out;
}
