import { useEffect, useRef } from 'react';
import { revealLine } from '../../editors/code/CodeEditor';
import { useConsole } from '../../store/console';
import { Icon } from '../components/Icon';
import { registerPanel } from './registry';

const COLORS = { printh: 'text-ink', error: 'text-p8-red', info: 'text-muted', agent: 'text-p8-pink' } as const;

export function ConsolePanel() {
  const lines = useConsole((s) => s.lines);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [lines.length]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2">
        <span className="label">printh, errors and reloads</span>
        <div className="flex-1" />
        <button className="btn-ghost" title="Clear" onClick={() => useConsole.getState().clear()}>
          <Icon name="trash" size={12} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 text-[12px] leading-5" data-testid="console">
        {lines.length === 0 && <div className="text-dim">Nothing yet. Output from printh() appears here.</div>}
        {lines.map((l) => (
          <div key={l.id} className={`flex gap-2 ${COLORS[l.kind]}`}>
            <span className="shrink-0 text-dim tabular-nums">{new Date(l.time).toLocaleTimeString([], { hour12: false })}</span>
            <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">
              {l.text}
              {l.line && (
                <button className="ml-2 text-p8-blue underline decoration-dotted" onClick={() => revealLine(l.line!)}>
                  go to line {l.line}
                </button>
              )}
            </span>
          </div>
        ))}
        <div ref={bottom} />
      </div>
    </div>
  );
}

registerPanel({ id: 'console', title: 'console', icon: 'console', shortcut: 'Ctrl+`', component: ConsolePanel });
