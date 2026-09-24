import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { setMapTile } from '../cart/cart';
import { useProject } from '../store/project';
import { canRedo, canUndo, checkpoint, clearHistory, redo, undo } from './history';

describe('asset history', () => {
  beforeAll(async () => {
    await useProject.getState().create('hist');
    clearHistory();
  });

  it('undoes and redoes sprite, map and flag edits', () => {
    const cart = () => useProject.getState().cart!;
    checkpoint('draw');
    useProject.getState().mutate(['gfx', 'map', 'flags'], (c) => {
      c.gfx[0] = 9;
      setMapTile(c, 1, 1, 42);
      c.flags[3] = 5;
    });
    expect(canUndo()).toBe(true);
    const rev = useProject.getState().revisions.gfx;
    expect(undo()).toBe(true);
    expect([cart().gfx[0], cart().map[129], cart().flags[3]]).toEqual([0, 0, 0]);
    expect(useProject.getState().revisions.gfx).toBeGreaterThan(rev);
    expect(canRedo()).toBe(true);
    redo();
    expect([cart().gfx[0], cart().map[129], cart().flags[3]]).toEqual([9, 42, 5]);
  });

  it('a new checkpoint clears the redo stack', () => {
    undo();
    checkpoint('other');
    expect(canRedo()).toBe(false);
  });
});
