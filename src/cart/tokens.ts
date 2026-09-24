/**
 * PICO-8 token / character counting.
 *
 * Rules (matching PICO-8 and shrinko8):
 * - 1 token: identifiers, keywords, number and string literals, operators,
 *   and *opening* brackets `( [ {`.
 * - 0 tokens: `, . : ; ::`, closing brackets `) ] }`, `local`, `end`, comments.
 * - A unary `-` or `~` glued to a number literal counts together with it
 *   (e.g. `x=-1` is 3 tokens, but `a-1` is 3 and `a - -1` is 3).
 */
import { lex, type Token } from './lexer';
import { toP8String } from './p8scii';

export const TOKEN_LIMIT = 8192;
export const CHAR_LIMIT = 65535;

const FREE_VALUES: ReadonlySet<string> = new Set([',', '.', ':', ';', '::', ')', ']', '}', 'end', 'local']);
const NO_UNARY_BEFORE: ReadonlySet<string> = new Set([')', ']', '}', ';', 'end']);

/** Whether `tokens[i]` costs a token. */
export function tokenCost(tokens: readonly Token[], i: number): 0 | 1 {
  const tok = tokens[i]!;
  if (tok.type === 'error') return 0;
  if ((tok.type === 'punct' || tok.type === 'keyword') && FREE_VALUES.has(tok.value)) return 0;
  if (tok.type === 'punct' && (tok.value === '-' || tok.value === '~')) {
    const next = tokens[i + 1];
    const prev = tokens[i - 1];
    if (
      next &&
      next.type === 'number' &&
      tok.end === next.start &&
      prev &&
      prev.type !== 'number' &&
      prev.type !== 'string' &&
      prev.type !== 'ident' &&
      !NO_UNARY_BEFORE.has(prev.value)
    ) {
      return 0;
    }
  }
  return 1;
}

export function countTokensInTokens(tokens: readonly Token[]): number {
  let n = 0;
  for (let i = 0; i < tokens.length; i++) n += tokenCost(tokens, i);
  return n;
}

/** Count tokens of PICO-8 source given as unicode text (as stored in `.p8`). */
export function countTokens(code: string): number {
  return countTokensInTokens(lex(toP8String(code)).tokens);
}

/** Character count in P8SCII (each glyph counts as 1). */
export function countChars(code: string): number {
  return toP8String(code).length;
}

export interface FunctionTokenInfo {
  /** Name as written (`foo`, `obj.method`, `obj:method`, or `<anonymous>`). */
  name: string;
  /** 1-based line of the `function` keyword. */
  line: number;
  endLine: number;
  tokens: number;
}

export interface CodeStats {
  tokens: number;
  chars: number;
  tokenLimit: number;
  charLimit: number;
  functions: FunctionTokenInfo[];
}

/**
 * Token cost of every *named* function (including nested ones), by matching
 * block keywords. Anonymous functions are folded into their parent.
 */
export function functionTokenCounts(code: string): FunctionTokenInfo[] {
  const { tokens } = lex(toP8String(code));
  const result: FunctionTokenInfo[] = [];
  // Stack of open blocks; function blocks remember where they began.
  const stack: { fn?: { name: string; line: number; startIdx: number } }[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.type !== 'keyword') continue;
    switch (t.value) {
      case 'function': {
        let name = '';
        let j = i + 1;
        while (j < tokens.length) {
          const n = tokens[j]!;
          if (n.type === 'ident' || (n.type === 'punct' && (n.value === '.' || n.value === ':'))) {
            name += n.value;
            j++;
          } else break;
        }
        // `local function f` / `f = function`
        if (!name) {
          const prev = tokens[i - 1];
          const prev2 = tokens[i - 2];
          if (prev?.value === '=' && prev2?.type === 'ident') name = prev2.value;
        }
        stack.push({ fn: name ? { name, line: t.line, startIdx: i } : undefined });
        break;
      }
      case 'do':
      case 'then':
      case 'repeat':
        // `while/for ... do` and `if ... then` open one block; `elseif ... then` doesn't.
        if (t.value === 'then') {
          if (!isIfThen(tokens, i)) break;
        }
        stack.push({});
        break;
      case 'until':
      case 'end': {
        const block = stack.pop();
        if (block?.fn) {
          let cost = 0;
          for (let k = block.fn.startIdx; k <= i; k++) cost += tokenCost(tokens, k);
          result.push({ name: block.fn.name, line: block.fn.line, endLine: t.line, tokens: cost });
        }
        break;
      }
    }
  }
  return result.sort((a, b) => a.line - b.line);
}

/** True if the `then` at index i belongs to an `if` (not an `elseif`). */
function isIfThen(tokens: readonly Token[], i: number): boolean {
  let depth = 0;
  for (let k = i - 1; k >= 0; k--) {
    const t = tokens[k]!;
    if (t.type === 'punct') {
      if (t.value === ')' || t.value === ']' || t.value === '}') depth++;
      else if (t.value === '(' || t.value === '[' || t.value === '{') depth--;
    }
    if (depth > 0) continue;
    if (t.type === 'keyword' && (t.value === 'if' || t.value === 'elseif')) return t.value === 'if';
  }
  return true;
}

export function codeStats(code: string): CodeStats {
  return {
    tokens: countTokens(code),
    chars: countChars(code),
    tokenLimit: TOKEN_LIMIT,
    charLimit: CHAR_LIMIT,
    functions: functionTokenCounts(code),
  };
}
