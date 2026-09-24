/**
 * Audio backend contract used by the runtime's sfx()/music() and stat().
 * The WebAudio synthesizer (M6) implements it; headless runs use the
 * sequencer alone, which tracks channel state without producing sound.
 */
export interface ChannelState {
  /** sfx playing on the channel, or -1. */
  sfx: number;
  /** note index within the sfx, or -1. */
  note: number;
}

export interface AudioBackend {
  sfx(n: number, channel: number, offset: number, length: number): void;
  music(n: number, fadeMs: number, channelMask: number): void;
  /** Advances the sequencer by one game frame (1/fps seconds). */
  tick(dt: number): void;
  channel(i: number): ChannelState;
  /** Current music pattern or -1, patterns played, ticks on the pattern. */
  musicState(): { pattern: number; count: number; ticks: number; playing: boolean };
  /** Stops everything (on reset/stop). */
  stopAll(): void;
  setPaused(paused: boolean): void;
}
