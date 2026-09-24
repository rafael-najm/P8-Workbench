import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { CodeEditor, editorRef } from '../../editors/code/CodeEditor';
import { showRuntimeError } from '../../editors/code/diagnostics';
import { useProject, type AssetKind, type Revisions } from '../../store/project';
import { PANEL_IDS, useUi, type PanelId } from '../../store/ui';
import { importFiles } from '../actions';
import { handleShortcut } from '../commands';
import { game } from '../game/controller';
import { PANELS } from '../panels/registry';
import { CommandPalette } from './CommandPalette';
import { PanelFrame } from './PanelFrame';
import { SettingsDialog } from './SettingsDialog';
import { Toasts } from './Toasts';
import { TopBar } from './TopBar';

function Dock({ side, ids }: { side: 'left' | 'right'; ids: PanelId[] }) {
  const panels = useUi((s) => s.panels);
  const width = Math.max(...ids.map((id) => panels[id].w));
  const start = useRef<{ x: number; w: number } | null>(null);

  const onDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const w = Math.max(260, Math.min(window.innerWidth * 0.7, start.current.w + (side === 'left' ? dx : -dx)));
    for (const id of ids) useUi.getState().setRect(id, { w });
  };

  const splitter = (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (start.current = null)}
      className="w-1 shrink-0 cursor-col-resize bg-line transition-colors duration-150 hover:bg-p8-blue"
    />
  );
  return (
    <>
      {side === 'right' && splitter}
      <aside className="flex min-h-0 shrink-0 flex-col gap-1 bg-bg p-1" style={{ width }}>
        {ids.map((id) => {
          const Comp = PANELS.get(id)!.component;
          return (
            <PanelFrame key={id} id={id}>
              <Comp />
            </PanelFrame>
          );
        })}
      </aside>
      {side === 'left' && splitter}
    </>
  );
}

function DropZone() {
  const [over, setOver] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setOver(true);
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      if (e.dataTransfer?.files.length) void importFiles(e.dataTransfer.files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', overFn);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('drop', drop);
    };
  }, []);
  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-3 z-[150] grid place-items-center border-2 border-dashed border-p8-pink bg-black/60 animate-fade">
      <div className="text-[16px] text-p8-pink">drop .p8 carts to import</div>
    </div>
  );
}

/** Keeps the running game in sync with sprite/map/sfx edits. */
function useAssetSync() {
  useEffect(() => {
    let prev: Revisions = useProject.getState().revisions;
    return useProject.subscribe((s) => {
      const changed = (['gfx', 'map', 'flags', 'sfx', 'music'] as AssetKind[]).filter((k) => s.revisions[k as keyof Revisions] !== prev[k as keyof Revisions]);
      prev = s.revisions;
      if (changed.length && s.cart) game.syncAssets(s.cart, changed);
    });
  }, []);
}

export function Workspace() {
  const panels = useUi((s) => s.panels);
  useAssetSync();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleShortcut(e);
    window.addEventListener('keydown', onKey, true);
    game.onError = (err) => editorRef.current && showRuntimeError(editorRef.current, err);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useProject.getState().dirty) {
        void useProject.getState().save();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  const visible = PANEL_IDS.filter((id) => panels[id].open && PANELS.has(id));
  const left = visible.filter((id) => panels[id].dock === 'left');
  const right = visible.filter((id) => panels[id].dock === 'right');
  const floating = visible.filter((id) => panels[id].dock === 'float');

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        {left.length > 0 && <Dock side="left" ids={left} />}
        <main className="min-w-0 flex-1 bg-bg2">
          <CodeEditor />
        </main>
        {right.length > 0 && <Dock side="right" ids={right} />}
      </div>
      {floating.map((id) => {
        const Comp = PANELS.get(id)!.component;
        return (
          <PanelFrame key={id} id={id}>
            <Comp />
          </PanelFrame>
        );
      })}
      <CommandPalette />
      <SettingsDialog />
      <Toasts />
      <DropZone />
    </div>
  );
}
