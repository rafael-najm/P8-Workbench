/** Screen memory (4bpp at 0x6000) -> RGBA pixels, through the screen palette. */
import { ADDR } from './memory';
import { PALETTE_RGBA32, screenColorIndex } from './palette';

const lut = new Uint32Array(16);

/** Fills `out` (128*128 packed RGBA, little-endian) from memory. */
export function renderScreen(ram: Uint8Array, out: Uint32Array): void {
  for (let c = 0; c < 16; c++) lut[c] = PALETTE_RGBA32[screenColorIndex(ram[ADDR.screenPal + c]!)]!;
  let o = 0;
  for (let a = ADDR.screen; a < ADDR.screen + 0x2000; a++) {
    const b = ram[a]!;
    out[o++] = lut[b & 0x0f]!;
    out[o++] = lut[b >> 4]!;
  }
}

/** Screen as 128*128 color indices (after the screen palette, 0-15 or 128-143). */
export function screenIndices(ram: Uint8Array): Uint8Array {
  const out = new Uint8Array(128 * 128);
  let o = 0;
  for (let a = ADDR.screen; a < ADDR.screen + 0x2000; a++) {
    const b = ram[a]!;
    out[o++] = ram[ADDR.screenPal + (b & 0x0f)]!;
    out[o++] = ram[ADDR.screenPal + (b >> 4)]!;
  }
  return out;
}
