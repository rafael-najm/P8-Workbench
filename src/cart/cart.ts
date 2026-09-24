import {
  GFX_H,
  GFX_SHARED_ROW,
  GFX_W,
  MAP_H,
  MAP_SHARED_ROW,
  MAP_W,
  MUSIC_COUNT,
  SFX_COUNT,
  SFX_NOTES,
  type Cart,
  type MusicPattern,
  type Sfx,
  type SfxNote,
} from './types';

export const DEFAULT_VERSION = 42;

export function emptyNote(): SfxNote {
  return { pitch: 0, waveform: 0, volume: 0, effect: 0, customInstrument: false };
}

/** PICO-8's default for a fresh sfx: speed 1 for sfx 0, 16 for the rest. */
export function emptySfx(index: number): Sfx {
  return {
    editorMode: 0,
    speed: index === 0 ? 1 : 16,
    loopStart: 0,
    loopEnd: 0,
    notes: Array.from({ length: SFX_NOTES }, emptyNote),
  };
}

/** Default music pattern: all four channels disabled (0x41..0x44). */
export function emptyMusic(): MusicPattern {
  return { flags: 0, channels: [0x41, 0x42, 0x43, 0x44] };
}

export function createEmptyCart(code = ''): Cart {
  return {
    version: DEFAULT_VERSION,
    code,
    gfx: new Uint8Array(GFX_W * GFX_H),
    flags: new Uint8Array(256),
    map: new Uint8Array(MAP_W * MAP_H),
    label: null,
    sfx: Array.from({ length: SFX_COUNT }, (_, i) => emptySfx(i)),
    music: Array.from({ length: MUSIC_COUNT }, emptyMusic),
    extraSections: [],
  };
}

// --- Shared gfx/map memory -------------------------------------------------
//
// In PICO-8 memory, 0x1000..0x1fff holds both the bottom half of the
// spritesheet (rows 64..127) and the bottom half of the map (rows 32..63).
// One map row (128 bytes) = two spritesheet rows (2 x 64 bytes, 2 px/byte,
// low nibble = left pixel).

/** Index of the gfx pixel holding the low nibble of shared map byte (x, y). */
function sharedGfxIndex(x: number, y: number): number {
  const byteOffset = (y - MAP_SHARED_ROW) * MAP_W + x; // 0..4095
  const gy = GFX_SHARED_ROW + (byteOffset >> 6);
  const gx = (byteOffset & 63) * 2;
  return gy * GFX_W + gx;
}

export function getGfxPixel(cart: Cart, x: number, y: number): number {
  return cart.gfx[y * GFX_W + x]!;
}

/** Set a spritesheet pixel, keeping the shared map half in sync. */
export function setGfxPixel(cart: Cart, x: number, y: number, color: number): void {
  const c = color & 0x0f;
  cart.gfx[y * GFX_W + x] = c;
  if (y >= GFX_SHARED_ROW) {
    const byteOffset = (y - GFX_SHARED_ROW) * 64 + (x >> 1);
    const my = MAP_SHARED_ROW + (byteOffset >> 7);
    const mx = byteOffset & 127;
    const i = my * MAP_W + mx;
    const old = cart.map[i]!;
    cart.map[i] = x & 1 ? (old & 0x0f) | (c << 4) : (old & 0xf0) | c;
  }
}

export function getMapTile(cart: Cart, x: number, y: number): number {
  return cart.map[y * MAP_W + x]!;
}

/** Set a map tile, keeping the shared spritesheet half in sync. */
export function setMapTile(cart: Cart, x: number, y: number, tile: number): void {
  const v = tile & 0xff;
  cart.map[y * MAP_W + x] = v;
  if (y >= MAP_SHARED_ROW) {
    const gi = sharedGfxIndex(x, y);
    cart.gfx[gi] = v & 0x0f;
    cart.gfx[gi + 1] = v >> 4;
  }
}

/** Recompute map rows 32..63 from the spritesheet (gfx is the source of truth). */
export function syncMapFromGfx(cart: Cart): void {
  for (let y = MAP_SHARED_ROW; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const gi = sharedGfxIndex(x, y);
      cart.map[y * MAP_W + x] = (cart.gfx[gi]! & 0x0f) | ((cart.gfx[gi + 1]! & 0x0f) << 4);
    }
  }
}

/** Recompute spritesheet rows 64..127 from the map (map is the source of truth). */
export function syncGfxFromMap(cart: Cart): void {
  for (let y = MAP_SHARED_ROW; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const v = cart.map[y * MAP_W + x]!;
      const gi = sharedGfxIndex(x, y);
      cart.gfx[gi] = v & 0x0f;
      cart.gfx[gi + 1] = v >> 4;
    }
  }
}

/** Deep copy (the round-trip layout is shared: it is immutable). */
export function cloneCart(cart: Cart): Cart {
  return {
    ...cart,
    gfx: cart.gfx.slice(),
    flags: cart.flags.slice(),
    map: cart.map.slice(),
    label: cart.label ? cart.label.slice() : null,
    sfx: cart.sfx.map((s) => ({ ...s, notes: s.notes.map((n) => ({ ...n })) })),
    music: cart.music.map((m) => ({ flags: m.flags, channels: [...m.channels] as MusicPattern['channels'] })),
    extraSections: cart.extraSections.map((s) => ({ name: s.name, lines: [...s.lines] })),
  };
}
