import { useState } from 'react';
import { useProject } from '../../store/project';
import { useRuntime } from '../../store/runtime';
import { PANEL_IDS, useUi } from '../../store/ui';
import { restartGame, runGame, saveProject } from '../actions';
import { Icon } from '../components/Icon';
import { PixelText } from '../components/PixelText';
import { game } from '../game/controller';
import { PANELS } from '../panels/registry';
import { TokenMeter } from './TokenMeter';

export function TopBar() {
  const name = useProject((s) => s.name);
  const dirty = useProject((s) => s.dirty);
  const status = useRuntime((s) => s.status);
  const panels = useUi((s) => s.panels);
  const [editing, setEditing] = useState(false);
  const running = status === 'running' || status === 'paused';

  return (
    <header className="relative z-40 flex h-11 shrink-0 items-center gap-3 border-b border-line bg-bg2 px-3">
      <button className="flex items-center gap-2" onClick={() => window.dispatchEvent(new Event('p8-home'))} title="Home">
        <div className="grid h-6 w-6 place-items-center border border-p8-pink bg-p8-purple shadow-[var(--shadow-hard)]">
          <Icon name="game" size={14} className="text-p8-white" />
        </div>
        <PixelText text="pico workbench" scale={2} color="#ff77a8" shadow="#1d2b53" className="hidden sm:inline-block" />
      </button>
      <div className="h-5 w-px bg-line" />
      {editing ? (
        <input
          autoFocus
          className="input w-44"
          defaultValue={name}
          onBlur={(e) => {
            useProject.getState().rename(e.target.value.trim() || 'untitled');
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button className="max-w-52 truncate text-[13px] text-ink hover:text-p8-blue" onClick={() => setEditing(true)} title="Rename">
          {name || 'untitled'}
          <span className={`ml-1.5 inline-block h-1.5 w-1.5 align-middle transition-colors ${dirty ? 'bg-p8-orange' : 'bg-p8-green/60'}`} title={dirty ? 'unsaved changes' : 'saved'} />
        </button>
      )}
      <div className="h-5 w-px bg-line" />
      <TokenMeter />
      <div className="flex-1" />
      <nav className="flex items-center gap-0.5" aria-label="Panels">
        {PANEL_IDS.map((id) => {
          const def = PANELS.get(id);
          if (!def || id === 'projects') return null;
          return (
            <button
              key={id}
              className="btn-ghost"
              data-active={panels[id].open}
              title={`${def.title}${def.shortcut ? ` (${def.shortcut})` : ''}`}
              onClick={() => useUi.getState().toggle(id)}
            >
              <Icon name={def.icon} size={16} />
            </button>
          );
        })}
      </nav>
      <div className="h-5 w-px bg-line" />
      <button className="btn-ghost" title="Save (Ctrl+S)" onClick={() => void saveProject()}>
        <Icon name="save" size={16} />
      </button>
      <button className="btn-ghost" title="Command palette (Ctrl+K)" onClick={() => useUi.getState().setPalette(true)}>
        <Icon name="search" size={16} />
      </button>
      <button className="btn-ghost" title="Settings" onClick={() => useUi.getState().setSettings(true)}>
        <Icon name="settings" size={16} />
      </button>
      {running && (
        <button className="btn" onClick={() => game.stop()} title="Stop">
          <Icon name="stop" size={12} />
        </button>
      )}
      <button className="btn btn-primary" onClick={(e) => (e.shiftKey ? void restartGame() : void runGame())} title="Run (Ctrl+R) · Shift: restart (Ctrl+Enter)" data-testid="run-button">
        <Icon name={running ? 'restart' : 'play'} size={12} />
        {running ? 'Reload' : 'Run'}
        <span className="kbd ml-1 border-p8-pink/50 bg-transparent text-p8-peach">Ctrl R</span>
      </button>
    </header>
  );
}
