/**
 * Registers the JS-implemented PICO-8 API (graphics, memory, input, audio,
 * system) as raw Lua functions.
 */
import type { AudioBackend } from '../audio/backend';
import { LUA_TNONE, LUA_TNIL, type LuaBridge } from '../lua/bridge';
import { ADDR, type Memory } from '../memory';
import type { Gfx } from './gfx';
import type { Input } from './input';
import type { Text } from './text';

export interface SystemHooks {
  printh(text: string): void;
  cartdata(id: string): boolean;
  dsetChanged(): void;
  menuitem(index: number, label: string | null): void;
  stat(n: number): number | string | boolean | undefined;
  reset(): void;
  extcmd(cmd: string): void;
}

export interface ApiDeps {
  bridge: LuaBridge;
  mem: Memory;
  gfx: Gfx;
  text: Text;
  input: Input;
  audio: AudioBackend;
  sys: SystemHooks;
}

/** Names of the functions registered here (exposed to carts). */
export const JS_API_NAMES = [
  'cls', 'pset', 'pget', 'line', 'rect', 'rectfill', 'circ', 'circfill', 'oval', 'ovalfill', 'spr', 'sspr',
  'map', 'mapdraw', 'tline', 'cursor', 'color', 'camera', 'clip', 'palt', 'fillp', 'fget', 'fset', 'sget',
  'sset', 'mget', 'mset', 'peek', 'poke', 'peek2', 'poke2', 'peek4', 'poke4', 'memcpy', 'memset', 'reload',
  'cstore', 'btn', 'btnp', 'sfx', 'music', 'cartdata', 'dget', 'dset', 'extcmd',
] as const;

export function bindApi({ bridge: b, mem, gfx, text, input, audio, sys }: ApiDeps): void {
  const n = (L: number, i: number) => b.num(L, i);
  const f = (L: number, i: number, def: number) => b.num(L, i) ?? def;
  const reg = (name: string, fn: (L: number) => number) => b.register(name, fn);
  const none = (L: number, i: number) => {
    const t = b.type(L, i);
    return t === LUA_TNONE || t === LUA_TNIL;
  };

  // --- graphics ---
  reg('cls', (L) => (gfx.cls(n(L, 1)), 0));
  reg('pset', (L) => (gfx.pset(f(L, 1, 0), f(L, 2, 0), n(L, 3)), 0));
  reg('pget', (L) => (b.pushNum(L, gfx.pget(f(L, 1, 0), f(L, 2, 0))), 1));
  reg('line', (L) => (gfx.line(n(L, 1), n(L, 2), n(L, 3), n(L, 4), n(L, 5)), 0));
  reg('rect', (L) => (gfx.rect(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), f(L, 4, 0), n(L, 5)), 0));
  reg('rectfill', (L) => (gfx.rectfill(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), f(L, 4, 0), n(L, 5)), 0));
  reg('circ', (L) => (gfx.circ(f(L, 1, 0), f(L, 2, 0), n(L, 3), n(L, 4)), 0));
  reg('circfill', (L) => (gfx.circfill(f(L, 1, 0), f(L, 2, 0), n(L, 3), n(L, 4)), 0));
  reg('oval', (L) => (gfx.oval(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), f(L, 4, 0), n(L, 5)), 0));
  reg('ovalfill', (L) => (gfx.ovalfill(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), f(L, 4, 0), n(L, 5)), 0));
  reg('spr', (L) => (gfx.spr(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), n(L, 4), n(L, 5), b.bool(L, 6), b.bool(L, 7)), 0));
  reg('sspr', (L) => {
    gfx.sspr(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), f(L, 4, 0), f(L, 5, 0), f(L, 6, 0), n(L, 7), n(L, 8), b.bool(L, 9), b.bool(L, 10));
    return 0;
  });
  const map = (L: number) => (gfx.map(n(L, 1), n(L, 2), n(L, 3), n(L, 4), n(L, 5), n(L, 6), n(L, 7)), 0);
  reg('map', map);
  reg('mapdraw', map);
  reg('tline', (L) => {
    gfx.tline(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0), f(L, 4, 0), f(L, 5, 0), f(L, 6, 0), n(L, 7), n(L, 8), n(L, 9));
    return 0;
  });
  reg('cursor', (L) => {
    const [x, y] = gfx.cursor(n(L, 1), n(L, 2), n(L, 3));
    b.pushNum(L, x);
    b.pushNum(L, y);
    return 2;
  });
  reg('color', (L) => (b.pushNum(L, gfx.color(n(L, 1))), 1));
  reg('camera', (L) => {
    const [x, y] = gfx.cameraCall(n(L, 1), n(L, 2));
    b.pushNum(L, x);
    b.pushNum(L, y);
    return 2;
  });
  reg('clip', (L) => {
    const prev = gfx.clip(n(L, 1), n(L, 2), n(L, 3), n(L, 4), b.bool(L, 5));
    for (const v of prev) b.pushNum(L, v);
    return 4;
  });
  reg('__p8_pal', (L) => (gfx.pal(n(L, 1), n(L, 2), n(L, 3)), 0));
  reg('palt', (L) => (gfx.palt(n(L, 1), b.optBool(L, 2)), 0));
  reg('fillp', (L) => (b.pushNum(L, gfx.fillp(n(L, 1))), 1));
  reg('__p8_print', (L) => {
    const s = b.str(L, 1) ?? '';
    const argc = b.argc(L);
    let r;
    // print(str, col) form
    if (argc === 2 && !none(L, 2)) r = text.print(s, undefined, undefined, n(L, 2));
    else r = text.print(s, n(L, 2), n(L, 3), n(L, 4));
    b.pushNum(L, r.x);
    b.pushNum(L, r.y);
    return 2;
  });
  reg('fget', (L) => {
    const v = gfx.fget(f(L, 1, 0), n(L, 2));
    if (typeof v === 'boolean') b.pushBool(L, v);
    else b.pushNum(L, v);
    return 1;
  });
  reg('fset', (L) => {
    if (b.argc(L) >= 3) gfx.fset(f(L, 1, 0), f(L, 2, 0), b.bool(L, 3));
    else gfx.fset(f(L, 1, 0), f(L, 2, 0));
    return 0;
  });
  reg('sget', (L) => (b.pushNum(L, gfx.sget(f(L, 1, 0), f(L, 2, 0))), 1));
  reg('sset', (L) => (gfx.sset(f(L, 1, 0), f(L, 2, 0), n(L, 3)), 0));
  reg('mget', (L) => (b.pushNum(L, gfx.mget(f(L, 1, 0), f(L, 2, 0))), 1));
  reg('mset', (L) => (gfx.mset(f(L, 1, 0), f(L, 2, 0), n(L, 3)), 0));
  reg('__p8_reset', () => (sys.reset(), 0));

  // --- memory ---
  const addr = (L: number, i: number) => Math.floor(f(L, i, 0)) & 0xffff;
  const peek = (L: number) => {
    const a = addr(L, 1);
    const count = Math.max(1, Math.min(8192, Math.floor(f(L, 2, 1))));
    for (let k = 0; k < count; k++) b.pushNum(L, mem.peek(a + k));
    return count;
  };
  reg('peek', peek);
  reg('__p8_peek', peek);
  reg('poke', (L) => {
    const a = addr(L, 1);
    const argc = b.argc(L);
    for (let k = 2; k <= argc; k++) mem.poke(a + k - 2, Math.floor(f(L, k, 0)) & 0xff);
    return 0;
  });
  const peek2 = (L: number) => (b.pushNum(L, mem.peek2(addr(L, 1))), 1);
  reg('peek2', peek2);
  reg('__p8_peek2', peek2);
  reg('poke2', (L) => {
    const a = addr(L, 1);
    const argc = b.argc(L);
    for (let k = 2; k <= argc; k++) mem.poke2(a + (k - 2) * 2, Math.floor(f(L, k, 0)));
    return 0;
  });
  const peek4 = (L: number) => (b.pushNum(L, mem.peek4(addr(L, 1))), 1);
  reg('peek4', peek4);
  reg('__p8_peek4', peek4);
  reg('poke4', (L) => {
    const a = addr(L, 1);
    const argc = b.argc(L);
    for (let k = 2; k <= argc; k++) mem.poke4(a + (k - 2) * 4, f(L, k, 0));
    return 0;
  });
  reg('memcpy', (L) => (mem.memcpy(addr(L, 1), addr(L, 2), Math.floor(f(L, 3, 0))), 0));
  reg('memset', (L) => (mem.memset(addr(L, 1), Math.floor(f(L, 2, 0)) & 0xff, Math.floor(f(L, 3, 0))), 0));
  reg('reload', (L) => (mem.reload(Math.floor(f(L, 1, 0)), Math.floor(f(L, 2, 0)), Math.floor(f(L, 3, ADDR.cartEnd))), 0));
  reg('cstore', (L) => (mem.cstore(Math.floor(f(L, 1, 0)), Math.floor(f(L, 2, 0)), Math.floor(f(L, 3, ADDR.cartEnd))), 0));

  // --- input ---
  const pushBtn = (L: number, v: boolean | number) => {
    if (typeof v === 'boolean') b.pushBool(L, v);
    else b.pushNum(L, v);
    return 1;
  };
  reg('btn', (L) => pushBtn(L, input.btn(n(L, 1), n(L, 2))));
  reg('btnp', (L) => pushBtn(L, input.btnp(n(L, 1), n(L, 2))));

  // --- audio ---
  reg('sfx', (L) => (audio.sfx(f(L, 1, -1), f(L, 2, -1), f(L, 3, 0), f(L, 4, 0)), 0));
  reg('music', (L) => (audio.music(f(L, 1, 0), f(L, 2, 0), f(L, 3, 0)), 0));

  // --- system ---
  reg('__p8_printh', (L) => (sys.printh(b.str(L, 1) ?? ''), 0));
  reg('__p8_stat_raw', (L) => {
    b.push(L, sys.stat(Math.floor(f(L, 1, 0))));
    return 1;
  });
  reg('cartdata', (L) => (b.pushBool(L, sys.cartdata(b.str(L, 1) ?? '')), 1));
  reg('dget', (L) => {
    const i = Math.floor(f(L, 1, 0));
    b.pushNum(L, i >= 0 && i < 64 ? mem.peek4(ADDR.persistent + i * 4) : 0);
    return 1;
  });
  reg('dset', (L) => {
    const i = Math.floor(f(L, 1, 0));
    if (i >= 0 && i < 64) {
      mem.poke4(ADDR.persistent + i * 4, f(L, 2, 0));
      sys.dsetChanged();
    }
    return 0;
  });
  reg('__p8_menuitem', (L) => (sys.menuitem(Math.floor(f(L, 1, 0)), b.str(L, 2) ?? null), 0));
  reg('extcmd', (L) => (sys.extcmd(b.str(L, 1) ?? ''), 0));
}
