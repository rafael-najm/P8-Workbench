/**
 * AudioWorklet processor: runs a Sequencer + Synth per "player" at audio
 * rate (sample-accurate note timing). Players: "game" (the running cart) and
 * "preview" (sfx/music editors, agent's play_sfx). Memory for sfx/music is
 * sent by the main thread.
 */
import { ADDR } from '../memory';
import { Sequencer } from './sequencer';
import { Synth } from './synth';

// Minimal AudioWorklet typings (not part of the DOM lib).
declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: new () => object): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

export type AudioMessage =
  | { target: Target; type: 'mem'; bytes: Uint8Array }
  | { target: Target; type: 'sfx'; n: number; channel: number; offset: number; length: number }
  | { target: Target; type: 'music'; n: number; fade: number; mask: number }
  | { target: Target; type: 'stop' }
  | { target: Target; type: 'pause'; paused: boolean }
  | { type: 'volume'; value: number };

type Target = 'game' | 'preview';

class Player {
  ram = new Uint8Array(0x10000);
  seq = new Sequencer(this.ram);
  synth = new Synth(sampleRate, (sfx, note) => {
    const a = ADDR.sfx + (sfx & 63) * 68 + (note & 31) * 2;
    return this.ram[a]! | (this.ram[a + 1]! << 8);
  });
  paused = false;
  fade = 1;
  fadeStep = 0;
  constructor() {
    this.seq.listener = {
      noteOn: (e) => this.synth.noteOn(e),
      channelStop: (ch) => this.synth.stop(ch),
    };
  }
}

const BLOCK = 32;

class P8Processor extends AudioWorkletProcessor {
  players: Record<Target, Player> = { game: new Player(), preview: new Player() };
  volume = 1;
  mix = new Float32Array(128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<AudioMessage>) => this.handle(e.data);
  }

  handle(m: AudioMessage) {
    if (m.type === 'volume') {
      this.volume = m.value;
      return;
    }
    const p = this.players[m.target];
    switch (m.type) {
      case 'mem':
        p.ram.set(m.bytes, ADDR.music);
        break;
      case 'sfx':
        p.seq.sfx(m.n, m.channel, m.offset, m.length);
        break;
      case 'music':
        p.seq.music(m.n, m.fade, m.mask);
        if (m.n >= 0 && m.fade > 0) {
          p.fade = 0;
          p.fadeStep = 1 / ((m.fade / 1000) * sampleRate);
        }
        break;
      case 'stop':
        p.seq.stopAll();
        p.synth.stopAll();
        break;
      case 'pause':
        p.paused = m.paused;
        p.seq.setPaused(m.paused);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const n = out[0].length;
    if (this.mix.length !== n) this.mix = new Float32Array(n);
    const mix = this.mix;
    mix.fill(0);
    for (const p of Object.values(this.players)) {
      if (p.paused) continue;
      for (let i = 0; i < n; i += BLOCK) {
        const count = Math.min(BLOCK, n - i);
        p.seq.tick(count / sampleRate);
        p.synth.render(mix, i, count);
      }
      if (p.fade < 1) {
        // music fade-in (applied to the whole player, cheap and good enough)
        for (let i = 0; i < n; i++) {
          p.fade = Math.min(1, p.fade + p.fadeStep);
          mix[i]! *= p.fade;
        }
      }
    }
    const v = this.volume;
    for (let i = 0; i < n; i++) {
      const s = Math.max(-1, Math.min(1, mix[i]! * v));
      for (const ch of out) ch[i] = s;
    }
    return true;
  }
}

registerProcessor('p8-audio', P8Processor);
