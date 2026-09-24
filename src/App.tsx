import { useEffect, useState } from 'react';
import { bootProjects, useProject } from './store/project';
import { PixelText } from './ui/components/PixelText';
import { Workspace } from './ui/layout/Workspace';
import './ui/panels/GamePanel';
import './editors/sprite/SpritePanel';
import './editors/map/MapPanel';
import './ui/panels/ConsolePanel';
import './ui/panels/ProjectsPanel';

export function App() {
  const ready = useProject((s) => s.cart !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootProjects().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md border border-p8-red bg-panel p-5 shadow-[var(--shadow-hard-lg)]">
          <PixelText text="could not start" scale={3} color="#ff004d" />
          <p className="mt-3 text-muted">{error}</p>
          <p className="mt-2 text-dim">Projects are stored in IndexedDB. Private browsing modes can block it.</p>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="grid h-full place-items-center">
        <div className="flex flex-col items-center gap-3 animate-fade">
          <PixelText text="pico workbench" scale={4} color="#ff77a8" shadow="#1d2b53" />
          <div className="h-1 w-40 overflow-hidden bg-line">
            <div className="h-full w-1/3 animate-pulse bg-p8-blue" />
          </div>
        </div>
      </div>
    );
  }
  return <Workspace />;
}
