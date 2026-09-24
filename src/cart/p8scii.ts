/**
 * P8SCII <-> Unicode mapping.
 *
 * PICO-8 has a 256-glyph charset. In `.p8` text files, bytes outside printable
 * ASCII are written as specific Unicode characters (some of them followed by
 * the emoji variation selector U+FE0F, e.g. "⬅️"). This table is the complete
 * byte -> unicode mapping used by PICO-8's `.p8` format.
 */

const LOW_CONTROL = [
  '\0', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '\t', '\n', 'ᵇ', 'ᶜ', '\r', 'ᵉ', 'ᶠ',
  '▮', '■', '□', '⁙', '⁘', '‖', '◀', '▶', '「', '」', '¥', '•', '、', '。', '゛', '゜',
];

const HIGH = [
  '○',
  '█', '▒', '🐱', '⬇️', '░', '✽', '●', '♥', '☉', '웃', '⌂', '⬅️', '😐', '♪', '🅾️', '◆',
  '…', '➡️', '★', '⧗', '⬆️', 'ˇ', '∧', '❎', '▤', '▥', 'あ', 'い', 'う', 'え', 'お', 'か',
  'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ', 'た', 'ち', 'つ', 'て', 'と', 'な', 'に',
  'ぬ', 'ね', 'の', 'は', 'ひ', 'ふ', 'へ', 'ほ', 'ま', 'み', 'む', 'め', 'も', 'や', 'ゆ', 'よ',
  'ら', 'り', 'る', 'れ', 'ろ', 'わ', 'を', 'ん', 'っ', 'ゃ', 'ゅ', 'ょ', 'ア', 'イ', 'ウ', 'エ',
  'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ', 'タ', 'チ', 'ツ', 'テ', 'ト',
  'ナ', 'ニ', 'ヌ', 'ネ', 'ノ', 'ハ', 'ヒ', 'フ', 'ヘ', 'ホ', 'マ', 'ミ', 'ム', 'メ', 'モ', 'ヤ',
  'ユ', 'ヨ', 'ラ', 'リ', 'ル', 'レ', 'ロ', 'ワ', 'ヲ', 'ン', 'ッ', 'ャ', 'ュ', 'ョ', '◜', '◝',
];

/** P8SCII byte -> unicode string (index 0..255). */
export const P8SCII_TO_UNICODE: readonly string[] = (() => {
  const table: string[] = [...LOW_CONTROL];
  for (let i = 0x20; i < 0x7f; i++) table.push(String.fromCharCode(i));
  table.push(...HIGH);
  if (table.length !== 256) throw new Error(`P8SCII table has ${table.length} entries`);
  return table;
})();

/** Unicode "italic" capitals that PICO-8 uses when copying uppercase (puny) letters. */
const UNICAPS = [...'𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻'];

const UNICODE_TO_P8SCII: ReadonlyMap<string, number> = (() => {
  const map = new Map<string, number>();
  P8SCII_TO_UNICODE.forEach((ch, i) => map.set(ch, i));
  UNICAPS.forEach((ch, i) => map.set(ch, 0x41 + i));
  // Glyphs that normally carry U+FE0F are also accepted without it.
  P8SCII_TO_UNICODE.forEach((ch, i) => {
    if (ch.endsWith('️')) map.set(ch.slice(0, -1), i);
  });
  return map;
})();

/** Named button glyphs, handy for the API docs / agent. */
export const GLYPH = {
  left: '⬅️',
  right: '➡️',
  up: '⬆️',
  down: '⬇️',
  o: '🅾️',
  x: '❎',
  heart: '♥',
} as const;

/**
 * Convert a unicode string (as stored in a `.p8` file) to a P8SCII byte array.
 * Unknown characters are encoded as their UTF-8 bytes, like PICO-8 does.
 */
export function unicodeToP8scii(text: string): Uint8Array {
  const out: number[] = [];
  const cps = [...text];
  const encoder = new TextEncoder();
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i]!;
    const code = ch.codePointAt(0)!;
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    const next = cps[i + 1];
    // Prefer the 2-codepoint form (glyph + variation selector) when present.
    if (next === '️') {
      const pair = UNICODE_TO_P8SCII.get(ch + next);
      if (pair !== undefined) {
        out.push(pair);
        i++;
        continue;
      }
    }
    const single = UNICODE_TO_P8SCII.get(ch);
    if (single !== undefined) {
      out.push(single);
      continue;
    }
    for (const b of encoder.encode(ch)) out.push(b);
  }
  return Uint8Array.from(out);
}

/** Convert P8SCII bytes to a unicode string (the `.p8` text representation). */
export function p8sciiToUnicode(bytes: ArrayLike<number>): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += P8SCII_TO_UNICODE[bytes[i]! & 0xff];
  return s;
}

/**
 * Convert a unicode string to a "p8 string": a JS string where every char
 * code is a P8SCII byte (0..255). Convenient for tokenizers.
 */
export function toP8String(text: string): string {
  const bytes = unicodeToP8scii(text);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

/** Inverse of {@link toP8String}. */
export function fromP8String(p8: string): string {
  let s = '';
  for (let i = 0; i < p8.length; i++) s += P8SCII_TO_UNICODE[p8.charCodeAt(i) & 0xff];
  return s;
}
