import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloneCart, createEmptyCart, getMapTile, setGfxPixel, setMapTile } from './cart';
import { parseP8, serializeP8, serializeP8Canonical } from './p8format';
import { MUSIC_CHANNEL_DISABLED } from './types';

const NEBULA = readFileSync(new URL('../../samples/nebula_strike.p8', import.meta.url), 'utf8');

describe('nebula_strike.p8', () => {
  const cart = parseP8(NEBULA);

  it('round-trips byte-for-byte', () => {
    expect(serializeP8(cart)).toBe(NEBULA);
  });

  it('round-trips after a deep clone', () => {
    expect(serializeP8(cloneCart(cart))).toBe(NEBULA);
  });

  it('parses the header and code', () => {
    expect(cart.version).toBe(42);
    expect(cart.code.startsWith('-- nebula strike\n')).toBe(true);
    expect(cart.code).toContain('❎');
    expect(cart.code.endsWith('end')).toBe(true);
  });

  it('parses gfx', () => {
    // First gfx row: "0000000000077000..."
    expect(Array.from(cart.gfx.subarray(8, 16))).toEqual([0, 0, 0, 7, 7, 0, 0, 0]);
  });

  it('parses sfx, including short lines', () => {
    expect(cart.sfx[0]).toMatchObject({ editorMode: 0, speed: 1, loopStart: 4, loopEnd: 0 });
    expect(cart.sfx[0]!.notes[0]).toEqual({ pitch: 0x3a, waveform: 4, volume: 2, effect: 0, customInstrument: false });
    expect(cart.sfx[63]!.speed).toBe(16);
    expect(cart.sfx[63]!.notes.every((n) => n.volume === 0)).toBe(true);
  });

  it('parses music', () => {
    expect(cart.music[0]).toEqual({ flags: 1, channels: [0x10, 0x14, 0x18, 0x44] });
    expect(cart.music[3]!.flags).toBe(2);
    expect(cart.music[4]!.channels.every((c) => (c & MUSIC_CHANNEL_DISABLED) !== 0)).toBe(true);
  });

  it('re-serializes only the modified section', () => {
    const edited = cloneCart(cart);
    edited.code = edited.code.replace('-- nebula strike', '-- nebula strike!');
    const out = serializeP8(edited);
    expect(out).toContain('-- nebula strike!\n');
    // untouched sections keep their original (non-canonical) text
    const sfxStart = NEBULA.indexOf('__sfx__');
    expect(out.slice(out.indexOf('__sfx__'))).toBe(NEBULA.slice(sfxStart));
  });

  it('canonical output parses back to the same data', () => {
    const again = parseP8(serializeP8Canonical(cart));
    expect(again.code).toBe(cart.code);
    expect(again.gfx).toEqual(cart.gfx);
    expect(again.map).toEqual(cart.map);
    expect(again.flags).toEqual(cart.flags);
    expect(again.sfx).toEqual(cart.sfx);
    expect(again.music).toEqual(cart.music);
  });
});

describe('p8 format', () => {
  it('parses every section of a canonical cart', () => {
    const cart = createEmptyCart('print("hi")');
    cart.flags[3] = 0x81;
    cart.flags[200] = 7;
    setMapTile(cart, 5, 2, 0x2a);
    cart.label = new Uint8Array(128 * 128);
    cart.label[0] = 17; // secret palette -> 'h'
    cart.sfx[2] = {
      editorMode: 1,
      speed: 8,
      loopStart: 2,
      loopEnd: 6,
      notes: Array.from({ length: 32 }, (_, i) => ({
        pitch: i,
        waveform: i % 8,
        volume: 5,
        effect: i % 8,
        customInstrument: i === 3,
      })),
    };
    cart.music[1] = { flags: 5, channels: [1, 2, 0x43, 0x44] };
    const text = serializeP8Canonical(cart);
    expect(text).toMatch(/^pico-8 cartridge \/\/ http:\/\/www\.pico-8\.com\nversion 42\n__lua__\nprint\("hi"\)\n/);
    expect(text.indexOf('__label__')).toBeLessThan(text.indexOf('__gff__'));
    expect(text).toContain('\nh000');
    expect(text).toContain('__music__\n00 41424344\n05 01024344\n');

    const back = parseP8(text);
    expect(back.flags[3]).toBe(0x81);
    expect(back.flags[200]).toBe(7);
    expect(getMapTile(back, 5, 2)).toBe(0x2a);
    expect(back.label?.[0]).toBe(17);
    expect(back.sfx[2]).toEqual(cart.sfx[2]);
    expect(back.music[1]).toEqual(cart.music[1]);
    expect(serializeP8(back)).toBe(text);
  });

  it('omits empty sections', () => {
    const text = serializeP8Canonical(createEmptyCart('x=1'));
    expect(text).toBe('pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nx=1\n');
  });

  it('adds a new section in canonical position when data appears', () => {
    const cart = parseP8('pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nx=1\n__sfx__\n000100000c050000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000\n');
    cart.gfx[0] = 7;
    const out = serializeP8(cart);
    expect(out.indexOf('__gfx__')).toBeGreaterThan(out.indexOf('__lua__'));
    expect(out.indexOf('__gfx__')).toBeLessThan(out.indexOf('__sfx__'));
  });

  it('preserves CRLF line endings', () => {
    const text = 'pico-8 cartridge // http://www.pico-8.com\r\nversion 41\r\n__lua__\r\na=1\r\nb=2\r\n';
    const cart = parseP8(text);
    expect(cart.code).toBe('a=1\nb=2');
    expect(serializeP8(cart)).toBe(text);
    cart.code += '\nc=3';
    expect(serializeP8(cart)).toBe('pico-8 cartridge // http://www.pico-8.com\r\nversion 41\r\n__lua__\r\na=1\r\nb=2\r\nc=3\r\n');
  });

  it('keeps unknown meta sections verbatim', () => {
    const text = 'pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n\n__meta:title__\nmy game\nby me\n';
    const cart = parseP8(text);
    expect(cart.extraSections).toEqual([{ name: 'meta:title', lines: ['my game', 'by me'] }]);
    expect(serializeP8(cart)).toBe(text);
  });

  it('reports invalid hex with a line number', () => {
    expect(() => parseP8('pico-8 cartridge\nversion 42\n__gfx__\n00zz\n')).toThrow(/line 4/);
  });
});

describe('shared gfx/map memory', () => {
  it('map rows 32..63 alias spritesheet rows 64..127', () => {
    const cart = createEmptyCart();
    setMapTile(cart, 0, 32, 0xab);
    // map byte (0,32) = gfx pixels (0,64) low nibble and (1,64) high nibble
    expect(cart.gfx[64 * 128]).toBe(0xb);
    expect(cart.gfx[64 * 128 + 1]).toBe(0xa);

    setGfxPixel(cart, 127, 127, 0xc);
    // last shared byte: map (127, 63), high nibble
    expect(getMapTile(cart, 127, 63)).toBe(0xc0);
  });

  it('upper map rows are independent of gfx', () => {
    const cart = createEmptyCart();
    setMapTile(cart, 10, 31, 0xff);
    expect(cart.gfx.every((p) => p === 0)).toBe(true);
  });

  it('parsing derives the shared map half from __gfx__', () => {
    const row = '1'.repeat(128);
    const gfx = Array.from({ length: 128 }, (_, y) => (y === 64 ? row : '0'.repeat(128))).join('\n');
    const cart = parseP8(`pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n\n__gfx__\n${gfx}\n`);
    expect(getMapTile(cart, 0, 32)).toBe(0x11);
    expect(getMapTile(cart, 63, 32)).toBe(0x11);
    expect(getMapTile(cart, 64, 32)).toBe(0);
  });

  it('a __map__ section with >32 rows writes into the spritesheet', () => {
    const rows = Array.from({ length: 33 }, (_, y) => (y === 32 ? '21' : '00').padEnd(256, '0')).join('\n');
    const cart = parseP8(`pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\n\n__map__\n${rows}\n`);
    expect(getMapTile(cart, 0, 32)).toBe(0x21);
    expect(cart.gfx[64 * 128]).toBe(1);
    expect(cart.gfx[64 * 128 + 1]).toBe(2);
  });
});
