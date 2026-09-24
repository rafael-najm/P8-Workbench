import { useEffect, useState } from 'react';
import { MUSIC_CHANNEL_DISABLED, MUSIC_FLAG_LOOP_END, MUSIC_FLAG_LOOP_START, MUSIC_FLAG_STOP } from '../../cart/types';
import { useEditor } from '../../store/editor';
import { useProject } from '../../store/project';
import { useUi } from '../../store/ui';
import { Icon } from '../../ui/components/Icon';
import { registerPanel } from '../../ui/panels/registry';
import { checkpoint, redo, undo } from '../history';
import { onPlayback, playMusic, stopPlayback } from '../sfx/playback';

const FLAGS = [
  { bit: MUSIC_FLAG_LOOP_START, label: 'loop start', short: '[' },
  { bit: MUSIC_FLAG_LOOP_END, label: 'loop end', short: ']' },
  { bit: MUSIC_FLAG_STOP, label: 'stop', short: '■' },
];

export function MusicPanel() {
  const cart = useProject((s) => s.cart);
  useProject((s) => s.revisions.music);
  const ed = useEditor();
  const [playing, setPlaying] = useState<number | null>(null);
  useEffect(() => onPlayback((s) => setPlaying(s && s.pattern >= 0 ? s.pattern : null)), []);
  if (!cart) return null;
  const p = ed.pattern;
  const pat = cart.music[p]!;

  const edit = (fn: (m: typeof pat) => void) => {
    checkpoint('music edit');
    useProject.getState().mutate('music', (c) => fn(c.music[p]!));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') e.shiftKey ? redo() : undo();
    else if (ctrl && e.key.toLowerCase() === 'y') redo();
    else if (e.key === ' ') playing !== null ? stopPlayback() : playMusic(cart, p);
    else if (e.key === 'ArrowRight') ed.set({ pattern: Math.min(63, p + 1) });
    else if (e.key === 'ArrowLeft') ed.set({ pattern: Math.max(0, p - 1) });
    else if (e.key === 'ArrowDown') ed.set({ pattern: Math.min(63, p + 8) });
    else if (e.key === 'ArrowUp') ed.set({ pattern: Math.max(0, p - 8) });
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="flex h-full min-h-0 outline-none" tabIndex={0} onKeyDown={onKeyDown} data-testid="music-editor">
      <div className="grid shrink-0 grid-cols-8 content-start gap-1 overflow-y-auto border-r border-line p-2">
        {cart.music.map((m, i) => {
          const used = m.channels.some((c) => !(c & MUSIC_CHANNEL_DISABLED));
          return (
            <button
              key={i}
              onClick={() => ed.set({ pattern: i })}
              className={`relative h-9 w-10 border text-[9px] leading-[9px] transition-colors duration-100 ${i === p ? 'border-p8-pink bg-p8-purple/40' : 'border-line hover:border-line2'} ${playing === i ? 'bg-p8-darkgreen/60' : ''}`}
              title={`pattern ${i}`}
            >
              <span className={`absolute top-0.5 left-1 ${used ? 'text-p8-yellow' : 'text-dim'}`}>{i}</span>
              <span className="absolute top-0.5 right-1 text-p8-orange">
                {m.flags & MUSIC_FLAG_LOOP_START ? '[' : ''}
                {m.flags & MUSIC_FLAG_LOOP_END ? ']' : ''}
                {m.flags & MUSIC_FLAG_STOP ? '■' : ''}
              </span>
              <span className="absolute inset-x-0 bottom-1 flex justify-center gap-[2px]">
                {m.channels.map((c, k) => (
                  <span key={k} className={`h-2 w-2 ${c & MUSIC_CHANNEL_DISABLED ? 'bg-line' : 'bg-p8-blue'}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-p8-yellow">pattern {p}</span>
          <button className="btn h-6" onClick={() => (playing !== null ? stopPlayback() : playMusic(cart, p))} data-testid="music-play">
            <Icon name={playing !== null ? 'stop' : 'play'} size={10} /> {playing !== null ? 'stop' : 'play from here'}
          </button>
          {playing !== null && <span className="text-[11px] text-p8-green">playing pattern {playing}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {FLAGS.map((f) => (
            <button key={f.bit} className="btn h-6 whitespace-nowrap" data-active={!!(pat.flags & f.bit)} style={pat.flags & f.bit ? { borderColor: 'var(--color-p8-orange)', color: 'var(--color-p8-orange)' } : undefined} onClick={() => edit((m) => (m.flags ^= f.bit))}>
              {f.short} {f.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {pat.channels.map((c, ch) => {
            const enabled = !(c & MUSIC_CHANNEL_DISABLED);
            const n = c & 0x3f;
            return (
              <div key={ch} className={`border p-2 ${enabled ? 'border-p8-blue/60 bg-p8-darkblue/20' : 'border-line'}`}>
                <label className="mb-2 flex items-center gap-2 text-[11px]">
                  <input type="checkbox" checked={enabled} onChange={() => edit((m) => (m.channels[ch] = c ^ MUSIC_CHANNEL_DISABLED))} />
                  channel {ch}
                </label>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <span className="text-[10px] text-dim">sfx</span>
                  <input
                    className="input h-6 w-14"
                    type="number"
                    min={0}
                    max={63}
                    disabled={!enabled}
                    value={n}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => edit((m) => (m.channels[ch] = (c & MUSIC_CHANNEL_DISABLED) | Math.max(0, Math.min(63, Number(e.target.value) || 0))))}
                  />
                  <button
                    className="btn-ghost text-[10px]"
                    disabled={!enabled}
                    title="Open in the sfx editor"
                    onClick={() => {
                      ed.set({ sfx: n });
                      useUi.getState().open('sfx');
                    }}
                  >
                    edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] leading-4 text-dim">
          A pattern lasts as long as its leftmost non-looping sfx. After it, music continues with the next pattern; a pattern with loop end jumps back to the last loop start, and stop ends the song. In code: music({p}).
        </p>
      </div>
    </div>
  );
}

registerPanel({ id: 'music', title: 'music', icon: 'music', shortcut: 'Ctrl+5', component: MusicPanel });
