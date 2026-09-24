import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseP8 } from './p8format';
import { CHAR_LIMIT, TOKEN_LIMIT, codeStats, countChars, countTokens, functionTokenCounts } from './tokens';

const NEBULA = readFileSync(new URL('../../samples/nebula_strike.p8', import.meta.url), 'utf8');

describe('countTokens: nebula_strike.p8', () => {
  const cart = parseP8(NEBULA);

  it('matches PICO-8/shrinko8: 5653 tokens', () => {
    expect(countTokens(cart.code)).toBe(5653);
  });

  it('matches PICO-8/shrinko8: 18482 chars (glyphs count as 1)', () => {
    expect(countChars(cart.code)).toBe(18482);
  });

  it('stays within limits and lists functions', () => {
    const stats = codeStats(cart.code);
    expect(stats.tokens).toBeLessThan(TOKEN_LIMIT);
    expect(stats.chars).toBeLessThan(CHAR_LIMIT);
    expect(stats.functions.length).toBeGreaterThan(10);
    expect(stats.functions.find((f) => f.name === '_init')).toBeDefined();
  });
});

// Expected counts generated with shrinko8 (`count_tokens`), an independent
// implementation of PICO-8's rules.
const CASES: [string, number][] = [
  ["x=1", 3],
  ["x=-1", 3],
  ["x = - 1", 4],
  ["a-1", 3],
  ["a - -1", 3],
  ["f(-1)", 3],
  ["t[-1]", 3],
  ["return -1", 2],
  ["y=~5", 3],
  ["local a,b=1,2", 5],
  ["print(\"hi\")", 3],
  ["t={1,2,3}", 6],
  ["obj.x=obj.y", 5],
  ["obj:m(1)", 4],
  ["if a!=b then c+=1 end", 8],
  ["x\\=2", 3],
  ["for i=1,10 do end", 6],
  ["-- comment\nx=1 // another\n--[[ long\ncomment ]] y=2", 6],
  ["s=[[long\nstring]]", 3],
  ["a=b>>>1 c=d<<>2 e=f>><3 g=h^^i", 20],
  ["?\"hi\"", 2],
  ["x=@0x5f00+%1+$2", 10],
  ["::lbl:: goto lbl", 3],
  ["a=0b1010+0x5a5a.8+.5", 7],
  ["print(\"❎ ok\")", 3],
  ["x=(1)-1", 6],
  ["x=a[1]-1", 7],
  ["x=\"s\"-1", 5],
  ["function f(...) return ... end", 6],
  ["a..=\"b\"", 3],
];

describe('countTokens: rules', () => {
  it.each(CASES)('%j -> %i', (code, expected) => {
    expect(countTokens(code)).toBe(expected);
  });

  it('comments cost nothing', () => {
    expect(countTokens('-- hello\n--[[ multi\nline ]]\n// c style')).toBe(0);
  });

  it('closing brackets, commas, dots, colons, local and end are free', () => {
    expect(countTokens(') ] } , . : ; local end')).toBe(0);
  });

  it('opening brackets cost one token each', () => {
    expect(countTokens('( [ {')).toBe(3);
  });

  it('unary minus glued to a number merges; separated does not', () => {
    expect(countTokens('x=-1')).toBe(3);
    expect(countTokens('x=- 1')).toBe(4);
    expect(countTokens('x=-y')).toBe(4);
  });

  it('binary minus after identifier/number/closing bracket is its own token', () => {
    expect(countTokens('a-1')).toBe(3);
    expect(countTokens('2-1')).toBe(3);
    expect(countTokens('f()-1')).toBe(4); // f ( - 1
  });

  it('glyphs inside strings are one char each', () => {
    expect(countChars('"⬅️➡️⬆️⬇️🅾️❎"')).toBe(8);
  });
});

describe('functionTokenCounts', () => {
  it('attributes tokens to named functions', () => {
    const code = [
      'function a()',
      ' if x then y=1 elseif z then y=2 else y=3 end',
      ' for i=1,3 do end',
      'end',
      'local function b() return 1 end',
      'c=function() while true do end end',
      'function o:m() end',
    ].join('\n');
    const fns = functionTokenCounts(code);
    expect(fns.map((f) => f.name)).toEqual(['a', 'b', 'c', 'o:m']);
    expect(fns[0]).toMatchObject({ line: 1, endLine: 4 });
    expect(fns[1]!.tokens).toBe(countTokens('function b() return 1 end'));
    expect(fns[3]!.tokens).toBe(countTokens('function o:m() end'));
  });
});
