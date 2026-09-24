import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { SfxNote } from '../../cart/types';
import { pitchName } from '../../runtime/audio/notes';
import { FX_NAMES, WAVE_NAMES } from '../../runtime/audio/synth';
import { PALETTE_HEX } from '../../runtime/palette';
import { useEditor } from '../../store/editor';
import { useProject } from '../../store/project';
import { Icon } from '../../ui/components/Icon';
import { registerPanel } from '../../ui/panels/registry';
import { checkpoint, redo, undo } from '../history';
import { onPlayback, playSfx, stopPlayback } from './playback';

/** Waveform colors, like PICO-8's instrument colors. */
export const WAVE_COLORS = [PALETTE_HEX[12], PALETTE_HEX[14], PALETTE_HEX[9], PALETTE_HEX[11], PALETTE_HEX[10], PALETTE_HEX[13], PALETTE_HEX[6], PALETTE_HEX[15]];

const PIANO = 'zsxdcvgbhnjmq2w3er5t6y7ui9o0p';
type Col = 'pitch' | 'wave' | 'vol' | 'fx';
const COLS: Col[] = ['pitch', 'wave', 'vol', 'fx'];

function isEmpty(notes: SfxNote[]) {
  return notes.every((n) => n.volume === 0);
}

export function SfxPanel() {
  const cart = useProject((s) => s.cart);
  useProject((s) => s.revisions.sfx);
  const ed = useEditor();
  const [mode, setMode] = useState<'tracker' | 'graph'>('tracker');
  const [cursor, setCursor] = useState({ row: 0, col: 'pitch' as Col });
  const [octave, setOctave] = useState(2);
  const [inst, setInst] = useState({ wave: 0, vol: 5, fx: 0 });
  const [playing, setPlaying] = useState<{ sfx: number; note: number } | null>(null);
  useEffect(() => onPlayback((s) => setPlaying(s && s.sfx >= 0 ? s : null)), []);

  if (!cart) return null;
  const n = ed.sfx;
  const sfx = cart.sfx[n]!;

  const edit = (fn: (notes: SfxNote[]) => void, label = 'sfx edit') => {
    checkpoint(label);
    useProject.getState().mutate('sfx', (c) => fn(c.sfx[n]!.notes));
  };
  const setHeader = (patch: Partial<Pick<typeof sfx, 'speed' | 'loopStart' | 'loopEnd'>>) => {
    checkpoint('sfx header');
    useProject.getState().mutate('sfx', (c) => Object.assign(c.sfx[n]!, patch));
  };
  const toggle = () => (playing ? stopPlayback() : playSfx(cart, n));

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (ctrl && key === 'z') e.shiftKey ? redo() : undo();
    else if (ctrl && key === 'y') redo();
    else if (e.key === ' ') toggle();
    else if (e.key === 'ArrowDown') setCursor((c) => ({ ...c, row: Math.min(31, c.row + 1) }));
    else if (e.key === 'ArrowUp') setCursor((c) => ({ ...c, row: Math.max(0, c.row - 1) }));
    else if (e.key === 'ArrowRight' || e.key === 'Tab') setCursor((c) => ({ ...c, col: COLS[(COLS.indexOf(c.col) + 1) % 4]! }));
    else if (e.key === 'ArrowLeft') setCursor((c) => ({ ...c, col: COLS[(COLS.indexOf(c.col) + 3) % 4]! }));
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      edit((notes) => (notes[cursor.row] = { ...notes[cursor.row]!, volume: 0 }));
      setCursor((c) => ({ ...c, row: Math.min(31, c.row + 1) }));
    } else if (e.key === '-' || e.key === '_') setOctave((o) => Math.max(0, o - 1));
    else if (e.key === '=' || e.key === '+') setOctave((o) => Math.min(4, o + 1));
    else if (cursor.col !== 'pitch' && /^[0-7]$/.test(e.key)) {
      const v = Number(e.key);
      const field = cursor.col === 'wave' ? 'waveform' : cursor.col === 'vol' ? 'volume' : 'effect';
      edit((notes) => (notes[cursor.row] = { ...notes[cursor.row]!, [field]: v }));
      setCursor((c) => ({ ...c, row: Math.min(31, c.row + 1) }));
    } else if (cursor.col === 'pitch' && !ctrl && PIANO.includes(key)) {
      const pitch = Math.min(63, octave * 12 + PIANO.indexOf(key));
      edit((notes) => (notes[cursor.row] = { pitch, waveform: inst.wave, volume: inst.vol, effect: inst.fx, customInstrument: false }));
      setCursor((c) => ({ ...c, row: Math.min(31, c.row + 1) }));
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="flex h-full min-h-0 outline-none" tabIndex={0} onKeyDown={onKeyDown} data-testid="sfx-editor">
      <SfxList current={n} onSelect={(i) => ed.set({ sfx: i })} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 flex-wrap items-center gap-2 border-b border-line px-2 text-[11px]">
          <span className="text-p8-yellow">sfx {n}</span>
          <button className="btn h-6" onClick={toggle} data-testid="sfx-play">
            <Icon name={playing ? 'stop' : 'play'} size={10} /> {playing ? 'stop' : 'play'}
          </button>
          <Num label="spd" value={sfx.speed} min={1} max={255} onChange={(v) => setHeader({ speed: v })} />
          <Num label="loop" value={sfx.loopStart} min={0} max={31} onChange={(v) => setHeader({ loopStart: v })} />
          <Num label="end" value={sfx.loopEnd} min={0} max={32} onChange={(v) => setHeader({ loopEnd: v })} />
          <div className="flex-1" />
          <button className="btn-ghost" data-active={mode === 'tracker'} onClick={() => setMode('tracker')}>
            tracker
          </button>
          <button className="btn-ghost" data-active={mode === 'graph'} onClick={() => setMode('graph')}>
            graph
          </button>
        </div>
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2 text-[10px]">
          <span className="text-dim">new notes:</span>
          <select className="input h-6" value={inst.wave} onChange={(e) => setInst({ ...inst, wave: Number(e.target.value) })}>
            {WAVE_NAMES.map((w, i) => (
              <option key={w} value={i}>
                {i} {w}
              </option>
            ))}
          </select>
          <span className="text-dim">vol</span>
          <input className="w-16" type="range" min={1} max={7} value={inst.vol} onChange={(e) => setInst({ ...inst, vol: Number(e.target.value) })} />
          <span>{inst.vol}</span>
          <select className="input h-6" value={inst.fx} onChange={(e) => setInst({ ...inst, fx: Number(e.target.value) })}>
            {FX_NAMES.map((f, i) => (
              <option key={f} value={i}>
                fx {i} {f}
              </option>
            ))}
          </select>
          <span className="text-dim">octave {octave} (- / =)</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {mode === 'tracker' ? (
            <Tracker notes={sfx.notes} cursor={cursor} setCursor={setCursor} playNote={playing?.sfx === n ? playing.note : -1} loop={[sfx.loopStart, sfx.loopEnd]} />
          ) : (
            <Graph notes={sfx.notes} edit={edit} inst={inst} playNote={playing?.sfx === n ? playing.note : -1} />
          )}
        </div>
        <div className="shrink-0 border-t border-line px-2 py-1 text-[10px] text-dim">
          piano keys z s x d c v… (2nd octave q 2 w 3…) · arrows move · 0-7 on wave/vol/fx columns · del clears · space plays
        </div>
      </div>
    </div>
  );
}

function Num({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange(v: number): void }) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-dim">{label}</span>
      <input className="input h-6 w-14" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  );
}

function SfxList({ current, onSelect }: { current: number; onSelect(i: number): void }) {
  const cart = useProject((s) => s.cart);
  useProject((s) => s.revisions.sfx);
  if (!cart) return null;
  return (
    <div className="w-[108px] shrink-0 overflow-y-auto border-r border-line py-1">
      {cart.sfx.map((s, i) => (
        <button key={i} onClick={() => onSelect(i)} className={`flex w-full items-center gap-1.5 px-2 py-0.5 text-left text-[11px] ${i === current ? 'bg-p8-darkblue text-p8-white' : 'hover:bg-panel2'}`}>
          <span className={`w-5 tabular-nums ${isEmpty(s.notes) ? 'text-dim' : 'text-p8-yellow'}`}>{i}</span>
          <svg width="56" height="10" viewBox="0 0 32 8" preserveAspectRatio="none" className="shrink-0">
            {s.notes.map((note, k) =>
              note.volume ? <rect key={k} x={k} y={7 - Math.floor(note.pitch / 9)} width={1} height={1} fill={WAVE_COLORS[note.waveform]} /> : null,
            )}
          </svg>
        </button>
      ))}
    </div>
  );
}

function Tracker({
  notes,
  cursor,
  setCursor,
  playNote,
  loop,
}: {
  notes: SfxNote[];
  cursor: { row: number; col: Col };
  setCursor(c: { row: number; col: Col }): void;
  playNote: number;
  loop: [number, number];
}) {
  return (
    <table className="w-full border-collapse text-[12px] tabular-nums" data-testid="sfx-tracker">
      <tbody>
        {notes.map((note, i) => {
          const inLoop = loop[1] > loop[0] && i >= loop[0] && i < loop[1];
          const cell = (col: Col, text: string, color?: string) => (
            <td
              className={`cursor-pointer px-2 ${cursor.row === i && cursor.col === col ? 'bg-p8-pink text-black' : ''}`}
              style={{ color: cursor.row === i && cursor.col === col ? undefined : color }}
              onClick={() => setCursor({ row: i, col })}
            >
              {text}
            </td>
          );
          return (
            <tr key={i} className={`${i === playNote ? 'bg-p8-darkgreen/50' : i % 4 === 0 ? 'bg-panel2/60' : ''} ${cursor.row === i ? 'outline outline-1 -outline-offset-1 outline-line2' : ''}`}>
              <td className={`w-8 px-2 text-right ${inLoop ? 'text-p8-orange' : 'text-dim'}`}>{i}</td>
              {note.volume === 0 ? (
                <>
                  {cell('pitch', '···', '#4b5577')}
                  {cell('wave', '·', '#4b5577')}
                  {cell('vol', '·', '#4b5577')}
                  {cell('fx', '·', '#4b5577')}
                </>
              ) : (
                <>
                  {cell('pitch', pitchName(note.pitch).padEnd(3, '-'), '#fff1e8')}
                  {cell('wave', `${note.waveform}${note.customInstrument ? '*' : ''}`, WAVE_COLORS[note.waveform])}
                  {cell('vol', String(note.volume), '#c2c3c7')}
                  {cell('fx', String(note.effect), note.effect ? '#ff77a8' : '#5f6a86')}
                </>
              )}
              <td className="w-full px-2 text-[10px] text-dim">{note.volume ? `${WAVE_NAMES[note.waveform]}${note.effect ? ` · ${FX_NAMES[note.effect]}` : ''}` : ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Graph({ notes, edit, inst, playNote }: { notes: SfxNote[]; edit(fn: (n: SfxNote[]) => void, label?: string): void; inst: { wave: number; vol: number; fx: number }; playNote: number }) {
  const pitchRef = useRef<HTMLDivElement>(null);
  const volRef = useRef<HTMLDivElement>(null);
  const drawing = useRef<'pitch' | 'vol' | null>(null);

  const apply = (e: ReactPointerEvent, which: 'pitch' | 'vol', first: boolean) => {
    const el = (which === 'pitch' ? pitchRef : volRef).current!;
    const r = el.getBoundingClientRect();
    const i = Math.max(0, Math.min(31, Math.floor(((e.clientX - r.left) / r.width) * 32)));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    const fn = (ns: SfxNote[]) => {
      const cur = ns[i]!;
      if (which === 'pitch') ns[i] = { ...cur, pitch: Math.round((1 - y) * 63), volume: cur.volume || inst.vol, waveform: cur.volume ? cur.waveform : inst.wave, effect: cur.volume ? cur.effect : inst.fx };
      else ns[i] = { ...cur, volume: Math.round((1 - y) * 7) };
    };
    if (first) edit(fn, 'sfx draw');
    else useProject.getState().mutate('sfx', (c) => fn(c.sfx[useEditor.getState().sfx]!.notes));
  };
  const handlers = (which: 'pitch' | 'vol') => ({
    onPointerDown: (e: ReactPointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      drawing.current = which;
      apply(e, which, true);
    },
    onPointerMove: (e: ReactPointerEvent) => drawing.current === which && apply(e, which, false),
    onPointerUp: () => (drawing.current = null),
  });

  return (
    <div className="flex h-full flex-col gap-2 p-2" data-testid="sfx-graph">
      <div ref={pitchRef} className="relative min-h-[160px] flex-1 cursor-crosshair border border-line bg-bg2" {...handlers('pitch')}>
        {notes.map((n, i) => (
          <div key={i} className="absolute bottom-0" style={{ left: `${(i / 32) * 100}%`, width: `${100 / 32}%`, height: '100%' }}>
            {i === playNote && <div className="absolute inset-0 bg-p8-darkgreen/40" />}
            {n.volume > 0 && (
              <div className="absolute inset-x-[1px] bottom-0" style={{ height: `${((n.pitch + 1) / 64) * 100}%`, background: WAVE_COLORS[n.waveform], opacity: 0.35 + n.volume / 11 }} />
            )}
          </div>
        ))}
      </div>
      <div ref={volRef} className="relative h-16 shrink-0 cursor-crosshair border border-line bg-bg2" {...handlers('vol')}>
        {notes.map((n, i) => (
          <div key={i} className="absolute bottom-0 bg-p8-grey" style={{ left: `calc(${(i / 32) * 100}% + 1px)`, width: `calc(${100 / 32}% - 2px)`, height: `${(n.volume / 7) * 100}%` }} />
        ))}
      </div>
      <div className="flex h-5 shrink-0">
        {notes.map((n, i) => (
          <button
            key={i}
            title={`note ${i}: set wave ${inst.wave}, fx ${inst.fx}`}
            className="flex-1 border-r border-bg text-[9px]"
            style={{ background: n.volume ? WAVE_COLORS[n.waveform] : '#141b2b', color: '#000' }}
            onClick={() => edit((ns) => (ns[i] = { ...ns[i]!, waveform: inst.wave, effect: inst.fx }))}
          >
            {n.effect || ''}
          </button>
        ))}
      </div>
    </div>
  );
}

registerPanel({ id: 'sfx', title: 'sfx', icon: 'sfx', shortcut: 'Ctrl+4', component: SfxPanel });
