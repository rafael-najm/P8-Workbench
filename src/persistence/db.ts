/**
 * Project storage in IndexedDB. Projects are stored as `.p8` text (the
 * canonical, lossless format); the last 50 versions of each are kept.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface ProjectRecord {
  id: string;
  name: string;
  p8: string;
  createdAt: number;
  updatedAt: number;
  /** Token count at last save (for the project list). */
  tokens?: number;
}

export interface VersionRecord {
  id?: number;
  projectId: string;
  p8: string;
  savedAt: number;
  label: string;
}

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectRecord; indexes: { updatedAt: number } };
  versions: { key: number; value: VersionRecord; indexes: { projectId: string } };
}

export const MAX_VERSIONS = 50;
const DB_NAME = 'pico-workbench';

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

export function db(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(DB_NAME, 1, {
    upgrade(d) {
      const projects = d.createObjectStore('projects', { keyPath: 'id' });
      projects.createIndex('updatedAt', 'updatedAt');
      const versions = d.createObjectStore('versions', { keyPath: 'id', autoIncrement: true });
      versions.createIndex('projectId', 'projectId');
    },
  });
  return dbPromise;
}

/** For tests: forget the cached connection. */
export function resetDbConnection(): void {
  dbPromise = null;
}

export function newProjectId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function listProjects(): Promise<ProjectRecord[]> {
  const all = await (await db()).getAll('projects');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectRecord | undefined> {
  return (await db()).get('projects', id);
}

export async function putProject(p: ProjectRecord): Promise<void> {
  await (await db()).put('projects', p);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['projects', 'versions'], 'readwrite');
  await tx.objectStore('projects').delete(id);
  const index = tx.objectStore('versions').index('projectId');
  for await (const cursor of index.iterate(id)) await cursor.delete();
  await tx.done;
}

export async function addVersion(projectId: string, p8: string, label: string): Promise<void> {
  const d = await db();
  const tx = d.transaction('versions', 'readwrite');
  await tx.store.add({ projectId, p8, label, savedAt: Date.now() });
  const keys = await tx.store.index('projectId').getAllKeys(projectId);
  // keys are auto-increment, so ascending = oldest first
  const excess = keys.length - MAX_VERSIONS;
  for (let i = 0; i < excess; i++) await tx.store.delete(keys[i]!);
  await tx.done;
}

export async function listVersions(projectId: string): Promise<VersionRecord[]> {
  const all = await (await db()).getAllFromIndex('versions', 'projectId', projectId);
  return all.sort((a, b) => b.savedAt - a.savedAt || (b.id ?? 0) - (a.id ?? 0));
}
