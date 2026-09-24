/**
 * Headless execution: runs a cart without canvas/audio/clock, with a
 * scripted input timeline. Used by tests, the agent's run/playtest tools
 * (inside a Web Worker) and screenshots.
 */
import type { Cart } from '../cart/types';
import { buttonIndex } from './api/input';
import { Machine, type MachineOptions, type RuntimeError } from './machine';
import { encodeIndexedPng, toPaletteIndices } from './png';
import { screenIndices } from './render';

/** Hold `buttons` for `hold_frames` frames starting at `frame` (frames counted from boot). */
export interface InputEvent {
  frame: number;
  buttons: string[];
  hold_frames?: number;
  player?: number;
}

export interface HeadlessRunOptions extends Pick<MachineOptions, 'seed' | 'timeoutSeconds' | 'wasmUrl'> {
  frames: number;
  inputs?: InputEvent[];
  /** Global names to report at the end. */
  watch?: string[];
  /** Called after every frame (for bots, sampling, screenshots). */
  onFrame?: (m: Machine, frame: number) => void;
}

export interface HeadlessRunResult {
  framesRun: number;
  error: RuntimeError | null;
  stopped: boolean;
  printh: string[];
  globals: Record<string, unknown>;
  /** Average simulated FPS: how many frames per second this machine could run. */
  simulatedFps: number;
  /** Average stat(1)-style CPU usage. */
  avgCpu: number;
  maxCpu: number;
}

/** Builds an input mask timeline: frame -> player -> mask. */
export function inputMaskAt(inputs: InputEvent[], frame: number, player = 0): number {
  let mask = 0;
  for (const ev of inputs) {
    if ((ev.player ?? 0) !== player) continue;
    const hold = Math.max(1, ev.hold_frames ?? 1);
    if (frame >= ev.frame && frame < ev.frame + hold) {
      for (const b of ev.buttons) {
        const i = buttonIndex(b.toLowerCase());
        if (i >= 0) mask |= 1 << i;
      }
    }
  }
  return mask;
}

export async function createHeadless(cart: Cart, options: Pick<MachineOptions, 'seed' | 'timeoutSeconds' | 'wasmUrl'> & { printh?: string[] } = {}): Promise<Machine> {
  const log = options.printh;
  const m = await Machine.create({
    seed: options.seed ?? 1,
    timeoutSeconds: options.timeoutSeconds,
    wasmUrl: options.wasmUrl,
    host: {
      printh: (s) => log?.push(s),
      loadCartData: () => null,
      now: () => new Date(Date.UTC(2026, 0, 1)),
    },
  });
  m.load(cart);
  return m;
}

/** Runs `frames` frames on an existing machine with scripted inputs. */
export function runFrames(m: Machine, opts: Omit<HeadlessRunOptions, 'seed' | 'timeoutSeconds' | 'wasmUrl'>): Omit<HeadlessRunResult, 'printh'> {
  const inputs = opts.inputs ?? [];
  const players = new Set(inputs.map((e) => e.player ?? 0));
  let framesRun = 0;
  let cpuSum = 0;
  let cpuMax = 0;
  const start = performance.now();
  let guard = 0;
  while (framesRun < opts.frames && m.status === 'running' && guard++ < opts.frames * 4 + 100) {
    for (const p of players) m.input.setMask(p, inputMaskAt(inputs, m.frame, p));
    const r = m.tick();
    if (r === 'ok' || r === 'flip') {
      framesRun++;
      cpuSum += m.cpu;
      cpuMax = Math.max(cpuMax, m.cpu);
      opts.onFrame?.(m, m.frame);
    }
  }
  const elapsed = (performance.now() - start) / 1000;
  return {
    framesRun,
    error: m.error,
    stopped: m.status === 'stopped',
    globals: opts.watch && opts.watch.length ? m.globals(opts.watch, 2, 32) : {},
    simulatedFps: elapsed > 0 ? Math.round(framesRun / elapsed) : 0,
    avgCpu: framesRun ? cpuSum / framesRun : 0,
    maxCpu: cpuMax,
  };
}

export async function runHeadless(cart: Cart, options: HeadlessRunOptions): Promise<HeadlessRunResult> {
  const printh: string[] = [];
  const m = await createHeadless(cart, { ...options, printh });
  try {
    return { ...runFrames(m, options), printh };
  } finally {
    m.dispose();
  }
}

/** PNG of the current screen. */
export function screenshotPng(m: Machine, scale = 2): Promise<Uint8Array> {
  return encodeIndexedPng(toPaletteIndices(screenIndices(m.memory.ram)), 128, 128, scale);
}
