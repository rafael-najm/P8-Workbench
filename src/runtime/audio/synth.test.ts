import { describe, expect, it } from 'vitest';
import { NoiseState, pitchToHz, Synth, waveSample } from './synth';
import { TICK_SECONDS } from './sequencer';

const SR = 44100;

function note(pitch: number, wave: number, vol: number, fx = 0) {
  return pitch | (wave << 6) | (vol << 9) | (fx << 12);
}

function render(s: Synth, seconds: number): Float32Array {
  const out = new Float32Array(Math.floor(SR * seconds));
  s.render(out);
  return out;
}

function zeroCrossings(buf: Float32Array, from = 0): number {
  let n = 0;
  for (let i = from + 1; i < buf.length; i++) if ((buf[i - 1]! < 0) !== (buf[i]! < 0)) n++;
  return n;
}

function rms(buf: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += buf[i]! ** 2;
  return Math.sqrt(s / (to - from));
}

describe('synth', () => {
  it('pitch 33 is A (440 Hz), 12 steps per octave', () => {
    expect(pitchToHz(33)).toBeCloseTo(440);
    expect(pitchToHz(45)).toBeCloseTo(880);
  });

  it('every waveform produces bounded, non-silent output', () => {
    const noise = new NoiseState();
    for (let w = 0; w < 8; w++) {
      let peak = 0;
      for (let i = 0; i < 1000; i++) peak = Math.max(peak, Math.abs(waveSample(w, (i * 0.0137) % 1, noise)));
      expect(peak).toBeGreaterThan(0.05);
      expect(peak).toBeLessThanOrEqual(0.6);
    }
  });

  it('plays a square wave at the right frequency', () => {
    const s = new Synth(SR, () => 0);
    s.noteOn({ channel: 0, sfx: 0, note: 0, word: note(33, 3, 7), speed: 255, isMusic: false });
    const buf = render(s, 0.5);
    const hz = zeroCrossings(buf, 2000) / 2 / ((buf.length - 2000) / SR);
    expect(hz).toBeGreaterThan(430);
    expect(hz).toBeLessThan(450);
  });

  it('volume 0 is silent; fade out decays', () => {
    const silent = new Synth(SR, () => 0);
    silent.noteOn({ channel: 1, sfx: 0, note: 0, word: note(33, 0, 0), speed: 10, isMusic: false });
    expect(rms(render(silent, 0.05), 0, 2000)).toBeLessThan(1e-3);

    const s = new Synth(SR, () => 0);
    s.noteOn({ channel: 0, sfx: 0, note: 0, word: note(30, 3, 7, 5), speed: 30, isMusic: false });
    const len = Math.floor(30 * TICK_SECONDS * SR);
    const buf = render(s, (len * 1.0) / SR);
    expect(rms(buf, 200, len / 4)).toBeGreaterThan(rms(buf, (3 * len) / 4, len - 1) * 2);
  });

  it('slide moves from the previous pitch', () => {
    const s = new Synth(SR, () => 0);
    s.noteOn({ channel: 0, sfx: 0, note: 0, word: note(12, 3, 7), speed: 10, isMusic: false });
    render(s, 0.01);
    s.noteOn({ channel: 0, sfx: 0, note: 1, word: note(48, 3, 7, 1), speed: 60, isMusic: false });
    const buf = render(s, 60 * TICK_SECONDS);
    const q = Math.floor(buf.length / 4);
    expect(zeroCrossings(buf.subarray(3 * q))).toBeGreaterThan(zeroCrossings(buf.subarray(0, q)) * 2);
  });

  it('stop silences the voice', () => {
    const s = new Synth(SR, () => 0);
    s.noteOn({ channel: 2, sfx: 0, note: 0, word: note(33, 2, 7), speed: 200, isMusic: false });
    render(s, 0.05);
    s.stop(2);
    const buf = render(s, 0.1);
    expect(rms(buf, buf.length - 500, buf.length)).toBeLessThan(1e-3);
  });
});
