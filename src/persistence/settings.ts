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
}

const DEFAULTS: Settings = {
  lastProjectId: null,
  gameScale: 'fit',
  crt: false,
  speed: 1,
  onboarded: false,
  openrouterKey: '',
  model: 'anthropic/claude-sonnet-4.5',
  agentMode: 'auto',
  agentBudget: 0.5,
  panelLayout: '',
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
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
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
