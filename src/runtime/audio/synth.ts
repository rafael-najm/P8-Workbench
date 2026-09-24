/**
 * PICO-8-style synthesizer: 4 voices driven by sequencer note events.
 * Waveforms and effects are approximations of PICO-8's, tuned to sound
 * right rather than to be sample-exact.
 */
import type { NoteEvent } from './sequencer';
import { TICK_SECONDS } from './sequencer';

export const WAVE_NAMES = ['triangle', 'tilted saw', 'saw', 'square', 'pulse', 'organ', 'noise', 'phaser'] as const;
export const FX_NAMES = ['none', 'slide', 'vibrato', 'drop', 'fade in', 'fade out', 'arp fast', 'arp slow'] as const;

/** PICO-8 pitch (0 = C0) to Hz; pitch 33 (A2) = 440 Hz. */
export function pitchToHz(pitch: number): number {
  return 440 * 2 ** ((pitch - 33) / 12);
}

/** One sample of waveform `w` at phase t in [0, 1). Output roughly in [-0.5, 0.5]. */
export function waveSample(w: number, t: number, noise: NoiseState): number {
  switch (w) {
    case 0: // triangle
      return (Math.abs(4 * t - 2) - 1) * 0.5;
    case 1: {
      // tilted saw: rises for 7/8, falls for 1/8
      const a = 0.875;
      return (t < a ? t / a : (1 - t) / (1 - a)) - 0.5;
    }
    case 2: // saw
      return (t < 0.5 ? t : t - 1) * 0.65;
    case 3: // square
      return t < 0.5 ? 0.25 : -0.25;
    case 4: // pulse (1/3 duty)
      return t < 0.3125 ? 0.25 : -0.25;
    case 5: // organ: two triangle humps
      return (t < 0.5 ? 3 - Math.abs(24 * t - 6) : 1 - Math.abs(16 * t - 12)) / 9;
    case 6: // noise: sample-and-hold white noise, re-sampled with the phase for pitch control
      return noise.sample(t);
    case 7: {
      // phaser: two detuned triangles
      const a = Math.abs(((t * 2) % 2) - 1) - 0.5;
      const b = Math.abs(((t * (127 / 64)) % 2) - 1) - 0.5;
      return (a + b / 2) * 0.7;
    }
    default:
      return 0;
  }
}

export class NoiseState {
  private value = 0;
  private lastT = 0;
  private seed = 0x1234567;
  private rand(): number {
    // xorshift32
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 0x100000000 - 0.5;
  }
  sample(t: number): number {
    // new random value on each half cycle: higher pitch = brighter noise
    const half = t < 0.5 ? 0 : 0.5;
    if (half !== this.lastT) {
      this.lastT = half;
      this.value = this.rand() * 0.5 + this.value * 0.5;
    }
    return this.value;
  }
}

interface Voice {
  active: boolean;
  phase: number;
  pitch: number;
  prevPitch: number;
  wave: number;
  vol: number;
  prevVol: number;
  fx: number;
  /** Seconds into the note, and note length. */
  t: number;
  len: number;
  /** Pitches of the 4-note arpeggio group. */
  arp: number[];
  noise: NoiseState;
  /** Smoothed output gain (click-free changes). */
  gain: number;
}

function newVoice(): Voice {
  return { active: false, phase: 0, pitch: 0, prevPitch: 0, wave: 0, vol: 0, prevVol: 0, fx: 0, t: 0, len: 1, arp: [0, 0, 0, 0], noise: new NoiseState(), gain: 0 };
}

export class Synth {
  voices: Voice[] = [newVoice(), newVoice(), newVoice(), newVoice()];
  masterGain = 0.5;

  constructor(
    private readonly sampleRate: number,
    /** Reads a raw note word from sfx memory (for arpeggio groups / instruments). */
    private readonly noteWord: (sfx: number, note: number) => number,
  ) {}

  noteOn(e: NoteEvent): void {
    const v = this.voices[e.channel];
    if (!v) return;
    const w = e.word;
    const pitch = w & 0x3f;
    let wave = (w >> 6) & 7;
    const vol = (w >> 9) & 7;
    const fx = (w >> 12) & 7;
    const custom = (w & 0x8000) !== 0;
    if (custom) {
      // Custom instrument: use the waveform of the instrument sfx's first note.
      wave = (this.noteWord(wave, 0) >> 6) & 7;
    }
    v.prevPitch = v.active ? v.pitch : pitch;
    v.prevVol = v.active ? v.vol : 0;
    v.pitch = pitch;
    v.wave = wave;
    v.vol = vol;
    v.fx = fx;
    v.t = 0;
    v.len = e.speed * TICK_SECONDS;
    v.active = true;
    if (fx === 6 || fx === 7) {
      const base = e.note & ~3;
      v.arp = [0, 1, 2, 3].map((k) => this.noteWord(e.sfx, base + k) & 0x3f);
    }
  }

  stop(channel: number): void {
    const v = this.voices[channel];
    if (v) v.active = false;
  }

  stopAll(): void {
    for (const v of this.voices) v.active = false;
  }

  /** Mixes all voices into `out` (mono), adding to its contents. */
  render(out: Float32Array, start = 0, count = out.length - start): void {
    const dt = 1 / this.sampleRate;
    for (const v of this.voices) {
      if (!v.active && v.gain < 1e-4) continue;
      for (let i = 0; i < count; i++) {
        const progress = Math.min(1, v.t / v.len);
        let pitch = v.pitch;
        let vol = v.vol / 7;
        switch (v.fx) {
          case 1: // slide from the previous note
            pitch = v.prevPitch + (v.pitch - v.prevPitch) * progress;
            vol = (v.prevVol + (v.vol - v.prevVol) * progress) / 7;
            break;
          case 2: // vibrato
            pitch += Math.sin(v.t * Math.PI * 2 * 7.5) * 0.5;
            break;
          case 3: // drop
            pitch *= 1 - progress;
            break;
          case 4: // fade in
            vol *= progress;
            break;
          case 5: // fade out
            vol *= 1 - progress;
            break;
          case 6: // fast arpeggio
          case 7: {
            const step = (v.fx === 6 ? 4 : 8) * TICK_SECONDS;
            pitch = v.arp[Math.floor(v.t / step) % 4] ?? pitch;
            break;
          }
        }
        const target = v.active ? vol : 0;
        // ~2ms smoothing avoids clicks between notes
        v.gain += (target - v.gain) * 0.02;
        const hz = pitchToHz(pitch);
        v.phase += hz * dt;
        v.phase -= Math.floor(v.phase);
        out[start + i]! += waveSample(v.wave, v.phase, v.noise) * v.gain * this.masterGain;
        v.t += dt;
      }
    }
  }
}
