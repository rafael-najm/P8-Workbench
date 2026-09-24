/**
 * Main-thread audio engine: owns the AudioContext and the worklet. The
 * game backend keeps a local Sequencer for stat() and forwards commands.
 */
import workletUrl from './worklet.ts?worker&url';
import { ADDR } from '../memory';
import type { AudioBackend, ChannelState } from './backend';
import { Sequencer } from './sequencer';
import type { AudioMessage } from './worklet';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private starting: Promise<void> | null = null;
  private queue: AudioMessage[] = [];
  private volume = 0.8;
  muted = false;

  /** Creates/resumes the audio context. Call from a user gesture. */
  ensure(): Promise<void> {
    if (this.ctx?.state === 'suspended') void this.ctx.resume();
    this.starting ??= (async () => {
      if (typeof AudioContext === 'undefined') return;
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'p8-audio', { outputChannelCount: [2] });
      node.connect(ctx.destination);
      this.node = node;
      this.post({ type: 'volume', value: this.muted ? 0 : this.volume });
      for (const m of this.queue) node.port.postMessage(m);
      this.queue = [];
      if (ctx.state === 'suspended') await ctx.resume();
    })().catch((e: unknown) => {
      console.warn('audio unavailable', e);
    });
    return this.starting;
  }

  post(m: AudioMessage): void {
    if (this.node) this.node.port.postMessage(m);
    else if (this.queue.length < 64) this.queue.push(m);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.post({ type: 'volume', value: muted ? 0 : this.volume });
  }

  sendMemory(target: 'game' | 'preview', ram: Uint8Array): void {
    this.post({ target, type: 'mem', bytes: ram.slice(ADDR.music, ADDR.cartEnd) });
  }

  /** Backend for a Machine running interactively. */
  gameBackend(ram: Uint8Array): AudioBackend {
    return new WorkletBackend(this, ram);
  }

  /** Plays an sfx or music pattern from the editors (independent of the game). */
  preview(ram: Uint8Array, what: { sfx?: number; music?: number }): void {
    void this.ensure();
    this.post({ target: 'preview', type: 'stop' });
    this.sendMemory('preview', ram);
    if (what.sfx !== undefined) this.post({ target: 'preview', type: 'sfx', n: what.sfx, channel: 0, offset: 0, length: 0 });
    if (what.music !== undefined) this.post({ target: 'preview', type: 'music', n: what.music, fade: 0, mask: 0 });
  }

  stopPreview(): void {
    this.post({ target: 'preview', type: 'stop' });
  }
}

class WorkletBackend implements AudioBackend {
  private local: Sequencer;
  constructor(
    private readonly engine: AudioEngine,
    private readonly ram: Uint8Array,
  ) {
    this.local = new Sequencer(ram);
  }
  sfx(n: number, channel: number, offset: number, length: number): void {
    this.local.sfx(n, channel, offset, length);
    this.engine.sendMemory('game', this.ram);
    this.engine.post({ target: 'game', type: 'sfx', n, channel, offset, length });
  }
  music(n: number, fadeMs: number, channelMask: number): void {
    this.local.music(n, fadeMs, channelMask);
    this.engine.sendMemory('game', this.ram);
    this.engine.post({ target: 'game', type: 'music', n, fade: fadeMs, mask: channelMask });
  }
  tick(dt: number): void {
    this.local.tick(dt);
  }
  channel(i: number): ChannelState {
    return this.local.channel(i);
  }
  musicState() {
    return this.local.musicState();
  }
  stopAll(): void {
    this.local.stopAll();
    this.engine.post({ target: 'game', type: 'stop' });
  }
  setPaused(paused: boolean): void {
    this.local.setPaused(paused);
    this.engine.post({ target: 'game', type: 'pause', paused });
  }
}

export const audio = new AudioEngine();
