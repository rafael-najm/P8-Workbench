/** App-side agent session: tool context bound to the project, snapshots, auto context, chat state. */
import { create } from 'zustand';
import { countTokens, functionTokenCounts } from '../cart/tokens';
import { parseP8, serializeP8 } from '../cart/p8format';
import { loadSettings } from '../persistence/settings';
import { playSfx as playPreview } from '../editors/sfx/playback';
import { useEditor } from '../store/editor';
import { useProject } from '../store/project';
import { useRuntime } from '../store/runtime';
import { PANEL_IDS, useUi } from '../store/ui';
import { workerExecutor } from './exec/workerExecutor';
import { runAgent, type AgentEvent } from './loop';
import { systemPrompt } from './prompt';
import type { ChatMessage, EditPreview, ToolCall, ToolContext, ToolResult } from './types';

export type ChatItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string; cost?: number; tokens?: number }
  | { kind: 'tool'; id: number; name: string; summary: string; args: unknown; result?: ToolResult; ms?: number; status: 'running' | 'ok' | 'error'; before?: string; undone?: boolean }
  | { kind: 'approval'; id: number; name: string; preview: EditPreview | null; resolve(ok: boolean): void; decided?: boolean }
  | { kind: 'error'; id: number; text: string }
  | { kind: 'task'; id: number; snapshot: string; undone?: boolean };

interface AgentState {
  items: ChatItem[];
  running: boolean;
  send(text: string): Promise<void>;
  stop(): void;
  undoTask(id: number): void;
  undoEdit(id: number): void;
  clear(): void;
}

let nextId = 1;
let controller: AbortController | null = null;
let history: ChatMessage[] = [];
/** Cart (p8 text) before the first change made by the running tool call. */
let editSnapshot: string | null = null;

export function autoContext(): string {
  const p = useProject.getState();
  const cart = p.cart;
  if (!cart) return '';
  const rt = useRuntime.getState();
  const ed = useEditor.getState();
  const fns = functionTokenCounts(cart.code).map((f) => `${f.name}:${f.line}(${f.tokens})`).join(' ');
  const open = PANEL_IDS.filter((id) => useUi.getState().panels[id].open).join(',');
  return [
    `[context] cart "${p.name}" · ${countTokens(cart.code)}/8192 tokens · ${cart.code.split('\n').length} lines`,
    `functions (name:line(tokens)): ${fns}`,
    `open panels: ${open} · selected sprite ${ed.sprite} (${ed.spriteSize * 8}x${ed.spriteSize * 8}) · selected sfx ${ed.sfx}`,
    `game: ${rt.status}${rt.status === 'running' || rt.status === 'paused' ? ` frame ${rt.frame}` : ''}${rt.error ? ` · last error line ${rt.error.line}: ${rt.error.message}` : ''}`,
  ].join('\n');
}

const toolContext: ToolContext = {
  cart: () => useProject.getState().cart!,
  update(kinds, _label, fn) {
    const st = useProject.getState();
    editSnapshot ??= serializeP8(st.cart!);
    if (kinds.length === 1 && kinds[0] === 'code') {
      const c = structuredClone(st.cart!.code);
      const tmp = { ...st.cart!, code: c };
      fn(tmp);
      st.setCode(tmp.code);
    } else {
      st.mutate(kinds.filter((k) => k !== 'code') as never, fn);
    }
  },
  exec: workerExecutor,
  playSfx: (n) => {
    const cart = useProject.getState().cart;
    if (cart) playPreview(cart, n);
  },
};

export const useAgent = create<AgentState>((set, get) => {
  const push = (item: ChatItem) => set((s) => ({ items: [...s.items, item] }));
  const patch = (id: number, p: Partial<ChatItem>) => set((s) => ({ items: s.items.map((i) => (i.id === id ? ({ ...i, ...p } as ChatItem) : i)) }));

  return {
    items: [],
    running: false,
    async send(text) {
      const s = loadSettings();
      if (!s.openrouterKey) {
        push({ kind: 'error', id: nextId++, text: 'Add your OpenRouter API key in Settings first.' });
        useUi.getState().setSettings(true);
        return;
      }
      const cart = useProject.getState().cart;
      if (!cart || get().running) return;
      push({ kind: 'task', id: nextId++, snapshot: serializeP8(cart) });
      push({ kind: 'user', id: nextId++, text });
      if (!history.length) history.push({ role: 'system', content: systemPrompt() });
      history.push({ role: 'user', content: `${autoContext()}\n\n${text}` });
      controller = new AbortController();
      set({ running: true });
      let streamId = 0;
      const toolIds = new Map<string, number>();
      const onEvent = (e: AgentEvent) => {
        if (e.type === 'text') {
          if (!streamId) {
            streamId = nextId++;
            push({ kind: 'assistant', id: streamId, text: '' });
          }
          set((st) => ({ items: st.items.map((i) => (i.id === streamId && i.kind === 'assistant' ? { ...i, text: i.text + e.delta } : i)) }));
        } else if (e.type === 'assistant') {
          if (streamId && e.usage) patch(streamId, { cost: e.usage.cost, tokens: (e.usage.prompt_tokens ?? 0) + (e.usage.completion_tokens ?? 0) });
          streamId = 0;
        } else if (e.type === 'tool_start') {
          const id = nextId++;
          toolIds.set(e.call.id, id);
          editSnapshot = null;
          push({ kind: 'tool', id, name: e.call.function.name, summary: e.summary, args: e.args, status: 'running' });
        } else if (e.type === 'tool_end') {
          const id = toolIds.get(e.call.id);
          if (id) patch(id, { result: e.result, ms: e.ms, status: e.result.isError ? 'error' : 'ok', before: editSnapshot ?? undefined });
          editSnapshot = null;
        } else if (e.type === 'error') push({ kind: 'error', id: nextId++, text: e.message });
      };
      const approve = s.agentMode === 'approve'
        ? (call: ToolCall, preview: EditPreview | null) => new Promise<boolean>((resolve) => {
            const id = nextId++;
            push({ kind: 'approval', id, name: call.function.name, preview, resolve: (okv) => { patch(id, { decided: true }); resolve(okv); } });
          })
        : undefined;
      const models = (await import('./models')).cachedModels();
      const vision = models.find((m) => m.id === s.model)?.architecture?.input_modalities?.includes('image') ?? true;
      try {
        history = await runAgent({ apiKey: s.openrouterKey, model: s.model, messages: history, ctx: toolContext, vision, signal: controller.signal, onEvent, approve, maxCost: s.agentBudget > 0 ? s.agentBudget : undefined });
      } finally {
        set({ running: false });
        controller = null;
      }
    },
    stop() {
      controller?.abort();
      set((st) => ({ items: st.items.map((i) => (i.kind === 'approval' && !i.decided ? (i.resolve(false), { ...i, decided: true }) : i)) }));
    },
    undoTask(id) {
      const item = get().items.find((i) => i.id === id);
      if (!item || item.kind !== 'task') return;
      useProject.getState().replaceCart(parseP8(item.snapshot));
      patch(id, { undone: true });
      history.push({ role: 'user', content: '[the user undid all changes from that task]' });
    },
    undoEdit(id) {
      const item = get().items.find((i) => i.id === id);
      if (!item || item.kind !== 'tool' || !item.before) return;
      useProject.getState().replaceCart(parseP8(item.before));
      patch(id, { undone: true });
      history.push({ role: 'user', content: `[the user reverted your ${item.name} call; the cart is back to how it was before it]` });
    },
    clear() {
      history = [];
      set({ items: [] });
    },
  };
});
