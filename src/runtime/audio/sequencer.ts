/**
 * PICO-8 sfx/music sequencer: timing, loops, channel allocation and music
 * patterns, read live from memory. Produces no sound by itself; the synth
 * (M6) listens to note events. Headless runs use it alone for stat().
 */
import { ADDR } from '../memory';
import type { AudioBackend, ChannelState } from './backend';

/** One sfx tick: 183 samples at 22050 Hz. A note lasts `speed` ticks. */
export const TICK_SECONDS = 183 / 22050;

export interface NoteEvent {
  channel: number;
  sfx: number;
  note: number;
  /** Raw 16-bit note word from memory. */
  word: number;
  /** Speed of the sfx (ticks per note). */
  speed: number;
  /** Whether the next note will be from the same sfx (for slides/legato). */
  isMusic: boolean;
}

interface Channel {
  sfx: number;
  note: number;
  /** Seconds elapsed within the current note. */
  time: number;
  /** Last note index + 1 allowed by sfx(n, ch, offset, length). */
  end: number;
  music: boolean;
  /** Loop released by sfx(-2): play to the end instead of looping. */
  released: boolean;
}

export interface SequencerListener {
  noteOn(e: NoteEvent): void;
  channelStop(channel: number): void;
}

export class Sequencer implements AudioBackend {
  private channels: Channel[] = [0, 1, 2, 3].map(() => idle());
  private musicPattern = -1;
  private musicCount = 0;
  private musicTime = 0;
  private musicLength = 0;
  private musicMask = 0;
  private musicLoopStart = 0;
  private paused = false;
  listener: SequencerListener | null = null;

  constructor(private readonly ram: Uint8Array) {}

  private sfxHeader(n: number) {
    const base = ADDR.sfx + n * 68;
    return {
      speed: Math.max(1, this.ram[base + 65]!),
      loopStart: this.ram[base + 66]!,
      loopEnd: this.ram[base + 67]!,
    };
  }

  private noteWord(n: number, i: number): number {
    const a = ADDR.sfx + n * 68 + i * 2;
    return this.ram[a]! | (this.ram[a + 1]! << 8);
  }

  /** Number of notes an sfx plays when not looping (the "length" rule when loop end is 0). */
  private sfxLength(n: number): number {
    const h = this.sfxHeader(n);
    if (h.loopEnd === 0 && h.loopStart > 0) return Math.min(32, h.loopStart);
    return 32;
  }

  private looping(n: number): boolean {
    const h = this.sfxHeader(n);
    return h.loopEnd > h.loopStart;
  }

  private start(ch: number, n: number, offset: number, length: number, music: boolean) {
    const c = this.channels[ch]!;
    c.sfx = n;
    c.note = Math.max(0, Math.min(31, offset));
    c.time = 0;
    c.end = length > 0 ? Math.min(32, c.note + length) : 32;
    c.music = music;
    c.released = false;
    this.emitNote(ch);
  }

  private stop(ch: number) {
    const c = this.channels[ch]!;
    if (c.sfx < 0) return;
    this.channels[ch] = idle();
    this.listener?.channelStop(ch);
  }

  private emitNote(ch: number) {
    const c = this.channels[ch]!;
    if (!this.listener || c.sfx < 0) return;
    this.listener.noteOn({
      channel: ch,
      sfx: c.sfx,
      note: c.note,
      word: this.noteWord(c.sfx, c.note),
      speed: this.sfxHeader(c.sfx).speed,
      isMusic: c.music,
    });
  }

  // --- AudioBackend -----------------------------------------------------------------

  sfx(n: number, channel = -1, offset = 0, length = 0): void {
    n = Math.floor(n);
    channel = Math.floor(channel);
    if (n === -1) {
      if (channel >= 0 && channel < 4) this.stop(channel);
      else for (let i = 0; i < 4; i++) if (!this.channels[i]!.music) this.stop(i);
      return;
    }
    if (n === -2) {
      for (let i = 0; i < 4; i++) if (channel < 0 || i === channel) this.channels[i]!.released = true;
      return;
    }
    if (n < 0 || n > 63) return;
    if (channel === -2) {
      for (let i = 0; i < 4; i++) if (this.channels[i]!.sfx === n) this.stop(i);
      return;
    }
    let ch = channel;
    if (ch < 0 || ch > 3) {
      // Same sfx already playing restarts there; else a free channel not reserved by music.
      ch = this.channels.findIndex((c) => c.sfx === n && !c.music);
      if (ch < 0) ch = this.channels.findIndex((c, i) => c.sfx < 0 && !((this.musicMask >> i) & 1));
      if (ch < 0) ch = this.channels.findIndex((c) => c.sfx < 0);
      if (ch < 0) ch = this.channels.findIndex((c, i) => !c.music && !((this.musicMask >> i) & 1));
      if (ch < 0) ch = 3;
    }
    this.start(ch, n, Math.floor(offset), Math.floor(length), false);
  }

  music(n: number, _fadeMs = 0, channelMask = 0): void {
    n = Math.floor(n);
    if (n < 0) {
      for (let i = 0; i < 4; i++) if (this.channels[i]!.music) this.stop(i);
      this.musicPattern = -1;
      this.musicMask = 0;
      return;
    }
    this.musicMask = channelMask & 0xf;
    this.musicCount = 0;
    this.musicLoopStart = n;
    this.startPattern(n & 63);
  }

  private patternBytes(p: number): number[] {
    return [0, 1, 2, 3].map((ch) => this.ram[ADDR.music + p * 4 + ch]!);
  }

  private startPattern(p: number) {
    const bytes = this.patternBytes(p);
    if (bytes[0]! & 0x80) this.musicLoopStart = p;
    this.musicPattern = p;
    this.musicTime = 0;
    let length = 0;
    let fallback = 0;
    bytes.forEach((b, ch) => {
      const disabled = (b & 0x40) !== 0;
      if (disabled) {
        if (this.channels[ch]!.music) this.stop(ch);
        return;
      }
      const n = b & 0x3f;
      this.start(ch, n, 0, 0, true);
      const dur = this.sfxLength(n) * this.sfxHeader(n).speed * TICK_SECONDS;
      if (!fallback) fallback = dur;
      if (!length && !this.looping(n)) length = dur;
    });
    this.musicLength = length || fallback;
    if (!this.musicLength) this.musicLength = 32 * 16 * TICK_SECONDS;
  }

  private nextPattern() {
    const p = this.musicPattern;
    const bytes = this.patternBytes(p);
    this.musicCount++;
    if (bytes[2]! & 0x80) {
      this.music(-1);
      return;
    }
    if (bytes[1]! & 0x80) {
      this.startPattern(this.musicLoopStart);
      return;
    }
    if (p + 1 > 63) {
      this.music(-1);
      return;
    }
    this.startPattern(p + 1);
  }

  tick(dt: number): void {
    if (this.paused) return;
    for (let ch = 0; ch < 4; ch++) {
      const c = this.channels[ch]!;
      if (c.sfx < 0) continue;
      c.time += dt;
      let dur = this.sfxHeader(c.sfx).speed * TICK_SECONDS;
      while (c.sfx >= 0 && c.time >= dur) {
        c.time -= dur;
        const h = this.sfxHeader(c.sfx);
        let next = c.note + 1;
        if (!c.released && h.loopEnd > h.loopStart && next >= h.loopEnd) next = h.loopStart;
        const limit = Math.min(c.end, this.looping(c.sfx) && !c.released ? 32 : this.sfxLength(c.sfx));
        if (next >= limit) {
          if (c.music) {
            // hold silence until the pattern ends
            c.note = 32;
            c.sfx = -1;
            this.listener?.channelStop(ch);
          } else {
            this.stop(ch);
          }
          break;
        }
        c.note = next;
        this.emitNote(ch);
        dur = this.sfxHeader(c.sfx).speed * TICK_SECONDS;
      }
    }
    if (this.musicPattern >= 0) {
      this.musicTime += dt;
      if (this.musicTime >= this.musicLength) this.nextPattern();
    }
  }

  channel(i: number): ChannelState {
    const c = this.channels[i];
    if (!c || c.sfx < 0) return { sfx: -1, note: -1 };
    return { sfx: c.sfx, note: c.note };
  }

  musicState() {
    return {
      pattern: this.musicPattern,
      count: this.musicCount,
      ticks: Math.floor(this.musicTime / TICK_SECONDS),
      playing: this.musicPattern >= 0,
    };
  }

  stopAll(): void {
    for (let i = 0; i < 4; i++) this.stop(i);
    this.musicPattern = -1;
    this.musicMask = 0;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }
}

function idle(): Channel {
  return { sfx: -1, note: -1, time: 0, end: 32, music: false, released: false };
}
