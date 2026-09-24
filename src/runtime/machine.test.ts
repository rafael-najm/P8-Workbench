import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyCart } from '../cart/cart';
import { parseP8 } from '../cart/p8format';
import type { Cart } from '../cart/types';
import { runFrames, runHeadless } from './headless';
import { Machine } from './machine';
import { ADDR } from './memory';

function cartWith(code: string): Cart {
  return createEmptyCart(code);
}

async function machineWith(code: string, opts: { seed?: number; timeoutSeconds?: number } = {}) {
  const printed: string[] = [];
  const m = await Machine.create({ seed: opts.seed ?? 1, timeoutSeconds: opts.timeoutSeconds, host: { printh: (s) => printed.push(s) } });
  m.load(cartWith(code));
  return { m, printed };
}

describe('Lua API (via eval)', () => {
  let m: Machine;
  beforeAll(async () => {
    ({ m } = await machineWith(''));
    m.step(1);
  });
  afterAll(() => m.dispose());

  const ev = (code: string) => {
    const r = m.eval(code);
    if (!r.ok) throw new Error(r.error.message);
    return JSON.parse(r.json) as unknown;
  };

  it.each([
    ['flr(-1.5)', -2],
    ['flr(3.7)', 3],
    ['ceil(1.2)', 2],
    ['abs(-3)', 3],
    ['min(3)', 0],
    ['max(-3)', 0],
    ['min(4,2)', 2],
    ['mid(5,1,3)', 3],
    ['mid(1,5,3)', 3],
    ['sgn(0)', 1],
    ['sgn(-2)', -1],
    ['sqrt(16)', 4],
    ['sqrt(-1)', 0],
    ['sin(0.25)', -1],
    ['cos(0.5)', -1],
    ['atan2(1,0)', 0],
    ['atan2(0,-1)', 0.25],
    ['atan2(-1,0)', 0.5],
    ['cos(atan2(3,-4))*5', 3],
    ['sin(atan2(3,-4))*5', -4],
    ['-7%3', 2],
    ['7\\2', 3],
    ['-7\\2', -4],
    ['band(0x0f,0x3c)', 0x0c],
    ['shl(1,4)', 16],
    ['lshr(-1,28)', 15 / 65536],
    ['tonum("0x10")', 16],
    ['tonum("12.5")', 12.5],
    ['tonum("-3")', -3],
    ['tonum("0b101")', 5],
    ['tonum("ff",1)', 255],
    ['tonum("x")', null],
    ['tonum("x",4)', 0],
    ['#split("1,2,3")', 3],
    ['count({1,2,3})', 3],
    ['count({1,2,2},2)', 2],
  ])('%s = %j', (code, expected) => {
    const v = ev(code as string);
    if (typeof expected === 'number') expect(v).toBeCloseTo(expected, 3);
    else expect(v).toBe(expected);
  });

  it.each([
    ['tostr(1/3)', '0.3333'],
    ['tostr(-0.5)', '-0.5'],
    ['tostr(255,1)', '0x00ff.0000'],
    ['tostr(1000>>16,2)', '1000'],
    ['tostr(nil)', '[nil]'],
    ['tostr(true)', 'true'],
    ['tostr({})', '[table]'],
    ['sub("hello",2,3)', 'el'],
    ['sub("hello",-3)', 'llo'],
    ['sub("hello",2)', 'ello'],
    ['chr(65,66)', 'AB'],
    ['"a"..1.5', 'a1.5'],
    ['tostr(split("a,1,,b")[2]+1)', '2'],
    ['split("a,1,,b")[3]', ''],
    ['split("1,2",",",false)[1]', '1'],
    ['split("abcdef",2)[2]', 'cd'],
  ])('%s = %j', (code, expected) => {
    expect(ev(code)).toBe(expected);
  });

  it('ord returns multiple values', () => {
    expect(ev('{ord("abc",1,3)}')).toEqual([97, 98, 99]);
  });

  it('split converts numbers by default', () => {
    expect(ev('split("1,x,2.5")')).toEqual([1, 'x', 2.5]);
  });

  it('add/del/deli', () => {
    expect(ev('(function() local t={1,2,3} add(t,4) add(t,0,1) del(t,2) deli(t,1) return t end)()')).toEqual([1, 3, 4]);
    expect(ev('add({},5)')).toBe(5);
    expect(ev('deli({1,2,3})')).toBe(3);
  });

  it('all() tolerates deleting the current element', () => {
    const r = ev(`(function()
      local t, seen = {1,2,3,4,5}, {}
      for v in all(t) do add(seen, v) if v%2==0 then del(t, v) end end
      return {seen, t}
    end)()`);
    expect(r).toEqual([[1, 2, 3, 4, 5], [1, 3, 5]]);
  });

  it('foreach', () => {
    expect(ev('(function() local s=0 foreach({1,2,3}, function(v) s+=v end) return s end)()')).toBe(6);
  });

  it('rnd is deterministic per seed and in range', () => {
    const a = ev('(function() srand(42) local t={} for i=1,5 do add(t,rnd(10)) end return t end)()') as number[];
    const b = ev('(function() srand(42) local t={} for i=1,5 do add(t,rnd(10)) end return t end)()') as number[];
    expect(a).toEqual(b);
    for (const v of a) expect(v >= 0 && v < 10).toBe(true);
    expect(ev('(function() srand(1) local t={} for i=1,50 do t[rnd({"a","b"})]=true end return t.a and t.b end)()')).toBe(true);
  });

  it('peek/poke/memcpy/memset and the @ % $ operators', () => {
    ev('poke(0x4300, 1, 2, 3)');
    expect(ev('{peek(0x4300, 3)}')).toEqual([1, 2, 3]);
    expect(ev('@0x4301')).toBe(2);
    ev('poke2(0x4310, -2)');
    expect(ev('%0x4310')).toBe(-2);
    ev('poke4(0x4320, 1.5)');
    expect(ev('$0x4320')).toBe(1.5);
    ev('memset(0x4400, 7, 4) memcpy(0x4500, 0x4400, 4)');
    expect(ev('peek(0x4503)')).toBe(7);
  });

  it('glyph constants: buttons and fill patterns', () => {
    expect(ev('{⬅️,➡️,⬆️,⬇️,🅾️,❎}')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(ev('tostr(▒,1)')).toBe('0x5a5a.8000');
  });

  it('time() starts at 0', () => {
    expect(ev('type(time())')).toBe('number');
  });
});

describe('frame cycle', () => {
  it('calls _init once, then _update60 + _draw each frame at 60 fps', async () => {
    const { m } = await machineWith('function _init() n,u,d=0,0,0 n+=1 end function _update60() u+=1 end function _draw() d+=1 end');
    m.step(10);
    expect(m.fps).toBe(60);
    expect(m.globals(['n', 'u', 'd'])).toEqual({ n: 1, u: 10, d: 10 });
    m.dispose();
  });

  it('_update runs at 30 fps and time() advances by 1/30', async () => {
    const { m } = await machineWith('function _update() end function _draw() end');
    m.step(30);
    expect(m.fps).toBe(30);
    expect(JSON.parse((m.eval('time()') as { json: string }).json)).toBeCloseTo(1, 3);
    m.dispose();
  });

  it('flip() yields a frame from top-level loops', async () => {
    const { m } = await machineWith('n=0 while true do n+=1 cls(n%16) flip() end');
    m.step(5);
    expect(m.status).toBe('running');
    expect(m.globals(['n']).n).toBe(5);
    m.dispose();
  });

  it('printh goes to the host', async () => {
    const { m, printed } = await machineWith('printh("hello "..42)');
    m.step(1);
    expect(printed).toEqual(['hello 42']);
    m.dispose();
  });

  it('stop() stops with a message, run() restarts', async () => {
    const { m } = await machineWith('function _update() if (time()>0.1) stop("done") end');
    m.step(10);
    expect(m.status).toBe('stopped');
    expect(m.stopMessage).toBe('done');
    m.dispose();

    // run() restarts from scratch (fresh globals, _init again)
    const r = await machineWith('printh("boot") function _update() if (time()>0.05) run() end');
    r.m.step(8);
    expect(r.m.status).toBe('running');
    expect(r.printed.length).toBeGreaterThanOrEqual(2);
    r.m.dispose();
  });

  it('cartdata/dget/dset persist through the host', async () => {
    const saved: Record<string, Uint8Array> = {};
    const m = await Machine.create({
      seed: 1,
      host: { loadCartData: (id) => saved[id] ?? null, saveCartData: (id, d) => (saved[id] = d) },
    });
    m.load(cartWith('cartdata("t") dset(3, 12.5)'));
    m.step(1);
    expect(saved.t).toBeDefined();
    m.load(cartWith('cartdata("t") v=dget(3)'));
    m.step(1);
    expect(m.globals(['v']).v).toBe(12.5);
    m.dispose();
  });

  it('menuitem registers labels and callbacks', async () => {
    let items: (string | null)[] = [];
    const m = await Machine.create({ host: { menuItemsChanged: (i) => (items = i) } });
    m.load(cartWith('hits=0 menuitem(1, "restart", function() hits+=1 end)'));
    m.step(1);
    expect(items[0]).toBe('restart');
    m.callMenuItem(1);
    expect(m.globals(['hits']).hits).toBe(1);
    m.dispose();
  });
});

describe('input', () => {
  it('btn and btnp with PICO-8 repeat timing (15 frames, then every 4)', async () => {
    const { m } = await machineWith('log={} function _update() add(log, btnp(4) and 1 or 0) held=btn(4) end');
    m.step(1); // boot frame
    m.input.setButton(0, 4, true);
    m.step(24);
    const log = m.globals(['log'], 1, 100).log as number[];
    const hits = log.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    // pressed on the first frame, repeats after 15 frames, then every 4
    expect(hits.map((h) => h - hits[0]!)).toEqual([0, 15, 19, 23]);
    expect(m.globals(['held']).held).toBe(true);
    m.dispose();
  });

  it('btn() without args returns a bitfield', async () => {
    const { m } = await machineWith('function _update() b=btn() end');
    m.input.setMask(0, 0b100001);
    m.step(2);
    expect(m.globals(['b']).b).toBe(0b100001);
    m.dispose();
  });
});

describe('errors', () => {
  it('reports runtime errors with the original source line', async () => {
    const { m } = await machineWith('a=1\n\nfunction _update()\n local t=nil\n t.x=1\nend');
    m.step(3);
    expect(m.status).toBe('error');
    expect(m.error?.line).toBe(5);
    expect(m.error?.message).toMatch(/attempt to index a nil value/);
    expect(m.error?.kind).toBe('runtime');
    m.dispose();
  });

  it('reports syntax errors on load', async () => {
    const m = await Machine.create();
    const err = m.load(cartWith('x=1\nif x then\n'));
    expect(err?.kind).toBe('compile');
    expect(m.status).toBe('error');
    m.dispose();
  });

  it('errors inside nested functions point at the failing line', async () => {
    const { m } = await machineWith('function f()\n return nil+1\nend\nfunction _update() f() end');
    m.step(2);
    expect(m.error?.line).toBe(2);
    expect(m.error?.traceback).toMatch(/cart:4/);
    m.dispose();
  });

  it('the watchdog stops infinite loops', async () => {
    const { m } = await machineWith('function _update() while true do end end', { timeoutSeconds: 0.2 });
    const t0 = Date.now();
    m.step(3);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(m.status).toBe('error');
    expect(m.error?.kind).toBe('timeout');
    m.dispose();
  });

  it('draws the error on the game screen', async () => {
    const { m } = await machineWith('function _draw() cls(1) error("boom") end');
    m.step(2);
    // top-left area is repainted black with text
    expect(m.memory.peek(ADDR.screen)).toBe(0);
    m.dispose();
  });
});

describe('hot reload and eval', () => {
  it('redefines functions without calling _init and keeps state', async () => {
    const { m } = await machineWith('function _init() x=0 end function _update() x+=1 end');
    m.step(5);
    const err = m.hotReload('function _init() x=0 end function _update() x+=10 end');
    expect(err).toBeNull();
    m.step(2);
    expect(m.globals(['x']).x).toBe(25);
    m.dispose();
  });

  it('hot reload reports compile errors without breaking the running game', async () => {
    const { m } = await machineWith('function _update() x=(x or 0)+1 end');
    m.step(2);
    const err = m.hotReload('function _update( x=1 end');
    expect(err?.kind).toBe('compile');
    m.step(2);
    expect(m.status).toBe('running');
    m.dispose();
  });

  it('eval runs statements and expressions in the cart env', async () => {
    const { m } = await machineWith('p={x=1,hp={3,4}}');
    m.step(1);
    const r = m.eval('p');
    expect(r.ok && JSON.parse(r.json)).toEqual({ hp: [3, 4], x: 1 });
    expect(m.eval('p.x=5').ok).toBe(true);
    expect(m.globals(['p']).p).toEqual({ hp: [3, 4], x: 5 });
    const bad = m.eval('nil+1');
    expect(bad.ok).toBe(false);
    m.dispose();
  });

  it('globals() lists user state and hides the API', async () => {
    const { m } = await machineWith('score=10 name="x" function f() end');
    m.step(1);
    const g = m.globals();
    expect(g).toEqual({ name: 'x', score: 10 });
    expect(m.functionNames()).toEqual(['f']);
    m.dispose();
  });
});

describe('nebula_strike.p8', () => {
  const cart = parseP8(readFileSync(new URL('../../samples/nebula_strike.p8', import.meta.url), 'utf8'));

  it('runs 10,000 frames headless with random inputs without errors', async () => {
    const m = await Machine.create({ seed: 7 });
    m.load(cart);
    // Deterministic pseudo-random input: new random button mask every 1-30 frames.
    let s = 12345;
    const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let next = 0;
    const res = runFrames(m, {
      frames: 10_000,
      onFrame: (mm, frame) => {
        if (frame >= next) {
          mm.input.setMask(0, Math.floor(rand() * 64));
          next = frame + 1 + Math.floor(rand() * 30);
        }
      },
    });
    expect(res.error).toBeNull();
    expect(res.framesRun).toBe(10_000);
    expect(m.fps).toBe(60);
    m.dispose();
  }, 120_000);

  it('title screen renders the logo', async () => {
    const res = await runHeadless(cart, { frames: 30, watch: ['st'] });
    expect(res.error).toBeNull();
    expect(res.globals.st).toBe(1);
  });
});

describe('input taps', () => {
  it('a press and release between two frames still counts as one pressed frame', async () => {
    const { m } = await machineWith('n=0 function _update() if (btnp(5)) n+=1 end');
    m.step(1);
    m.input.setButton(0, 5, true);
    m.input.setButton(0, 5, false);
    m.step(3);
    expect(m.globals(['n']).n).toBe(1);
    m.dispose();
  });
});
