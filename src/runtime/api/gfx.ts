/**
 * Graphics API. All state lives in PICO-8 memory (draw state at 0x5f00,
 * screen at 0x6000), so poke()-based tricks work like on the real thing.
 *
 * Coordinates arrive as numbers (possibly fractional) and are floored, like
 * PICO-8's fixed-point integer part.
 */
import { ADDR, type Memory } from '../memory';

const SCREEN = ADDR.screen;
const DRAW_PAL = ADDR.drawPal;
const SCREEN_PAL = ADDR.screenPal;
const TRANSPARENT = 0x10;

const flr = Math.floor;

/** Optional numeric argument (nil/undefined -> default), floored. */
function int(v: number | undefined, def: number): number {
  return v === undefined || Number.isNaN(v) ? def : flr(v);
}

interface DrawCtx {
  camX: number;
  camY: number;
  cx0: number;
  cy0: number;
  cx1: number;
  cy1: number;
  pattern: number;
  patternTransparent: boolean;
  patternSprites: boolean;
}

export class Gfx {
  constructor(private readonly mem: Memory) {}

  // --- state -------------------------------------------------------------------

  /** Resets the draw state (like reset()): palettes, clip, camera, pen, cursor, fill pattern. */
  resetDrawState(): void {
    this.resetPalettes();
    this.clipReset();
    this.setCamera(0, 0);
    this.mem.poke(ADDR.penColor, 6);
    this.mem.poke(ADDR.cursorX, 0);
    this.mem.poke(ADDR.cursorY, 0);
    this.fillp(0);
    this.mem.poke(ADDR.lineValid, 0);
    this.mem.poke(ADDR.btnpDelay, 0);
    this.mem.poke(ADDR.btnpRepeat, 0);
  }

  private resetPalettes(): void {
    this.resetDrawPal();
    for (let i = 0; i < 16; i++) this.mem.poke(SCREEN_PAL + i, i);
    for (let i = 0; i < 16; i++) this.mem.poke(ADDR.secondaryPal + i, i);
  }

  private resetDrawPal(): void {
    for (let i = 0; i < 16; i++) this.mem.poke(DRAW_PAL + i, (this.mem.peek(DRAW_PAL + i) & TRANSPARENT) | i);
  }

  private resetTransparency(): void {
    for (let i = 0; i < 16; i++) {
      const v = this.mem.peek(DRAW_PAL + i) & 0x0f;
      this.mem.poke(DRAW_PAL + i, i === 0 ? v | TRANSPARENT : v);
    }
  }

  private camera(): [number, number] {
    return [this.mem.peek2(ADDR.camera), this.mem.peek2(ADDR.camera + 2)];
  }

  private setCamera(x: number, y: number): void {
    this.mem.poke2(ADDR.camera, x);
    this.mem.poke2(ADDR.camera + 2, y);
  }

  private ctx(): DrawCtx {
    const m = this.mem;
    const [camX, camY] = this.camera();
    const flags = m.peek(ADDR.fillpFlags);
    return {
      camX,
      camY,
      cx0: m.peek(ADDR.clip),
      cy0: m.peek(ADDR.clip + 1),
      cx1: m.peek(ADDR.clip + 2),
      cy1: m.peek(ADDR.clip + 3),
      pattern: m.peek(ADDR.fillp) | (m.peek(ADDR.fillp + 1) << 8),
      patternTransparent: (flags & 1) !== 0,
      patternSprites: (flags & 2) !== 0,
    };
  }

  /** Resolves a color argument: sets the pen color if given, returns the pen byte. */
  private pen(col: number | undefined): number {
    if (col !== undefined && !Number.isNaN(col)) this.mem.poke(ADDR.penColor, flr(col) & 0xff);
    return this.mem.peek(ADDR.penColor);
  }

  // --- pixel primitives -----------------------------------------------------------

  /** Writes a raw color (0-15) to the screen, without clipping or palette. */
  rawSet(x: number, y: number, c: number): void {
    if (x < 0 || y < 0 || x > 127 || y > 127) return;
    const a = SCREEN + (y << 6) + (x >> 1);
    const b = this.mem.ram[a]!;
    this.mem.ram[a] = x & 1 ? (b & 0x0f) | (c << 4) : (b & 0xf0) | c;
  }

  rawGet(x: number, y: number): number {
    if (x < 0 || y < 0 || x > 127 || y > 127) return 0;
    const b = this.mem.ram[SCREEN + (y << 6) + (x >> 1)]!;
    return x & 1 ? b >> 4 : b & 0x0f;
  }

  /** Text pixel in screen space: clip + draw palette, no fill pattern. */
  textPixel(x: number, y: number, c: number): void {
    const m = this.mem;
    if (x < m.ram[ADDR.clip]! || y < m.ram[ADDR.clip + 1]! || x >= m.ram[ADDR.clip + 2]! || y >= m.ram[ADDR.clip + 3]!) return;
    this.rawSet(x, y, m.ram[DRAW_PAL + (c & 0x0f)]! & 0x0f);
  }

  /** Draws a shape pixel in screen space with clip, fill pattern and draw palette. */
  private plot(ctx: DrawCtx, x: number, y: number, pen: number): void {
    if (x < ctx.cx0 || y < ctx.cy0 || x >= ctx.cx1 || y >= ctx.cy1) return;
    let c = pen & 0x0f;
    if (ctx.pattern !== 0 && (ctx.pattern >> (15 - (((y & 3) << 2) | (x & 3)))) & 1) {
      if (ctx.patternTransparent) return;
      c = (pen >> 4) & 0x0f;
    }
    this.rawSet(x, y, this.mem.ram[DRAW_PAL + c]! & 0x0f);
  }

  /** Horizontal span in screen space (x0 <= x1). */
  private hspan(ctx: DrawCtx, x0: number, x1: number, y: number, pen: number): void {
    if (y < ctx.cy0 || y >= ctx.cy1) return;
    const a = Math.max(x0, ctx.cx0);
    const b = Math.min(x1, ctx.cx1 - 1);
    if (ctx.pattern === 0) {
      const c = this.mem.ram[DRAW_PAL + (pen & 0x0f)]! & 0x0f;
      for (let x = a; x <= b; x++) this.rawSet(x, y, c);
    } else {
      for (let x = a; x <= b; x++) this.plot(ctx, x, y, pen);
    }
  }

  // --- API -------------------------------------------------------------------------------

  cls(col?: number): void {
    const c = int(col, 0) & 0x0f;
    this.mem.ram.fill(c | (c << 4), SCREEN, SCREEN + 0x2000);
    this.mem.poke(ADDR.cursorX, 0);
    this.mem.poke(ADDR.cursorY, 0);
    this.clipReset();
  }

  pset(x: number, y: number, col?: number): void {
    const pen = this.pen(col);
    const ctx = this.ctx();
    this.plot(ctx, flr(x) - ctx.camX, flr(y) - ctx.camY, pen);
  }

  pget(x: number, y: number): number {
    const [cx, cy] = this.camera();
    return this.rawGet(int(x, 0) - cx, int(y, 0) - cy);
  }

  color(col?: number): number {
    const prev = this.mem.peek(ADDR.penColor);
    this.mem.poke(ADDR.penColor, int(col, 6) & 0xff);
    return prev;
  }

  cursor(x?: number, y?: number, col?: number): [number, number] {
    const prev: [number, number] = [this.mem.peek(ADDR.cursorX), this.mem.peek(ADDR.cursorY)];
    this.mem.poke(ADDR.cursorX, int(x, 0));
    this.mem.poke(ADDR.cursorY, int(y, 0));
    if (col !== undefined) this.pen(col);
    return prev;
  }

  cameraCall(x?: number, y?: number): [number, number] {
    const prev = this.camera();
    this.setCamera(int(x, 0), int(y, 0));
    return prev;
  }

  clipReset(): void {
    this.mem.poke(ADDR.clip, 0);
    this.mem.poke(ADDR.clip + 1, 0);
    this.mem.poke(ADDR.clip + 2, 128);
    this.mem.poke(ADDR.clip + 3, 128);
  }

  /** clip(x, y, w, h, clip_previous). Returns the previous clip rect. */
  clip(x?: number, y?: number, w?: number, h?: number, clipPrevious?: boolean): [number, number, number, number] {
    const m = this.mem;
    const prev: [number, number, number, number] = [
      m.peek(ADDR.clip),
      m.peek(ADDR.clip + 1),
      m.peek(ADDR.clip + 2) - m.peek(ADDR.clip),
      m.peek(ADDR.clip + 3) - m.peek(ADDR.clip + 1),
    ];
    if (x === undefined) {
      this.clipReset();
      return prev;
    }
    let x0 = int(x, 0);
    let y0 = int(y, 0);
    let x1 = x0 + int(w, 128);
    let y1 = y0 + int(h, 128);
    if (clipPrevious) {
      x0 = Math.max(x0, prev[0]);
      y0 = Math.max(y0, prev[1]);
      x1 = Math.min(x1, prev[0] + prev[2]);
      y1 = Math.min(y1, prev[1] + prev[3]);
    }
    const c = (v: number) => Math.max(0, Math.min(128, v));
    m.poke(ADDR.clip, c(x0));
    m.poke(ADDR.clip + 1, c(y0));
    m.poke(ADDR.clip + 2, Math.max(c(x0), c(x1)));
    m.poke(ADDR.clip + 3, Math.max(c(y0), c(y1)));
    return prev;
  }

  /**
   * pal(c0, c1, p): p=0 draw palette, 1 screen palette, 2 secondary palette.
   * pal() resets everything; pal(table, p) sets many entries.
   */
  pal(c0?: number | Map<number, number>, c1?: number, p?: number): void {
    const m = this.mem;
    if (c0 === undefined) {
      this.resetPalettes();
      this.resetTransparency();
      return;
    }
    if (c0 instanceof Map) {
      for (const [k, v] of c0) this.pal(k, v, c1);
      return;
    }
    const which = int(p, 0);
    if (c1 === undefined) {
      // pal(p): reset one palette
      const target = int(c0, 0);
      if (target === 0) this.resetDrawPal();
      else if (target === 1) for (let i = 0; i < 16; i++) m.poke(SCREEN_PAL + i, i);
      return;
    }
    const i = flr(c0) & 0x0f;
    const v = flr(c1);
    if (which === 1) m.poke(SCREEN_PAL + i, v & 0x8f);
    else if (which === 2) m.poke(ADDR.secondaryPal + i, v & 0xff);
    else m.poke(DRAW_PAL + i, (m.peek(DRAW_PAL + i) & TRANSPARENT) | (v & 0x0f));
  }

  /** palt(c, t) / palt(bitfield) / palt(). */
  palt(c?: number, t?: boolean): void {
    const m = this.mem;
    if (c === undefined) {
      this.resetTransparency();
      return;
    }
    if (t === undefined) {
      const bits = flr(c) & 0xffff;
      for (let i = 0; i < 16; i++) {
        const on = (bits >> (15 - i)) & 1;
        m.poke(DRAW_PAL + i, (m.peek(DRAW_PAL + i) & 0x0f) | (on ? TRANSPARENT : 0));
      }
      return;
    }
    const i = flr(c) & 0x0f;
    m.poke(DRAW_PAL + i, (m.peek(DRAW_PAL + i) & 0x0f) | (t ? TRANSPARENT : 0));
  }

  /**
   * fillp(p): 16-bit pattern in the integer part; fractional bits:
   * 0x0.8 = transparent "1" bits, 0x0.4 = apply to sprites.
   * Returns the previous value.
   */
  fillp(p?: number): number {
    const m = this.mem;
    const prevPattern = m.peek(ADDR.fillp) | (m.peek(ADDR.fillp + 1) << 8);
    const prevFlags = m.peek(ADDR.fillpFlags);
    const prev = (prevPattern >= 0x8000 ? prevPattern - 0x10000 : prevPattern) + ((prevFlags & 1) * 0.5 + ((prevFlags >> 1) & 1) * 0.25);
    const raw = Math.floor((p ?? 0) * 65536);
    const pattern = (raw >> 16) & 0xffff;
    const frac = raw & 0xffff;
    m.poke(ADDR.fillp, pattern & 0xff);
    m.poke(ADDR.fillp + 1, pattern >> 8);
    m.poke(ADDR.fillpFlags, (frac & 0x8000 ? 1 : 0) | (frac & 0x4000 ? 2 : 0));
    return prev;
  }

  line(x0?: number, y0?: number, x1?: number, y1?: number, col?: number): void {
    const m = this.mem;
    if (x0 === undefined) {
      m.poke(ADDR.lineValid, 0);
      return;
    }
    let ax: number;
    let ay: number;
    let bx: number;
    let by: number;
    if (x1 === undefined || y1 === undefined) {
      // line(x1, y1, [col]) continues from the last endpoint
      if (x1 !== undefined) col = x1;
      bx = flr(x0);
      by = int(y0, 0);
      if (!m.peek(ADDR.lineValid)) {
        m.poke2(ADDR.lineX, bx);
        m.poke2(ADDR.lineY, by);
        m.poke(ADDR.lineValid, 1);
        this.pen(col);
        return;
      }
      ax = m.peek2(ADDR.lineX);
      ay = m.peek2(ADDR.lineY);
    } else {
      ax = flr(x0);
      ay = int(y0, 0);
      bx = flr(x1);
      by = flr(y1);
    }
    const pen = this.pen(col);
    const ctx = this.ctx();
    m.poke2(ADDR.lineX, bx);
    m.poke2(ADDR.lineY, by);
    m.poke(ADDR.lineValid, 1);

    ax -= ctx.camX;
    bx -= ctx.camX;
    ay -= ctx.camY;
    by -= ctx.camY;
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    let x = ax;
    let y = ay;
    // Bail out of absurdly long off-screen lines.
    for (let n = 0; n < 4096; n++) {
      this.plot(ctx, x, y, pen);
      if (x === bx && y === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  rect(x0: number, y0: number, x1: number, y1: number, col?: number): void {
    const pen = this.pen(col);
    const ctx = this.ctx();
    const [ax, bx] = order(flr(x0) - ctx.camX, flr(x1) - ctx.camX);
    const [ay, by] = order(flr(y0) - ctx.camY, flr(y1) - ctx.camY);
    this.hspan(ctx, ax, bx, ay, pen);
    if (by !== ay) this.hspan(ctx, ax, bx, by, pen);
    for (let y = ay + 1; y < by; y++) {
      this.plot(ctx, ax, y, pen);
      if (bx !== ax) this.plot(ctx, bx, y, pen);
    }
  }

  rectfill(x0: number, y0: number, x1: number, y1: number, col?: number): void {
    const pen = this.pen(col);
    const ctx = this.ctx();
    const [ax, bx] = order(flr(x0) - ctx.camX, flr(x1) - ctx.camX);
    const [ay, by] = order(flr(y0) - ctx.camY, flr(y1) - ctx.camY);
    const top = Math.max(ay, ctx.cy0);
    const bottom = Math.min(by, ctx.cy1 - 1);
    for (let y = top; y <= bottom; y++) this.hspan(ctx, ax, bx, y, pen);
  }

  circ(x: number, y: number, r?: number, col?: number): void {
    this.circle(x, y, r, col, false);
  }

  circfill(x: number, y: number, r?: number, col?: number): void {
    this.circle(x, y, r, col, true);
  }

  private circle(x: number, y: number, rArg: number | undefined, col: number | undefined, fill: boolean): void {
    const pen = this.pen(col);
    const ctx = this.ctx();
    const cx = flr(x) - ctx.camX;
    const cy = flr(y) - ctx.camY;
    const r = int(rArg, 4);
    if (r < 0) return;
    let px = r;
    let py = 0;
    let err = 1 - r;
    while (px >= py) {
      if (fill) {
        this.hspan(ctx, cx - px, cx + px, cy + py, pen);
        this.hspan(ctx, cx - px, cx + px, cy - py, pen);
        this.hspan(ctx, cx - py, cx + py, cy + px, pen);
        this.hspan(ctx, cx - py, cx + py, cy - px, pen);
      } else {
        this.plot(ctx, cx + px, cy + py, pen);
        this.plot(ctx, cx - px, cy + py, pen);
        this.plot(ctx, cx + px, cy - py, pen);
        this.plot(ctx, cx - px, cy - py, pen);
        this.plot(ctx, cx + py, cy + px, pen);
        this.plot(ctx, cx - py, cy + px, pen);
        this.plot(ctx, cx + py, cy - px, pen);
        this.plot(ctx, cx - py, cy - px, pen);
      }
      py++;
      if (err < 0) {
        err += 2 * py + 1;
      } else {
        px--;
        err += 2 * (py - px) + 1;
      }
    }
  }

  oval(x0: number, y0: number, x1: number, y1: number, col?: number): void {
    this.ellipse(x0, y0, x1, y1, col, false);
  }

  ovalfill(x0: number, y0: number, x1: number, y1: number, col?: number): void {
    this.ellipse(x0, y0, x1, y1, col, true);
  }

  private ellipse(x0: number, y0: number, x1: number, y1: number, col: number | undefined, fill: boolean): void {
    const pen = this.pen(col);
    const ctx = this.ctx();
    const [ax, bx] = order(flr(x0) - ctx.camX, flr(x1) - ctx.camX);
    const [ay, by] = order(flr(y0) - ctx.camY, flr(y1) - ctx.camY);
    const cx = (ax + bx + 1) / 2;
    const cy = (ay + by + 1) / 2;
    const rx = (bx - ax + 1) / 2;
    const ry = (by - ay + 1) / 2;
    const rows = by - ay + 1;
    const left = new Array<number>(rows);
    const right = new Array<number>(rows);
    for (let i = 0; i < rows; i++) {
      const dy = (ay + i + 0.5 - cy) / ry;
      const half = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      left[i] = Math.round(cx - half);
      right[i] = Math.round(cx + half) - 1;
    }
    for (let i = 0; i < rows; i++) {
      const y = ay + i;
      const l = left[i]!;
      const r = right[i]!;
      if (r < l) continue;
      if (fill) {
        this.hspan(ctx, l, r, y, pen);
        continue;
      }
      // Outline: extend each edge to meet the neighbouring rows' edges.
      const nl = Math.min(i > 0 ? left[i - 1]! : Infinity, i < rows - 1 ? left[i + 1]! : Infinity);
      const nr = Math.max(i > 0 ? right[i - 1]! : -Infinity, i < rows - 1 ? right[i + 1]! : -Infinity);
      const le = Math.min(r, Math.max(l, nl - 1));
      const rs = Math.max(l, Math.min(r, nr + 1));
      if (i === 0 || i === rows - 1 || le >= rs) {
        this.hspan(ctx, l, r, y, pen);
      } else {
        this.hspan(ctx, l, le, y, pen);
        this.hspan(ctx, rs, r, y, pen);
      }
    }
  }

  // --- spritesheet / flags / map -----------------------------------------------------

  sget(x: number, y: number): number {
    const sx = int(x, 0);
    const sy = int(y, 0);
    if (sx < 0 || sy < 0 || sx > 127 || sy > 127) return 0;
    const b = this.mem.ram[(sy << 6) + (sx >> 1)]!;
    return sx & 1 ? b >> 4 : b & 0x0f;
  }

  sset(x: number, y: number, col?: number): void {
    const sx = int(x, 0);
    const sy = int(y, 0);
    const c = this.pen(col) & 0x0f;
    if (sx < 0 || sy < 0 || sx > 127 || sy > 127) return;
    const a = (sy << 6) + (sx >> 1);
    const b = this.mem.ram[a]!;
    this.mem.ram[a] = sx & 1 ? (b & 0x0f) | (c << 4) : (b & 0xf0) | c;
  }

  fget(n: number, f?: number): number | boolean {
    const v = this.mem.peek(ADDR.flags + (int(n, 0) & 0xff));
    if (f === undefined) return v;
    return ((v >> (int(f, 0) & 7)) & 1) === 1;
  }

  fset(n: number, f?: number | boolean, v?: boolean): void {
    const a = ADDR.flags + (int(n, 0) & 0xff);
    if (v === undefined) {
      this.mem.poke(a, typeof f === 'number' ? flr(f) & 0xff : 0);
      return;
    }
    const bit = 1 << (int(typeof f === 'number' ? f : 0, 0) & 7);
    const cur = this.mem.peek(a);
    this.mem.poke(a, v ? cur | bit : cur & ~bit);
  }

  private mapAddr(x: number, y: number): number {
    if (x < 0 || x > 127 || y < 0 || y > 63) return -1;
    return y < 32 ? ADDR.map + y * 128 + x : ADDR.mapShared + (y - 32) * 128 + x;
  }

  mget(x: number, y: number): number {
    const a = this.mapAddr(int(x, 0), int(y, 0));
    return a < 0 ? 0 : this.mem.ram[a]!;
  }

  mset(x: number, y: number, v?: number): void {
    const a = this.mapAddr(int(x, 0), int(y, 0));
    if (a >= 0) this.mem.ram[a] = int(v, 0) & 0xff;
  }

  /** Blits sheet pixels (sx,sy,w,h) to screen (dx,dy) scaled to (dw,dh). All screen coords pre-camera. */
  private blit(sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, fx: boolean, fy: boolean): void {
    if (dw <= 0 || dh <= 0 || sw <= 0 || sh <= 0) return;
    const ctx = this.ctx();
    const ram = this.mem.ram;
    const x0 = dx - ctx.camX;
    const y0 = dy - ctx.camY;
    const usePattern = ctx.pattern !== 0 && ctx.patternSprites;
    for (let j = 0; j < dh; j++) {
      const y = y0 + j;
      if (y < ctx.cy0 || y >= ctx.cy1) continue;
      let ty = flr((j * sh) / dh);
      if (fy) ty = sh - 1 - ty;
      const py = sy + ty;
      if (py < 0 || py > 127) continue;
      for (let i = 0; i < dw; i++) {
        const x = x0 + i;
        if (x < ctx.cx0 || x >= ctx.cx1) continue;
        let tx = flr((i * sw) / dw);
        if (fx) tx = sw - 1 - tx;
        const px = sx + tx;
        if (px < 0 || px > 127) continue;
        const b = ram[(py << 6) + (px >> 1)]!;
        const s = px & 1 ? b >> 4 : b & 0x0f;
        const p = ram[DRAW_PAL + s]!;
        if (p & TRANSPARENT) continue;
        if (usePattern && (ctx.pattern >> (15 - (((y & 3) << 2) | (x & 3)))) & 1) {
          if (ctx.patternTransparent) continue;
        }
        this.rawSet(x, y, p & 0x0f);
      }
    }
  }

  spr(n: number, x: number, y: number, w?: number, h?: number, flipX?: boolean, flipY?: boolean): void {
    const id = int(n, 0);
    if (id < 0 || id > 255) return;
    const pw = flr((w ?? 1) * 8);
    const ph = flr((h ?? 1) * 8);
    this.blit((id & 15) * 8, (id >> 4) * 8, pw, ph, flr(x), flr(y), pw, ph, !!flipX, !!flipY);
  }

  sspr(sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw?: number, dh?: number, flipX?: boolean, flipY?: boolean): void {
    const w = flr(sw);
    const h = flr(sh);
    this.blit(flr(sx), flr(sy), w, h, flr(dx), flr(dy), int(dw, w), int(dh, h), !!flipX, !!flipY);
  }

  map(cx?: number, cy?: number, sx?: number, sy?: number, cw?: number, ch?: number, layer?: number): void {
    const x0 = int(cx, 0);
    const y0 = int(cy, 0);
    const dx = int(sx, 0);
    const dy = int(sy, 0);
    const w = int(cw, 128);
    const h = int(ch, 64);
    const mask = int(layer, 0);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const t = this.mget(x0 + i, y0 + j);
        if (t === 0) continue;
        if (mask && (this.mem.peek(ADDR.flags + t) & mask) !== mask) continue;
        this.spr(t, dx + i * 8, dy + j * 8);
      }
    }
  }

  /** Textured line: samples the map along (mx, my) in tile units, stepping (mdx, mdy) per pixel. */
  tline(x0: number, y0: number, x1: number, y1: number, mx: number, my: number, mdx?: number, mdy?: number, layers?: number): void {
    const ctx = this.ctx();
    let ax = flr(x0) - ctx.camX;
    let ay = flr(y0) - ctx.camY;
    const bx = flr(x1) - ctx.camX;
    const by = flr(y1) - ctx.camY;
    const stepX = mdx ?? 0.125;
    const stepY = mdy ?? 0;
    const mask = int(layers, 0);
    let u = mx;
    let v = my;
    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let err = dx + dy;
    const ram = this.mem.ram;
    for (let n = 0; n < 4096; n++) {
      if (ax >= ctx.cx0 && ay >= ctx.cy0 && ax < ctx.cx1 && ay < ctx.cy1) {
        const tx = flr(u);
        const ty = flr(v);
        const t = this.mget(tx, ty);
        if (t !== 0 && (!mask || (this.mem.peek(ADDR.flags + t) & mask) === mask)) {
          const px = (t & 15) * 8 + (flr(u * 8) & 7);
          const py = (t >> 4) * 8 + (flr(v * 8) & 7);
          const b = ram[(py << 6) + (px >> 1)]!;
          const s = px & 1 ? b >> 4 : b & 0x0f;
          const p = ram[DRAW_PAL + s]!;
          if (!(p & TRANSPARENT)) this.rawSet(ax, ay, p & 0x0f);
        }
      }
      if (ax === bx && ay === by) break;
      u += stepX;
      v += stepY;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }
}

function order(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}
