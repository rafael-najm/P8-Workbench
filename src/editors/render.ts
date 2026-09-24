/** Canvas helpers shared by the asset editors. */
import type { Cart } from '../cart/types';
import { PALETTE_RGBA32 } from '../runtime/palette';

/** The spritesheet as RGBA32 (128x128). Color 0 can be made transparent. */
export function sheetPixels(cart: Cart, transparent0 = false): Uint32Array {
  const out = new Uint32Array(128 * 128);
  for (let i = 0; i < out.length; i++) {
    const c = cart.gfx[i]!;
    out[i] = transparent0 && c === 0 ? 0 : PALETTE_RGBA32[c]!;
  }
  return out;
}

export function putPixels(ctx: CanvasRenderingContext2D, pixels: Uint32Array, w: number, h: number, dx = 0, dy = 0): void {
  const img = ctx.createImageData(w, h);
  new Uint32Array(img.data.buffer).set(pixels.subarray(0, w * h));
  ctx.putImageData(img, dx, dy);
}

/** A 128x128 canvas holding the sheet, for drawImage-based rendering (map, previews). */
export function sheetCanvas(cart: Cart, target?: HTMLCanvasElement | OffscreenCanvas): HTMLCanvasElement | OffscreenCanvas {
  const c = target ?? (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(128, 128) : Object.assign(document.createElement('canvas'), { width: 128, height: 128 }));
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | null;
  if (ctx) putPixels(ctx, sheetPixels(cart, true), 128, 128);
  return c;
}

export function spriteOrigin(n: number): [number, number] {
  return [(n % 16) * 8, Math.floor(n / 16) * 8];
}
