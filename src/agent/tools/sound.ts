import type { SfxNote } from '../../cart/types';
import { parsePitch, pitchName } from '../../runtime/audio/notes';
import { FX_NAMES, WAVE_NAMES } from '../../runtime/audio/synth';
import { fail, ok, type ToolDef } from '../types';

export const getSfx: ToolDef<{ n: number }> = {
  name: 'get_sfx', kind: 'read',
  description: `Read sfx n (0-63): speed (ticks per note, 1 tick = 1/120s), loops and the 32 notes (vol 0 = silent). Waves: ${WAVE_NAMES.map((w, i) => `${i} ${w}`).join(', ')}. Fx: ${FX_NAMES.map((f, i) => `${i} ${f}`).join(', ')}.`,
  parameters: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 63 } }, required: ['n'] },
  summarize: (a) => `#${a.n}`,
  run(a, ctx) {
    const s = ctx.cart().sfx[a.n]!;
    let last = 31;
    while (last >= 0 && s.notes[last]!.volume === 0) last--;
    return ok({ n: a.n, speed: s.speed, loop_start: s.loopStart, loop_end: s.loopEnd, empty: last < 0,
      notes: s.notes.slice(0, last + 1).map((x) => ({ pitch: pitchName(x.pitch), wave: x.waveform, vol: x.volume, fx: x.effect })) });
  },
};

export const setSfx: ToolDef<{ n: number; speed: number; loop_start?: number; loop_end?: number; notes: { pitch: string | number; wave?: number; vol?: number; fx?: number }[] }> = {
  name: 'set_sfx', kind: 'edit',
  description: 'Write sfx n. notes: up to 32 of {pitch ("c#3" or 0-63; c0..d#5), wave 0-7, vol 0-7, fx 0-7}; missing notes become silent. speed ~ 1-32 (lower = faster).',
  parameters: { type: 'object', properties: {
    n: { type: 'integer', minimum: 0, maximum: 63 }, speed: { type: 'integer', minimum: 1, maximum: 255 },
    loop_start: { type: 'integer', minimum: 0, maximum: 31 }, loop_end: { type: 'integer', minimum: 0, maximum: 32 },
    notes: { type: 'array', items: { type: 'object', properties: { pitch: { anyOf: [{ type: 'string' }, { type: 'integer' }] }, wave: { type: 'integer', minimum: 0, maximum: 7 }, vol: { type: 'integer', minimum: 0, maximum: 7 }, fx: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['pitch'] } },
  }, required: ['n', 'speed', 'notes'] },
  summarize: (a) => `#${a.n} ${a.notes.length} notes spd ${a.speed}`,
  preview: (a) => ({ type: 'text', summary: `sfx ${a.n}: ${a.notes.map((x) => x.pitch).join(' ')}` }),
  run(a, ctx) {
    if (a.notes.length > 32) return fail('at most 32 notes');
    const notes: SfxNote[] = [];
    for (let i = 0; i < 32; i++) {
      const x = a.notes[i];
      if (!x) { notes.push({ pitch: 0, waveform: 0, volume: 0, effect: 0, customInstrument: false }); continue; }
      const p = parsePitch(x.pitch);
      if (p === null) return fail(`note ${i}: bad pitch ${JSON.stringify(x.pitch)} (use c0..d#5 or 0-63)`);
      notes.push({ pitch: p, waveform: x.wave ?? 0, volume: x.vol ?? 5, effect: x.fx ?? 0, customInstrument: false });
    }
    ctx.update(['sfx'], 'set_sfx', (c) => (c.sfx[a.n] = { editorMode: c.sfx[a.n]!.editorMode, speed: a.speed, loopStart: a.loop_start ?? 0, loopEnd: a.loop_end ?? 0, notes }));
    return ok({ ok: true, duration_seconds: Math.round(((a.loop_end || a.notes.length) * a.speed * 183) / 22050 * 100) / 100 });
  },
};

export const setMusic: ToolDef<{ pattern: number; channels: (number | null)[]; flags?: number }> = {
  name: 'set_music', kind: 'edit',
  description: 'Set music pattern (0-63): channels = 4 sfx numbers (null = channel off); flags: 1 loop start, 2 loop end, 4 stop.',
  parameters: { type: 'object', properties: { pattern: { type: 'integer', minimum: 0, maximum: 63 }, channels: { type: 'array', description: '4 entries: sfx 0-63 or null' }, flags: { type: 'integer', minimum: 0, maximum: 7 } }, required: ['pattern', 'channels'] },
  summarize: (a) => `#${a.pattern} ${JSON.stringify(a.channels)}`,
  run(a, ctx) {
    if (a.channels.some((v) => v !== null && (typeof v !== 'number' || v < 0 || v > 63))) return fail('channels: sfx numbers 0-63 or null');
    const ch = [0, 1, 2, 3].map((i) => { const v = a.channels[i]; return v === null || v === undefined ? 0x41 + i : v & 0x3f; }) as [number, number, number, number];
    ctx.update(['music'], 'set_music', (c) => (c.music[a.pattern] = { flags: a.flags ?? 0, channels: ch }));
    return ok({ ok: true });
  },
};

export const playSfx: ToolDef<{ n: number }> = {
  name: 'play_sfx', kind: 'read',
  description: 'Play sfx n for the user to hear.',
  parameters: { type: 'object', properties: { n: { type: 'integer', minimum: 0, maximum: 63 } }, required: ['n'] },
  summarize: (a) => `#${a.n}`,
  run(a, ctx) {
    ctx.playSfx?.(a.n);
    return ok(ctx.playSfx ? 'playing' : 'audio not available here');
  },
};
