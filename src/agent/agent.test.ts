import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { cloneCart } from '../cart/cart';
import { parseP8 } from '../cart/p8format';
import type { Cart } from '../cart/types';
import { InProcessExecutor } from './exec/executor';
import { compactHistory, runAgent, type AgentEvent } from './loop';
import { validate } from './schema';
import { TOOL_BY_NAME, TOOLS, toolSchemas } from './tools';
import type { ToolContext, ToolResult } from './types';

const NEBULA = parseP8(readFileSync(new URL('../../samples/nebula_strike.p8', import.meta.url), 'utf8'));
let cart: Cart;
const exec = new InProcessExecutor();
const ctx: ToolContext = { cart: () => cart, update: (_k, _l, fn) => fn(cart), exec };
const call = async (name: string, args: unknown): Promise<ToolResult & { json: any }> => {
  const t = TOOL_BY_NAME.get(name)!;
  expect(validate(t.parameters, args)).toEqual([]);
  const r = await t.run(args as never, ctx);
  let json: unknown = null;
  try { json = JSON.parse(r.content); } catch { /* text */ }
  return { ...r, json };
};

beforeEach(() => (cart = cloneCart(NEBULA)));

describe('tool schemas', () => {
  it('every tool has a valid function schema', () => {
    expect(TOOLS.length).toBe(21);
    for (const s of toolSchemas()) expect(s.function.parameters.type).toBe('object');
  });
  it('validate reports missing and mistyped args', () => {
    const t = TOOL_BY_NAME.get('get_sprite')!;
    expect(validate(t.parameters, {})).toEqual(['args.n: required']);
    expect(validate(t.parameters, { n: 300 })[0]).toMatch(/<= 255/);
  });
});

describe('code tools', () => {
  it('read_code / search_code', async () => {
    expect((await call('read_code', { start_line: 1, end_line: 2 })).content).toContain('   1| -- nebula strike');
    expect((await call('search_code', { query: 'function _init' })).content).toMatch(/^\d+\| function _init/);
  });
  it('edit_code requires a unique match and reports syntax', async () => {
    expect((await call('edit_code', { old_str: 'end', new_str: 'x' })).isError).toBe(true);
    const r = await call('edit_code', { old_str: 'hi=dget(0)', new_str: 'hi=dget(0) bonus=1' });
    expect(r.json).toMatchObject({ ok: true, syntax: 'ok' });
    expect(cart.code).toContain('bonus=1');
    expect((await call('edit_code', { old_str: 'bonus=1', new_str: 'bonus=(' })).json.syntax).toMatch(/syntax error/);
  });
  it('write_code and cart_stats', async () => {
    await call('write_code', { code: 'function _draw() cls(1) end' });
    const r = await call('cart_stats', {});
    expect(r.json.tokens).toBe('6/8192');
    expect(r.json.functions[0]).toMatch(/_draw/);
  });
});

describe('gfx tools', () => {
  it('get/set sprite round-trip', async () => {
    await call('set_sprite', { n: 200, rows: ['8.......', '.8......'] });
    const r = await call('get_sprite', { n: 200 });
    expect(r.json.rows.slice(0, 2)).toEqual(['8.......', '.8......']);
    expect((await call('set_sprite', { n: 0, rows: ['zz'] })).isError).toBe(true);
  });
  it('spritesheet image, flags and map', async () => {
    const img = await call('get_spritesheet_image', { region: { x: 0, y: 0, w: 16, h: 8 } });
    expect(img.images?.[0]).toMatch(/^data:image\/png;base64,/);
    await call('set_flags', { n: 5, flags: [0, 2] });
    expect(cart.flags[5]).toBe(5);
    await call('set_map', { x: 1, y: 2, rows: ['0a0b'] });
    expect((await call('get_map', { x: 1, y: 2, w: 2, h: 1 })).json.rows).toEqual(['0a0b']);
  });
});

describe('sound tools', () => {
  it('set_sfx with note names, get_sfx, set_music, play_sfx', async () => {
    await call('set_sfx', { n: 40, speed: 6, notes: [{ pitch: 'c3', wave: 3, vol: 6 }, { pitch: 'e3', fx: 1 }] });
    const r = await call('get_sfx', { n: 40 });
    expect(r.json.notes).toEqual([{ pitch: 'c3', wave: 3, vol: 6, fx: 0 }, { pitch: 'e3', wave: 0, vol: 5, fx: 1 }]);
    expect((await call('set_sfx', { n: 40, speed: 6, notes: [{ pitch: 'h9' }] })).isError).toBe(true);
    await call('set_music', { pattern: 20, channels: [40, null, null, null], flags: 1 });
    expect(cart.music[20]).toEqual({ flags: 1, channels: [40, 0x42, 0x43, 0x44] });
    expect((await call('play_sfx', { n: 40 })).content).toMatch(/audio/);
  });
});

describe('execution tools', () => {
  it('run_game reports errors with source lines', async () => {
    const ok = await call('run_game', { frames: 120, inputs: [{ frame: 10, buttons: ['x'], hold_frames: 2 }], watch: ['st'] });
    expect(ok.json).toMatchObject({ frames_run: 120, error: null, target_fps: 60 });
    cart.code += '\nfunction _draw()\n local t=nil\n t.x=1\nend';
    const bad = await call('run_game', { frames: 10 });
    expect(bad.json.error.line).toBe(cart.code.split('\n').length - 1);
  });
  it('screenshot, screenshots, read_globals, eval_lua', async () => {
    const one = await call('screenshot', { at_frame: 30 });
    expect(one.images).toHaveLength(1);
    const sheet = await call('screenshots', { frames: [10, 20, 30] });
    expect(sheet.json.frames).toEqual([10, 20, 30]);
    await call('run_game', { frames: 5 });
    expect((await call('read_globals', { names: ['st'] })).json).toEqual({ st: 1 });
    expect((await call('eval_lua', { code: '1+#stars' })).json).toEqual({ value: 46 });
  });
  it('playtest: hold_fire_track reaches gameplay and reports screens', async () => {
    const r = await call('playtest', { strategy: 'hold_fire_track', frames: 900, seeds: [1], record: ['score'] });
    const s = r.json.seeds[0];
    expect(s.error).toBeNull();
    expect(s.screens.some((x: { screen: string }) => /upd_game/.test(x.screen))).toBe(true);
    expect(s.series.score).toBeDefined();
  }, 60_000);
  it('playtest: custom bot', async () => {
    const r = await call('playtest', { strategy: 'custom', frames: 120, seeds: [2], bot: 'function bot(s) if s.frame%10<5 then return {"x"} end return {} end' });
    expect(r.json.summary.errors).toBe(0);
  }, 60_000);
});

describe('agent loop', () => {
  function sse(chunks: unknown[]): Response {
    const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(new Blob([body]).stream(), { status: 200 });
  }
  it('streams text, runs tool calls and loops until the model answers', async () => {
    let n = 0;
    const fetchFn = (async () => {
      n++;
      if (n === 1) return sse([
        { choices: [{ delta: { content: 'Editing' } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'edit_code', arguments: '{"old_str":"hi=dget(0)",' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"new_str":"hi=dget(0) z=1"}' } }] }, finish_reason: 'tool_calls' }] },
      ]);
      return sse([{ choices: [{ delta: { content: 'Done.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2, cost: 0.001 } }]);
    }) as unknown as typeof fetch;
    const events: AgentEvent[] = [];
    const msgs = await runAgent({ apiKey: 'k', model: 'm', messages: [{ role: 'user', content: 'go' }], ctx, vision: false, fetchFn, onEvent: (e) => events.push(e) });
    expect(cart.code).toContain('z=1');
    expect(events.map((e) => e.type)).toEqual(['text', 'assistant', 'tool_start', 'tool_end', 'text', 'assistant', 'done']);
    expect(msgs.filter((m) => m.role === 'tool')).toHaveLength(1);
    expect(events.find((e) => e.type === 'assistant' && e.usage)).toBeDefined();
  });
  it('approval can reject edits', async () => {
    const fetchFn = (async () => sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'write_code', arguments: '{"code":"x=1"}' } }] } }] }])) as unknown as typeof fetch;
    const before = cart.code;
    await runAgent({ apiKey: 'k', model: 'm', messages: [], ctx, vision: false, fetchFn, maxSteps: 1, onEvent: () => {}, approve: async () => false });
    expect(cart.code).toBe(before);
  });
});

describe('cost controls', () => {
  it('compacts old tool results and screenshots', () => {
    const msgs: import('./types').ChatMessage[] = [
      { role: 'tool', tool_call_id: 'a', content: 'x'.repeat(5000) },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:1' } }] },
      ...Array.from({ length: 8 }, () => ({ role: 'assistant' as const, content: 'hi' })),
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:2' } }] },
    ];
    compactHistory(msgs);
    expect((msgs[0] as { content: string }).content.length).toBeLessThan(1400);
    expect(msgs[1]!.content).toMatch(/removed/);
    expect(Array.isArray(msgs.at(-1)!.content)).toBe(true);
  });
  it('stops when the task budget is reached and sends max_tokens', async () => {
    let body: { max_tokens?: number } = {};
    const fetchFn = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      const chunk = { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'cart_stats', arguments: '{}' } }] } }], usage: { cost: 0.3 } };
      return new Response(new Blob([`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`]).stream());
    }) as unknown as typeof fetch;
    const events: AgentEvent[] = [];
    await runAgent({ apiKey: 'k', model: 'm', messages: [], ctx, vision: false, fetchFn, maxCost: 0.5, onEvent: (e) => events.push(e) });
    expect(body.max_tokens).toBe(4096);
    expect(events.filter((e) => e.type === 'assistant')).toHaveLength(2);
    expect(events.find((e) => e.type === 'error')).toBeDefined();
  });
});
