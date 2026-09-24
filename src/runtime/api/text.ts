/**
 * print() with P8SCII control codes.
 *
 * Supported: \n \r \t \b, \*n (repeat), \#c (background), \fc (foreground),
 * \-n \|n \+xy (cursor offsets), \^ commands: w t = p i b # (with - prefix to
 * turn off), c (cls), g/h (home), j (jump), x/y (char size), s (tab width),
 * digit waits and d (ignored in a single frame), and skip-over for custom
 * glyph data (\^. \^:), \v decorations, \a audio and font switches.
 */
import { CHAR_HEIGHT, FONT } from '../font';
import { ADDR, type Memory } from '../memory';
import type { Gfx } from './gfx';

/** Value of a P8SCII parameter char: 0-9, a-z = 10-35. */
function pv(code: number | undefined): number {
  if (code === undefined) return 0;
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 87;
  if (code >= 65 && code <= 90) return code - 55;
  return 0;
}

export interface PrintResult {
  x: number;
  y: number;
}

export class Text {
  constructor(
    private readonly mem: Memory,
    private readonly gfx: Gfx,
  ) {}

  /**
   * Draws `text` (p8 string: 1 char = 1 byte). With `x`/`y` undefined, prints
   * at the cursor and moves it to the next line (scrolling at the bottom).
   */
  print(text: string, x?: number, y?: number, col?: number): PrintResult {
    const m = this.mem;
    const atCursor = x === undefined || y === undefined;
    if (col !== undefined) m.poke(ADDR.penColor, Math.floor(col) & 0xff);

    let cx = atCursor ? m.peek(ADDR.cursorX) : Math.floor(x!);
    let cy = atCursor ? m.peek(ADDR.cursorY) : Math.floor(y!);
    if (atCursor) {
      // Scroll so the line fits, like PICO-8's terminal-style printing.
      while (cy > 128 - CHAR_HEIGHT) {
        m.memcpy(ADDR.screen, ADDR.screen + CHAR_HEIGHT * 64, 0x2000 - CHAR_HEIGHT * 64);
        m.memset(ADDR.screen + 0x2000 - CHAR_HEIGHT * 64, 0, CHAR_HEIGHT * 64);
        cy -= CHAR_HEIGHT;
      }
    }

    const camX = m.peek2(ADDR.camera);
    const camY = m.peek2(ADDR.camera + 2);
    let fg = m.peek(ADDR.penColor) & 0x0f;
    let bg = -1;
    let homeX = cx;
    let homeY = cy;
    let wide = false;
    let tall = false;
    let invert = false;
    let stripey = false;
    let charW = 4;
    let charH = 6;
    let tabW = 16;
    let lineH = CHAR_HEIGHT;
    let lineBottom = cy + CHAR_HEIGHT;

    const n = text.length;
    const code = (i: number) => (i < n ? text.charCodeAt(i) & 0xff : undefined);

    for (let i = 0; i < n; i++) {
      const ch = text.charCodeAt(i) & 0xff;
      if (ch === 0) break;
      if (ch < 16) {
        switch (ch) {
          case 1: {
            // \*n c : repeat next char n times
            const times = pv(code(i + 1));
            const rep = code(i + 2);
            i += 2;
            if (rep !== undefined) {
              for (let k = 0; k < times; k++) cx = this.glyph(rep, cx, cy, fg, bg, wide, tall, invert, stripey, camX, camY, charW, charH);
            }
            break;
          }
          case 2: // \#c background
            bg = pv(code(++i));
            break;
          case 3: // \-n  x offset
            cx += pv(code(++i)) - 16;
            break;
          case 4: // \|n  y offset
            cy += pv(code(++i)) - 16;
            break;
          case 5: // \+xy
            cx += pv(code(++i)) - 16;
            cy += pv(code(++i)) - 16;
            break;
          case 6: {
            // \^ commands
            let cmd = code(++i);
            let on = true;
            if (cmd === 45 /* - */) {
              on = false;
              cmd = code(++i);
            }
            switch (cmd) {
              case 119: wide = on; break; // w
              case 116: tall = on; break; // t
              case 61: stripey = on; break; // =
              case 112: wide = tall = stripey = on; break; // p (pinball)
              case 105: invert = on; break; // i
              case 98: case 35: break; // b, #: border / solid bg flags (no visual effect here)
              case 99: // c: cls
                this.gfx.cls(pv(code(++i)));
                cx = homeX = cy = homeY = 0;
                break;
              case 103: cx = homeX; cy = homeY; break; // g
              case 104: homeX = cx; homeY = cy; break; // h
              case 106: // j: jump (units of 4px)
                cx = homeX = pv(code(++i)) * 4;
                cy = homeY = pv(code(++i)) * 4;
                break;
              case 120: charW = pv(code(++i)); break; // x
              case 121: charH = pv(code(++i)); break; // y
              case 115: tabW = pv(code(++i)) * 4 || 16; break; // s
              case 100: i++; break; // d: per-char delay (no-op)
              case 46: i += 8; break; // .: 8-byte one-off glyph
              case 58: i += 16; break; // :: hex one-off glyph
              case 64: case 33: i = n; break; // @ ! poke commands: ignore the rest
              default: // 1-9 waits, unknown commands
                break;
            }
            break;
          }
          case 7: // \a audio: skip the command (up to a space)
            while (i + 1 < n && code(i + 1) !== 32) i++;
            break;
          case 8: // \b backspace
            cx -= wide ? charW * 2 : charW;
            break;
          case 9: // \t tab
            cx = homeX + (Math.floor((cx - homeX) / tabW) + 1) * tabW;
            break;
          case 10: // \n
            cx = homeX;
            cy += lineH;
            break;
          case 11: // \v decoration: skip 2 params
            i += 2;
            break;
          case 12: // \fc foreground
            fg = pv(code(++i)) & 0x0f;
            break;
          case 13: // \r
            cx = homeX;
            break;
          default: // 14/15 font switches: default font only
            break;
        }
        lineH = (tall ? 2 : 1) * CHAR_HEIGHT;
        continue;
      }
      cx = this.glyph(ch, cx, cy, fg, bg, wide, tall, invert, stripey, camX, camY, charW, charH);
      lineH = (tall ? 2 : 1) * CHAR_HEIGHT;
      lineBottom = Math.max(lineBottom, cy + lineH);
    }

    if (atCursor) {
      m.poke(ADDR.cursorX, homeX);
      m.poke(ADDR.cursorY, Math.max(0, Math.min(255, lineBottom)));
    } else {
      m.poke(ADDR.cursorX, homeX);
      m.poke(ADDR.cursorY, Math.max(0, Math.min(255, cy + lineH)));
    }
    return { x: cx, y: cy };
  }

  /** Draws one glyph at (x, y), returns the next x. */
  private glyph(
    ch: number,
    x: number,
    y: number,
    fg: number,
    bg: number,
    wide: boolean,
    tall: boolean,
    invert: boolean,
    stripey: boolean,
    camX: number,
    camY: number,
    charW: number,
    charH: number,
  ): number {
    const big = ch >= 0x80;
    const gw = big ? 7 : 3;
    const adv = (big ? charW * 2 : charW) * (wide ? 2 : 1);
    const sx = wide ? 2 : 1;
    const sy = tall ? 2 : 1;
    const cellW = adv;
    const cellH = charH * sy;
    const g = this.gfx;
    // Inverted text: the cell takes the foreground color, glyph pixels the background.
    const cellColor = invert ? fg : bg;
    const inkColor = invert ? Math.max(bg, 0) : fg;
    if (cellColor >= 0) {
      for (let py = 0; py < cellH; py++) for (let px = 0; px < cellW; px++) g.textPixel(x + px - camX, y + py - camY, cellColor);
    }
    for (let row = 0; row < 5; row++) {
      const bits = FONT[ch * 5 + row]!;
      for (let col = 0; col < gw; col++) {
        if (((bits >> col) & 1) === 0) continue;
        const color = inkColor;
        for (let dy = 0; dy < sy; dy++) {
          if (stripey && dy === 1) continue;
          for (let dx = 0; dx < sx; dx++) {
            if (stripey && dx === 1) continue;
            g.textPixel(x + col * sx + dx - camX, y + row * sy + dy - camY, color);
          }
        }
      }
    }
    return x + adv;
  }
}
