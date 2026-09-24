import { describe, expect, it } from 'vitest';
import { PALETTE_RGB } from '../runtime/palette';
import { brushPoints, ellipsePoints, flipBlock, floodFill, linePoints, quantizeToPalette, readBlock, rectPoints, rotateBlock } from './tools';

describe('raster tools', () => {
  it('line is continuous and inclusive', () => {
    expect(linePoints(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(linePoints(0, 0, 2, 2)).toEqual([[0, 0], [1, 1], [2, 2]]);
  });

  it('rect outline and fill', () => {
    expect(rectPoints(0, 0, 2, 2, false)).toHaveLength(8);
    expect(rectPoints(2, 2, 0, 0, true)).toHaveLength(9);
  });

  it('ellipse fill is symmetric and inside its box', () => {
    const pts = ellipsePoints(0, 0, 7, 7, true);
    for (const [x, y] of pts) expect(x >= 0 && x <= 7 && y >= 0 && y <= 7).toBe(true);
    const set = new Set(pts.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of pts) expect(set.has(`${7 - x},${y}`)).toBe(true);
    expect(ellipsePoints(0, 0, 7, 7, false).length).toBeLessThan(pts.length);
  });

  it('brush sizes', () => {
    expect(brushPoints(5, 5, 1)).toEqual([[5, 5]]);
    expect(brushPoints(5, 5, 3)).toHaveLength(9);
  });

  it('flood fill stays within bounds and matching color', () => {
    const grid = [
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ];
    const get = (x: number, y: number) => grid[y]![x]!;
    expect(floodFill(get, 0, 0, { x: 0, y: 0, w: 3, h: 3 })).toHaveLength(3);
    expect(floodFill(get, 0, 0, { x: 0, y: 0, w: 1, h: 3 })).toHaveLength(2);
    expect(floodFill(get, 5, 5, { x: 0, y: 0, w: 3, h: 3 })).toEqual([]);
  });

  it('flip and rotate blocks', () => {
    const b = readBlock((x, y) => y * 2 + x, { x: 0, y: 0, w: 2, h: 3 }); // [[0,1],[2,3],[4,5]]
    expect([...flipBlock(b, true).data]).toEqual([1, 0, 3, 2, 5, 4]);
    expect([...flipBlock(b, false).data]).toEqual([4, 5, 2, 3, 0, 1]);
    const r = rotateBlock(b);
    expect([r.w, r.h]).toEqual([3, 2]);
    expect([...r.data]).toEqual([4, 2, 0, 5, 3, 1]);
  });

  it('quantizes colors to the nearest palette entry and alpha to transparent', () => {
    const rgba = Uint8Array.from([255, 0, 70, 255, 250, 240, 230, 255, 10, 10, 10, 0]);
    expect([...quantizeToPalette(rgba, PALETTE_RGB.slice(0, 16))]).toEqual([8, 7, 0]);
  });
});
