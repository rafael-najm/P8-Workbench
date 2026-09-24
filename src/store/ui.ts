/** Panel layout (floating / docked), command palette and focus. */
import { create } from 'zustand';
import { loadSettings, saveSettings } from '../persistence/settings';

export const PANEL_IDS = ['game', 'sprites', 'map', 'sfx', 'music', 'agent', 'console', 'projects'] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type Dock = 'float' | 'left' | 'right';

export interface PanelState {
  open: boolean;
  dock: Dock;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

const DEFAULT_PANELS: Record<PanelId, PanelState> = {
  game: { open: true, dock: 'right', x: 0, y: 0, w: 420, h: 520, z: 1 },
  sprites: { open: false, dock: 'float', x: 120, y: 80, w: 760, h: 560, z: 1 },
  map: { open: false, dock: 'float', x: 140, y: 90, w: 820, h: 560, z: 1 },
  sfx: { open: false, dock: 'float', x: 160, y: 100, w: 780, h: 520, z: 1 },
  music: { open: false, dock: 'float', x: 180, y: 110, w: 820, h: 470, z: 1 },
  agent: { open: false, dock: 'right', x: 0, y: 0, w: 440, h: 600, z: 1 },
  console: { open: false, dock: 'float', x: 80, y: 420, w: 560, h: 240, z: 1 },
  projects: { open: false, dock: 'float', x: 200, y: 90, w: 560, h: 520, z: 1 },
};

interface UiState {
  panels: Record<PanelId, PanelState>;
  paletteOpen: boolean;
  settingsOpen: boolean;
  topZ: number;
  toggle(id: PanelId): void;
  open(id: PanelId): void;
  close(id: PanelId): void;
  /** Closes the frontmost floating panel (Esc). Returns whether one was closed. */
  closeTop(): boolean;
  focus(id: PanelId): void;
  setDock(id: PanelId, dock: Dock): void;
  setRect(id: PanelId, rect: Partial<Pick<PanelState, 'x' | 'y' | 'w' | 'h'>>): void;
  setPalette(open: boolean): void;
  setSettings(open: boolean): void;
  resetLayout(): void;
}

function loadLayout(): Record<PanelId, PanelState> {
  try {
    const saved = JSON.parse(loadSettings().panelLayout || '{}') as Partial<Record<PanelId, PanelState>>;
    const out = { ...DEFAULT_PANELS };
    for (const id of PANEL_IDS) if (saved[id]) out[id] = { ...DEFAULT_PANELS[id], ...saved[id] };
    return out;
  } catch {
    return { ...DEFAULT_PANELS };
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function persist(panels: Record<PanelId, PanelState>) {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => saveSettings({ panelLayout: JSON.stringify(panels) }), 300);
}

export const useUi = create<UiState>((set, get) => {
  const update = (id: PanelId, patch: Partial<PanelState>) => {
    const panels = { ...get().panels, [id]: { ...get().panels[id], ...patch } };
    set({ panels });
    persist(panels);
  };
  return {
    panels: loadLayout(),
    paletteOpen: false,
    settingsOpen: false,
    topZ: 10,
    toggle: (id) => (get().panels[id].open ? get().close(id) : get().open(id)),
    open: (id) => {
      const z = get().topZ + 1;
      set({ topZ: z });
      update(id, { open: true, z });
    },
    close: (id) => update(id, { open: false }),
    closeTop: () => {
      const floating = PANEL_IDS.filter((id) => get().panels[id].open && get().panels[id].dock === 'float');
      if (floating.length === 0) return false;
      const top = floating.reduce((a, b) => (get().panels[a].z >= get().panels[b].z ? a : b));
      get().close(top);
      return true;
    },
    focus: (id) => {
      if (get().panels[id].z === get().topZ) return;
      const z = get().topZ + 1;
      set({ topZ: z });
      update(id, { z });
    },
    setDock: (id, dock) => update(id, { dock }),
    setRect: (id, rect) => update(id, rect),
    setPalette: (open) => set({ paletteOpen: open }),
    setSettings: (open) => set({ settingsOpen: open }),
    resetLayout: () => {
      set({ panels: { ...DEFAULT_PANELS } });
      persist(DEFAULT_PANELS);
    },
  };
});
