/** Three-step tour shown on the first visit. */
import { useState } from 'react';
import { loadSettings, saveSettings } from '../persistence/settings';
import { PixelText } from './components/PixelText';

const STEPS = [
  { title: 'code first', text: 'The editor takes the whole screen. Ctrl+R runs the game, Ctrl+S saves and hot-reloads it without restarting. Token count is always on top.' },
  { title: 'panels', text: 'Game, sprites, map, sfx, music and agent are panels: Ctrl+1..6 toggles them, drag to float, or dock them left/right. Ctrl+K opens every command.' },
  { title: 'ai agent', text: 'Add your OpenRouter key in Settings, then ask the agent (Ctrl+6) to change code, draw sprites, compose sfx and playtest. Every change can be undone.' },
];

export function Onboarding() {
  const [step, setStep] = useState(() => (loadSettings().onboarded ? -1 : 0));
  if (step < 0) return null;
  const done = () => {
    saveSettings({ onboarded: true });
    setStep(-1);
  };
  const s = STEPS[step]!;
  return (
    <div className="fixed inset-0 z-[160] grid place-items-center bg-black/60 animate-fade">
      <div className="w-[420px] max-w-[92vw] border border-p8-pink bg-panel p-5 shadow-[var(--shadow-hard-lg)] animate-pop" data-testid="onboarding">
        <div className="mb-1 text-[10px] text-dim">{step + 1} / {STEPS.length}</div>
        <PixelText text={s.title} scale={3} color="#ff77a8" />
        <p className="mt-3 leading-5 text-ink">{s.text}</p>
        <div className="mt-5 flex justify-between">
          <button className="btn-ghost" onClick={done}>skip</button>
          <button className="btn btn-primary" onClick={() => (step + 1 < STEPS.length ? setStep(step + 1) : done())}>{step + 1 < STEPS.length ? 'next' : 'start'}</button>
        </div>
      </div>
    </div>
  );
}
