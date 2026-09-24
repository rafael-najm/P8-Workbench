/**
 * PICO-8 Lua lexer.
 *
 * Operates on a "p8 string" (see `toP8String`): every char code is a P8SCII
 * byte, so each glyph is exactly one character. Handles PICO-8 extensions:
 * `//` comments, `!=`, `\` integer division, `^^`, `>>>`, `<<>`, `>><`,
 * compound assignments, `?`, `@`, `$`, binary literals and fractional hex.
 *
 * Token boundaries follow PICO-8 (validated against shrinko8), so the token
 * counter and the M2 preprocessor share one source of truth.
 */

export type TokenType = 'number' | 'ident' | 'keyword' | 'string' | 'punct' | 'error';

export interface Token {
  type: TokenType;
  value: string;
  /** Offset of the first char (in the p8 string). */
  start: number;
  /** Offset one past the last char. */
  end: number;
  /** 1-based line number of the first char. */
  line: number;
}

export interface Comment {
  text: string;
  start: number;
  end: number;
  line: number;
  block: boolean;
}

export interface LexError {
  message: string;
  start: number;
  line: number;
}

export interface LexResult {
  tokens: Token[];
  comments: Comment[];
  errors: LexError[];
}

export const KEYWORDS: ReadonlySet<string> = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if',
  'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while',
]);

const WHITESPACE = ' \t\r\n';
const PUNCT_START = '+-*/\\%&|^<>=~#()[]{};,?@$.:';

export function isIdentChar(ch: string): boolean {
  if (!ch) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 48 && c <= 57) || // 0-9
    (c >= 97 && c <= 122) || // a-z
    (c >= 65 && c <= 90) || // A-Z
    c === 95 || // _
    c === 0x1e ||
    c === 0x1f ||
    c >= 0x80
  );
}

const isDigit = (ch: string) => ch >= '0' && ch <= '9' && ch.length === 1;

export function lex(src: string): LexResult {
  const tokens: Token[] = [];
  const comments: Comment[] = [];
  const errors: LexError[] = [];
  let i = 0;
  let line = 1;

  const peek = (off = 0) => src[i + off] ?? '';
  const accept = (ch: string) => {
    if (src[i] === ch) {
      i++;
      return true;
    }
    return false;
  };
  const countLines = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (src.charCodeAt(k) === 10) line++;
  };
  const push = (type: TokenType, start: number, tokLine: number) => {
    tokens.push({ type, value: src.slice(start, i), start, end: i, line: tokLine });
  };

  /** Tries to read `[==[ ... ]==]` at `i`. Returns [contentStart, contentEnd] or null (i unchanged). */
  const longBrackets = (): [number, number] | null => {
    const save = i;
    if (!accept('[')) return null;
    const padStart = i;
    while (accept('=')) {
      /* count padding */
    }
    const pad = src.slice(padStart, i);
    if (accept('[')) {
      const contentStart = i;
      const close = src.indexOf(`]${pad}]`, i);
      if (close >= 0) {
        i = close + pad.length + 2;
        return [contentStart, close];
      }
    }
    i = save;
    return null;
  };

  while (i < src.length) {
    const start = i;
    const startLine = line;
    const ch = src[i++]!;

    if (WHITESPACE.includes(ch)) {
      if (ch === '\n') line++;
      continue;
    }

    // number
    if (isDigit(ch) || (ch === '.' && isDigit(peek()))) {
      i = start;
      let digits = '0123456789';
      if (ch === '0' && (peek(1) === 'b' || peek(1) === 'B')) {
        i += 2;
        digits = '01';
      } else if (ch === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        i += 2;
        digits = '0123456789abcdefABCDEF';
      }
      for (;;) {
        const c = peek();
        if (c && (digits.includes(c) || c === '.')) i++;
        else break;
      }
      push('number', start, startLine);
      continue;
    }

    // identifier / keyword
    if (isIdentChar(ch)) {
      while (isIdentChar(peek())) i++;
      const word = src.slice(start, i);
      push(KEYWORDS.has(word) ? 'keyword' : 'ident', start, startLine);
      continue;
    }

    // quoted string
    if (ch === '"' || ch === "'") {
      let terminated = false;
      while (i < src.length) {
        const c = src[i++]!;
        if (c === '\n') {
          i--;
          break;
        }
        if (c === '\\') {
          if (accept('z')) {
            while (WHITESPACE.includes(peek()) && i < src.length) {
              if (peek() === '\n') line++;
              i++;
            }
          } else {
            if (peek() === '\n') line++;
            i++;
          }
        } else if (c === ch) {
          terminated = true;
          break;
        }
      }
      if (!terminated) errors.push({ message: 'Unterminated string', start, line: startLine });
      push('string', start, startLine);
      continue;
    }

    // long string
    if (ch === '[' && (peek() === '=' || peek() === '[')) {
      i = start;
      if (longBrackets()) {
        countLines(start, i);
        push('string', start, startLine);
      } else {
        i = start + 1;
        errors.push({ message: 'Invalid long brackets', start, line: startLine });
        push('error', start, startLine);
      }
      continue;
    }

    // comments: --, --[[ ]], //
    if ((ch === '-' && peek() === '-') || (ch === '/' && peek() === '/')) {
      i++;
      if (ch === '-') {
        const body = longBrackets();
        if (body) {
          comments.push({ text: src.slice(body[0], body[1]), start, end: i, line: startLine, block: true });
          countLines(start, i);
          continue;
        }
      }
      const nl = src.indexOf('\n', i);
      i = nl === -1 ? src.length : nl;
      comments.push({ text: src.slice(start + 2, i), start, end: i, line: startLine, block: false });
      continue;
    }

    // punctuation
    if (PUNCT_START.includes(ch)) {
      if ('.:/^<>'.includes(ch) && accept(ch)) {
        // doubled: .. :: ^^ << >>
        if ((ch === '.' || ch === '>') && accept(ch)) {
          // ... or >>>
          if (ch === '>') accept('=');
        } else if ((ch === '<' || ch === '>') && accept(ch === '<' ? '>' : '<')) {
          // <<> or >><
          accept('=');
        } else if ('./^<>'.includes(ch)) {
          accept('=');
        }
      } else if ('+-*/\\%&|^<>=~'.includes(ch)) {
        accept('=');
      }
      push('punct', start, startLine);
      continue;
    }

    if (ch === '!' && accept('=')) {
      push('punct', start, startLine);
      continue;
    }

    errors.push({ message: `Invalid character '${ch}'`, start, line: startLine });
    push('error', start, startLine);
  }

  return { tokens, comments, errors };
}
