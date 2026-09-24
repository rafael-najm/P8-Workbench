/**
 * Monaco setup: bundled locally (no CDN), only the editor worker, plus the
 * `pico8-lua` language, theme, completions, hovers and token CodeLens.
 */
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/features/register.all';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { loader } from '@monaco-editor/react';
import { functionTokenCounts } from '../../cart/tokens';
import { API_BY_NAME, API_DOCS, GLYPHS } from '../../runtime/api/docs';
import { PALETTE_HEX, PALETTE_NAMES } from '../../runtime/palette';

export { monaco };
export const LANGUAGE_ID = 'pico8-lua';
export const THEME_ID = 'pico8-dark';

declare global {
  interface Window {
    MonacoEnvironment?: { getWorker(workerId: string, label: string): Worker };
  }
}

let initialized = false;

export function setupMonaco(): typeof monaco {
  if (initialized) return monaco;
  initialized = true;
  window.MonacoEnvironment = { getWorker: () => new EditorWorker() };
  loader.config({ monaco });

  monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.p8', '.lua'], aliases: ['PICO-8 Lua'] });
  monaco.languages.setLanguageConfiguration(LANGUAGE_ID, {
    comments: { lineComment: '--', blockComment: ['--[[', ']]'] },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
    ],
    indentationRules: {
      increaseIndentPattern: /^\s*((function|do|then|repeat|else)\b.*|.*\b(function|do|then)\s*(--.*)?|.*\{\s*)$/,
      decreaseIndentPattern: /^\s*(end|else|elseif|until|\})\b/,
    },
    wordPattern: /[A-Za-z_\u0080-￿][\w\u0080-￿]*/,
  });

  const apiNames = API_DOCS.filter((d) => d.category !== 'callbacks' && d.category !== 'lua').map((d) => d.name);
  const luaNames = API_DOCS.filter((d) => d.category === 'lua').map((d) => d.name);
  monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, {
    defaultToken: '',
    keywords: ['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while'],
    api: apiNames,
    builtins: luaNames,
    callbacks: ['_init', '_update', '_update60', '_draw'],
    tokenizer: {
      root: [
        [/--\[(=*)\[/, { token: 'comment', next: '@longcomment.$1' }],
        [/(--|\/\/).*$/, 'comment'],
        [/\[(=*)\[/, { token: 'string', next: '@longstring.$1' }],
        [/"/, { token: 'string.quote', next: '@dstring' }],
        [/'/, { token: 'string.quote', next: '@sstring' }],
        [/0[xX][0-9a-fA-F]*(\.[0-9a-fA-F]*)?/, 'number.hex'],
        [/0[bB][01]*(\.[01]*)?/, 'number.binary'],
        [/\d*\.?\d+/, 'number'],
        [/[⬅➡⬆⬇❎🅾][️]?|[♥★●◆♪…█▒░🐱웃⌂😐☉✽⧗ˇ∧▤▥]/u, 'glyph'],
        [/[A-Za-z_][\w]*/, { cases: { '@keywords': 'keyword', '@callbacks': 'callback', '@api': 'api', '@builtins': 'builtin', '@default': 'identifier' } }],
        [/::\w+::/, 'label'],
        [/(\.\.=|\.\.\.|\.\.|>>>=|<<>=|>><=|>>>|<<>|>><|\^\^=|\^\^|<<=|>>=|<<|>>|[+\-*/\\%^|&]=|!=|~=|==|<=|>=)/, 'operator'],
        [/[?@$]/, 'operator.special'],
        [/[+\-*/\\%^#<>=~&|]/, 'operator'],
        [/[{}()[\]]/, '@brackets'],
        [/[;,.:]/, 'delimiter'],
      ],
      dstring: [
        [/\\(\^.|#.|f.|[*|+\-]..?|\d{1,3}|x[0-9a-fA-F]{2}|.)/, 'string.escape'],
        [/[^\\"]+/, 'string'],
        [/"/, { token: 'string.quote', next: '@pop' }],
      ],
      sstring: [
        [/\\(\^.|#.|f.|[*|+\-]..?|\d{1,3}|x[0-9a-fA-F]{2}|.)/, 'string.escape'],
        [/[^\\']+/, 'string'],
        [/'/, { token: 'string.quote', next: '@pop' }],
      ],
      longcomment: [
        [/\](=*)\]/, { cases: { '$1==$S2': { token: 'comment', next: '@pop' }, '@default': 'comment' } }],
        [/./, 'comment'],
      ],
      longstring: [
        [/\](=*)\]/, { cases: { '$1==$S2': { token: 'string', next: '@pop' }, '@default': 'string' } }],
        [/./, 'string'],
      ],
    },
  } as monaco.languages.IMonarchLanguage);

  monaco.editor.defineTheme(THEME_ID, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '5f6a86', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff77a8' },
      { token: 'callback', foreground: 'ffa300', fontStyle: 'bold' },
      { token: 'api', foreground: '29adff' },
      { token: 'builtin', foreground: '83769c' },
      { token: 'number', foreground: 'ffec27' },
      { token: 'number.hex', foreground: 'ffec27' },
      { token: 'number.binary', foreground: 'ffec27' },
      { token: 'string', foreground: '00e436' },
      { token: 'string.quote', foreground: '00e436' },
      { token: 'string.escape', foreground: 'ffccaa' },
      { token: 'glyph', foreground: 'ffccaa' },
      { token: 'operator', foreground: 'c2c3c7' },
      { token: 'operator.special', foreground: 'ff77a8' },
      { token: 'label', foreground: 'ffa300' },
      { token: 'identifier', foreground: 'e6e1dc' },
    ],
    colors: {
      'editor.background': '#0b0f1a',
      'editor.foreground': '#e6e1dc',
      'editorLineNumber.foreground': '#2e3650',
      'editorLineNumber.activeForeground': '#29adff',
      'editor.lineHighlightBackground': '#121829',
      'editor.selectionBackground': '#1d2b53',
      'editorCursor.foreground': '#ff77a8',
      'editorIndentGuide.background1': '#161d30',
      'editorWidget.background': '#111623',
      'editorWidget.border': '#232a3b',
      'editorSuggestWidget.selectedBackground': '#1d2b53',
      'editorCodeLens.foreground': '#4b5577',
      'scrollbarSlider.background': '#1d2b5388',
      'minimap.background': '#0b0f1a',
    },
  });

  registerProviders();
  return monaco;
}

function registerProviders() {
  // Completions: API functions with signatures, snippets for callbacks, glyphs.
  monaco.languages.registerCompletionItemProvider(LANGUAGE_ID, {
    triggerCharacters: ['\\'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
      if (lineBefore.endsWith('\\')) {
        const r = new monaco.Range(position.lineNumber, position.column - 1, position.lineNumber, position.column);
        return {
          suggestions: GLYPHS.map((g) => ({
            label: `${g.glyph} ${g.name}`,
            kind: monaco.languages.CompletionItemKind.Constant,
            insertText: g.glyph,
            filterText: `\\${g.name}`,
            range: r,
          })),
        };
      }
      const suggestions: monaco.languages.CompletionItem[] = API_DOCS.map((d) => {
        if (d.category === 'callbacks') {
          return {
            label: d.name,
            kind: monaco.languages.CompletionItemKind.Snippet,
            detail: d.sig,
            documentation: d.desc,
            insertText: `function ${d.name}()\n\t$0\nend`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          };
        }
        return {
          label: d.name,
          kind: monaco.languages.CompletionItemKind.Function,
          detail: d.sig,
          documentation: { value: `**${d.sig}**\n\n${d.desc}` },
          insertText: d.name,
          range,
        };
      });
      // Identifiers already in the file.
      const seen = new Set(API_DOCS.map((d) => d.name));
      for (const m of model.getValue().matchAll(/\b([A-Za-z_][\w]*)\b/g)) {
        const w = m[1]!;
        if (seen.has(w) || w.length < 3 || w === word.word) continue;
        seen.add(w);
        suggestions.push({ label: w, kind: monaco.languages.CompletionItemKind.Variable, insertText: w, range });
      }
      return { suggestions };
    },
  });

  // Signature help for API calls.
  monaco.languages.registerSignatureHelpProvider(LANGUAGE_ID, {
    signatureHelpTriggerCharacters: ['(', ','],
    provideSignatureHelp(model, position) {
      const call = findCall(model, position);
      if (!call) return null;
      const doc = API_BY_NAME.get(call.name);
      if (!doc) return null;
      const params = doc.sig.replace(/^[^(]*\(/, '').replace(/\)[^)]*$/, '').split(',').map((p) => p.trim()).filter(Boolean);
      return {
        value: {
          signatures: [{ label: doc.sig, documentation: doc.desc, parameters: params.map((p) => ({ label: p })) }],
          activeSignature: 0,
          activeParameter: Math.min(call.argIndex, Math.max(0, params.length - 1)),
        },
        dispose() {},
      };
    },
  });

  // Hover: API docs, and palette colors for color arguments.
  monaco.languages.registerHoverProvider(LANGUAGE_ID, {
    provideHover(model, position) {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
      const doc = API_BY_NAME.get(word.word);
      if (doc) return { range, contents: [{ value: `**${doc.sig}**` }, { value: doc.desc }] };
      if (/^\d+$/.test(word.word)) {
        const n = parseInt(word.word, 10);
        const call = findCall(model, new monaco.Position(position.lineNumber, word.startColumn));
        const api = call ? API_BY_NAME.get(call.name) : undefined;
        if (n < 16 && api?.colorParams?.includes(call!.argIndex)) {
          return {
            range,
            contents: [{ value: `<span style="color:${PALETTE_HEX[n]};">■■■</span> **${n}** ${PALETTE_NAMES[n]} \`${PALETTE_HEX[n]}\``, supportHtml: true, isTrusted: true }],
          };
        }
      }
      return null;
    },
  });

  // CodeLens: tokens per function.
  monaco.languages.registerCodeLensProvider(LANGUAGE_ID, {
    provideCodeLenses(model) {
      let fns: ReturnType<typeof functionTokenCounts> = [];
      try {
        fns = functionTokenCounts(model.getValue());
      } catch {
        fns = [];
      }
      return {
        lenses: fns.map((f) => ({
          range: new monaco.Range(f.line, 1, f.line, 1),
          command: { id: '', title: `${f.tokens} tokens · ${f.endLine - f.line + 1} lines` },
        })),
        dispose() {},
      };
    },
  });
}

/** Finds the innermost call around a position: function name and argument index. */
function findCall(model: monaco.editor.ITextModel, position: monaco.Position): { name: string; argIndex: number } | null {
  const text = model.getValueInRange(new monaco.Range(Math.max(1, position.lineNumber - 5), 1, position.lineNumber, position.column));
  let depth = 0;
  let arg = 0;
  let inString: string | null = null;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]!;
    if (inString) {
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") inString = ch;
    else if (ch === ')' || ch === ']' || ch === '}') depth++;
    else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) {
        if (ch !== '(') return null;
        const m = /([A-Za-z_][\w]*)\s*$/.exec(text.slice(0, i));
        return m ? { name: m[1]!, argIndex: arg } : null;
      }
      depth--;
    } else if (ch === ',' && depth === 0) arg++;
  }
  return null;
}
