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
  description: 'Read code with line numbers, at most 150 lines per call. Use the function list in the context block to pick the range you need.',
  parameters: { type: 'object', properties: { start_line: { type: 'integer', minimum: 1 }, end_line: { type: 'integer', minimum: 1 } } },
  summarize: (a) => (a.start_line ? `lines ${a.start_line}-${a.end_line ?? 'end'}` : 'all'),
  run(a, ctx) {
    const lines = ctx.cart().code.split('\n');
    const MAX = 150;
    const s = Math.max(1, a.start_line ?? 1);
    const want = Math.min(lines.length, a.end_line ?? lines.length);
    const e = Math.min(want, s + MAX - 1);
    const more = e < want ? `\n… (${want - e} more lines: call read_code with start_line ${e + 1})` : '';
    return ok(`${lines.length} lines total; format: <line number><TAB><code>\n` + lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join('\n') + more);
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

/** Removes line-number prefixes a model may copy from read_code output ("  12\t", "12| "). */
function stripLineNumbers(text: string): string {
  const lines = text.split('\n');
  if (lines.length && lines.every((l) => /^\s*\d+(\t|\| ?)/.test(l) || l.trim() === '')) return lines.map((l) => l.replace(/^\s*\d+(\t|\| ?)/, '')).join('\n');
  return text;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches of `needle` in `code` ignoring differences in whitespace (indentation, spacing, blank lines). */
function looseMatches(code: string, needle: string): { index: number; length: number }[] {
  const parts = needle.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [];
  const re = new RegExp(parts.map(escapeRe).join('\\s*'), 'g');
  const out: { index: number; length: number }[] = [];
  for (const m of code.matchAll(re)) out.push({ index: m.index!, length: m[0].length });
  return out;
}

/** Lines similar to the first line of old_str, to help the model retry. */
function hints(code: string, oldStr: string): string {
  const first = oldStr.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  const words = first.split(/\W+/).filter((w) => w.length > 2);
  const scored = code.split('\n').map((l, i) => ({ i, l, s: words.filter((w) => l.includes(w)).length })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
  return scored.length ? ` Similar lines: ${scored.map((x) => `${x.i + 1}:${JSON.stringify(x.l)}`).join(' ')}` : '';
}

export const editCode: ToolDef<{ old_str: string; new_str: string }> = {
  name: 'edit_code', kind: 'edit',
  description: 'Replace a unique snippet of code: old_str = the current text (e.g. a few lines or a whole function, copied from read_code without the line numbers), new_str = the replacement. To insert code, include an existing neighbouring line in old_str and repeat it in new_str. Whitespace differences are tolerated.',
  parameters: { type: 'object', properties: { old_str: { type: 'string' }, new_str: { type: 'string' } }, required: ['old_str', 'new_str'] },
  summarize: (a) => a.old_str.split('\n')[0]!.slice(0, 50),
  preview(a, ctx) {
    const before = ctx.cart().code;
    const r = locate(before, a.old_str);
    return { type: 'code', before, after: 'index' in r ? before.slice(0, r.index) + stripLineNumbers(a.new_str) + before.slice(r.index + r.length) : before };
  },
  run(a, ctx) {
    const code = ctx.cart().code;
    const r = locate(code, a.old_str);
    if ('error' in r) return fail(r.error);
    const next = code.slice(0, r.index) + stripLineNumbers(a.new_str) + code.slice(r.index + r.length);
    ctx.update(['code'], 'edit_code', (c) => (c.code = next));
    const line = code.slice(0, r.index).split('\n').length;
    return ok({ ok: true, at_line: line, matched: r.loose ? 'ignoring whitespace differences' : 'exact', tokens: codeStats(next).tokens, syntax: syntaxNote(next) ?? 'ok' });
  },
};

function locate(code: string, rawOld: string): { index: number; length: number; loose: boolean } | { error: string } {
  const oldStr = stripLineNumbers(rawOld);
  if (!oldStr.trim()) return { error: 'old_str is empty' };
  const exact = code.split(oldStr).length - 1;
  if (exact === 1) return { index: code.indexOf(oldStr), length: oldStr.length, loose: false };
  if (exact > 1) return { error: `old_str occurs ${exact} times; include more surrounding lines to make it unique` };
  const loose = looseMatches(code, oldStr);
  if (loose.length === 1) return { ...loose[0]!, loose: true };
  if (loose.length > 1) return { error: `old_str matches ${loose.length} places (ignoring whitespace); include more surrounding lines` };
  return { error: `old_str not found.${hints(code, oldStr)} Use read_code on that range and copy the text after the tab.` };
}

/** Names of top-level-ish functions (function foo / function a.b / function a:b / local function foo). */
function functionNames(code: string): Set<string> {
  return new Set([...code.matchAll(/^\s*(?:local\s+)?function\s+([\w.:]+)/gm)].map((m) => m[1]!));
}

export const writeCode: ToolDef<{ code: string; replace_everything?: boolean }> = {
  name: 'write_code', kind: 'edit',
  description: 'Replace ALL the code of the cart with `code` (the complete program). Almost never needed: to change a function use edit_code. Refused if it would delete existing functions or most of the code, unless replace_everything is true because the user explicitly asked for a full rewrite.',
  parameters: { type: 'object', properties: { code: { type: 'string', description: 'the complete new program' }, replace_everything: { type: 'boolean', description: 'true only if the user asked to rewrite/replace the whole cart' } }, required: ['code'] },
  summarize: (a) => `${a.code.split('\n').length} lines`,
  preview: (a, ctx) => ({ type: 'code', before: ctx.cart().code, after: a.code }),
  run(a, ctx) {
    const before = ctx.cart().code;
    if (!a.replace_everything) {
      const lost = [...functionNames(before)].filter((f) => !functionNames(a.code).has(f));
      const shrink = a.code.length < before.length * 0.6;
      if (lost.length || shrink) {
        return fail(
          `refused: this would ${lost.length ? `delete ${lost.length} existing function(s) (${lost.slice(0, 8).join(', ')})` : 'remove most of the code'}. ` +
            'write_code replaces the WHOLE cart. To change one function, use edit_code with the old function text as old_str.',
        );
      }
    }
    ctx.update(['code'], 'write_code', (c) => (c.code = a.code));
    return ok({ ok: true, tokens: codeStats(a.code).tokens, syntax: syntaxNote(a.code) ?? 'ok' });
  },
};

export const cartStats: ToolDef<{ lint?: boolean }> = {
  name: 'cart_stats', kind: 'read',
  description: 'Tokens/chars vs limits, functions with token counts, syntax check and lint.',
  parameters: { type: 'object', properties: { lint: { type: 'boolean', description: 'include lint warnings (default true)' } } },
  run(_a, ctx) {
    const code = ctx.cart().code;
    const s = codeStats(code);
    return ok({ tokens: `${s.tokens}/${s.tokenLimit}`, chars: `${s.chars}/${s.charLimit}`, syntax: syntaxNote(code) ?? 'ok',
      functions: s.functions.map((f) => `${f.name} (line ${f.line}): ${f.tokens}`), lint: _a.lint === false ? undefined : lint(code).slice(0, 40).map((i) => `line ${i.line}: ${i.message}`) });
  },
};
