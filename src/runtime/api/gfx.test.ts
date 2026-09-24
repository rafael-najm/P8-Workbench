import { beforeEach, describe, expect, it } from 'vitest';
import { ADDR, Memory } from '../memory';
import { Gfx } from './gfx';
import { Text } from './text';

let mem: Memory;
let g: Gfx;
let text: Text;

beforeEach(() => {
  mem = new Memory();
  g = new Gfx(mem);
  text = new Text(mem, g);
  g.resetDrawState();
  g.pal();
});

/** Screen region as rows of hex digits ('.' for 0). */
function region(x: number, y: number, w: number, h: number): string[] {
  const rows: string[] = [];
  for (let j = 0; j < h; j++) {
    let row = '';
    for (let i = 0; i < w; i++) {
      const c = g.rawGet(x + i, y + j);
      row += c === 0 ? '.' : c.toString(16);
    }
    rows.push(row);
  }
  return rows;
}

function countColor(c: number): number {
  let n = 0;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) if (g.rawGet(x, y) === c) n++;
  return n;
}

/** Writes sprite pixels into the spritesheet (rows of hex digits). */
function setSprite(n: number, rows: string[]) {
  rows.forEach((row, j) => [...row].forEach((ch, i) => g.sset((n % 16) * 8 + i, Math.floor(n / 16) * 8 + j, ch === '.' ? 0 : parseInt(ch, 16))));
}

describe('screen memory layout', () => {
  it('stores 2 pixels per byte at 0x6000, low nibble = left pixel', () => {
    g.pset(0, 0, 7);
    g.pset(1, 0, 8);
    expect(mem.peek(ADDR.screen)).toBe(0x87);
    g.pset(127, 127, 12);
    expect(mem.peek(0x7fff) >> 4).toBe(12);
  });
});

describe('cls / pset / pget', () => {
  it('cls fills the screen and resets cursor and clip', () => {
    g.clip(10, 10, 5, 5);
    g.cursor(40, 50);
    g.cls(3);
    expect(countColor(3)).toBe(128 * 128);
    expect(mem.peek(ADDR.cursorX)).toBe(0);
    expect(mem.peek(ADDR.clip + 2)).toBe(128);
  });

  it('pset sets the pen color when given and uses it otherwise', () => {
    g.pset(5, 5, 9);
    g.pset(6, 5);
    expect(region(5, 5, 2, 1)).toEqual(['99']);
    expect(g.pget(6, 5)).toBe(9);
  });

  it('floors fractional coordinates', () => {
    g.pset(2.9, 3.7, 7);
    expect(g.rawGet(2, 3)).toBe(7);
    g.pset(-0.5, 0, 7); // floor(-0.5) = -1: offscreen
    expect(g.rawGet(0, 0)).toBe(0);
  });

  it('applies the camera', () => {
    g.cameraCall(10, 20);
    g.pset(15, 25, 8);
    expect(g.rawGet(5, 5)).toBe(8);
    expect(g.pget(15, 25)).toBe(8);
  });

  it('respects the clip rect', () => {
    g.clip(10, 10, 2, 2);
    g.rectfill(0, 0, 127, 127, 7);
    expect(countColor(7)).toBe(4);
    expect(region(9, 9, 4, 4)).toEqual(['....', '.77.', '.77.', '....']);
  });

  it('clip with clip_previous intersects', () => {
    g.clip(0, 0, 10, 10);
    g.clip(5, 5, 10, 10, true);
    expect([mem.peek(ADDR.clip), mem.peek(ADDR.clip + 1), mem.peek(ADDR.clip + 2), mem.peek(ADDR.clip + 3)]).toEqual([5, 5, 10, 10]);
  });
});

describe('shapes', () => {
  it('line (Bresenham, inclusive endpoints)', () => {
    g.line(0, 0, 4, 2, 7);
    expect(region(0, 0, 5, 3)).toEqual(['7....', '.77..', '...77']); // one pixel per column
  });

  it('line(x1,y1) continues from the previous endpoint', () => {
    g.line(0, 0, 3, 0, 7);
    g.line(3, 3);
    expect(region(0, 0, 4, 4)).toEqual(['7777', '...7', '...7', '...7']);
  });

  it('rect draws the outline, rectfill the area, coordinates in any order', () => {
    g.rect(3, 3, 0, 0, 5);
    expect(region(0, 0, 4, 4)).toEqual(['5555', '5..5', '5..5', '5555']);
    g.rectfill(10, 10, 12, 11, 6);
    expect(countColor(6)).toBe(6);
  });

  it('circfill with radius 0 is one pixel, radius 2 is a 5x5 disc', () => {
    g.circfill(10, 10, 0, 7);
    expect(countColor(7)).toBe(1);
    g.cls();
    g.circfill(10, 10, 2, 7);
    expect(region(8, 8, 5, 5)).toEqual(['.777.', '77777', '77777', '77777', '.777.']);
  });

  it('circ outline is symmetric', () => {
    g.circ(20, 20, 3, 8);
    const r = region(17, 17, 7, 7);
    expect(r).toEqual([...r].reverse());
    expect(r.map((row) => [...row].reverse().join(''))).toEqual(r);
    expect(r[3]![3]).toBe('.');
  });

  it('ovalfill fills its bounding box ellipse', () => {
    g.ovalfill(0, 0, 9, 3, 7);
    const r = region(0, 0, 10, 4);
    expect(r[1]).toBe('7777777777');
    expect(r[0]![0]).toBe('.');
    expect(r).toEqual([...r].reverse());
  });

  it('oval draws only the outline', () => {
    g.oval(0, 0, 11, 7, 7);
    const r = region(0, 0, 12, 8);
    expect(r[4]![6]).toBe('.');
    expect(r[4]![0]).toBe('7');
  });
});

describe('palettes', () => {
  it('pal remaps draw colors', () => {
    g.pal(7, 8);
    g.pset(0, 0, 7);
    expect(g.rawGet(0, 0)).toBe(8);
  });

  it('pal(c0, c1, 1) changes the screen palette only', () => {
    g.pal(7, 8, 1);
    g.pset(0, 0, 7);
    expect(g.rawGet(0, 0)).toBe(7);
    expect(mem.peek(ADDR.screenPal + 7)).toBe(8);
  });

  it('pal() resets everything', () => {
    g.pal(7, 8);
    g.pal(1, 2, 1);
    g.palt(0, false);
    g.pal();
    expect(mem.peek(ADDR.drawPal + 7)).toBe(7);
    expect(mem.peek(ADDR.screenPal + 1)).toBe(1);
    expect(mem.peek(ADDR.drawPal) & 0x10).toBe(0x10);
  });

  it('palt(bitfield) sets transparency for all colors', () => {
    g.palt(0b1000000000000001);
    expect(mem.peek(ADDR.drawPal + 0) & 0x10).toBe(0x10);
    expect(mem.peek(ADDR.drawPal + 15) & 0x10).toBe(0x10);
    expect(mem.peek(ADDR.drawPal + 7) & 0x10).toBe(0);
  });
});

describe('fillp', () => {
  it('uses the secondary color (high nibble) for 1 bits', () => {
    g.fillp(0b1010010110100101);
    g.rectfill(0, 0, 3, 1, 0x12);
    expect(region(0, 0, 4, 2)).toEqual(['1212', '2121']);
  });

  it('0x0.8 makes 1 bits transparent', () => {
    g.rectfill(0, 0, 3, 0, 9);
    g.fillp(0b1010000000000000 + 0.5);
    g.rectfill(0, 0, 3, 0, 7);
    expect(region(0, 0, 4, 1)).toEqual(['9797']);
  });

  it('fillp() clears the pattern and returns the previous value', () => {
    g.fillp(0x0f0f);
    expect(g.fillp()).toBe(0x0f0f);
    g.rectfill(0, 0, 3, 3, 7);
    expect(countColor(7)).toBe(16);
  });
});

describe('sprites', () => {
  beforeEach(() => {
    setSprite(1, ['7.......', '.8......', '..9.....', '........', '........', '........', '........', '.......a']);
  });

  it('spr draws with color 0 transparent', () => {
    g.rectfill(0, 0, 7, 7, 5);
    g.spr(1, 0, 0);
    expect(region(0, 0, 3, 3)).toEqual(['755', '585', '559']);
    expect(g.rawGet(7, 7)).toBe(10);
  });

  it('spr flips', () => {
    g.spr(1, 0, 0, 1, 1, true, false);
    expect(g.rawGet(7, 0)).toBe(7);
    g.cls();
    g.spr(1, 0, 0, 1, 1, false, true);
    expect(g.rawGet(0, 7)).toBe(7);
  });

  it('spr w/h can be fractional', () => {
    g.spr(1, 0, 0, 0.5, 0.5);
    expect(g.rawGet(0, 0)).toBe(7);
    expect(countColor(10)).toBe(0);
  });

  it('palt(0,false) draws color 0', () => {
    g.rectfill(0, 0, 7, 7, 5);
    g.palt(0, false);
    g.spr(1, 0, 0);
    expect(countColor(5)).toBe(0);
  });

  it('sspr scales', () => {
    g.sspr(8, 0, 8, 8, 0, 0, 16, 16);
    expect(region(0, 0, 4, 4)).toEqual(['77..', '77..', '..88', '..88']);
  });

  it('sget/sset', () => {
    expect(g.sget(8, 0)).toBe(7);
    g.sset(0, 0, 12);
    expect(g.sget(0, 0)).toBe(12);
    expect(g.sget(-1, 0)).toBe(0);
  });
});

describe('flags and map', () => {
  it('fget/fset with and without bit index', () => {
    g.fset(3, 0x81);
    expect(g.fget(3)).toBe(0x81);
    expect(g.fget(3, 7)).toBe(true);
    expect(g.fget(3, 1)).toBe(false);
    g.fset(3, 1, true);
    expect(g.fget(3)).toBe(0x83);
  });

  it('mget/mset; bottom half shares memory with the spritesheet', () => {
    g.mset(2, 3, 42);
    expect(g.mget(2, 3)).toBe(42);
    expect(mem.peek(ADDR.map + 3 * 128 + 2)).toBe(42);
    g.mset(0, 32, 0x21);
    expect(g.sget(0, 64)).toBe(1);
    expect(g.sget(1, 64)).toBe(2);
    expect(g.mget(200, 0)).toBe(0);
  });

  it('map draws tiles, skips tile 0 and filters by layer', () => {
    setSprite(1, Array(8).fill('77777777'));
    setSprite(2, Array(8).fill('88888888'));
    g.fset(2, 0, true);
    g.mset(0, 0, 1);
    g.mset(1, 0, 2);
    g.map(0, 0, 0, 0, 3, 1);
    expect(g.rawGet(0, 0)).toBe(7);
    expect(g.rawGet(8, 0)).toBe(8);
    g.cls();
    g.map(0, 0, 0, 0, 3, 1, 1);
    expect(g.rawGet(0, 0)).toBe(0);
    expect(g.rawGet(8, 0)).toBe(8);
  });

  it('tline samples the map', () => {
    setSprite(1, ['789abcde', ...Array(7).fill('........')]);
    g.mset(0, 0, 1);
    g.tline(0, 0, 7, 0, 0, 0);
    expect(region(0, 0, 8, 1)).toEqual(['789abcde']);
  });
});

describe('print', () => {
  it('draws glyphs and returns the x after the text', () => {
    const r = text.print('hi', 0, 0, 7);
    expect(r.x).toBe(8);
    expect(countColor(7)).toBeGreaterThan(0);
    expect(region(0, 0, 3, 5)).toEqual(['7.7', '7.7', '777', '7.7', '7.7']);
  });

  it('wide glyphs (>= 0x80) advance 8 px', () => {
    expect(text.print('\x97', 0, 0, 7).x).toBe(8);
  });

  it('\\^w doubles width, \\^t doubles height', () => {
    const r = text.print('\x06w\x06ta', 0, 0, 7);
    expect(r.x).toBe(8);
    expect(g.rawGet(0, 9)).toBe(7);
  });

  it('\\fc sets the foreground color, \\#c the background', () => {
    text.print('\x0c8\x021a', 0, 0, 7);
    expect(countColor(8)).toBeGreaterThan(0);
    expect(countColor(1)).toBeGreaterThan(0);
    expect(countColor(7)).toBe(0);
  });

  it('print without coords uses and advances the cursor, scrolling at the bottom', () => {
    text.print('a', undefined, undefined, 7);
    expect(mem.peek(ADDR.cursorY)).toBe(6);
    g.cursor(0, 124);
    text.print('b');
    expect(mem.peek(ADDR.cursorY)).toBeLessThanOrEqual(128);
  });

  it('\\n moves to a new line from the home x', () => {
    const r = text.print('a\nb', 10, 0, 7);
    expect(r).toEqual({ x: 14, y: 6 });
  });
});
