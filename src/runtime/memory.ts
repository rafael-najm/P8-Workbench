/**
 * The 64 KiB PICO-8 address space and cart <-> memory conversion.
 *
 * 0x0000 spritesheet (0x1000-0x1fff shared with map rows 32-63)
 * 0x2000 map rows 0-31
 * 0x3000 sprite flags
 * 0x3100 music (64 x 4 bytes)
 * 0x3200 sfx (64 x 68 bytes)
 * 0x4300 general use
 * 0x5e00 persistent cart data (64 x 4 bytes)
 * 0x5f00 draw state
 * 0x6000 screen (128x128, 4 bits per pixel, low nibble = left pixel)
 * 0x8000 upper memory (general use)
 */
import { syncMapFromGfx } from '../cart/cart';
import type { Cart, Sfx } from '../cart/types';

export const MEM_SIZE = 0x10000;
export const ADDR = {
  gfx: 0x0000,
  mapShared: 0x1000,
  map: 0x2000,
  flags: 0x3000,
  music: 0x3100,
  sfx: 0x3200,
  cartEnd: 0x4300,
  persistent: 0x5e00,
  drawPal: 0x5f00,
  screenPal: 0x5f10,
  clip: 0x5f20,
  penColor: 0x5f25,
  cursorX: 0x5f26,
  cursorY: 0x5f27,
  camera: 0x5f28,
  screenMode: 0x5f2c,
  devkit: 0x5f2d,
  palPersist: 0x5f2e,
  fillp: 0x5f31,
  fillpFlags: 0x5f33,
  colorFillp: 0x5f34,
  lineValid: 0x5f35,
  printAttrs: 0x5f58,
  btnpDelay: 0x5f5c,
  btnpRepeat: 0x5f5d,
  secondaryPal: 0x5f60,
  lineX: 0x5f3c,
  lineY: 0x5f3e,
  screen: 0x6000,
} as const;

export class Memory {
  readonly ram = new Uint8Array(MEM_SIZE);
  /** Cart ROM image (0x0000-0x42ff) for reload()/cstore(). */
  rom: Uint8Array = new Uint8Array(ADDR.cartEnd);

  peek(addr: number): number {
    return this.ram[addr & 0xffff]!;
  }

  poke(addr: number, v: number): void {
    this.ram[addr & 0xffff] = v;
  }

  peek2(addr: number): number {
    const v = this.peek(addr) | (this.peek(addr + 1) << 8);
    return v >= 0x8000 ? v - 0x10000 : v;
  }

  poke2(addr: number, v: number): void {
    this.poke(addr, v & 0xff);
    this.poke(addr + 1, (v >> 8) & 0xff);
  }

  /** Reads a 16.16 value. */
  peek4(addr: number): number {
    const raw = this.peek(addr) | (this.peek(addr + 1) << 8) | (this.peek(addr + 2) << 16) | (this.peek(addr + 3) << 24);
    return raw / 65536;
  }

  /** Writes a 16.16 value. */
  poke4(addr: number, v: number): void {
    const raw = toFixRaw(v);
    this.poke(addr, raw & 0xff);
    this.poke(addr + 1, (raw >>> 8) & 0xff);
    this.poke(addr + 2, (raw >>> 16) & 0xff);
    this.poke(addr + 3, (raw >>> 24) & 0xff);
  }

  memcpy(dest: number, src: number, len: number): void {
    if (len <= 0) return;
    if (dest + len <= MEM_SIZE && src + len <= MEM_SIZE && dest >= 0 && src >= 0) {
      this.ram.copyWithin(dest, src, src + len);
      return;
    }
    const tmp = new Uint8Array(len);
    for (let i = 0; i < len; i++) tmp[i] = this.peek(src + i);
    for (let i = 0; i < len; i++) this.poke(dest + i, tmp[i]!);
  }

  memset(dest: number, v: number, len: number): void {
    if (len <= 0) return;
    for (let i = 0; i < len; i++) this.poke(dest + i, v);
  }

  /** Copies from the cart ROM (reload). */
  reload(dest = 0, src = 0, len: number = ADDR.cartEnd): void {
    for (let i = 0; i < len; i++) {
      const s = src + i;
      this.poke(dest + i, s >= 0 && s < this.rom.length ? this.rom[s]! : 0);
    }
  }

  /** Copies to the cart ROM (cstore). */
  cstore(dest = 0, src = 0, len: number = ADDR.cartEnd): void {
    for (let i = 0; i < len; i++) {
      const d = dest + i;
      if (d >= 0 && d < this.rom.length) this.rom[d] = this.peek(src + i);
    }
  }
}

/** Number -> signed 32-bit 16.16 raw value (floor, wrapping). */
export function toFixRaw(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const scaled = Math.floor(v * 65536);
  if (Math.abs(scaled) < 2 ** 31) return scaled | 0;
  return Number(BigInt.asIntN(32, BigInt(scaled)));
}

// --- cart <-> memory -------------------------------------------------------------

function sfxToBytes(sfx: Sfx, out: Uint8Array, offset: number) {
  sfx.notes.forEach((n, i) => {
    const v =
      (n.pitch & 0x3f) |
      ((n.waveform & 0x7) << 6) |
      ((n.volume & 0x7) << 9) |
      ((n.effect & 0x7) << 12) |
      (n.customInstrument ? 0x8000 : 0);
    out[offset + i * 2] = v & 0xff;
    out[offset + i * 2 + 1] = v >> 8;
  });
  out[offset + 64] = sfx.editorMode;
  out[offset + 65] = sfx.speed;
  out[offset + 66] = sfx.loopStart;
  out[offset + 67] = sfx.loopEnd;
}

export function sfxFromBytes(bytes: Uint8Array, offset: number): Sfx {
  const notes = [];
  for (let i = 0; i < 32; i++) {
    const v = bytes[offset + i * 2]! | (bytes[offset + i * 2 + 1]! << 8);
    notes.push({
      pitch: v & 0x3f,
      waveform: (v >> 6) & 0x7,
      volume: (v >> 9) & 0x7,
      effect: (v >> 12) & 0x7,
      customInstrument: (v & 0x8000) !== 0,
    });
  }
  return {
    notes,
    editorMode: bytes[offset + 64]!,
    speed: bytes[offset + 65]!,
    loopStart: bytes[offset + 66]!,
    loopEnd: bytes[offset + 67]!,
  };
}

/** Builds the 0x4300-byte ROM image of a cart. */
export function cartToRom(cart: Cart): Uint8Array {
  const rom = new Uint8Array(ADDR.cartEnd);
  for (let i = 0; i < 128 * 128; i += 2) rom[ADDR.gfx + (i >> 1)] = (cart.gfx[i]! & 0xf) | ((cart.gfx[i + 1]! & 0xf) << 4);
  // map rows 0..31 (rows 32..63 are already in the gfx bytes)
  rom.set(cart.map.subarray(0, 128 * 32), ADDR.map);
  rom.set(cart.flags, ADDR.flags);
  cart.music.forEach((m, i) => {
    for (let ch = 0; ch < 4; ch++) {
      const flagBit = (m.flags >> ch) & 1;
      rom[ADDR.music + i * 4 + ch] = (m.channels[ch]! & 0x7f) | (flagBit << 7);
    }
  });
  cart.sfx.forEach((s, i) => sfxToBytes(s, rom, ADDR.sfx + i * 68));
  return rom;
}

/** Writes a ROM image back into the editable parts of a cart (gfx, map, flags, sfx, music). */
export function romToCart(rom: Uint8Array, cart: Cart): void {
  for (let i = 0; i < 128 * 64; i++) {
    const b = rom[ADDR.gfx + i]!;
    cart.gfx[i * 2] = b & 0xf;
    cart.gfx[i * 2 + 1] = b >> 4;
  }
  cart.map.set(rom.subarray(ADDR.map, ADDR.map + 128 * 32));
  syncMapFromGfx(cart);
  cart.flags.set(rom.subarray(ADDR.flags, ADDR.flags + 256));
  for (let i = 0; i < 64; i++) {
    const bytes = [0, 1, 2, 3].map((ch) => rom[ADDR.music + i * 4 + ch]!);
    cart.music[i] = {
      flags: bytes.reduce((f, b, ch) => f | (((b >> 7) & 1) << ch), 0),
      channels: [bytes[0]! & 0x7f, bytes[1]! & 0x7f, bytes[2]! & 0x7f, bytes[3]! & 0x7f],
    };
    cart.sfx[i] = sfxFromBytes(rom, ADDR.sfx + i * 68);
  }
}
