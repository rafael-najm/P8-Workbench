import { create } from 'zustand';

export type ConsoleKind = 'printh' | 'error' | 'info' | 'agent';

export interface ConsoleLine {
  id: number;
  time: number;
  kind: ConsoleKind;
  text: string;
  /** Source line to jump to, for errors. */
  line?: number;
}

interface ConsoleState {
  lines: ConsoleLine[];
  log(kind: ConsoleKind, text: string, line?: number): void;
  clear(): void;
}

const MAX_LINES = 500;
let nextId = 1;

export const useConsole = create<ConsoleState>((set) => ({
  lines: [],
  log: (kind, text, line) =>
    set((s) => ({ lines: [...s.lines.slice(-(MAX_LINES - 1)), { id: nextId++, time: Date.now(), kind, text, line }] })),
  clear: () => set({ lines: [] }),
}));
