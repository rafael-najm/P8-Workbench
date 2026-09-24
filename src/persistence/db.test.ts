import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { addVersion, deleteProject, getProject, listProjects, listVersions, MAX_VERSIONS, putProject } from './db';

describe('project db', () => {
  it('stores, lists (newest first) and deletes projects with their versions', async () => {
    await putProject({ id: 'a', name: 'A', p8: 'x', createdAt: 1, updatedAt: 1 });
    await putProject({ id: 'b', name: 'B', p8: 'y', createdAt: 2, updatedAt: 5 });
    expect((await listProjects()).map((p) => p.id)).toEqual(['b', 'a']);
    await addVersion('a', 'v1', 'save');
    await deleteProject('a');
    expect(await getProject('a')).toBeUndefined();
    expect(await listVersions('a')).toEqual([]);
  });

  it(`keeps only the last ${MAX_VERSIONS} versions`, async () => {
    for (let i = 0; i < MAX_VERSIONS + 5; i++) await addVersion('c', `v${i}`, 'auto');
    const versions = await listVersions('c');
    expect(versions).toHaveLength(MAX_VERSIONS);
    expect(versions[0]!.p8).toBe(`v${MAX_VERSIONS + 4}`);
    expect(versions.at(-1)!.p8).toBe('v5');
  });
});
