/** Small typed wrapper around localStorage for settings (never project data). */

export interface Settings {
  lastProjectId: string | null;
  gameScale: number | 'fit';
  crt: boolean;
  speed: number;
  onboarded: boolean;
  openrouterKey: string;
  model: string;
  agentMode: 'auto' | 'approve';
  /** Max USD spent per agent task. */
  agentBudget: number;
  panelLayout: string;
  settingsVersion: number;
}

/** Cheap model with tool calling and vision (about 10x cheaper than Sonnet) that edits code reliably. */
export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export const RECOMMENDED_MODELS = [
  { id: DEFAULT_MODEL, note: 'default · cheap' },
  { id: 'google/gemini-3.1-flash-lite', note: 'cheapest · weaker at big edits' },
  { id: 'anthropic/claude-haiku-4.5', note: 'smarter · ~4x the cost' },
];

const DEFAULTS: Settings = {
  lastProjectId: null,
  gameScale: 'fit',
  crt: false,
  speed: 1,
  onboarded: false,
  openrouterKey: '',
  model: DEFAULT_MODEL,
  agentMode: 'auto',
  agentBudget: 0.25,
  panelLayout: '',
  settingsVersion: 3,
};

const KEY = 'pico-workbench.settings';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  const raw = storage()?.getItem(KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    const saved = { ...DEFAULTS, settingsVersion: 1, ...(JSON.parse(raw) as Partial<Settings>) };
    if (saved.settingsVersion < 2) {
      // v1 defaulted to an expensive model and a $0.50 budget: move to the cheap defaults.
      if (saved.model === 'anthropic/claude-sonnet-4.5') saved.model = DEFAULT_MODEL;
      if (saved.agentBudget === 0.5) saved.agentBudget = DEFAULTS.agentBudget;
      saved.settingsVersion = 2;
    }
    if (saved.settingsVersion < 3) {
      // flash-lite (v2 default) was too weak for safe code edits
      if (saved.model === 'google/gemini-3.1-flash-lite') saved.model = DEFAULT_MODEL;
      saved.settingsVersion = 3;
      storage()?.setItem(KEY, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  storage()?.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Persistent cart data (cartdata/dset), per cart id. */
export function loadCartData(id: string): Uint8Array | null {
  const raw = storage()?.getItem(`pico-workbench.cartdata.${id}`);
  if (!raw) return null;
  try {
    return Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function saveCartData(id: string, data: Uint8Array): void {
  storage()?.setItem(`pico-workbench.cartdata.${id}`, btoa(String.fromCharCode(...data)));
}
