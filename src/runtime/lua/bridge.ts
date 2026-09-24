/**
 * Low-level Lua <-> JS bridge on top of wasmoon's raw C API.
 *
 * API functions are registered as raw C closures: arguments are read
 * straight from the Lua stack and strings are read as bytes (P8SCII), which
 * is ~12x faster than wasmoon's generic function wrapping.
 */
import type { LuaEngine, LuaWasm } from 'wasmoon';

export const LUA_TNONE = -1;
export const LUA_TNIL = 0;
export const LUA_TBOOLEAN = 1;
export const LUA_TNUMBER = 3;
export const LUA_TSTRING = 4;
export const LUA_TTABLE = 5;
export const LUA_TFUNCTION = 6;

/** The subset of the Emscripten module exports we use. */
interface RawModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _lua_type(L: number, i: number): number;
  _lua_gettop(L: number): number;
  _lua_settop(L: number, i: number): void;
  _lua_tonumberx(L: number, i: number, isnum: number): number;
  _lua_toboolean(L: number, i: number): number;
  _lua_tolstring(L: number, i: number, len: number): number;
  _lua_pushnumber(L: number, n: number): void;
  _lua_pushboolean(L: number, b: number): void;
  _lua_pushnil(L: number): void;
  _lua_pushlstring(L: number, ptr: number, len: number): number;
  _lua_pushcclosure(L: number, fn: number, n: number): void;
  _lua_setglobal(L: number, name: number): void;
  _lua_getglobal(L: number, name: number): number;
  _lua_pcallk(L: number, nargs: number, nresults: number, errfunc: number, ctx: number, k: number): number;
  _lua_error(L: number): number;
  addFunction(fn: (L: number) => number, sig: string): number;
  removeFunction(ptr: number): void;
}

export type RawFunction = (L: number) => number;

export class LuaBridge {
  readonly M: RawModule;
  readonly L: number;
  private scratch: number;
  private strBuf = 0;
  private strCap = 0;
  private names = new Map<string, number>();
  private functions: number[] = [];

  constructor(
    readonly wasm: LuaWasm,
    readonly engine: LuaEngine,
  ) {
    this.M = wasm.module as unknown as RawModule;
    this.L = engine.global.address;
    this.scratch = this.M._malloc(8);
  }

  /** A NUL-terminated C string kept alive for the bridge's lifetime (for global names). */
  private cname(name: string): number {
    let p = this.names.get(name);
    if (p === undefined) {
      const bytes = new TextEncoder().encode(name);
      p = this.M._malloc(bytes.length + 1);
      this.M.HEAPU8.set(bytes, p);
      this.M.HEAPU8[p + bytes.length] = 0;
      this.names.set(name, p);
    }
    return p;
  }

  /**
   * Registers a global raw function. JS exceptions thrown by `fn` become Lua
   * errors (catchable by pcall, reported with the cart line).
   */
  register(name: string, fn: RawFunction): void {
    const M = this.M;
    const wrapped = (L: number) => {
      let ret: number;
      try {
        ret = fn(L);
      } catch (e) {
        this.pushStr(L, e instanceof Error ? e.message : String(e));
        return M._lua_error(L);
      }
      return ret;
    };
    const ptr = M.addFunction(wrapped, 'ii');
    this.functions.push(ptr);
    M._lua_pushcclosure(this.L, ptr, 0);
    M._lua_setglobal(this.L, this.cname(name));
  }

  argc(L: number): number {
    return this.M._lua_gettop(L);
  }

  type(L: number, i: number): number {
    return this.M._lua_type(L, i);
  }

  /** Number argument; nil/none/non-numeric -> undefined. Numeric strings are converted. */
  num(L: number, i: number): number | undefined {
    const t = this.M._lua_type(L, i);
    if (t === LUA_TNUMBER) return this.M._lua_tonumberx(L, i, 0);
    if (t === LUA_TSTRING) {
      const v = this.M._lua_tonumberx(L, i, this.scratch);
      return this.M.HEAPU32[this.scratch >> 2] ? v : undefined;
    }
    return undefined;
  }

  bool(L: number, i: number): boolean {
    return this.M._lua_toboolean(L, i) !== 0;
  }

  /** Optional boolean: none/nil -> undefined. */
  optBool(L: number, i: number): boolean | undefined {
    const t = this.M._lua_type(L, i);
    if (t === LUA_TNONE || t === LUA_TNIL) return undefined;
    return this.M._lua_toboolean(L, i) !== 0;
  }

  /** String argument as a p8 string (1 char = 1 byte), or undefined. */
  str(L: number, i: number): string | undefined {
    const t = this.M._lua_type(L, i);
    if (t !== LUA_TSTRING && t !== LUA_TNUMBER) return undefined;
    const p = this.M._lua_tolstring(L, i, this.scratch);
    const len = this.M.HEAPU32[this.scratch >> 2]!;
    const heap = this.M.HEAPU8;
    let s = '';
    for (let k = 0; k < len; k += 4096) {
      s += String.fromCharCode.apply(null, heap.subarray(p + k, p + Math.min(len, k + 4096)) as unknown as number[]);
    }
    return s;
  }

  pushNum(L: number, v: number): void {
    this.M._lua_pushnumber(L, v);
  }

  pushBool(L: number, v: boolean): void {
    this.M._lua_pushboolean(L, v ? 1 : 0);
  }

  pushNil(L: number): void {
    this.M._lua_pushnil(L);
  }

  /** Pushes a p8 string (char codes 0-255) or plain JS string (UTF-16 truncated to bytes). */
  pushStr(L: number, s: string): void {
    const len = s.length;
    if (len + 1 > this.strCap) {
      if (this.strBuf) this.M._free(this.strBuf);
      this.strCap = Math.max(256, len + 1);
      this.strBuf = this.M._malloc(this.strCap);
    }
    const heap = this.M.HEAPU8;
    for (let k = 0; k < len; k++) heap[this.strBuf + k] = s.charCodeAt(k) & 0xff;
    this.M._lua_pushlstring(L, this.strBuf, len);
  }

  /** Pushes any JS value (number, boolean, string, undefined/null). */
  push(L: number, v: number | boolean | string | undefined | null): void {
    if (typeof v === 'number') this.pushNum(L, v);
    else if (typeof v === 'boolean') this.pushBool(L, v);
    else if (typeof v === 'string') this.pushStr(L, v);
    else this.pushNil(L);
  }

  /**
   * Calls global function `name` with args, returning up to `nresults` values
   * converted to JS (numbers, booleans, p8 strings, undefined). Errors raised
   * by the function are returned as { error }.
   */
  call(name: string, args: (number | boolean | string | undefined)[], nresults: number): { values: (number | boolean | string | undefined)[]; error?: string } {
    const L = this.L;
    const M = this.M;
    const top = M._lua_gettop(L);
    M._lua_getglobal(L, this.cname(name));
    for (const a of args) this.push(L, a);
    const status = M._lua_pcallk(L, args.length, nresults, 0, 0, 0);
    if (status !== 0) {
      const err = this.str(L, -1) ?? 'error';
      M._lua_settop(L, top);
      return { values: [], error: err };
    }
    const values: (number | boolean | string | undefined)[] = [];
    for (let i = 0; i < nresults; i++) {
      const idx = top + 1 + i;
      const t = M._lua_type(L, idx);
      if (t === LUA_TNUMBER) values.push(M._lua_tonumberx(L, idx, 0));
      else if (t === LUA_TBOOLEAN) values.push(M._lua_toboolean(L, idx) !== 0);
      else if (t === LUA_TSTRING) values.push(this.str(L, idx));
      else values.push(undefined);
    }
    M._lua_settop(L, top);
    return { values };
  }

  /** Closes the Lua state and frees the registered functions and buffers. */
  dispose(): void {
    this.engine.global.close();
    for (const p of this.functions) this.M.removeFunction(p);
    for (const p of this.names.values()) this.M._free(p);
    if (this.strBuf) this.M._free(this.strBuf);
    this.M._free(this.scratch);
    this.functions = [];
    this.names.clear();
    this.strBuf = 0;
  }

  /** Runs Lua source in _G (setup code). Throws on error. */
  exec(code: string): void {
    this.engine.doStringSync(code);
  }
}
