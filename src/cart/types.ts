/** In-memory representation of a PICO-8 cartridge. */

export const GFX_W = 128;
export const GFX_H = 128;
export const MAP_W = 128;
export const MAP_H = 64;
/** Map rows >= this share memory with the bottom half of the spritesheet. */
export const MAP_SHARED_ROW = 32;
/** First spritesheet row shared with the map. */
export const GFX_SHARED_ROW = 64;
export const SFX_COUNT = 64;
export const SFX_NOTES = 32;
export const MUSIC_COUNT = 64;

export interface SfxNote {
  /** 0..63 (c0..d#5) */
  pitch: number;
  /** 0..7 */
  waveform: number;
  /** 0..7 */
  volume: number;
  /** 0..7 */
  effect: number;
  /** When true, `waveform` refers to sfx 0..7 used as an instrument. */
  customInstrument: boolean;
}

export interface Sfx {
  /** Byte 0 of the sfx header: editor mode (bit 0) + filter bits. */
  editorMode: number;
  speed: number;
  loopStart: number;
  loopEnd: number;
  notes: SfxNote[];
}

export interface MusicPattern {
  /** 1 = loop start, 2 = loop end, 4 = stop. */
  flags: number;
  /** 4 channel bytes. Bit 6 set = channel disabled; bits 0..5 = sfx index. */
  channels: [number, number, number, number];
}

export const MUSIC_FLAG_LOOP_START = 1;
export const MUSIC_FLAG_LOOP_END = 2;
export const MUSIC_FLAG_STOP = 4;
export const MUSIC_CHANNEL_DISABLED = 0x40;

/**
 * Raw text of a section as read from disk, together with the canonical
 * serialization of what was parsed from it. When the section's data still
 * serializes to `canonical`, the serializer emits `raw` verbatim, so files
 * with non-canonical formatting (short lines, extra rows...) round-trip
 * byte-for-byte.
 */
export interface SectionSource {
  raw: string;
  canonical: string;
}

export interface Cart {
  /** The `version N` header value. */
  version: number;
  /** Lua source, as unicode text (glyphs are unicode characters). */
  code: string;
  /** 128*128 color indices (0..15), row-major. Rows 64..127 are shared with map rows 32..63. */
  gfx: Uint8Array;
  /** 256 sprite flag bytes. */
  flags: Uint8Array;
  /** 128*64 tile indices, row-major. Rows 32..63 mirror gfx rows 64..127. */
  map: Uint8Array;
  /** 128*128 label pixels (0..31: 16..31 are the secret palette), or null if absent. */
  label: Uint8Array | null;
  sfx: Sfx[];
  music: MusicPattern[];
  /** Sections this library does not model (e.g. `__meta:*__`), kept verbatim. */
  extraSections: { name: string; lines: string[] }[];
  /** Internal bookkeeping for lossless round-trips. */
  source?: CartFileLayout;
}

export interface CartFileLayout {
  /** Header lines (everything before the first section). */
  header: string;
  /** Cart version as parsed; the raw header is reused while it is unchanged. */
  version: number;
  /** Section order as found in the file. */
  order: string[];
  sections: Record<string, SectionSource>;
  /** Line terminator detected in the file. */
  eol: '\n' | '\r\n';
}
