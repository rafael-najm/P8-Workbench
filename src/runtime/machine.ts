/**
 * The PICO-8 "machine": memory, Lua VM, API, input, audio sequencer and the
 * frame cycle (_init / _update(60) / _draw). It has no clock of its own:
 * callers step it (the interactive clock in the UI, or headless runs).
 */
import { cloneCart } from '../cart/cart';
import { fromP8String } from '../cart/p8scii';
import type { Cart } from '../cart/types';
import { bindApi, JS_API_NAMES, type SystemHooks } from './api/bind';
import { Gfx } from './api/gfx';
import { Input } from './api/input';
import { Text } from './api/text';
import type { AudioBackend } from './audio/backend';
import { Sequencer } from './audio/sequencer';
import { LuaBridge } from './lua/bridge';
import { createLuaEngine } from './lua/engine';
import { INSPECT_LUA } from './lua/inspect';
import { PRELUDE_LUA } from './lua/prelude';
import { CART_GLOBALS, STDLIB_LUA } from './lua/stdlib';
import { ADDR, cartToRom, Memory } from './memory';
import { luaIdent, mapLine, preprocess } from './preprocess';
import { GLYPH_CONSTANTS } from './api/docs';
import { renderScreen } from './render';

// Lua helpers that depend on the machine's environment.
const MACHINE_LUA = String.raw`
function __p8_eval(depth)
  local chunk, err = load(__p8_src, "=cart", "t", __p8_env)
  __p8_src = nil
  if not chunk then return "error", err end
  local res = table.pack(__p8_invoke(chunk))
  if res[1] ~= "ok" then return res[1], res[2], res[3] end
  if res.n < 2 then return "ok", "null" end
  return "ok", __p8_json(res[2], depth)
end

-- stat(0) (Lua memory in KB) is answered in Lua, the rest by the host.
function stat(n)
  if n == 0 then return collectgarbage("count") end
  return __p8_stat_raw(n)
end

__p8_menu = {}
__p8_builtin = {}
function menuitem(i, label, fn)
  i = math.floor(i or 0)
  if label == nil then __p8_menu[i] = nil else __p8_menu[i] = fn end
  __p8_menuitem(i, label)
end

function __p8_callenv(name, ...)
  local fn = __p8_env[name]
  if type(fn) ~= "function" then return "error", "no function named " .. tostring(name) end
  return __p8_invoke(fn, ...)
end

function __p8_menu_call(i, buttons)
  local fn = __p8_menu[i]
  if not fn then return "ok" end
  return __p8_invoke(fn, buttons)
end
`;

export type MachineStatus = 'empty' | 'running' | 'error' | 'stopped';

export interface RuntimeError {
  kind: 'compile' | 'runtime' | 'timeout';
  /** Message without the "cart:N:" prefix. */
  message: string;
  /** Line in the PICO-8 source, when known. */
  line: number | null;
  traceback: string;
}

export interface MachineHost {
  printh?(text: string): void;
  loadCartData?(id: string): Uint8Array | null;
  saveCartData?(id: string, data: Uint8Array): void;
  menuItemsChanged?(items: (string | null)[]): void;
  /** Wall clock for stat(80..95). */
  now?(): Date;
}

export interface MachineOptions {
  host?: MachineHost;
  /** RNG seed used at boot (default: random). Fixed seeds make runs reproducible. */
  seed?: number;
  /** Watchdog: max seconds a frame may run. */
  timeoutSeconds?: number;
  /** Audio backend (default: a silent sequencer that only tracks state). */
  audio?: (ram: Uint8Array) => AudioBackend;
  /** URL of wasmoon's glue.wasm (browser builds). */
  wasmUrl?: string;
}

export type FrameResult = 'ok' | 'boot' | 'flip' | 'error' | 'stopped' | 'idle';

export class Machine {
  readonly memory = new Memory();
  readonly gfx: Gfx;
  readonly text: Text;
  readonly input = new Input();
  readonly audio: AudioBackend;
  status: MachineStatus = 'empty';
  error: RuntimeError | null = null;
  /** Message passed to stop(). */
  stopMessage = '';
  /** Game frames executed since boot (update/draw calls). */
  frame = 0;
  /** 30 or 60, known after boot. */
  fps = 30;
  menuItems: (string | null)[] = [null, null, null, null, null];
  /** Last frame's CPU usage as a fraction of the frame budget (stat(1)). */
  cpu = 0;

  private cart: Cart | null = null;
  private lineMap: number[] = [];
  private cartDataId: string | null = null;
  private seed: number | null;

  private constructor(
    private readonly bridge: LuaBridge,
    private readonly options: MachineOptions,
  ) {
    this.seed = options.seed ?? null;
    this.gfx = new Gfx(this.memory);
    this.text = new Text(this.memory, this.gfx);
    this.audio = options.audio ? options.audio(this.memory.ram) : new Sequencer(this.memory.ram);
    bindApi({
      bridge,
      mem: this.memory,
      gfx: this.gfx,
      text: this.text,
      input: this.input,
      audio: this.audio,
      sys: this.systemHooks(),
    });
    bridge.exec(PRELUDE_LUA);
    bridge.exec(STDLIB_LUA);
    bridge.exec(INSPECT_LUA);
    bridge.exec(MACHINE_LUA);
  }

  static async create(options: MachineOptions = {}): Promise<Machine> {
    const { engine, wasm } = await createLuaEngine(options.wasmUrl);
    const bridge = new LuaBridge(wasm, engine);
    return new Machine(bridge, options);
  }

  private systemHooks(): SystemHooks {
    const host = this.options.host ?? {};
    return {
      printh: (s) => host.printh?.(fromP8String(s)),
      cartdata: (id) => {
        this.cartDataId = id;
        const data = host.loadCartData?.(id) ?? null;
        if (data) this.memory.ram.set(data.subarray(0, 256), ADDR.persistent);
        return data !== null;
      },
      dsetChanged: () => {
        if (this.cartDataId) host.saveCartData?.(this.cartDataId, this.memory.ram.slice(ADDR.persistent, ADDR.persistent + 256));
      },
      menuitem: (i, label) => {
        if (i >= 1 && i <= 5) {
          this.menuItems[i - 1] = label === null ? null : fromP8String(label);
          host.menuItemsChanged?.([...this.menuItems]);
        }
      },
      stat: (n) => this.stat(n),
      reset: () => this.gfx.resetDrawState(),
      extcmd: (cmd) => {
        if (cmd === 'reset') this.pendingRestart = true;
      },
    };
  }

  private pendingRestart = false;

  private stat(n: number): number | string | boolean | undefined {
    const now = this.options.host?.now?.() ?? new Date();
    if (n === 1) return this.cpu;
    if (n === 7 || n === 8 || n === 9) return this.fps;
    if (n >= 16 && n <= 19) return this.audio.channel(n - 16).sfx;
    if (n >= 20 && n <= 23) return this.audio.channel(n - 20).note;
    if (n === 24) return this.audio.musicState().pattern;
    if (n >= 46 && n <= 49) return this.audio.channel(n - 46).sfx;
    if (n >= 50 && n <= 53) return this.audio.channel(n - 50).note;
    const ms = this.audio.musicState();
    if (n === 54) return ms.pattern;
    if (n === 55) return ms.count;
    if (n === 56) return ms.ticks;
    if (n === 57) return ms.playing;
    const utc = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds()];
    const local = [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()];
    if (n >= 80 && n <= 85) return utc[n - 80];
    if (n >= 90 && n <= 95) return local[n - 90];
    if (n === 100) return undefined;
    if (n === 102) return 0;
    return 0;
  }

  // --- loading -------------------------------------------------------------------

  /**
   * Loads a cart and prepares it to boot on the next tick. Returns the
   * compile error, if any (the machine then stays in 'error').
   */
  load(cart: Cart): RuntimeError | null {
    this.cart = cloneCart(cart);
    this.memory.rom = cartToRom(this.cart);
    return this.restart();
  }

  /** The cart currently loaded (with any cstore() changes applied to its ROM). */
  get loadedCart(): Cart | null {
    return this.cart;
  }

  /** Full restart: reset memory from ROM, fresh globals, boot on next tick. */
  restart(): RuntimeError | null {
    if (!this.cart) return null;
    const pre = preprocess(this.cart.code);
    this.error = null;
    this.stopMessage = '';
    this.frame = 0;
    this.fps = 30;
    this.pendingRestart = false;
    this.menuItems = [null, null, null, null, null];
    this.options.host?.menuItemsChanged?.([...this.menuItems]);
    const ram = this.memory.ram;
    ram.fill(0);
    ram.set(this.memory.rom, 0);
    this.gfx.resetDrawState();
    this.gfx.pal();
    this.input.reset();
    this.audio.stopAll();
    this.cartDataId = null;

    if (!pre.ok) {
      this.lineMap = [];
      this.fail({ kind: 'compile', message: pre.error.message, line: pre.error.line, traceback: '' });
      return this.error;
    }
    this.lineMap = pre.lineMap;
    this.resetEnv();
    this.bridge.engine.global.set('__p8_src', pre.lua);
    const res = this.bridge.call('__p8_compile_boot', [], 1);
    const err = res.error ?? (typeof res.values[0] === 'string' ? res.values[0] : undefined);
    if (err) {
      this.fail(this.parseError(err, '', 'compile'));
      return this.error;
    }
    this.status = 'running';
    return null;
  }

  /** Creates a fresh cart environment with the API. */
  private resetEnv(): void {
    const names = [...CART_GLOBALS, ...JS_API_NAMES, 'stat', 'menuitem'];
    const glyphs = [...GLYPH_CONSTANTS].map(([byte, v]) => `${luaIdent(String.fromCharCode(byte))}=${v}`).join(',');
    this.bridge.exec(`
      local names = {${names.map((n) => `"${n}"`).join(',')}}
      local env, builtin = {}, {}
      for _, n in ipairs(names) do env[n] = _G[n] builtin[n] = true end
      env._G = env
      builtin._G = true
      for k, v in pairs({${glyphs}}) do env[k] = v builtin[k] = true end
      __p8_env, __p8_builtin = env, builtin
      __p8_menu = {}
      __p8_t = 0.0
      __p8_timeout = ${this.options.timeoutSeconds ?? 2}
      srand(${this.seed ?? Math.floor(Math.random() * 0x7fff)})
      function __p8_compile_boot()
        local chunk, err = load(__p8_src, "=cart", "t", __p8_env)
        __p8_src = nil
        if not chunk then return err end
        __p8_boot(chunk)
        return nil
      end
      function __p8_compile_defs()
        local chunk, err = load(__p8_src, "=cart", "t", __p8_env)
        __p8_src = nil
        if not chunk then return "compile", err end
        return __p8_invoke(chunk)
      end
    `);
    this.bridge.exec('__p8_sethook()');
  }

  // --- running -------------------------------------------------------------------

  /** Runs one game frame. */
  tick(): FrameResult {
    if (this.status !== 'running') return 'idle';
    if (this.pendingRestart) this.restart();
    const dt = 1 / this.fps;
    this.input.delay = this.memory.peek(ADDR.btnpDelay);
    this.input.repeat = this.memory.peek(ADDR.btnpRepeat);
    this.input.latch();
    const t0 = performance.now();
    const res = this.bridge.call('__p8_tick', [dt], 3);
    this.cpu = (performance.now() - t0) / (1000 * dt);
    const [status, msg, tb] = res.values as [string | undefined, string | undefined, string | undefined];
    if (res.error) {
      this.fail(this.parseError(res.error, '', 'runtime'));
      return 'error';
    }
    this.audio.tick(dt);
    switch (status) {
      case 'ok':
        this.frame++;
        return 'ok';
      case 'boot':
        this.fps = (this.bridge.call('__p8_fps', [], 1).values[0] as number) ?? 30;
        return 'boot';
      case 'flip':
        return 'flip';
      case 'stop':
        this.status = 'stopped';
        this.stopMessage = fromP8String(msg ?? '');
        this.audio.stopAll();
        return 'stopped';
      case 'run':
        this.restart();
        return 'boot';
      default:
        this.fail(this.parseError(msg ?? 'error', tb ?? '', 'runtime'));
        return 'error';
    }
  }

  /** Runs `n` frames (stops early on error/stop). Returns frames actually run. */
  step(n: number): number {
    let done = 0;
    while (done < n && this.status === 'running') {
      const r = this.tick();
      if (r === 'ok' || r === 'flip') done++;
    }
    return done;
  }

  private fail(err: RuntimeError): void {
    this.error = err;
    this.status = 'error';
    this.audio.stopAll();
    // Show the error on the game screen, PICO-8 style.
    this.gfx.resetDrawState();
    this.gfx.pal();
    const lines = [`runtime error${err.line ? ` line ${err.line}` : ''}`, ...wrap(err.message.toLowerCase(), 31)];
    if (err.kind === 'compile') lines[0] = `syntax error${err.line ? ` line ${err.line}` : ''}`;
    this.gfx.rectfill(0, 0, 127, lines.length * 6 + 3, 0);
    lines.forEach((l, i) => this.text.print(l, 2, 2 + i * 6, i === 0 ? 8 : 7));
  }

  private parseError(raw: string, traceback: string, kind: RuntimeError['kind']): RuntimeError {
    const message = fromP8String(raw);
    const tb = fromP8String(traceback);
    const direct = /^cart:(\d+):\s*/.exec(message);
    let line: number | null = null;
    if (direct) line = mapLine(this.lineMap, parseInt(direct[1]!, 10));
    else {
      const inTb = /cart:(\d+):/.exec(tb);
      if (inTb) line = mapLine(this.lineMap, parseInt(inTb[1]!, 10));
    }
    const clean = message.replace(/^cart:\d+:\s*/, '').replace(/^\[string "[^"]*"\]:\d+:\s*/, '');
    const isTimeout = clean.startsWith('cpu timeout');
    return {
      kind: isTimeout ? 'timeout' : kind,
      message: clean,
      line,
      traceback: tb.replace(/\[C\]: in \?\n?/g, ''),
    };
  }

  /**
   * Hot reload: re-runs the cart's top-level definitions without _init,
   * keeping globals. Returns a compile/runtime error, or null.
   */
  hotReload(code: string): RuntimeError | null {
    if (!this.cart) return null;
    this.cart.code = code;
    if (this.status !== 'running') return this.restart();
    const pre = preprocess(code, { definitionsOnly: true });
    if (!pre.ok) return { kind: 'compile', message: pre.error.message, line: pre.error.line, traceback: '' };
    this.lineMap = pre.lineMap;
    this.bridge.engine.global.set('__p8_src', pre.lua);
    const res = this.bridge.call('__p8_compile_defs', [], 3);
    const [status, msg, tb] = res.values as [string, string | undefined, string | undefined];
    if (res.error) return this.parseError(res.error, '', 'runtime');
    if (status === 'ok') return null;
    return this.parseError(msg ?? 'error', tb ?? '', status === 'compile' ? 'compile' : 'runtime');
  }

  /** Updates the ROM/memory for spritesheet, map and flags edits (live editing). */
  applyAssets(cart: Cart, parts: { gfx?: boolean; map?: boolean; flags?: boolean; sfx?: boolean; music?: boolean } = {}): void {
    if (!this.cart) return;
    const rom = cartToRom(cart);
    const copy = (from: number, to: number) => {
      this.memory.rom.set(rom.subarray(from, to), from);
      this.memory.ram.set(rom.subarray(from, to), from);
    };
    const all = Object.keys(parts).length === 0;
    if (all || parts.gfx || parts.map) {
      copy(ADDR.gfx, ADDR.map + 0x1000);
    }
    if (all || parts.flags) copy(ADDR.flags, ADDR.music);
    if (all || parts.music) copy(ADDR.music, ADDR.sfx);
    if (all || parts.sfx) copy(ADDR.sfx, ADDR.cartEnd);
    this.cart.gfx.set(cart.gfx);
    this.cart.map.set(cart.map);
    this.cart.flags.set(cart.flags);
  }

  /**
   * Evaluates PICO-8 code in the cart environment. An expression's value is
   * returned as JSON text; statements return "null".
   */
  eval(code: string, depth = 2): { ok: true; json: string } | { ok: false; error: RuntimeError } {
    if (this.status === 'empty') return { ok: false, error: { kind: 'runtime', message: 'no cart loaded', line: null, traceback: '' } };
    const asExpr = preprocess(`return ${code}`);
    const pre = asExpr.ok ? asExpr : preprocess(code);
    if (!pre.ok) return { ok: false, error: { kind: 'compile', message: pre.error.message, line: pre.error.line, traceback: '' } };
    this.bridge.engine.global.set('__p8_src', pre.lua);
    const res = this.bridge.call('__p8_eval', [depth], 3);
    if (res.error) return { ok: false, error: this.parseError(res.error, '', 'runtime') };
    const [status, value, tb] = res.values as [string, string | undefined, string | undefined];
    if (status !== 'ok') return { ok: false, error: this.parseError(value ?? 'error', tb ?? '', 'runtime') };
    return { ok: true, json: fromP8String(value ?? 'null') };
  }

  /** JSON object of user globals (or of the given names). */
  globals(names?: string[], depth = 2, maxItems = 32): Record<string, unknown> {
    const res = this.bridge.call('__p8_globals', [names?.join(',') ?? '', depth, maxItems], 1);
    const text = typeof res.values[0] === 'string' ? fromP8String(res.values[0]) : '{}';
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  /** Names of user-defined global functions. */
  functionNames(): string[] {
    const res = this.bridge.call('__p8_functions', [], 1);
    const s = typeof res.values[0] === 'string' ? res.values[0] : '';
    return s ? s.split(',') : [];
  }

  /**
   * Calls a global function of the cart (e.g. a playtest bot) with the
   * watchdog. Returns its first two results.
   */
  callFunction(name: string, ...args: (number | string | boolean)[]): { ok: true; values: (number | boolean | string | undefined)[] } | { ok: false; error: RuntimeError } {
    const res = this.bridge.call('__p8_callenv', [name, ...args], 3);
    if (res.error) return { ok: false, error: this.parseError(res.error, '', 'runtime') };
    const [status, a, b] = res.values;
    if (status !== 'ok') return { ok: false, error: this.parseError(typeof a === 'string' ? a : 'error', typeof b === 'string' ? b : '', 'runtime') };
    return { ok: true, values: [a, b] };
  }

  /** Invokes a pause-menu item callback (1..5). */
  callMenuItem(index: number, buttons = 0): RuntimeError | null {
    const res = this.bridge.call('__p8_menu_call', [index, buttons], 3);
    const [status, msg, tb] = res.values as [string, string | undefined, string | undefined];
    if (status === 'ok' || status === undefined) return null;
    const err = this.parseError(msg ?? 'error', tb ?? '', 'runtime');
    this.fail(err);
    return err;
  }

  /** Writes the screen (through the screen palette) as RGBA pixels. */
  render(out: Uint32Array): void {
    renderScreen(this.memory.ram, out);
  }

  dispose(): void {
    this.status = 'empty';
    this.bridge.dispose();
  }
}


function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      if ((line + ' ' + word).trim().length > width) {
        if (line) out.push(line);
        line = word;
        while (line.length > width) {
          out.push(line.slice(0, width));
          line = line.slice(width);
        }
      } else line = (line ? line + ' ' : '') + word;
    }
    if (line) out.push(line);
  }
  return out.slice(0, 12);
}
