import { useEffect, useState } from 'react';
import { parseP8 } from '../../cart/p8format';
import { deleteProject, listProjects, listVersions, type ProjectRecord, type VersionRecord } from '../../persistence/db';
import { SAMPLE_P8, useProject } from '../../store/project';
import { toast } from '../../store/toast';
import { useUi } from '../../store/ui';
import { exportCart, newProject, pickAndImport } from '../actions';
import { Icon } from '../components/Icon';
import { game } from '../game/controller';
import { registerPanel } from './registry';

function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export function ProjectsPanel() {
  const currentId = useProject((s) => s.id);
  const savedAt = useProject((s) => s.savedAt);
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [tab, setTab] = useState<'projects' | 'history'>('projects');

  useEffect(() => {
    void listProjects().then(setProjects);
    if (currentId) void listVersions(currentId).then(setVersions);
  }, [currentId, savedAt]);

  const open = async (id: string) => {
    await useProject.getState().open(id);
    game.stop();
    useUi.getState().close('projects');
  };

  const remove = async (p: ProjectRecord) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await deleteProject(p.id);
    const rest = await listProjects();
    setProjects(rest);
    if (p.id === currentId) {
      if (rest[0]) await open(rest[0].id);
      else await useProject.getState().importP8(SAMPLE_P8, 'nebula strike');
    }
  };

  const restore = async (v: VersionRecord) => {
    if (!confirm(`Restore the version from ${new Date(v.savedAt).toLocaleString()}? The current state is saved as a version first.`)) return;
    await useProject.getState().save('before restore');
    useProject.getState().replaceCart(parseP8(v.p8));
    await useProject.getState().save('restored');
    toast('version restored', 'success');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
        <button className="btn-ghost text-[12px]" data-active={tab === 'projects'} onClick={() => setTab('projects')}>
          <Icon name="folder" size={12} /> carts
        </button>
        <button className="btn-ghost text-[12px]" data-active={tab === 'history'} onClick={() => setTab('history')}>
          <Icon name="history" size={12} /> history ({versions.length})
        </button>
        <div className="flex-1" />
        <button className="btn h-6" onClick={() => void newProject()}>
          <Icon name="plus" size={10} /> new
        </button>
        <button className="btn h-6" onClick={pickAndImport} title="Or drop .p8 files anywhere">
          <Icon name="upload" size={10} /> import
        </button>
        <button className="btn h-6" onClick={exportCart}>
          <Icon name="download" size={10} /> export
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'projects' && projects === null && <div className="p-4 text-dim">loading…</div>}
        {tab === 'projects' &&
          projects?.map((p) => (
            <div key={p.id} className={`group flex items-center gap-3 border-b border-line/60 px-3 py-2 ${p.id === currentId ? 'bg-p8-darkblue/40' : 'hover:bg-panel2'}`}>
              <button className="min-w-0 flex-1 text-left" onClick={() => void open(p.id)}>
                <div className="truncate text-[13px] text-ink">
                  {p.name}
                  {p.id === currentId && <span className="ml-2 text-[10px] text-p8-blue">open</span>}
                </div>
                <div className="text-[11px] text-dim">
                  {p.tokens ?? '?'} tokens · {timeAgo(p.updatedAt)}
                </div>
              </button>
              <button className="btn-ghost opacity-0 group-hover:opacity-100 hover:!text-p8-red" title="Delete" onClick={() => void remove(p)}>
                <Icon name="trash" size={12} />
              </button>
            </div>
          ))}
        {tab === 'history' && versions.length === 0 && <div className="p-4 text-dim">No versions yet. Every Ctrl+S (and an autosave every few minutes) keeps a version; the last 50 are kept.</div>}
        {tab === 'history' &&
          versions.map((v) => (
            <div key={v.id} className="flex items-center gap-3 border-b border-line/60 px-3 py-1.5 hover:bg-panel2">
              <div className="flex-1">
                <div className="text-[12px]">{new Date(v.savedAt).toLocaleString()}</div>
                <div className="text-[10px] text-dim">{v.label}</div>
              </div>
              <button className="btn h-6" onClick={() => void restore(v)}>
                <Icon name="undo" size={10} /> restore
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

registerPanel({ id: 'projects', title: 'projects', icon: 'folder', shortcut: 'Ctrl+O', component: ProjectsPanel });
