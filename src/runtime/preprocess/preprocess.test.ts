import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LuaEngine } from 'wasmoon';
import { parseP8 } from '../../cart/p8format';
import { createLuaEngine } from '../lua/engine';
import { PRELUDE_LUA } from '../lua/prelude';
import { FIXTURES } from './fixtures';
import { mapLine, preprocess } from './index';

function body(code: string): string {
  const r = preprocess(code);
  if (!r.ok) throw new Error(`line ${r.error.line}: ${r.error.message}`);
  return r.lua.slice(r.lua.indexOf(';') + 1);
}

describe('preprocess fixtures', () => {
  it.each(FIXTURES)('%s', (_name, input, expected) => {
    expect(body(input)).toBe(expected);
  });

  it('keeps every statement on its source line', () => {
    const src = 'a=1\n\n--[[x\ny]]\nb+=2\nif (c) d=3\n\nfunction f()\n return 1\nend';
    const r = preprocess(src);
    if (!r.ok) throw new Error(r.error.message);
    const lines = r.lua.split('\n');
    expect(lines.length).toBe(src.split('\n').length);
    expect(lines[4]).toContain('b=(b+');
    expect(lines[5]).toContain('if(c)then d=3.0;end;');
    expect(lines[8]).toContain('return 1.0');
    r.lineMap.forEach((src, i) => expect(src).toBe(i + 1));
    expect(mapLine(r.lineMap, 9)).toBe(9);
  });
});

describe('preprocess errors', () => {
  it.each([
    ['x+=', 1],
    ['a=1\nif x then\nb=2', 3],
    ['a=1\nb=)', 2],
    ['s="\\q"', 1],
    ['f(', 1],
    ['1=2', 1],
    ['a b', 1],
  ])('%j reports line %i', (src, line) => {
    const r = preprocess(src as string);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.line).toBe(line);
  });

  it('messages mention what was expected', () => {
    const r = preprocess('if x then\ny=1');
    expect(!r.ok && r.error.message).toMatch(/'end' expected.*line 1/);
  });
});

describe('preprocessed code in Lua 5.4', () => {
  let lua: LuaEngine;
  beforeAll(async () => {
    lua = (await createLuaEngine()).engine;
    lua.doStringSync(PRELUDE_LUA);
    // peek stubs for the operator tests
    lua.doStringSync('local m={[1]=0x34,[2]=0x12} function __p8_peek(a) return m[a] or 0 end function __p8_peek2(a) return __p8_peek(a)+__p8_peek(a+1)*256 end function __p8_peek4(a) return 0 end');
  });

  /** Runs PICO-8 code and returns the value of the global `r` (as a string via tostr). */
  function run(src: string): string {
    const r = preprocess(src);
    if (!r.ok) throw new Error(r.error.message);
    lua.global.set('__src', r.lua);
    return lua.doStringSync('r=nil local f=assert(load(__src,"=cart")) f() return tostr(r)') as string;
  }

  it.each([
    ['r=0 t={x={0,0}} i=2 t.x[i]+=5 r=t.x[2]', '5'],
    ['b={x=1,y=2,dx=3,dy=4} b.x+=b.dx b.y+=b.dy r=b.x..","..b.y', '4,6'],
    ['r=7\\2', '3'],
    ['r=-7\\2', '-4'],
    ['r=-7%3', '2'],
    ['r=1/3', '0.3333'],
    ['r=2/3', '0.6667'],
    ['r=.1', '0.1'],
    ['r=-1.5', '-1.5'],
    ['r=0xffff', '-1'],
    ['r=32767+1', '-32768'], // 16.16 overflow when printed
    ['r=5&3', '1'],
    ['r=5|3', '7'],
    ['r=5^^3', '6'],
    ['r=tostr(~0,1)', '0xffff.ffff'],
    ['r=1<<4', '16'],
    ['r=-16>>2', '-4'],
    ['r=tostr(-1>>>16,1)', '0x0000.ffff'],
    ['r=-1>>>16', '1'], // 0x0.ffff rounds to 1 when printed
    ['r=0x8000<<>1', '0'],
    ['r=tostr(0x8000<<>1,1)', '0x0000.0001'],
    ['r=1>><1', '0.5'],
    ['r=0x5a5a.8', '23130.5'],
    ['r=0b1010.1', '10.5'],
    ['r=@1+%1', '4712'], // 0x34 + 0x1234
    ['x=1 if (x==1) r="a" else r="b"', 'a'],
    ['x=2 if (x==1) r="a" else r="b"', 'b'],
    ['i=0 while (i<5) i+=1\nr=i', '5'],
    ['r=0 if (false) r=1 r=2\nr=r', '0'],
    ['r="n:"..1.5', 'n:1.5'],
    ['r=1 ..2', '12'],
    ['s="a" s..="b" s..=3 r=s', 'ab3'],
    ['r=#"hello"..""', '5'],
    ['function f(...) return select("#",...) end r=f(1,nil,3)', '3'],
    ['r=0 for i=10,1,-3 do r+=i end', '22'],
    ['score=0 score+=1000>>16 r=tostr(score,2)', '1000'],
    ['r=tostr(-1,1)', '0xffff.0000'],
    ['r=("x"):rep(3)', 'xxx'],
    ['r=({1,2,3})[2]', '2'],
    ['r=1 != 2', 'true'],
  ])('%s -> %s', (src, expected) => {
    expect(run(src)).toBe(expected);
  });

  it('compiles nebula_strike.p8 without errors', () => {
    const cart = parseP8(readFileSync(new URL('../../../samples/nebula_strike.p8', import.meta.url), 'utf8'));
    const r = preprocess(cart.code);
    if (!r.ok) throw new Error(`line ${r.error.line}: ${r.error.message}`);
    lua.global.set('__src', r.lua);
    const err = lua.doStringSync('local f, err = load(__src, "=cart") return err or "ok"');
    expect(err).toBe('ok');
    expect(r.lua.split('\n').length).toBe(cart.code.split('\n').length);
  });
});
