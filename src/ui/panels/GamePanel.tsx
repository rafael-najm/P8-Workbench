import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings, saveSettings } from '../../persistence/settings';
import { useRuntime } from '../../store/runtime';
import { restartGame, runGame } from '../actions';
import { Icon } from '../components/Icon';
import { PixelText } from '../components/PixelText';
import { game } from '../game/controller';
import { revealLine } from '../../editors/code/CodeEditor';
import { registerPanel } from './registry';

const SPEEDS = [0.25, 0.5, 1, 2, 4];
const SCALES: (number | 'fit')[] = ['fit', 2, 3, 4, 5, 6, 8];

function GameScreen() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 256, h: 256 });
  const [prefs, setPrefs] = useState(() => loadSettings());
  const status = useRuntime((s) => s.status);
  const focused = useRuntime((s) => s.focused);
  const error = useRuntime((s) => s.error);
  const stopMessage = useRuntime((s) => s.stopMessage);
  const menuItems = useRuntime((s) => s.menuItems);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuSel, setMenuSel] = useState(0);

  useEffect(() => {
    game.attachCanvas(canvasRef.current);
    return () => game.attachCanvas(null);
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onSettings = () => setPrefs(loadSettings());
    window.addEventListener('p8-settings', onSettings);
    return () => window.removeEventListener('p8-settings', onSettings);
  }, []);

  // Focus follows clicks: inside the screen = game gets the keyboard.
  useEffect(() => {
    const onDown = (e: Event) => {
      if (!wrapRef.current?.contains(e.target as Node)) game.setFocused(false);
    };
    window.addEventListener('mousedown', onDown, true);
    // Any other element taking focus (editor, palette, inputs) releases the game keys.
    window.addEventListener('focusin', onDown, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('focusin', onDown, true);
    };
  }, []);

  // PICO-8 pause menu (Enter / P while focused)
  const items = [{ label: 'continue', run: () => game.resume() }, ...menuItems.flatMap((m, i) => (m ? [{ label: m, run: () => game.callMenuItem(i + 1) }] : [])), { label: 'reset cart', run: () => void restartGame() }];
  const openMenu = useCallback(() => {
    if (useRuntime.getState().status !== 'running' && useRuntime.getState().status !== 'paused') return;
    game.pause();
    setMenuSel(0);
    setMenuOpen(true);
  }, []);
  useEffect(() => {
    window.addEventListener('p8-pause-menu', openMenu);
    return () => window.removeEventListener('p8-pause-menu', openMenu);
  }, [openMenu]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (!useRuntime.getState().focused) return;
      if (e.code === 'ArrowDown') setMenuSel((s) => (s + 1) % items.length);
      else if (e.code === 'ArrowUp') setMenuSel((s) => (s - 1 + items.length) % items.length);
      else if (['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyN', 'KeyM', 'Enter', 'KeyP'].includes(e.code)) {
        setMenuOpen(false);
        items[menuSel]?.run();
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  useEffect(() => {
    if (status !== 'paused') setMenuOpen(false);
  }, [status]);

  const scale = prefs.gameScale === 'fit' ? Math.max(1, Math.floor(Math.min(box.w - 16, box.h - 16) / 128)) : prefs.gameScale;
  const size = 128 * scale;

  return (
    <div ref={wrapRef} className="relative grid h-full min-h-0 place-items-center overflow-hidden bg-[#03050a]" data-testid="game-screen">
      <div
        className={`relative ${prefs.crt ? 'crt' : ''} ${focused ? 'outline outline-1 outline-offset-4 outline-p8-blue' : ''}`}
        style={{ width: size, height: size }}
        onMouseDown={() => game.setFocused(true)}
      >
        <canvas ref={canvasRef} width={128} height={128} className="pixelated block h-full w-full bg-black" data-testid="game-canvas" />
        {status === 'idle' && (
          <button className="absolute inset-0 grid place-items-center bg-black/70 animate-fade" onClick={() => void runGame()}>
            <div className="flex flex-col items-center gap-3">
              <div className="grid h-12 w-12 place-items-center border-2 border-p8-pink bg-p8-purple shadow-[var(--shadow-hard)]">
                <Icon name="play" size={24} className="text-p8-white" />
              </div>
              <PixelText text="run cart" scale={2} color="#c2c3c7" />
              <span className="kbd">Ctrl R</span>
            </div>
          </button>
        )}
        {status === 'running' && !focused && !menuOpen && (
          <div className="pointer-events-none absolute right-1 bottom-1 bg-black/70 px-1.5 py-0.5 text-[10px] text-p8-grey animate-fade">click to play · ⬅️➡️⬆️⬇️ z x</div>
        )}
        {menuOpen && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <div className="min-w-[55%] border-2 border-p8-white bg-black px-4 py-3" style={{ imageRendering: 'pixelated' }}>
              {items.map((it, i) => (
                <button
                  key={it.label + i}
                  className="flex w-full items-center gap-2 py-1 text-left"
                  onMouseEnter={() => setMenuSel(i)}
                  onClick={() => {
                    setMenuOpen(false);
                    it.run();
                  }}
                >
                  <span className="w-3">{i === menuSel && <PixelText text="▶" scale={Math.max(1, scale - 1)} color="#fff1e8" />}</span>
                  <PixelText text={it.label} scale={Math.max(1, scale - 1)} color={i === menuSel ? '#fff1e8' : '#c2c3c7'} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {status === 'error' && error && (
        <div className="absolute inset-x-2 bottom-2 border border-p8-red bg-[#1a0610]/95 p-2 text-[12px] shadow-[var(--shadow-hard)] animate-slide-up">
          <div className="mb-1 flex items-center gap-2 text-p8-red">
            <b>{error.kind === 'compile' ? 'syntax error' : error.kind === 'timeout' ? 'timeout' : 'runtime error'}</b>
            {error.line && (
              <button className="underline decoration-dotted hover:text-p8-pink" onClick={() => revealLine(error.line!)}>
                line {error.line}
              </button>
            )}
            <div className="flex-1" />
            <button className="btn h-6" onClick={() => void restartGame()}>
              <Icon name="restart" size={10} /> restart
            </button>
          </div>
          <div className="break-words text-p8-peach">{error.message}</div>
        </div>
      )}
      {status === 'stopped' && stopMessage && (
        <div className="absolute inset-x-2 bottom-2 border border-line2 bg-panel2 p-2 text-[12px]">stopped: {stopMessage}</div>
      )}
    </div>
  );
}

function Toolbar() {
  const status = useRuntime((s) => s.status);
  const fps = useRuntime((s) => s.fps);
  const target = useRuntime((s) => s.targetFps);
  const frame = useRuntime((s) => s.frame);
  const speed = useRuntime((s) => s.speed);
  const [prefs, setPrefs] = useState(() => loadSettings());
  const running = status === 'running';
  const active = status === 'running' || status === 'paused';

  const setScale = (v: string) => {
    setPrefs(saveSettings({ gameScale: v === 'fit' ? 'fit' : Number(v) }));
    window.dispatchEvent(new Event('p8-settings'));
  };
  const toggleCrt = () => {
    setPrefs(saveSettings({ crt: !prefs.crt }));
    window.dispatchEvent(new Event('p8-settings'));
  };

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
      <button className="btn-ghost" title={running ? 'Pause (F5)' : 'Play (F5)'} onClick={() => (active ? game.togglePause() : void runGame())} data-testid="play-pause">
        <Icon name={running ? 'pause' : 'play'} size={14} />
      </button>
      <button className="btn-ghost" title="Step 1 frame (F6)" disabled={!active} onClick={() => game.step(1)}>
        <Icon name="step" size={14} />
      </button>
      <button className="btn-ghost text-[10px]" title="Step 10 frames" disabled={!active} onClick={() => game.step(10)}>
        +10
      </button>
      <button className="btn-ghost" title="Restart (Ctrl+Enter)" onClick={() => void restartGame()}>
        <Icon name="restart" size={14} />
      </button>
      <div className="mx-1 h-4 w-px bg-line" />
      <select className="input h-6 px-1 text-[11px]" value={speed} onChange={(e) => game.setSpeed(Number(e.target.value))} title="Speed">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
      <select className="input h-6 px-1 text-[11px]" value={String(prefs.gameScale)} onChange={(e) => setScale(e.target.value)} title="Scale">
        {SCALES.map((s) => (
          <option key={s} value={String(s)}>
            {s === 'fit' ? 'fit' : `${s}x`}
          </option>
        ))}
      </select>
      <button className="btn-ghost text-[10px]" data-active={prefs.crt} onClick={toggleCrt} title="CRT effect">
        CRT
      </button>
      <div className="flex-1" />
      <div className="text-right text-[10px] leading-tight text-muted tabular-nums">
        <div>
          <span className={active && fps < target - 3 && running ? 'text-p8-orange' : 'text-ink'}>{running ? fps : '--'}</span>/{target} fps
        </div>
        <div>frame {frame}</div>
      </div>
    </div>
  );
}

type GlobalsMap = Record<string, unknown>;

function formatValue(v: unknown): string {
  if (typeof v === 'string') return v.startsWith('[') ? v : JSON.stringify(v);
  return JSON.stringify(v);
}

function Inspector() {
  const [open, setOpen] = useState(false);
  const [globals, setGlobals] = useState<GlobalsMap>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const status = useRuntime((s) => s.status);
  const paused = status === 'paused' || status === 'stopped' || status === 'error';

  useEffect(() => {
    if (!open) return;
    const read = () => {
      const m = game.current;
      if (m && m.status !== 'empty') setGlobals(m.globals(undefined, 1, 12));
    };
    read();
    const id = setInterval(read, 250);
    return () => clearInterval(id);
  }, [open, status]);

  const commit = (name: string, value: string) => {
    setEditing(null);
    const m = game.current;
    if (!m) return;
    const r = m.eval(`${name}=${value}`);
    if (!r.ok) alert(r.error.message);
    setGlobals(m.globals(undefined, 1, 12));
    game.render();
  };

  const entries = Object.entries(globals).filter(([k]) => !filter || k.includes(filter));

  return (
    <div className={`flex min-h-0 flex-col border-t border-line ${open ? 'h-[40%]' : ''}`}>
      <button className="flex h-7 shrink-0 items-center gap-2 px-2 text-left hover:bg-panel2" onClick={() => setOpen(!open)}>
        <Icon name="eye" size={12} className="text-p8-blue" />
        <span className="label">globals</span>
        <span className="text-[10px] text-dim">{open ? `${Object.keys(globals).length} · ${paused ? 'click a value to edit' : 'pause to edit'}` : ''}</span>
        <div className="flex-1" />
        <span className="text-dim">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <input className="input mx-2 mb-1 h-6 shrink-0" placeholder="filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 text-[11px]" data-testid="inspector">
            {entries.length === 0 && <div className="py-2 text-dim">{game.current ? 'no user globals yet' : 'run the cart to inspect globals'}</div>}
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 border-b border-line/50 py-0.5">
                <span className="w-28 shrink-0 truncate text-p8-blue" title={k}>
                  {k}
                </span>
                {editing === k ? (
                  <input
                    autoFocus
                    className="input h-5 flex-1"
                    defaultValue={typeof v === 'object' ? '' : formatValue(v)}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(k, (e.target as HTMLInputElement).value);
                      if (e.key === 'Escape') setEditing(null);
                      e.stopPropagation();
                    }}
                  />
                ) : (
                  <button
                    className={`min-w-0 flex-1 truncate text-left ${paused ? 'hover:text-p8-yellow' : 'cursor-default'} ${typeof v === 'number' ? 'text-p8-yellow' : typeof v === 'string' ? 'text-p8-green' : 'text-ink'}`}
                    title={JSON.stringify(v, null, 1)}
                    onClick={() => paused && setEditing(k)}
                  >
                    {formatValue(v)}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function GamePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Toolbar />
      <div className="min-h-0 flex-1">
        <GameScreen />
      </div>
      <Inspector />
    </div>
  );
}

registerPanel({ id: 'game', title: 'game', icon: 'game', shortcut: 'Ctrl+1', component: GamePanel });
