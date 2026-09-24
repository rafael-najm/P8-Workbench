import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lint } from './lint';
import { parseP8 } from './p8format';

describe('lint', () => {
  it('flags globals that are read but never assigned', () => {
    const issues = lint('function _update()\n x=plyer.x\nend\nplayer={}');
    expect(issues).toEqual([{ line: 2, kind: 'undefined-global', name: 'plyer', message: expect.stringContaining('plyer') }]);
  });

  it('knows the API, globals assigned anywhere and function names', () => {
    expect(lint('function a() b() end function b() spr(1,x,0) end x=1')).toEqual([]);
  });

  it('flags unused locals but not params, loop vars or _', () => {
    const issues = lint('function f(a)\n local used, unused = 1, 2\n for i=1,3 do end\n local _ = 3\n return used\nend');
    expect(issues.map((i) => [i.kind, i.name, i.line])).toEqual([['unused-local', 'unused', 2]]);
  });

  it('handles scopes, compound assignment, methods and repeat-until', () => {
    const code = 'local n=0\nn+=1\nobj={}\nfunction obj:m() return self end\nrepeat local k=1 until k>0';
    expect(lint(code)).toEqual([]);
  });

  it('reports syntax errors', () => {
    expect(lint('if x then')[0]?.kind).toBe('syntax');
  });

  it('nebula_strike has no undefined globals', () => {
    const cart = parseP8(readFileSync(new URL('../../samples/nebula_strike.p8', import.meta.url), 'utf8'));
    const issues = lint(cart.code).filter((i) => i.kind === 'undefined-global');
    expect(issues).toEqual([]);
  });
});
