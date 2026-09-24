/** OpenRouter client: streaming chat completions with tool calling (OpenAI-compatible). */
import type { ChatMessage, ToolCall } from './types';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1';

export interface ModelInfo {
  id: string;
  name: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
}

export async function listModels(fetchFn: typeof fetch = fetch): Promise<ModelInfo[]> {
  const r = await fetchFn(`${OPENROUTER_URL}/models`);
  if (!r.ok) throw new Error(`models: HTTP ${r.status}`);
  const j = (await r.json()) as { data: ModelInfo[] };
  return j.data;
}

export const supportsTools = (m: ModelInfo) => !!m.supported_parameters?.includes('tools');
export const supportsImages = (m: ModelInfo) => !!m.architecture?.input_modalities?.includes('image');

export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
}

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  finishReason: string | null;
}

export interface StreamOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  signal?: AbortSignal;
  onText?(delta: string): void;
  fetchFn?: typeof fetch;
  /** Output cap. Also limits how much credit OpenRouter reserves per request. */
  maxTokens?: number;
}

interface Delta {
  content?: string | null;
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

/** Parses an SSE stream of chat completion chunks. */
export async function streamChat(o: StreamOptions): Promise<StreamResult> {
  const res = await (o.fetchFn ?? fetch)(`${OPENROUTER_URL}/chat/completions`, {
    method: 'POST',
    signal: o.signal,
    headers: {
      Authorization: `Bearer ${o.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://pico-workbench.local',
      'X-Title': 'PICO Workbench',
    },
    body: JSON.stringify({ model: o.model, messages: withCaching(o.model, o.messages), max_tokens: o.maxTokens ?? 4096, tools: o.tools, tool_choice: o.tools ? 'auto' : undefined, stream: true, usage: { include: true } }),
  });
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j.error?.message) msg += `: ${j.error.message}`;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const out: StreamResult = { content: '', toolCalls: [], usage: null, finishReason: null };
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      let chunk: { choices?: { delta?: Delta; finish_reason?: string | null }[]; usage?: Usage; error?: { message: string } };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new Error(chunk.error.message);
      if (chunk.usage) out.usage = chunk.usage;
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      if (choice.finish_reason) out.finishReason = choice.finish_reason;
      const d = choice.delta;
      if (d?.content) {
        out.content += d.content;
        o.onText?.(d.content);
      }
      for (const tc of d?.tool_calls ?? []) {
        const cur = (out.toolCalls[tc.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.function.name += tc.function.name;
        if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
      }
    }
  }
  out.toolCalls = out.toolCalls.filter(Boolean).map((t, i) => ({ ...t, id: t.id || `call_${i}_${Date.now()}` }));
  return out;
}

/** Anthropic models on OpenRouter support prompt caching: cache the (large, fixed) system prompt. */
function withCaching(model: string, messages: ChatMessage[]): unknown[] {
  if (!model.startsWith('anthropic/')) return messages;
  return messages.map((m, i) =>
    i === 0 && m.role === 'system' ? { role: 'system', content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] } : m,
  );
}
