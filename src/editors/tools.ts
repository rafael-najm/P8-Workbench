/** Pure raster tools used by the sprite and map editors (integer grid coordinates). */

export type Point = [number, number];

/** Bresenham line, inclusive. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const pts: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
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
  return pts;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const pts: Point[] = [];
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (filled || x === ax || x === bx || y === ay || y === by) pts.push([x, y]);
    }
  }
  return pts;
}

/** Ellipse inscribed in the rectangle (outline or filled). */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Point[] {
  const [ax, bx] = x0 <= x1 ? [x0, x1] : [x1, x0];
  const [ay, by] = y0 <= y1 ? [y0, y1] : [y1, y0];
  const cx = (ax + bx + 1) / 2;
  const cy = (ay + by + 1) / 2;
  const rx = (bx - ax + 1) / 2;
  const ry = (by - ay + 1) / 2;
  const inside = (x: number, y: number) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0001;
  const pts: Point[] = [];
  for (let y = ay; y <= by; y++) {
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push([x, y]);
    }
  }
  return pts;
}

/** Square brush of `size` pixels centered-ish on (x, y). */
export function brushPoints(x: number, y: number, size: number): Point[] {
  const pts: Point[] = [];
  const o = Math.floor((size - 1) / 2);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) pts.push([x - o + i, y - o + j]);
  return pts;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 4-way flood fill within bounds. Returns the filled points. */
export function floodFill(get: (x: number, y: number) => number, x: number, y: number, b: Bounds): Point[] {
  if (x < b.x || y < b.y || x >= b.x + b.w || y >= b.y + b.h) return [];
  const target = get(x, y);
  const seen = new Uint8Array(b.w * b.h);
  const out: Point[] = [];
  const stack: Point[] = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop()!;
    if (px < b.x || py < b.y || px >= b.x + b.w || py >= b.y + b.h) continue;
    const k = (py - b.y) * b.w + (px - b.x);
    if (seen[k] || get(px, py) !== target) continue;
    seen[k] = 1;
    out.push([px, py]);
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  return out;
}

/** A rectangular block of values (pixels or tiles). */
export interface Block {
  w: number;
  h: number;
  data: Uint8Array;
}

export function readBlock(get: (x: number, y: number) => number, b: Bounds): Block {
  const data = new Uint8Array(b.w * b.h);
  for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) data[j * b.w + i] = get(b.x + i, b.y + j);
  return { w: b.w, h: b.h, data };
}

export function flipBlock(block: Block, horizontal: boolean): Block {
  const out = new Uint8Array(block.data.length);
  for (let j = 0; j < block.h; j++) {
    for (let i = 0; i < block.w; i++) {
      const si = horizontal ? block.w - 1 - i : i;
      const sj = horizontal ? j : block.h - 1 - j;
      out[j * block.w + i] = block.data[sj * block.w + si]!;
    }
  }
  return { w: block.w, h: block.h, data: out };
}

/** Rotates 90 degrees clockwise. */
export function rotateBlock(block: Block): Block {
  const out = new Uint8Array(block.data.length);
  const w = block.h;
  const h = block.w;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out[j * w + i] = block.data[(block.h - 1 - i) * block.w + j]!;
  return { w, h, data: out };
}

/** Converts RGBA pixels to the nearest of `palette` colors (by weighted RGB distance). */
export function quantizeToPalette(rgba: Uint8ClampedArray | Uint8Array, palette: readonly (readonly [number, number, number])[], transparentIndex = 0): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const a = rgba[i * 4 + 3]!;
    if (a < 128) {
      out[i] = transparentIndex;
      continue;
    }
    let best = 0;
    let bestD = Infinity;
    palette.forEach(([pr, pg, pb], k) => {
      const rm = (r + pr) / 2;
      const d = (2 + rm / 256) * (r - pr) ** 2 + 4 * (g - pg) ** 2 + (2 + (255 - rm) / 256) * (b - pb) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    out[i] = best;
  }
  return out;
}
