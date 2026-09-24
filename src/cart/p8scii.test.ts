import { describe, expect, it } from 'vitest';
import { P8SCII_TO_UNICODE, fromP8String, p8sciiToUnicode, toP8String, unicodeToP8scii } from './p8scii';

describe('P8SCII', () => {
  it('has 256 unique entries', () => {
    expect(P8SCII_TO_UNICODE).toHaveLength(256);
    expect(new Set(P8SCII_TO_UNICODE).size).toBe(256);
  });

  it('maps button glyphs to their PICO-8 bytes', () => {
    expect([...unicodeToP8scii('⬅️➡️⬆️⬇️🅾️❎')]).toEqual([0x8b, 0x91, 0x94, 0x83, 0x8e, 0x97]);
    expect([...unicodeToP8scii('♥◆★')]).toEqual([0x87, 0x8f, 0x92]);
  });

  it('accepts glyphs without the variation selector', () => {
    expect([...unicodeToP8scii('⬅❎')]).toEqual([0x8b, 0x97]);
  });

  it('maps unicode italic capitals to A-Z', () => {
    expect(fromP8String(toP8String('𝘩𝘪'))).toBe('HI');
  });

  it('round-trips every byte', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...unicodeToP8scii(p8sciiToUnicode(all))]).toEqual([...all]);
  });

  it('encodes unknown characters as UTF-8 bytes', () => {
    expect([...unicodeToP8scii('é')]).toEqual([0xc3, 0xa9]);
  });
});
