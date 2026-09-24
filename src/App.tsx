import { useMemo } from 'react';
import { parseP8 } from './cart/p8format';
import { codeStats } from './cart/tokens';
import nebula from '../samples/nebula_strike.p8?raw';

// TODO(milestone-4): replace this placeholder with the real workspace shell
// (full-screen Monaco, dockable panels, command palette).
export function App() {
  const stats = useMemo(() => codeStats(parseP8(nebula).code), []);
  const pct = Math.round((stats.tokens / stats.tokenLimit) * 100);

  return (
    <main className="flex h-full items-center justify-center p-4">
      <section className="w-full max-w-md border border-line bg-panel p-6 shadow-[4px_4px_0_0_#000]">
        <h1 className="mb-1 text-lg font-bold tracking-widest text-p8-pink">PICO WORKBENCH</h1>
        <p className="mb-6 text-sm opacity-70">Milestone 1: cart format &amp; token counter</p>
        <p className="mb-2 text-sm">
          nebula_strike.p8 · <span className="text-p8-yellow">{stats.tokens}</span>/{stats.tokenLimit} tokens ·{' '}
          {stats.chars}/{stats.charLimit} chars
        </p>
        <div className="h-2 w-full border border-line">
          <div className="h-full bg-p8-blue" style={{ width: `${pct}%` }} />
        </div>
      </section>
    </main>
  );
}
