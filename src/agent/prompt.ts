import { PALETTE_NAMES } from '../runtime/palette';
import template from './system-prompt.md?raw';

export function systemPrompt(): string {
  const palette = PALETTE_NAMES.map((n, i) => `${i} ${n}`).join(', ');
  return template.replace('{{PALETTE}}', palette);
}
