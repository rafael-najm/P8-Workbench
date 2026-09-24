/** Observable state of the interactive game (updated a few times per second). */
import { create } from 'zustand';
import type { RuntimeError } from '../runtime/machine';

export type GameStatus = 'idle' | 'loading' | 'running' | 'paused' | 'error' | 'stopped';

interface RuntimeState {
  status: GameStatus;
  fps: number;
  targetFps: number;
  frame: number;
  speed: number;
  error: RuntimeError | null;
  stopMessage: string;
  focused: boolean;
  menuItems: (string | null)[];
  set(patch: Partial<Omit<RuntimeState, 'set'>>): void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  status: 'idle',
  fps: 0,
  targetFps: 30,
  frame: 0,
  speed: 1,
  error: null,
  stopMessage: '',
  focused: false,
  menuItems: [null, null, null, null, null],
  set: (patch) => set(patch),
}));
