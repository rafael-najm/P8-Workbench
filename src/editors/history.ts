/**
 * Undo/redo for asset edits (spritesheet, map, flags, sfx, music). Each entry
 * is a snapshot taken *before* an operation; code has Monaco's own undo.
 */
import type { Cart, MusicPattern, Sfx } from '../cart/types';
import { useProject, type AssetKind } from '../store/project';

interface Snapshot {
  gfx: Uint8Array;
  map: Uint8Array;
  flags: Uint8Array;
  sfx: Sfx[];
  music: MusicPattern[];
  label: string;
}

const LIMIT = 100;
let undoStack: Snapshot[] = [];
let redoStack: Snapshot[] = [];
const listeners = new Set<() => void>();

function take(cart: Cart, label: string): Snapshot {
  return {
    gfx: cart.gfx.slice(),
    map: cart.map.slice(),
    flags: cart.flags.slice(),
    sfx: structuredClone(cart.sfx),
    music: structuredClone(cart.music),
    label,
  };
}

function restore(cart: Cart, s: Snapshot) {
  cart.gfx.set(s.gfx);
  cart.map.set(s.map);
  cart.flags.set(s.flags);
  cart.sfx = structuredClone(s.sfx);
  cart.music = structuredClone(s.music);
}

const ALL: AssetKind[] = ['gfx', 'map', 'flags', 'sfx', 'music'];

/** Call before a user operation (e.g. on pointerdown) to make it undoable. */
export function checkpoint(label: string): void {
  const cart = useProject.getState().cart;
  if (!cart) return;
  undoStack.push(take(cart, label));
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
  listeners.forEach((l) => l());
}

export function undo(): boolean {
  const cart = useProject.getState().cart;
  const s = undoStack.pop();
  if (!cart || !s) return false;
  redoStack.push(take(cart, s.label));
  useProject.getState().mutate(ALL, (c) => restore(c, s));
  listeners.forEach((l) => l());
  return true;
}

export function redo(): boolean {
  const cart = useProject.getState().cart;
  const s = redoStack.pop();
  if (!cart || !s) return false;
  undoStack.push(take(cart, s.label));
  useProject.getState().mutate(ALL, (c) => restore(c, s));
  listeners.forEach((l) => l());
  return true;
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
  listeners.forEach((l) => l());
}

export function onHistoryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Undo history belongs to one project.
useProject.subscribe((s, prev) => {
  if (s.id !== prev.id) clearHistory();
});
