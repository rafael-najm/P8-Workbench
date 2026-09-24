/** Shared state of the sprite/map editors (also reported to the agent). */
import { create } from 'zustand';

export type SpriteTool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rect' | 'rectfill' | 'circ' | 'circfill' | 'select' | 'picker';
export type MapTool = 'pencil' | 'rect' | 'fill' | 'select' | 'picker' | 'eraser';

export interface Selection {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface EditorState {
  /** Selected sprite (top-left of the selection block). */
  sprite: number;
  /** Block size in sprites: 1 (8x8), 2 (16x16), 4 (32x32). */
  spriteSize: 1 | 2 | 4;
  tab: number;
  tool: SpriteTool;
  brush: number;
  color: number;
  color2: number;
  /** Pixel selection inside the edited block (block-relative coordinates). */
  selection: Selection | null;
  anim: { from: number; to: number; fps: number; playing: boolean };
  mapTool: MapTool;
  /** Tile brush for the map: w x h sprites starting at `sprite`. */
  mapSelection: Selection | null;
  set(patch: Partial<Omit<EditorState, 'set'>>): void;
}

export const useEditor = create<EditorState>((set) => ({
  sprite: 1,
  spriteSize: 1,
  tab: 0,
  tool: 'pencil',
  brush: 1,
  color: 7,
  color2: 0,
  selection: null,
  anim: { from: 1, to: 4, fps: 8, playing: false },
  mapTool: 'pencil',
  mapSelection: null,
  set: (patch) => set(patch),
}));
