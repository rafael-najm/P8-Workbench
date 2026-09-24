import { DiffEditor } from '@monaco-editor/react';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { loadSettings, saveSettings } from '../../persistence/settings';
import { useUi } from '../../store/ui';
import { Icon } from '../../ui/components/Icon';
import { SETTINGS_SECTIONS } from '../../ui/layout/SettingsDialog';
import { registerPanel } from '../../ui/panels/registry';
import { LANGUAGE_ID, THEME_ID } from '../../editors/code/monaco';
import { fetchModels } from '../models';
import { supportsImages, supportsTools, type ModelInfo } from '../openrouter';
import { useAgent, type ChatItem } from '../session';

/** Tiny safe markdown: fenced code, inline code, bold, headings, bullet lists. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/```(?:\w+)?\n?/);
  const inline = (s: string, key: number): ReactNode => (
    <Fragment key={key}>
      {s.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? <code key={i} className="bg-bg2 px-1 text-p8-peach">{part.slice(1, -1)}</code>
        : part.startsWith('**') ? <b key={i} className="text-p8-white">{part.slice(2, -2)}</b> : part,
      )}
    </Fragment>
  );
  return (
    <div className="flex flex-col gap-1.5 leading-5">
      {blocks.map((b, i) =>
        i % 2 ? <pre key={i} className="overflow-x-auto border border-line bg-bg2 p-2 text-[11px] text-p8-grey">{b.replace(/\n$/, '')}</pre>
        : b.split('\n').filter((l) => l.trim()).map((l, j) => {
            const h = /^#+\s(.*)/.exec(l);
            if (h) return <div key={`${i}-${j}`} className="text-p8-pink">{inline(h[1]!, j)}</div>;
            const li = /^\s*[-*]\s(.*)/.exec(l);
            if (li) return <div key={`${i}-${j}`} className="pl-3 before:mr-1 before:text-p8-blue before:content-['▪']">{inline(li[1]!, j)}</div>;
            return <p key={`${i}-${j}`}>{inline(l, j)}</p>;
          }),
      )}
    </div>
  );
}

function ToolCard({ item }: { item: Extract<ChatItem, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false);
  const color = item.status === 'running' ? 'text-p8-yellow' : item.status === 'error' ? 'text-p8-red' : 'text-p8-green';
  return (
    <div className="border border-line bg-bg2/60 text-[11px] animate-slide-up" data-testid="tool-card">
      <button className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-panel2" onClick={() => setOpen(!open)}>
        <span className={color}>{item.status === 'running' ? '◌' : item.status === 'error' ? '✕' : '✓'}</span>
        <span className="text-p8-blue">{item.name}</span>
        <span className="min-w-0 flex-1 truncate text-muted">{item.summary}</span>
        {item.ms !== undefined && <span className="text-dim tabular-nums">{item.ms < 1000 ? `${item.ms}ms` : `${(item.ms / 1000).toFixed(1)}s`}</span>}
      </button>
      {item.result?.images?.map((src, i) => <img key={i} src={src} alt="tool screenshot" className="pixelated mx-2 mb-2 max-h-64 border border-line" />)}
      {open && (
        <div className="border-t border-line p-2">
          <div className="label mb-1">arguments</div>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-p8-grey">{JSON.stringify(item.args, null, 1)}</pre>
          {item.result && (<><div className="label mt-2 mb-1">result</div><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-p8-grey">{item.result.content}</pre></>)}
        </div>
      )}
    </div>
  );
}

function Approval({ item }: { item: Extract<ChatItem, { kind: 'approval' }> }) {
  const p = item.preview;
  return (
    <div className="border border-p8-orange bg-[#1a1206] p-2 text-[11px]">
      <div className="mb-2 text-p8-orange">approve {item.name}?</div>
      {p?.type === 'code' && (
        <div className="h-56 border border-line">
          <DiffEditor original={p.before} modified={p.after} language={LANGUAGE_ID} theme={THEME_ID} options={{ readOnly: true, renderSideBySide: false, minimap: { enabled: false }, fontSize: 11, scrollBeyondLastLine: false }} />
        </div>
      )}
      {p?.type === 'text' && <pre className="max-h-48 overflow-auto text-p8-grey">{p.summary}</pre>}
      {!item.decided && (
        <div className="mt-2 flex gap-2">
          <button className="btn btn-primary h-6" onClick={() => item.resolve(true)}><Icon name="check" size={10} /> apply</button>
          <button className="btn h-6" onClick={() => item.resolve(false)}><Icon name="close" size={10} /> reject</button>
        </div>
      )}
    </div>
  );
}

export function AgentPanel() {
  const { items, running, send, stop, undoTask, clear } = useAgent();
  const [text, setText] = useState('');
  const [mode, setMode] = useState(loadSettings().agentMode);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [items]);
  const hasKey = !!loadSettings().openrouterKey;
  const submit = () => {
    if (!text.trim() || running) return;
    void send(text.trim());
    setText('');
  };
  const totalCost = items.reduce((s, i) => s + (i.kind === 'assistant' ? i.cost ?? 0 : 0), 0);

  return (
    <div className="flex h-full flex-col" data-testid="agent-panel">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px]">
        <button className="btn-ghost" data-active={mode === 'auto'} onClick={() => { saveSettings({ agentMode: 'auto' }); setMode('auto'); }}>auto</button>
        <button className="btn-ghost" data-active={mode === 'approve'} onClick={() => { saveSettings({ agentMode: 'approve' }); setMode('approve'); }}>approve edits</button>
        <div className="flex-1" />
        <span className="truncate text-dim" title="model">{loadSettings().model}</span>
        {totalCost > 0 && <span className="text-dim tabular-nums">${totalCost.toFixed(4)}</span>}
        <button className="btn-ghost" title="New conversation" onClick={clear}><Icon name="trash" size={12} /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2 text-[12px]">
        {items.length === 0 && (
          <div className="p-3 text-muted">
            {hasKey ? 'Ask for anything: “add a power-up”, “draw a new enemy sprite”, “make a jump sfx”, “playtest the first stage”…' : (
              <button className="btn" onClick={() => useUi.getState().setSettings(true)}><Icon name="settings" size={12} /> add your OpenRouter key</button>
            )}
          </div>
        )}
        {items.map((it) => {
          switch (it.kind) {
            case 'user': return <div key={it.id} className="ml-6 border-l-2 border-p8-pink bg-panel2 px-2 py-1.5 whitespace-pre-wrap">{it.text}</div>;
            case 'assistant': return (
              <div key={it.id}>
                <Markdown text={it.text} />
                {it.tokens ? <div className="mt-0.5 text-[10px] text-dim">{it.tokens} tokens{it.cost ? ` · $${it.cost.toFixed(5)}` : ''}</div> : null}
              </div>
            );
            case 'tool': return <ToolCard key={it.id} item={it} />;
            case 'approval': return <Approval key={it.id} item={it} />;
            case 'error': return <div key={it.id} className="border border-p8-red px-2 py-1 text-p8-red">{it.text}</div>;
            case 'task': return (
              <div key={it.id} className="flex items-center gap-2 pt-2 text-[10px] text-dim">
                <div className="h-px flex-1 bg-line" />
                <button className="hover:text-p8-orange disabled:opacity-40" disabled={it.undone || running} onClick={() => undoTask(it.id)} title="Restore the cart to before this task">
                  {it.undone ? 'task undone' : '↶ undo everything the agent did in this task'}
                </button>
              </div>
            );
          }
        })}
        {running && <div className="text-[11px] text-p8-yellow animate-pulse">working…</div>}
        <div ref={bottom} />
      </div>
      <div className="shrink-0 border-t border-line p-2">
        <textarea
          className="input h-16 w-full resize-none py-1"
          placeholder="Message the agent (Enter to send, Shift+Enter for a new line)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
            e.stopPropagation();
          }}
          data-testid="agent-input"
        />
        <div className="mt-1 flex justify-end gap-2">
          {running ? <button className="btn h-6" onClick={stop}><Icon name="stop" size={10} /> stop</button>
          : <button className="btn btn-primary h-6" onClick={submit} disabled={!text.trim()} data-testid="agent-send"><Icon name="send" size={10} /> send</button>}
        </div>
      </div>
    </div>
  );
}

function AgentSettings() {
  const [s, setS] = useState(loadSettings);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [onlyTools, setOnlyTools] = useState(true);
  const [onlyVision, setOnlyVision] = useState(false);
  useEffect(() => { fetchModels().then(setModels).catch((e: unknown) => setErr(String(e))); }, []);
  const list = useMemo(() => (models ?? []).filter((m) => (!onlyTools || supportsTools(m)) && (!onlyVision || supportsImages(m)) && (m.id + m.name).toLowerCase().includes(q.toLowerCase())).slice(0, 80), [models, q, onlyTools, onlyVision]);
  const update = (p: Parameters<typeof saveSettings>[0]) => setS(saveSettings(p));
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-muted">OpenRouter API key</span>
        <input className="input" type="password" value={s.openrouterKey} placeholder="sk-or-..." onChange={(e) => update({ openrouterKey: e.target.value.trim() })} data-testid="api-key" />
        <span className="text-[11px] text-p8-orange">Stored only in this browser (localStorage) and sent only to openrouter.ai. Don't use this on a shared computer.</span>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-muted">Model: <span className="text-p8-blue">{s.model}</span></span>
        <div className="flex items-center gap-2">
          <input className="input flex-1" placeholder="search models…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={onlyTools} onChange={(e) => setOnlyTools(e.target.checked)} /> tools</label>
          <label className="flex items-center gap-1 text-[11px]"><input type="checkbox" checked={onlyVision} onChange={(e) => setOnlyVision(e.target.checked)} /> images</label>
        </div>
        {err && <span className="text-[11px] text-p8-red">could not load models: {err}</span>}
        <div className="max-h-48 overflow-y-auto border border-line">
          {models === null && !err && <div className="p-2 text-dim">loading models…</div>}
          {list.map((m) => (
            <button key={m.id} onClick={() => update({ model: m.id })} className={`flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] ${m.id === s.model ? 'bg-p8-darkblue' : 'hover:bg-panel2'}`}>
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              {supportsImages(m) && <span className="text-p8-peach">img</span>}
              <span className="text-dim tabular-nums">${(Number(m.pricing?.prompt ?? 0) * 1e6).toFixed(2)}/M</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

SETTINGS_SECTIONS.push({ id: 'agent', title: 'ai agent (openrouter)', render: () => <AgentSettings /> });
registerPanel({ id: 'agent', title: 'agent', icon: 'agent', shortcut: 'Ctrl+6', component: AgentPanel });
