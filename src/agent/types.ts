/** Shared agent types (OpenAI-compatible chat format used by OpenRouter). */
import type { Cart } from '../cart/types';
import type { AssetKind } from '../store/project';
import type { Executor } from './exec/executor';

export type JsonSchema = {
  type?: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: (string | number)[];
  minimum?: number;
  maximum?: number;
  anyOf?: JsonSchema[];
  additionalProperties?: boolean;
};

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolResult {
  /** Text/JSON returned to the model. */
  content: string;
  /** PNG data URLs to show the model (vision) and the user. */
  images?: string[];
  isError?: boolean;
}

/** Before/after preview of an edit, for approval and diff display. */
export type EditPreview =
  | { type: 'code'; before: string; after: string }
  | { type: 'sprite'; before: string; after: string; label: string }
  | { type: 'text'; summary: string };

export interface ToolContext {
  /** The cart being edited (live object; do not mutate directly — use update). */
  cart(): Cart;
  /** Applies a change to the cart; creates an undo snapshot first. */
  update(kinds: (AssetKind | 'code')[], label: string, fn: (cart: Cart) => void): void;
  exec: Executor;
  playSfx?(n: number): void;
}

export interface ToolDef<A = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** read: no side effects; edit: changes the cart (needs approval in approve mode); exec: runs code headless. */
  kind: 'read' | 'edit' | 'exec';
  run(args: A, ctx: ToolContext): Promise<ToolResult> | ToolResult;
  /** Short human summary of the arguments for the tool card. */
  summarize?(args: A): string;
  /** Preview of an edit (for approval/diff). */
  preview?(args: A, ctx: ToolContext): EditPreview | Promise<EditPreview>;
}

export class ToolError extends Error {}

export function ok(value: unknown, images?: string[]): ToolResult {
  return { content: typeof value === 'string' ? value : JSON.stringify(value, null, 1), images };
}

export function fail(message: string): ToolResult {
  return { content: JSON.stringify({ error: message }), isError: true };
}
