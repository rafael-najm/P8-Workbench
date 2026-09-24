/**
 * Current project: the cart being edited, persistence (autosave + versions)
 * and change notifications. The cart's typed arrays are mutated in place;
 * `revisions` tell subscribers what changed.
 */
import { create } from 'zustand';
import { cloneCart, createEmptyCart } from '../cart/cart';
import { parseP8, serializeP8 } from '../cart/p8format';
import { countTokens } from '../cart/tokens';
import type { Cart } from '../cart/types';
import { addVersion, getProject, listProjects, newProjectId, putProject, type ProjectRecord } from '../persistence/db';
import { loadSettings, saveSettings } from '../persistence/settings';
import nebula from '../../samples/nebula_strike.p8?raw';

export type AssetKind = 'gfx' | 'map' | 'flags' | 'sfx' | 'music' | 'label';

export interface Revisions {
  code: number;
  gfx: number;
  map: number;
  flags: number;
  sfx: number;
  music: number;
  label: number;
}

interface ProjectState {
  id: string | null;
  name: string;
  cart: Cart | null;
  revisions: Revisions;
  dirty: boolean;
  savedAt: number | null;
  loading: boolean;

  /** Replace the whole code. */
  setCode(code: string): void;
  /** Mutate cart assets in place and notify. */
  mutate(kind: AssetKind | AssetKind[], fn: (cart: Cart) => void): void;
  /** Replace the cart (undo, agent write, version restore). */
  replaceCart(cart: Cart): void;
  rename(name: string): void;
  open(id: string): Promise<void>;
  create(name?: string, cart?: Cart): Promise<string>;
  importP8(text: string, name: string): Promise<string>;
  save(label?: string): Promise<void>;
  exportP8(): string;
}

const ZERO: Revisions = { code: 0, gfx: 0, map: 0, flags: 0, sfx: 0, music: 0, label: 0 };

export const NEW_CART_CODE = `-- my new cart
-- ctrl+r to run, ctrl+s to save

function _init()
 x,y=64,64
 t=0
end

function _update60()
 t+=1
 if (btn(⬅️)) x-=1
 if (btn(➡️)) x+=1
 if (btn(⬆️)) y-=1
 if (btn(⬇️)) y+=1
end

function _draw()
 cls(1)
 circfill(x,y,6+sin(t/60),12)
 print("hello, pico workbench!",20,12,7)
end`;

const AUTOSAVE_MS = 1000;
const AUTO_VERSION_MS = 5 * 60 * 1000;
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastVersionAt = 0;

export const useProject = create<ProjectState>((set, get) => {
  const scheduleAutosave = () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      const auto = Date.now() - lastVersionAt > AUTO_VERSION_MS;
      void get().save(auto ? 'autosave' : undefined);
    }, AUTOSAVE_MS);
  };

  const bump = (kinds: (keyof Revisions)[]) => {
    const r = { ...get().revisions };
    for (const k of kinds) r[k]++;
    set({ revisions: r, dirty: true });
    scheduleAutosave();
  };

  return {
    id: null,
    name: '',
    cart: null,
    revisions: { ...ZERO },
    dirty: false,
    savedAt: null,
    loading: true,

    setCode(code) {
      const cart = get().cart;
      if (!cart || cart.code === code) return;
      cart.code = code;
      bump(['code']);
    },

    mutate(kind, fn) {
      const cart = get().cart;
      if (!cart) return;
      fn(cart);
      bump(Array.isArray(kind) ? kind : [kind]);
    },

    replaceCart(next) {
      const cur = get().cart;
      const cart = cloneCart(next);
      if (cur?.source) cart.source = cur.source;
      set({ cart });
      bump(['code', 'gfx', 'map', 'flags', 'sfx', 'music', 'label']);
    },

    rename(name) {
      set({ name, dirty: true });
      scheduleAutosave();
    },

    async open(id) {
      const rec = await getProject(id);
      if (!rec) throw new Error(`project ${id} not found`);
      const cart = parseP8(rec.p8);
      set({ id, name: rec.name, cart, revisions: { ...ZERO }, dirty: false, savedAt: rec.updatedAt, loading: false });
      saveSettings({ lastProjectId: id });
    },

    async create(name = 'untitled', cart) {
      const c = cart ?? createEmptyCart(NEW_CART_CODE);
      const now = Date.now();
      const rec: ProjectRecord = { id: newProjectId(), name, p8: serializeP8(c), createdAt: now, updatedAt: now, tokens: countTokens(c.code) };
      await putProject(rec);
      await get().open(rec.id);
      return rec.id;
    },

    async importP8(text, name) {
      const cart = parseP8(text);
      return get().create(name, cart);
    },

    async save(label) {
      const { id, name, cart } = get();
      if (!id || !cart) return;
      if (autosaveTimer) {
        clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      const p8 = serializeP8(cart);
      const prev = await getProject(id);
      const now = Date.now();
      await putProject({ id, name, p8, createdAt: prev?.createdAt ?? now, updatedAt: now, tokens: countTokens(cart.code) });
      if (label) {
        await addVersion(id, p8, label);
        lastVersionAt = now;
      }
      set({ dirty: false, savedAt: now });
    },

    exportP8() {
      const cart = get().cart;
      return cart ? serializeP8(cart) : '';
    },
  };
});

/** Opens the last project, seeding the sample on first run. */
export async function bootProjects(): Promise<void> {
  const store = useProject.getState();
  const projects = await listProjects();
  if (projects.length === 0) {
    await store.importP8(nebula, 'nebula strike');
    return;
  }
  const last = loadSettings().lastProjectId;
  const target = projects.find((p) => p.id === last) ?? projects[0]!;
  await store.open(target.id);
}

export const SAMPLE_P8 = nebula;
