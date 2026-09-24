import { useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../../persistence/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../components/Icon';
import { PixelText } from '../components/PixelText';

/** Extra sections contributed by other modules (e.g. the agent's API key). */
export const SETTINGS_SECTIONS: { id: string; title: string; render: () => ReactNode }[] = [];

function GeneralSection() {
  const [s, setS] = useState(loadSettings);
  const patch = (p: Parameters<typeof saveSettings>[0]) => {
    setS(saveSettings(p));
    window.dispatchEvent(new Event('p8-settings'));
  };
  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.crt} onChange={(e) => patch({ crt: e.target.checked })} />
        CRT scanlines on the game screen
      </label>
      <div className="flex items-center gap-2">
        <span className="w-28 text-muted">Game scale</span>
        <select className="input" value={String(s.gameScale)} onChange={(e) => patch({ gameScale: e.target.value === 'fit' ? 'fit' : Number(e.target.value) })}>
          {['fit', '2', '3', '4', '5', '6', '8'].map((v) => (
            <option key={v} value={v}>
              {v === 'fit' ? 'fit to panel' : `${v}x`}
            </option>
          ))}
        </select>
      </div>
      <div>
        <button className="btn" onClick={() => useUi.getState().resetLayout()}>
          Reset panel layout
        </button>
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  if (!open) return null;
  const close = () => useUi.getState().setSettings(false);
  const sections = [{ id: 'general', title: 'general', render: () => <GeneralSection /> }, ...SETTINGS_SECTIONS];
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 animate-fade" onMouseDown={close}>
      <div className="max-h-[85vh] w-[620px] max-w-[94vw] overflow-y-auto border border-line2 bg-panel shadow-[var(--shadow-hard-lg)] animate-pop" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex h-10 items-center border-b border-line px-4">
          <PixelText text="settings" scale={2} color="#ff77a8" />
          <div className="flex-1" />
          <button className="btn-ghost" onClick={close}>
            <Icon name="close" size={12} />
          </button>
        </div>
        {sections.map((sec) => (
          <section key={sec.id} className="border-b border-line px-4 py-4 last:border-0">
            <div className="label mb-3">{sec.title}</div>
            {sec.render()}
          </section>
        ))}
      </div>
    </div>
  );
}
