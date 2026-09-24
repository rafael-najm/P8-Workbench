/** Headless execution for agent tools. Runs in a Web Worker in the app, in-process in tests. */
import { parseP8 } from '../../cart/p8format';
import { createHeadless, runFrames, type InputEvent } from '../../runtime/headless';
import type { Machine } from '../../runtime/machine';
import { encodeIndexedPng, bytesToBase64, toPaletteIndices } from '../../runtime/png';
import { screenIndices } from '../../runtime/render';
import { contactSheet } from './contactSheet';
import { playtest, type PlaytestArgs, type PlaytestReport } from './playtest';

export interface RunGameArgs { frames: number; inputs?: InputEvent[]; from_start?: boolean; watch?: string[] }
export interface ShotArgs { frames?: number[]; at_frame?: number; scale?: number; inputs?: InputEvent[] }

export interface Executor {
  runGame(p8: string, a: RunGameArgs): Promise<unknown>;
  screenshots(p8: string, a: ShotArgs): Promise<{ images: string[]; frames: number[]; error: unknown }>;
  readGlobals(p8: string, names: string[] | undefined, depth: number): Promise<unknown>;
  evalLua(p8: string, code: string): Promise<unknown>;
  playtest(p8: string, a: PlaytestArgs): Promise<PlaytestReport>;
}

const dataUrl = (png: Uint8Array) => `data:image/png;base64,${bytesToBase64(png)}`;

export class InProcessExecutor implements Executor {
  private session: Machine | null = null;
  private sessionP8 = '';
  private printh: string[] = [];

  private async fresh(p8: string): Promise<Machine> {
    this.session?.dispose();
    this.printh = [];
    this.session = await createHeadless(parseP8(p8), { printh: this.printh, seed: 1 });
    this.sessionP8 = p8;
    return this.session;
  }
  private async current(p8: string): Promise<Machine> {
    if (!this.session || this.session.status === 'empty') return this.fresh(p8);
    if (p8 !== this.sessionP8) {
      const cart = parseP8(p8);
      this.session.hotReload(cart.code);
      this.session.applyAssets(cart);
      this.sessionP8 = p8;
    }
    return this.session;
  }

  async runGame(p8: string, a: RunGameArgs) {
    const m = a.from_start === false ? await this.current(p8) : await this.fresh(p8);
    const start = this.printh.length;
    const frames = Math.min(Math.max(1, a.frames), 36000);
    const base = m.frame;
    const inputs = (a.inputs ?? []).map((e) => ({ ...e, frame: e.frame + base }));
    const r = runFrames(m, { frames, inputs, watch: a.watch });
    return {
      frames_run: r.framesRun, final_frame: m.frame, status: m.status,
      error: r.error ? { message: r.error.message, line: r.error.line, kind: r.error.kind, traceback: r.error.traceback.slice(0, 800) } : null,
      printh: this.printh.slice(start).slice(-50), globals: r.globals,
      simulated_fps: r.simulatedFps, target_fps: m.fps, avg_cpu: Math.round(r.avgCpu * 100) / 100, max_cpu: Math.round(r.maxCpu * 100) / 100,
    };
  }

  async screenshots(p8: string, a: ShotArgs) {
    const scale = Math.max(1, Math.min(4, a.scale ?? 2));
    const wanted = a.frames?.length ? [...a.frames].sort((x, y) => x - y).slice(0, 16) : a.at_frame !== undefined ? [a.at_frame] : [];
    if (!wanted.length) {
      const m = await this.current(p8);
      if (m.frame === 0) runFrames(m, { frames: 30 });
      return { images: [dataUrl(await encodeIndexedPng(toPaletteIndices(screenIndices(m.memory.ram)), 128, 128, scale))], frames: [m.frame], error: m.error };
    }
    const m = await this.fresh(p8);
    const shots: { label: string; pixels: Uint8Array }[] = [];
    const last = wanted.at(-1)!;
    runFrames(m, {
      frames: last, inputs: a.inputs,
      onFrame: (mm, f) => { if (wanted.includes(f)) shots.push({ label: `f${f}`, pixels: toPaletteIndices(screenIndices(mm.memory.ram)) }); },
    });
    if (!shots.length) shots.push({ label: `f${m.frame}`, pixels: toPaletteIndices(screenIndices(m.memory.ram)) });
    if (shots.length === 1) return { images: [dataUrl(await encodeIndexedPng(shots[0]!.pixels, 128, 128, scale))], frames: [m.frame], error: m.error };
    const sheet = contactSheet(shots);
    return { images: [dataUrl(await encodeIndexedPng(sheet.pixels, sheet.width, sheet.height, Math.min(scale, 2)))], frames: wanted, error: m.error };
  }

  async readGlobals(p8: string, names: string[] | undefined, depth: number) {
    const m = await this.current(p8);
    if (m.frame === 0) m.step(1);
    return m.globals(names, depth, 32);
  }

  async evalLua(p8: string, code: string) {
    const m = await this.current(p8);
    if (m.frame === 0) m.step(1);
    const r = m.eval(code);
    return r.ok ? { value: JSON.parse(r.json) } : { error: r.error.message, line: r.error.line };
  }

  playtest(p8: string, a: PlaytestArgs) {
    return playtest(parseP8(p8), a);
  }
}
