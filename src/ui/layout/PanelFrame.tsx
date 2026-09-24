/** A workspace panel: floating (draggable/resizable) or docked left/right. */
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useUi, type PanelId } from '../../store/ui';
import { Icon } from '../components/Icon';
import { PixelText } from '../components/PixelText';
import { PANELS } from '../panels/registry';

const MIN_W = 260;
const MIN_H = 160;

export function PanelFrame({ id, children }: { id: PanelId; children: ReactNode }) {
  const state = useUi((s) => s.panels[id]);
  const { focus, setRect, setDock, close } = useUi.getState();
  const def = PANELS.get(id);
  const drag = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; x: number; y: number; w: number; h: number } | null>(null);
  const floating = state.dock === 'float';

  const onPointerDown = (mode: 'move' | 'resize') => (e: ReactPointerEvent) => {
    if (!floating || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, x: state.x, y: state.y, w: state.w, h: state.h };
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (d.mode === 'move') {
      setRect(id, {
        x: Math.max(-d.w + 80, Math.min(window.innerWidth - 80, d.x + dx)),
        y: Math.max(36, Math.min(window.innerHeight - 40, d.y + dy)),
      });
    } else {
      setRect(id, { w: Math.max(MIN_W, d.w + dx), h: Math.max(MIN_H, d.h + dy) });
    }
  };
  const onPointerUp = () => (drag.current = null);

  const style = floating
    ? { left: state.x, top: state.y, width: state.w, height: state.h, zIndex: 20 + state.z }
    : undefined;

  return (
    <section
      data-panel={id}
      onPointerDownCapture={() => focus(id)}
      style={style}
      className={`flex min-h-0 flex-col border border-line bg-panel animate-pop ${
        floating ? 'fixed shadow-[var(--shadow-hard-lg)]' : 'relative min-h-[120px] flex-1'
      }`}
    >
      <header
        onPointerDown={onPointerDown('move')}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setDock(id, floating ? 'right' : 'float')}
        className={`flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel2 pr-1 pl-2 select-none ${floating ? 'cursor-grab active:cursor-grabbing' : ''}`}
      >
        {def && <Icon name={def.icon} size={14} className="text-p8-blue" />}
        <PixelText text={def?.title ?? id} scale={2} color="#c2c3c7" />
        <div className="flex-1" />
        {def?.shortcut && <span className="kbd mr-1 hidden md:inline-flex">{def.shortcut}</span>}
        <button className="btn-ghost" title="Dock left" data-active={state.dock === 'left'} onClick={() => setDock(id, 'left')}>
          <Icon name="dockLeft" size={12} />
        </button>
        <button className="btn-ghost" title="Float" data-active={state.dock === 'float'} onClick={() => setDock(id, 'float')}>
          <Icon name="float" size={12} />
        </button>
        <button className="btn-ghost" title="Dock right" data-active={state.dock === 'right'} onClick={() => setDock(id, 'right')}>
          <Icon name="dockRight" size={12} />
        </button>
        <button className="btn-ghost hover:!text-p8-red" title="Close (Esc)" onClick={() => close(id)}>
          <Icon name="close" size={12} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {floating && (
        <div
          onPointerDown={onPointerDown('resize')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          className="absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
          style={{ background: 'linear-gradient(135deg, transparent 50%, #2e3852 50%)' }}
        />
      )}
    </section>
  );
}
