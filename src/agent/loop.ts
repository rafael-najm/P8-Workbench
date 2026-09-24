/** The agentic loop: call the model, execute tool calls, repeat until it answers. */
import { streamChat, type Usage } from './openrouter';
import { validate } from './schema';
import { TOOL_BY_NAME, toolSchemas } from './tools';
import type { ChatMessage, ContentPart, EditPreview, ToolCall, ToolContext, ToolResult } from './types';

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'assistant'; content: string; usage: Usage | null }
  | { type: 'tool_start'; call: ToolCall; args: unknown; summary: string }
  | { type: 'tool_end'; call: ToolCall; result: ToolResult; ms: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface LoopOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  ctx: ToolContext;
  vision: boolean;
  signal?: AbortSignal;
  maxSteps?: number;
  /** Stop the task when its cost (USD, as reported by OpenRouter) reaches this. */
  maxCost?: number;
  onEvent(e: AgentEvent): void;
  /** Called before edit tools when approval is required; resolve false to reject. */
  approve?(call: ToolCall, preview: EditPreview | null): Promise<boolean>;
  fetchFn?: typeof fetch;
}

export async function executeTool(call: ToolCall, ctx: ToolContext, approve?: LoopOptions['approve']): Promise<{ result: ToolResult; args: unknown }> {
  const tool = TOOL_BY_NAME.get(call.function.name);
  if (!tool) return { args: null, result: { content: JSON.stringify({ error: `unknown tool ${call.function.name}` }), isError: true } };
  let args: Record<string, unknown>;
  try {
    args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
  } catch {
    return { args: call.function.arguments, result: { content: JSON.stringify({ error: 'arguments are not valid JSON' }), isError: true } };
  }
  const errors = validate(tool.parameters, args);
  if (errors.length) return { args, result: { content: JSON.stringify({ error: 'invalid arguments', details: errors }), isError: true } };
  if (tool.kind === 'edit' && approve) {
    const preview = tool.preview ? await tool.preview(args, ctx) : null;
    if (!(await approve(call, preview))) return { args, result: { content: JSON.stringify({ error: 'the user rejected this edit' }), isError: true } };
  }
  try {
    return { args, result: await tool.run(args, ctx) };
  } catch (e) {
    return { args, result: { content: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true } };
  }
}

const KEEP_RECENT = 8;
const OLD_TOOL_CHARS = 1200;

/**
 * Keeps the history cheap: tool results older than the last few messages are
 * truncated and old screenshots dropped (the model can call the tool again).
 */
export function compactHistory(msgs: ChatMessage[]): void {
  const lastImages = msgs.map((m, i) => (m.role === 'user' && Array.isArray(m.content) ? i : -1)).filter((i) => i >= 0).at(-1) ?? -1;
  msgs.forEach((m, i) => {
    if (i >= msgs.length - KEEP_RECENT) return;
    if (m.role === 'tool' && m.content.length > OLD_TOOL_CHARS) {
      m.content = `${m.content.slice(0, OLD_TOOL_CHARS)}\n…(old result truncated; call the tool again if you need it)`;
    } else if (m.role === 'user' && Array.isArray(m.content) && i !== lastImages) {
      msgs[i] = { role: 'user', content: '(older screenshots removed to save context)' };
    }
  });
}

export async function runAgent(o: LoopOptions): Promise<ChatMessage[]> {
  const msgs = o.messages;
  const tools = toolSchemas();
  let spent = 0;
  for (let step = 0; step < (o.maxSteps ?? 40); step++) {
    if (o.signal?.aborted) break;
    if (o.maxCost !== undefined && spent >= o.maxCost) {
      o.onEvent({ type: 'error', message: `Stopped: this task reached its budget ($${spent.toFixed(3)} of $${o.maxCost}). Raise it in Settings or send "continue".` });
      break;
    }
    compactHistory(msgs);
    let res;
    try {
      res = await streamChat({ apiKey: o.apiKey, model: o.model, messages: msgs, tools, signal: o.signal, fetchFn: o.fetchFn, onText: (d) => o.onEvent({ type: 'text', delta: d }) });
    } catch (e) {
      if (o.signal?.aborted) break;
      o.onEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) });
      break;
    }
    msgs.push({ role: 'assistant', content: res.content || null, tool_calls: res.toolCalls.length ? res.toolCalls : undefined });
    spent += res.usage?.cost ?? 0;
    o.onEvent({ type: 'assistant', content: res.content, usage: res.usage });
    if (!res.toolCalls.length) break;
    const images: ContentPart[] = [];
    for (const call of res.toolCalls) {
      if (o.signal?.aborted) {
        msgs.push({ role: 'tool', tool_call_id: call.id, content: '{"error":"stopped by the user"}' });
        continue;
      }
      const tool = TOOL_BY_NAME.get(call.function.name);
      let parsed: unknown = null;
      try { parsed = JSON.parse(call.function.arguments || '{}'); } catch { /* reported by executeTool */ }
      o.onEvent({ type: 'tool_start', call, args: parsed, summary: tool?.summarize && parsed ? tool.summarize(parsed as never) : '' });
      const t0 = performance.now();
      const { result } = await executeTool(call, o.ctx, o.approve);
      o.onEvent({ type: 'tool_end', call, result, ms: Math.round(performance.now() - t0) });
      const content = result.images?.length ? `${result.content}\n(${result.images.length} image(s) attached in the next message)` : result.content;
      msgs.push({ role: 'tool', tool_call_id: call.id, content: content.slice(0, 60_000) });
      for (const url of result.images ?? []) images.push({ type: 'image_url', image_url: { url } });
    }
    if (images.length) {
      msgs.push({ role: 'user', content: o.vision ? [{ type: 'text', text: 'Images returned by the tool calls above:' }, ...images] : '(tool images omitted: the selected model has no vision)' });
    }
  }
  o.onEvent({ type: 'done' });
  return msgs;
}
