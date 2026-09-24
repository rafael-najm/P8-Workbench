import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '../../store/ui';
import { getCommands, type Command } from '../commands';
import { game } from '../game/controller';

/** Subsequence match score (higher is better), or -1. */
function score(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  const idx = t.indexOf(q);
  if (idx >= 0) return 100 - idx;
  let ti = 0;
  let s = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    s += found === ti ? 3 : 1;
    ti = found + 1;
  }
  return s;
}

export function CommandPalette() {
  const open = useUi((s) => s.paletteOpen);
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    if (!open) return [];
    return getCommands()
      .map((c) => ({ c, s: score(query, `${c.group} ${c.title}`) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
  }, [open, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSel(0);
      game.setFocused(false);
    }
  }, [open]);

  if (!open) return null;
  const close = () => useUi.getState().setPalette(false);
  const exec = (c: Command | undefined) => {
    if (!c) return;
    close();
    void c.run();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/50 pt-[12vh] animate-fade" onMouseDown={close}>
      <div className="w-[560px] max-w-[92vw] border border-line2 bg-panel shadow-[var(--shadow-hard-lg)] animate-pop" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          autoFocus
          value={query}
          placeholder="Type a command…"
          className="h-11 w-full border-b border-line bg-transparent px-4 text-[14px] text-ink outline-none placeholder:text-dim"
          onChange={(e) => {
            setQuery(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setSel((s) => Math.min(results.length - 1, s + 1));
            else if (e.key === 'ArrowUp') setSel((s) => Math.max(0, s - 1));
            else if (e.key === 'Enter') exec(results[sel]);
            else return;
            e.preventDefault();
          }}
        />
        <ul className="max-h-[50vh] overflow-y-auto py-1" role="listbox">
          {results.map((c, i) => (
            <li
              key={c.id}
              role="option"
              aria-selected={i === sel}
              onMouseEnter={() => setSel(i)}
              onClick={() => exec(c)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-1.5 ${i === sel ? 'bg-p8-darkblue text-p8-white' : 'text-ink'}`}
            >
              <span className="w-20 shrink-0 text-[10px] tracking-wider text-muted uppercase">{c.group}</span>
              <span className="flex-1">{c.title}</span>
              {c.shortcut && <span className="kbd">{c.shortcut}</span>}
            </li>
          ))}
          {results.length === 0 && <li className="px-4 py-3 text-muted">No matching commands</li>}
        </ul>
      </div>
    </div>
  );
}
