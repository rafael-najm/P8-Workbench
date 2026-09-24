import { serializeP8 } from '../../cart/p8format';
import type { PlaytestArgs } from '../exec/playtest';
import { ok, type JsonSchema, type ToolDef } from '../types';

const INPUTS: JsonSchema = { type: 'array', description: 'Input script: [{frame, buttons: ["left","right","up","down","o","x"], hold_frames}] (frames counted from the start of this run)',
  items: { type: 'object', properties: { frame: { type: 'integer', minimum: 0 }, buttons: { type: 'array', items: { type: 'string' } }, hold_frames: { type: 'integer', minimum: 1 } }, required: ['frame', 'buttons'] } };

export const runGame: ToolDef<{ frames: number; inputs?: []; from_start?: boolean; watch?: string[] }> = {
  name: 'run_game', kind: 'exec',
  description: 'Run the cart headless for N frames (in a sandbox copy). Returns errors with source line, printh output, watched globals and simulated performance. from_start (default true) restarts; false continues the previous run.',
  parameters: { type: 'object', properties: { frames: { type: 'integer', minimum: 1, maximum: 36000 }, inputs: INPUTS, from_start: { type: 'boolean' }, watch: { type: 'array', items: { type: 'string' } } }, required: ['frames'] },
  summarize: (a) => `${a.frames} frames${a.inputs?.length ? ` · ${a.inputs.length} inputs` : ''}`,
  async run(a, ctx) {
    return ok(await ctx.exec.runGame(serializeP8(ctx.cart()), a));
  },
};

export const screenshot: ToolDef<{ at_frame?: number; scale?: number; inputs?: [] }> = {
  name: 'screenshot', kind: 'exec',
  description: 'PNG of the game screen: at_frame runs from the start to that frame (with optional inputs); without it, the current state of the last run.',
  parameters: { type: 'object', properties: { at_frame: { type: 'integer', minimum: 1 }, scale: { type: 'integer', minimum: 1, maximum: 4 }, inputs: INPUTS } },
  summarize: (a) => (a.at_frame ? `frame ${a.at_frame}` : 'current'),
  async run(a, ctx) {
    const r = await ctx.exec.screenshots(serializeP8(ctx.cart()), a);
    return ok({ frames: r.frames, error: r.error ?? null }, r.images);
  },
};

export const screenshots: ToolDef<{ frames: number[]; scale?: number; inputs?: [] }> = {
  name: 'screenshots', kind: 'exec',
  description: 'Several screenshots from one run (contact sheet image, labelled by frame). Up to 16 frames.',
  parameters: { type: 'object', properties: { frames: { type: 'array', items: { type: 'integer', minimum: 1 } }, scale: { type: 'integer', minimum: 1, maximum: 2 }, inputs: INPUTS }, required: ['frames'] },
  summarize: (a) => a.frames.join(','),
  async run(a, ctx) {
    const r = await ctx.exec.screenshots(serializeP8(ctx.cart()), a);
    return ok({ frames: r.frames, error: r.error ?? null }, r.images);
  },
};

export const readGlobals: ToolDef<{ names?: string[]; depth?: number }> = {
  name: 'read_globals', kind: 'exec',
  description: 'Values of global variables in the last run (all user globals if names omitted). Tables limited by depth.',
  parameters: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } }, depth: { type: 'integer', minimum: 0, maximum: 4 } } },
  summarize: (a) => a.names?.join(',') ?? 'all',
  async run(a, ctx) {
    return ok(await ctx.exec.readGlobals(serializeP8(ctx.cart()), a.names, a.depth ?? 2));
  },
};

export const evalLua: ToolDef<{ code: string }> = {
  name: 'eval_lua', kind: 'exec',
  description: 'Evaluate PICO-8 Lua (expression or statements) in the paused state of the last run; returns the value as JSON.',
  parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  summarize: (a) => a.code.slice(0, 60),
  async run(a, ctx) {
    return ok(await ctx.exec.evalLua(serializeP8(ctx.cart()), a.code));
  },
};

export const playtestTool: ToolDef<PlaytestArgs> = {
  name: 'playtest', kind: 'exec',
  description: 'Run bots headless over several seeds and report: frames until game over, errors (with line), time per screen, peaks of monitored tables, sampled variables. Strategies: random; hold_fire_track (holds fire and follows the nearest enemy in x; set `enemies`/`player` global names if auto-detection fails); custom (`bot`: PICO-8 Lua `function bot(state) return {"left","x"} end`).',
  parameters: { type: 'object', properties: {
    strategy: { type: 'string', enum: ['random', 'hold_fire_track', 'custom'] }, frames: { type: 'integer', minimum: 1, maximum: 36000 },
    seeds: { type: 'array', items: { type: 'integer' } }, enemies: { type: 'string' }, player: { type: 'string' }, bot: { type: 'string' },
    track: { type: 'array', items: { type: 'string' } }, record: { type: 'array', items: { type: 'string' } }, sample_every: { type: 'integer', minimum: 1 }, game_over: { type: 'string' },
  }, required: ['strategy', 'frames'] },
  summarize: (a) => `${a.strategy} ${a.frames}f x${a.seeds?.length ?? 3}`,
  async run(a, ctx) {
    return ok(await ctx.exec.playtest(serializeP8(ctx.cart()), a));
  },
};
