/**
 * Interactive game controller: owns the Machine used by the Game View,
 * drives it with requestAnimationFrame (with speed control and a frame
 * accumulator), renders to the canvas and feeds keyboard/gamepad input.
 */
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import type { Cart } from '../../cart/types';
import type { AudioBackend } from '../../runtime/audio/backend';
import { Machine, type RuntimeError } from '../../runtime/machine';
import { loadCartData, saveCartData } from '../../persistence/settings';
import { useConsole } from '../../store/console';
import type { AssetKind } from '../../store/project';
import { useRuntime } from '../../store/runtime';

/** keyboard code -> [player, button] */
const KEYMAP: Record<string, [number, number]> = {
  ArrowLeft: [0, 0], ArrowRight: [0, 1], ArrowUp: [0, 2], ArrowDown: [0, 3],
  KeyZ: [0, 4], KeyC: [0, 4], KeyN: [0, 4],
  KeyX: [0, 5], KeyV: [0, 5], KeyM: [0, 5],
  KeyS: [1, 0], KeyF: [1, 1], KeyE: [1, 2], KeyD: [1, 3],
  ShiftLeft: [1, 4], Tab: [1, 4], KeyA: [1, 5], KeyQ: [1, 5],
};

export type ControllerListener = () => void;

class GameController {
  private machine: Machine | null = null;
  private machinePromise: Promise<Machine> | null = null;
  private ctx2d: CanvasRenderingContext2D | null = null;
  private image: ImageData | null = null;
  private pixels: Uint32Array | null = null;
  private raf = 0;
  private lastTs = 0;
  private acc = 0;
  private paused = false;
  private fpsFrames = 0;
  private fpsSince = 0;
  private lastPublish = 0;
  private keyState = new Map<string, boolean>();
  private listeners = new Set<ControllerListener>();
  /** Set by the audio module (M6) to provide sound. */
  audioFactory: ((ram: Uint8Array) => AudioBackend) | null = null;
  /** Called with runtime errors (to mark lines in the editor). */
  onError: ((err: RuntimeError | null) => void) | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => this.onKey(e, true));
      window.addEventListener('keyup', (e) => this.onKey(e, false));
      window.addEventListener('blur', () => this.releaseKeys());
    }
  }

  /** Subscribe to "frame rendered" (e.g. for the inspector). */
  subscribe(fn: ControllerListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get current(): Machine | null {
    return this.machine;
  }

  private async getMachine(): Promise<Machine> {
    if (this.machine) return this.machine;
    this.machinePromise ??= Machine.create({
      wasmUrl: glueWasmUrl,
      audio: this.audioFactory ?? undefined,
      host: {
        printh: (s) => useConsole.getState().log('printh', s),
        loadCartData,
        saveCartData,
        menuItemsChanged: (items) => useRuntime.getState().set({ menuItems: items }),
      },
    });
    this.machine = await this.machinePromise;
    return this.machine;
  }

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.ctx2d = canvas?.getContext('2d') ?? null;
    if (this.ctx2d) {
      this.image = this.ctx2d.createImageData(128, 128);
      this.pixels = new Uint32Array(this.image.data.buffer);
      this.render();
    }
  }

  /** Loads and starts a cart from scratch. */
  async run(cart: Cart): Promise<void> {
    const rt = useRuntime.getState();
    rt.set({ status: 'loading', error: null, stopMessage: '' });
    const m = await this.getMachine();
    const err = m.load(cart);
    this.paused = false;
    this.acc = 0;
    if (err) {
      this.handleError(err);
      return;
    }
    this.onError?.(null);
    rt.set({ status: 'running', frame: 0 });
    this.startLoop();
  }

  /** Hot reload code (keeps state). Starts the game if it isn't running. */
  async hotReload(cart: Cart): Promise<RuntimeError | null> {
    const m = this.machine;
    if (!m || m.status !== 'running') {
      await this.run(cart);
      return this.machine?.error ?? null;
    }
    const err = m.hotReload(cart.code);
    m.applyAssets(cart);
    if (err) {
      useConsole.getState().log('error', `reload failed${err.line ? ` (line ${err.line})` : ''}: ${err.message}`, err.line ?? undefined);
      this.onError?.(err);
    } else {
      this.onError?.(null);
      useConsole.getState().log('info', 'code reloaded');
    }
    return err;
  }

  /** Pushes asset edits (sprites, map, sfx...) into the running game. */
  syncAssets(cart: Cart, kinds: AssetKind[]): void {
    const m = this.machine;
    if (!m || m.status === 'empty') return;
    m.applyAssets(cart, {
      gfx: kinds.includes('gfx'),
      map: kinds.includes('map'),
      flags: kinds.includes('flags'),
      sfx: kinds.includes('sfx'),
      music: kinds.includes('music'),
    });
    if (this.paused || m.status !== 'running') this.render();
  }

  pause(): void {
    if (useRuntime.getState().status !== 'running') return;
    this.paused = true;
    this.machine?.audio.setPaused(true);
    useRuntime.getState().set({ status: 'paused', fps: 0 });
  }

  resume(): void {
    if (useRuntime.getState().status !== 'paused') return;
    this.paused = false;
    this.machine?.audio.setPaused(false);
    this.lastTs = 0;
    useRuntime.getState().set({ status: 'running' });
    this.startLoop();
  }

  togglePause(): void {
    const s = useRuntime.getState().status;
    if (s === 'running') this.pause();
    else if (s === 'paused') this.resume();
  }

  /** Advances n frames while paused (or pauses first). */
  step(n = 1): void {
    const m = this.machine;
    if (!m) return;
    if (useRuntime.getState().status === 'running') this.pause();
    if (m.status !== 'running') return;
    for (let i = 0; i < n && m.status === 'running'; i++) {
      this.feedGamepads();
      m.tick();
    }
    this.afterFrames();
    this.render();
    this.publish(true);
  }

  async restart(cart: Cart): Promise<void> {
    await this.run(cart);
  }

  stop(): void {
    this.paused = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.machine?.audio.stopAll();
    if (this.machine) this.machine.status = 'stopped';
    useRuntime.getState().set({ status: 'stopped', fps: 0 });
  }

  setSpeed(speed: number): void {
    useRuntime.getState().set({ speed });
  }

  setFocused(focused: boolean): void {
    if (useRuntime.getState().focused === focused) return;
    useRuntime.getState().set({ focused });
    if (!focused) this.releaseKeys();
  }

  callMenuItem(index: number): void {
    const err = this.machine?.callMenuItem(index);
    if (err) this.handleError(err);
    this.resume();
  }

  // --- loop -------------------------------------------------------------------------

  private startLoop(): void {
    if (this.raf) return;
    this.lastTs = 0;
    this.fpsSince = performance.now();
    this.fpsFrames = 0;
    const loop = (ts: number) => {
      this.raf = 0;
      if (this.paused || !this.machine || this.machine.status !== 'running') return;
      this.frame(ts);
      if (!this.paused && this.machine.status === 'running') this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private frame(ts: number): void {
    const m = this.machine!;
    const speed = useRuntime.getState().speed;
    const dt = this.lastTs ? Math.min(0.1, (ts - this.lastTs) / 1000) : 1 / 60;
    this.lastTs = ts;
    this.acc += dt * speed;
    const interval = 1 / m.fps;
    let ran = 0;
    while (this.acc >= interval && ran < 8 && m.status === 'running') {
      this.feedGamepads();
      m.tick();
      this.acc -= interval;
      ran++;
      this.fpsFrames++;
    }
    if (ran === 8) this.acc = 0;
    if (ran > 0) {
      this.afterFrames();
      this.render();
    }
    this.publish(false);
  }

  private afterFrames(): void {
    const m = this.machine!;
    if (m.status === 'error' && m.error) this.handleError(m.error);
    else if (m.status === 'stopped') {
      useRuntime.getState().set({ status: 'stopped', stopMessage: m.stopMessage });
      useConsole.getState().log('info', `stopped${m.stopMessage ? `: ${m.stopMessage}` : ''}`);
    }
    for (const fn of this.listeners) fn();
  }

  private handleError(err: RuntimeError): void {
    this.render();
    useRuntime.getState().set({ status: 'error', error: err, fps: 0 });
    const where = err.line ? ` (line ${err.line})` : '';
    useConsole.getState().log('error', `${err.kind === 'compile' ? 'syntax error' : err.kind === 'timeout' ? 'timeout' : 'runtime error'}${where}: ${err.message}`, err.line ?? undefined);
    this.onError?.(err);
  }

  private publish(force: boolean): void {
    const now = performance.now();
    if (!force && now - this.lastPublish < 250) return;
    const m = this.machine;
    if (!m) return;
    const elapsed = (now - this.fpsSince) / 1000;
    const fps = elapsed > 0 ? Math.round(this.fpsFrames / elapsed) : 0;
    if (elapsed > 1) {
      this.fpsSince = now;
      this.fpsFrames = 0;
    }
    this.lastPublish = now;
    useRuntime.getState().set({ frame: m.frame, fps: this.paused ? 0 : fps, targetFps: m.fps });
  }

  render(): void {
    if (!this.machine || !this.ctx2d || !this.image || !this.pixels) return;
    this.machine.render(this.pixels);
    this.ctx2d.putImageData(this.image, 0, 0);
  }

  // --- input ------------------------------------------------------------------------

  private onKey(e: KeyboardEvent, down: boolean): void {
    const rt = useRuntime.getState();
    if (!rt.focused || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    const mapped = KEYMAP[e.code];
    if (e.code === 'Enter' || e.code === 'KeyP') {
      if (down && !e.repeat) window.dispatchEvent(new CustomEvent('p8-pause-menu'));
      e.preventDefault();
      return;
    }
    if (!mapped) return;
    e.preventDefault();
    this.keyState.set(e.code, down);
    this.machine?.input.setButton(mapped[0], mapped[1], this.isHeld(mapped[0], mapped[1]));
  }

  private isHeld(player: number, button: number): boolean {
    for (const [code, down] of this.keyState) {
      const m = KEYMAP[code];
      if (down && m && m[0] === player && m[1] === button) return true;
    }
    return false;
  }

  private releaseKeys(): void {
    this.keyState.clear();
    this.machine?.input.releaseAll();
  }

  /** Gamepad API: pads 0..7 map to players 0..7 (merged with the keyboard). */
  private feedGamepads(): void {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const m = this.machine;
    if (!m) return;
    const pads = navigator.getGamepads();
    for (let p = 0; p < pads.length && p < 8; p++) {
      const pad = pads[p];
      if (!pad) continue;
      const b = (i: number) => !!pad.buttons[i]?.pressed;
      const ax = pad.axes[0] ?? 0;
      const ay = pad.axes[1] ?? 0;
      let mask = 0;
      if (b(14) || ax < -0.5) mask |= 1;
      if (b(15) || ax > 0.5) mask |= 2;
      if (b(12) || ay < -0.5) mask |= 4;
      if (b(13) || ay > 0.5) mask |= 8;
      if (b(0) || b(2)) mask |= 16;
      if (b(1) || b(3)) mask |= 32;
      let keys = 0;
      for (let btn = 0; btn < 6; btn++) if (this.isHeld(p, btn)) keys |= 1 << btn;
      m.input.setMask(p, mask | keys);
    }
  }
}

export const game = new GameController();
