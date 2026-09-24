import { getGfxPixel, getMapTile, setGfxPixel, setMapTile } from '../../cart/cart';
import { encodeIndexedPng, bytesToBase64 } from '../../runtime/png';
import { fail, ok, type ToolDef } from '../types';

const origin = (n: number) => [(n % 16) * 8, Math.floor(n / 16) * 8] as const;
const HEX = '0123456789abcdef';

export const getSprite: ToolDef<{ n: number; w?: number; h?: number }> = {
  name: 'get_sprite', kind: 'read',
  description: 'Sprite n (w x h sprites, default 1x1) as rows of hex digits, one per pixel, "." for color 0.',
  parameters: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 255 }, w: { type: 'integer', minimum: 1, maximum: 16 }, h: { type: 'integer', minimum: 1, maximum: 16 } }, required: ['n'] },
  summarize: (a) => `#${a.n}${a.w || a.h ? ` ${a.w ?? 1}x${a.h ?? 1}` : ''}`,
  run(a, ctx) {
    const [ox, oy] = origin(a.n);
    const rows: string[] = [];
    for (let y = 0; y < (a.h ?? 1) * 8 && oy + y < 128; y++) {
      let r = '';
      for (let x = 0; x < (a.w ?? 1) * 8 && ox + x < 128; x++) { const c = getGfxPixel(ctx.cart(), ox + x, oy + y); r += c ? HEX[c] : '.'; }
      rows.push(r);
    }
    return ok({ n: a.n, flags: ctx.cart().flags[a.n], rows });
  },
};

export const setSprite: ToolDef<{ n: number; rows: string[] }> = {
  name: 'set_sprite', kind: 'edit',
  description: 'Write pixels starting at sprite n. rows: equal-length strings of hex digits ("." = 0), width/height multiples of 8 recommended (8 = one sprite).',
  parameters: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 255 }, rows: { type: 'array', items: { type: 'string' } } }, required: ['n', 'rows'] },
  summarize: (a) => `#${a.n} ${a.rows[0]?.length ?? 0}x${a.rows.length}`,
  preview: (a) => ({ type: 'text', summary: `sprite ${a.n}:\n${a.rows.join('\n')}` }),
  run(a, ctx) {
    const [ox, oy] = origin(a.n);
    const w = a.rows[0]?.length ?? 0;
    if (!w || a.rows.some((r) => r.length !== w)) return fail('rows must be non-empty and the same length');
    if (a.rows.some((r) => !/^[0-9a-fA-F.]+$/.test(r))) return fail('rows may only contain hex digits and "."');
    if (ox + w > 128 || oy + a.rows.length > 128) return fail('block goes past the edge of the spritesheet');
    ctx.update(['gfx', 'map'], 'set_sprite', (c) => a.rows.forEach((r, y) => [...r].forEach((ch, x) => setGfxPixel(c, ox + x, oy + y, ch === '.' ? 0 : parseInt(ch, 16)))));
    return ok({ ok: true, size: `${w}x${a.rows.length}`, note: oy + a.rows.length > 64 ? 'sprites 128-255 share memory with map rows 32-63' : undefined });
  },
};

export const getSpritesheetImage: ToolDef<{ region?: { x: number; y: number; w: number; h: number }; scale?: number }> = {
  name: 'get_spritesheet_image', kind: 'read',
  description: 'PNG of the spritesheet (or a pixel region) for visual inspection.',
  parameters: { type: 'object', properties: { region: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, w: { type: 'integer' }, h: { type: 'integer' } } }, scale: { type: 'integer', minimum: 1, maximum: 8 } } },
  async run(a, ctx) {
    const r = a.region ?? { x: 0, y: 0, w: 128, h: 128 };
    const w = Math.max(1, Math.min(128 - r.x, r.w)), h = Math.max(1, Math.min(128 - r.y, r.h));
    const px = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = getGfxPixel(ctx.cart(), r.x + x, r.y + y);
    const png = await encodeIndexedPng(px, w, h, a.scale ?? (w <= 32 ? 8 : 3));
    return ok({ region: { ...r, w, h } }, [`data:image/png;base64,${bytesToBase64(png)}`]);
  },
};

export const setFlags: ToolDef<{ n: number; flags: number | number[] }> = {
  name: 'set_flags', kind: 'edit',
  description: 'Set sprite n flags as a byte (0-255): bit 0 = 1, bit 1 = 2, bit 2 = 4... e.g. 5 turns on flags 0 and 2.',
  parameters: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 255 }, flags: { type: 'integer', minimum: 0, maximum: 255 } }, required: ['n', 'flags'] },
  summarize: (a) => `#${a.n} = ${JSON.stringify(a.flags)}`,
  run(a, ctx) {
    const v = Array.isArray(a.flags) ? a.flags.reduce((m, b) => m | (1 << b), 0) : a.flags;
    ctx.update(['flags'], 'set_flags', (c) => (c.flags[a.n] = v));
    return ok({ ok: true, n: a.n, flags: v });
  },
};

export const getMap: ToolDef<{ x: number; y: number; w: number; h: number }> = {
  name: 'get_map', kind: 'read',
  description: 'Map cells as rows of 2-digit hex tile numbers (map is 128x64; rows 32-63 share memory with sprites 128-255).',
  parameters: { type: 'object', properties: { x: { type: 'integer', minimum: 0 }, y: { type: 'integer', minimum: 0 }, w: { type: 'integer', minimum: 1, maximum: 128 }, h: { type: 'integer', minimum: 1, maximum: 64 } }, required: ['x', 'y', 'w', 'h'] },
  summarize: (a) => `${a.x},${a.y} ${a.w}x${a.h}`,
  run(a, ctx) {
    const rows: string[] = [];
    for (let y = a.y; y < Math.min(64, a.y + a.h); y++) {
      let r = '';
      for (let x = a.x; x < Math.min(128, a.x + a.w); x++) r += getMapTile(ctx.cart(), x, y).toString(16).padStart(2, '0');
      rows.push(r);
    }
    return ok({ rows });
  },
};

export const setMap: ToolDef<{ x: number; y: number; rows: string[] }> = {
  name: 'set_map', kind: 'edit',
  description: 'Write map cells from (x,y): rows of 2-digit hex tile numbers.',
  parameters: { type: 'object', properties: { x: { type: 'integer', minimum: 0, maximum: 127 }, y: { type: 'integer', minimum: 0, maximum: 63 }, rows: { type: 'array', items: { type: 'string' } } }, required: ['x', 'y', 'rows'] },
  summarize: (a) => `${a.x},${a.y} ${(a.rows[0]?.length ?? 0) / 2}x${a.rows.length}`,
  preview: (a) => ({ type: 'text', summary: a.rows.join('\n') }),
  run(a, ctx) {
    if (a.rows.some((r) => r.length % 2 || !/^[0-9a-fA-F]*$/.test(r))) return fail('rows must be pairs of hex digits');
    ctx.update(['map', 'gfx'], 'set_map', (c) => a.rows.forEach((r, j) => { for (let i = 0; i < r.length / 2; i++) { const x = a.x + i, y = a.y + j; if (x < 128 && y < 64) setMapTile(c, x, y, parseInt(r.slice(i * 2, i * 2 + 2), 16)); } }));
    return ok({ ok: true });
  },
};
