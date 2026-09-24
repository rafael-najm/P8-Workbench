import { lint } from '../../cart/lint';
import { codeStats } from '../../cart/tokens';
import { preprocess } from '../../runtime/preprocess';
import { fail, ok, type ToolDef } from '../types';

const syntaxNote = (code: string) => {
  const r = preprocess(code);
  return r.ok ? undefined : `syntax error line ${r.error.line}: ${r.error.message}`;
};

export const readCode: ToolDef<{ start_line?: number; end_line?: number }> = {
  name: 'read_code', kind: 'read',
  description: 'Read the cart code with line numbers (optionally a line range).',
  parameters: { type: 'object', properties: { start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } } },
  summarize: (a) => (a.start_line ? `lines ${a.start_line}-${a.end_line ?? 'end'}` : 'all'),
  run(a, ctx) {
    const lines = ctx.cart().code.split('\n');
    const s = Math.max(1, a.start_line ?? 1);
    const e = Math.min(lines.length, a.end_line ?? lines.length);
    return ok(`${lines.length} lines total\n` + lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(4)}| ${l}`).join('\n'));
  },
};

export const searchCode: ToolDef<{ query: string; regex?: boolean }> = {
  name: 'search_code', kind: 'read',
  description: 'Find occurrences in the code. Returns matching lines with line numbers.',
  parameters: { type: 'object', properties: { query: { type: 'string' }, regex: { type: 'boolean' } }, required: ['query'] },
  summarize: (a) => a.query,
  run(a, ctx) {
    let re: RegExp;
    try { re = a.regex ? new RegExp(a.query) : new RegExp(a.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); } catch (e) { return fail(`bad regex: ${String(e)}`); }
    const hits = ctx.cart().code.split('\n').flatMap((l, i) => (re.test(l) ? [`${i + 1}| ${l}`] : []));
    return ok(hits.length ? hits.slice(0, 200).join('\n') : 'no matches');
  },
};

export const editCode: ToolDef<{ old_str: string; new_str: string }> = {
  name: 'edit_code', kind: 'edit',
  description: 'Replace an exact, unique snippet of code (old_str must occur exactly once; include enough context). Prefer this over write_code.',
  parameters: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['old_str', 'new_str'] },
  summarize: (a) => a.old_str.split('\n')[0]!.slice(0, 50),
  preview(a, ctx) {
    const before = ctx.cart().code;
    return { type: 'code', before, after: before.replace(a.old_str, () => a.new_str) };
  },
  run(a, ctx) {
    const code = ctx.cart().code;
    const n = a.old_str ? code.split(a.old_str).length - 1 : 0;
    if (n !== 1) return fail(n === 0 ? 'old_str not found (check exact whitespace; use read_code)' : `old_str occurs ${n} times; add context to make it unique`);
    const next = code.replace(a.old_str, () => a.new_str);
    ctx.update(['code'], 'edit_code', (c) => (c.code = next));
    const line = code.slice(0, code.indexOf(a.old_str)).split('\n').length;
    return ok({ ok: true, at_line: line, tokens: codeStats(next).tokens, syntax: syntaxNote(next) ?? 'ok' });
  },
};

export const writeCode: ToolDef<{ code: string }> = {
  name: 'write_code', kind: 'edit',
  description: 'Replace ALL the code. Only when a rewrite is really needed; otherwise use edit_code.',
  parameters: { type: 'object', properties: { code: { type: 'string' } }, required: ['code'] },
  summarize: (a) => `${a.code.split('\n').length} lines`,
  preview: (a, ctx) => ({ type: 'code', before: ctx.cart().code, after: a.code }),
  run(a, ctx) {
    ctx.update(['code'], 'write_code', (c) => (c.code = a.code));
    return ok({ ok: true, tokens: codeStats(a.code).tokens, syntax: syntaxNote(a.code) ?? 'ok' });
  },
};

export const cartStats: ToolDef<Record<string, never>> = {
  name: 'cart_stats', kind: 'read',
  description: 'Tokens/chars vs limits, functions with token counts, syntax check and lint.',
  parameters: { type: 'object', properties: {} },
  run(_a, ctx) {
    const code = ctx.cart().code;
    const s = codeStats(code);
    return ok({ tokens: `${s.tokens}/${s.tokenLimit}`, chars: `${s.chars}/${s.charLimit}`, syntax: syntaxNote(code) ?? 'ok',
      functions: s.functions.map((f) => `${f.name} (line ${f.line}): ${f.tokens}`), lint: lint(code).slice(0, 40).map((i) => `line ${i.line}: ${i.message}`) });
  },
};
