import { API_DOCS } from '../runtime/api/docs';
import { PALETTE_NAMES } from '../runtime/palette';
import template from './system-prompt.md?raw';

export function systemPrompt(): string {
  const api = API_DOCS.filter((d) => d.category !== 'lua').map((d) => `- ${d.sig}: ${d.desc}`).join('\n');
  const palette = PALETTE_NAMES.map((n, i) => `${i} ${n}`).join(', ');
  return template.replace('{{API}}', api).replace('{{PALETTE}}', palette);
}
