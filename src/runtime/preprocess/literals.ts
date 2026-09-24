/** Decoding of PICO-8 number and string literals. */

const FIX_MASK = 0xffffffff;

/** Wraps a raw 32-bit fixed-point value to the signed 16.16 number it represents. */
export function fixToNumber(raw: number): number {
  const u = raw >>> 0;
  return (u >= 0x80000000 ? u - 0x100000000 : u) / 65536;
}

/** Truncates a number to its 16.16 raw representation (wrapping like PICO-8). */
export function numberToFix(value: number): number {
  return Number(BigInt.asUintN(32, BigInt(Math.trunc(value * 65536)))) & FIX_MASK;
}

/**
 * Parses a PICO-8 number literal (`12`, `.5`, `0x5a5a.8`, `0b1010.1`) into
 * its 16.16 raw value. Literals out of range wrap, like in PICO-8.
 */
export function parseNumberLiteral(text: string): number | null {
  let s = text.toLowerCase();
  let base = 10;
  if (s.startsWith('0x')) {
    base = 16;
    s = s.slice(2);
  } else if (s.startsWith('0b')) {
    base = 2;
    s = s.slice(2);
  }
  const digit = (ch: string) => {
    const v = parseInt(ch, base);
    return Number.isNaN(v) ? -1 : v;
  };
  let value = 0;
  let i = 0;
  while (i < s.length && digit(s[i]!) >= 0) value = value * base + digit(s[i++]!);
  if (s[i] === '.') {
    i++;
    let scale = 1;
    while (i < s.length && digit(s[i]!) >= 0) {
      scale /= base;
      value += digit(s[i++]!) * scale;
    }
  }
  if (i !== s.length || s.length === 0) return null;
  // Precision beyond 2^53 is irrelevant: only the low 32 bits of value*65536 are kept.
  const scaled = Math.trunc(value * 65536);
  return Number(BigInt.asUintN(32, BigInt(scaled)));
}

const SIMPLE_ESCAPES: Record<string, number> = {
  '*': 1, '#': 2, '-': 3, '|': 4, '+': 5, '^': 6,
  a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13,
  '\\': 92, '"': 34, "'": 39, '\n': 10,
};

export class StringLiteralError extends Error {}

/**
 * Decodes a string literal token (quoted or long-bracket) from a p8 string
 * into its value, also as a p8 string (1 char = 1 P8SCII byte). Control-code
 * escapes like `\^` and `\#` become their raw bytes; `print` interprets them.
 */
export function decodeStringLiteral(token: string): string {
  if (token.startsWith('[')) {
    const open = token.indexOf('[', 1) + 1;
    let body = token.slice(open, token.length - open);
    body = body.replace(/\r\n?/g, '\n');
    if (body.startsWith('\n')) body = body.slice(1);
    return body;
  }
  const body = token.slice(1, -1);
  let out = '';
  let i = 0;
  while (i < body.length) {
    const ch = body[i]!;
    if (ch !== '\\') {
      out += ch;
      i++;
      continue;
    }
    const esc = body[i + 1] ?? '';
    const simple = SIMPLE_ESCAPES[esc];
    if (simple !== undefined) {
      out += String.fromCharCode(simple);
      i += 2;
    } else if (esc === 'z') {
      i += 2;
      while (i < body.length && ' \t\r\n'.includes(body[i]!)) i++;
    } else if (esc === 'x') {
      const hex = body.slice(i + 2, i + 4);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new StringLiteralError(`invalid hex escape '\\x${hex}'`);
      out += String.fromCharCode(parseInt(hex, 16));
      i += 4;
    } else if (esc >= '0' && esc <= '9') {
      let j = i + 1;
      while (j < i + 4 && j < body.length && body[j]! >= '0' && body[j]! <= '9') j++;
      const v = parseInt(body.slice(i + 1, j), 10);
      if (v > 255) throw new StringLiteralError(`decimal escape too large '\\${v}'`);
      out += String.fromCharCode(v);
      i = j;
    } else {
      throw new StringLiteralError(`invalid escape '\\${esc}'`);
    }
  }
  return out;
}

/** Encodes a p8 string as a Lua 5.4 literal that is pure ASCII (bytes survive UTF-8 transport). */
export function encodeLuaString(value: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i) & 0xff;
    if (c === 34) out += '\\"';
    else if (c === 92) out += '\\\\';
    else if (c === 10) out += '\\n';
    else if (c >= 0x20 && c < 0x7f) out += String.fromCharCode(c);
    else out += '\\' + c.toString().padStart(3, '0');
  }
  return out + '"';
}

/** Formats a number as a Lua float literal (always float subtype). */
export function formatLuaNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`;
  const s = String(value);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
}
