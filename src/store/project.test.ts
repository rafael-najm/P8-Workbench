import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { serializeP8 } from '../cart/p8format';
import { listProjects, listVersions } from '../persistence/db';
import { bootProjects, SAMPLE_P8, useProject } from './project';

describe('project store', () => {
  it('seeds the sample on first boot and round-trips it unchanged', async () => {
    await bootProjects();
    const s = useProject.getState();
    expect(s.name).toBe('nebula strike');
    expect(serializeP8(s.cart!)).toBe(SAMPLE_P8);
    expect((await listProjects()).length).toBe(1);
  });

  it('tracks code/asset revisions and saves versions', async () => {
    const id = await useProject.getState().create('test');
    const before = useProject.getState().revisions.code;
    useProject.getState().setCode('x=1');
    expect(useProject.getState().revisions.code).toBe(before + 1);
    expect(useProject.getState().dirty).toBe(true);
    useProject.getState().mutate('gfx', (c) => (c.gfx[0] = 7));
    expect(useProject.getState().revisions.gfx).toBe(1);
    await useProject.getState().save('manual');
    expect(useProject.getState().dirty).toBe(false);
    const versions = await listVersions(id);
    expect(versions[0]?.label).toBe('manual');
    expect(versions[0]?.p8).toContain('x=1');
  });

  it('imports .p8 text as a new project', async () => {
    const id = await useProject.getState().importP8('pico-8 cartridge // http://www.pico-8.com\nversion 42\n__lua__\nprint(1)\n', 'imp');
    expect(useProject.getState().id).toBe(id);
    expect(useProject.getState().cart?.code).toBe('print(1)');
  });
});
