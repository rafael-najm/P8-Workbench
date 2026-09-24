/**
 * `.p8` text cartridge parser / serializer.
 *
 * Serialization is lossless: every section remembers the raw text it was
 * parsed from, and if its data is unchanged, the raw text is written back.
 * Modified (or new) sections are written in canonical PICO-8 formatting.
 */
import { createEmptyCart, emptyMusic, emptySfx, syncGfxFromMap, syncMapFromGfx } from './cart';
import {
  GFX_H,
  GFX_W,
  MAP_H,
  MAP_SHARED_ROW,
  MAP_W,
  MUSIC_COUNT,
  SFX_COUNT,
  SFX_NOTES,
  type Cart,
  type CartFileLayout,
  type MusicPattern,
  type Sfx,
} from './types';

export const P8_HEADER = 'pico-8 cartridge // http://www.pico-8.com';

const KNOWN_SECTIONS = ['lua', 'gfx', 'label', 'gff', 'map', 'sfx', 'music'] as const;
type KnownSection = (typeof KNOWN_SECTIONS)[number];

export class P8ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (line ${line})`);
    this.name = 'P8ParseError';
  }
}

function sectionNameOf(line: string): string | null {
  const clean = line.trim();
  if (clean.length <= 4 || !clean.startsWith('__') || !clean.endsWith('__')) return null;
  const name = clean.slice(2, -2);
  if ((KNOWN_SECTIONS as readonly string[]).includes(name) || name.startsWith('meta:')) return name;
  return null;
}

// --- hex helpers ---------------------------------------------------------

function hexDigit(ch: string, lineNo: number): number {
  const v = parseInt(ch, 16);
  if (Number.isNaN(v)) throw new P8ParseError(`Invalid hex digit '${ch}'`, lineNo);
  return v;
}

/** Label pixels use 0-f and g-v (16..31, secret palette). */
function extDigit(ch: string, lineNo: number): number {
  const lower = ch.toLowerCase();
  if (lower >= 'g' && lower <= 'v') return lower.charCodeAt(0) - 'g'.charCodeAt(0) + 16;
  return hexDigit(ch, lineNo);
}

const hex1 = (v: number) => (v & 0xf).toString(16);
const hex2 = (v: number) => (v & 0xff).toString(16).padStart(2, '0');
const extHex = (v: number) => (v < 16 ? hex1(v) : String.fromCharCode('g'.charCodeAt(0) + v - 16));

/** Read 2-hex-digit bytes, right-padding a trailing odd digit with 0 (like PICO-8). */
function readBytes(line: string, lineNo: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < line.length; i += 2) {
    const pair = line.slice(i, i + 2).padEnd(2, '0');
    out.push(hexDigit(pair[0]!, lineNo) * 16 + hexDigit(pair[1]!, lineNo));
  }
  return out;
}

// --- parse -----------------------------------------------------------------

interface RawSection {
  name: string;
  /** Line number (1-based) of the section header. */
  startLine: number;
  /** Content lines (between the header and the next section). */
  lines: string[];
  /** Raw text including the header line and all trailing newlines. */
  raw: string;
}

export function parseP8(text: string): Cart {
  const eol: '\n' | '\r\n' = text.includes('\r\n') ? '\r\n' : '\n';
  const normalized = eol === '\r\n' ? text.replace(/\r\n/g, '\n') : text;

  // Split while remembering the offset of each line start.
  const lines = normalized.split('\n');
  const offsets: number[] = [];
  let off = 0;
  for (const l of lines) {
    offsets.push(off);
    off += l.length + 1;
  }

  const sectionStarts: { name: string; index: number }[] = [];
  lines.forEach((line, i) => {
    const name = sectionNameOf(line);
    if (name !== null) sectionStarts.push({ name, index: i });
  });

  const headerEnd = sectionStarts.length > 0 ? offsets[sectionStarts[0]!.index]! : normalized.length;
  const header = normalized.slice(0, headerEnd);

  const raws: RawSection[] = sectionStarts.map((s, k) => {
    const next = sectionStarts[k + 1];
    // At EOF, the split yields a trailing '' for the file's final newline: drop it.
    const endIndex = next ? next.index : lines.at(-1) === '' ? lines.length - 1 : lines.length;
    const rawEnd = next ? offsets[next.index]! : normalized.length;
    return {
      name: s.name,
      startLine: s.index + 1,
      lines: lines.slice(s.index + 1, endIndex),
      raw: normalized.slice(offsets[s.index]!, rawEnd),
    };
  });

  const cart = createEmptyCart();
  const versionMatch = /^version\s+(\d+)/m.exec(header);
  if (versionMatch) cart.version = parseInt(versionMatch[1]!, 10);

  let mapRowsParsed = 0;
  for (const sec of raws) {
    switch (sec.name) {
      case 'lua':
        cart.code = parseLua(sec);
        break;
      case 'gfx':
        parseGfx(cart, sec);
        break;
      case 'gff':
        parseGff(cart, sec);
        break;
      case 'label':
        cart.label = parseLabel(sec);
        break;
      case 'map':
        mapRowsParsed = parseMap(cart, sec);
        break;
      case 'sfx':
        parseSfx(cart, sec);
        break;
      case 'music':
        parseMusic(cart, sec);
        break;
      default:
        cart.extraSections.push({ name: sec.name, lines: sec.lines });
    }
  }
  // Resolve the shared gfx/map memory. A map section with more than 32 rows
  // writes into the shared area (it comes after __gfx__ in the file).
  if (mapRowsParsed > MAP_SHARED_ROW) syncGfxFromMap(cart);
  else syncMapFromGfx(cart);

  const layout: CartFileLayout = { header, version: cart.version, order: raws.map((r) => r.name), sections: {}, eol };
  for (const sec of raws) {
    layout.sections[sec.name] = { raw: sec.raw, canonical: canonicalSection(cart, sec.name) };
  }
  cart.source = layout;
  return cart;
}

function parseLua(sec: RawSection): string {
  return sec.lines.join('\n');
}

function forEachDataLine(sec: RawSection, max: number, fn: (clean: string, y: number, lineNo: number) => void) {
  let y = 0;
  sec.lines.forEach((line, i) => {
    const clean = line.trim();
    if (!clean || y >= max) return;
    fn(clean, y, sec.startLine + 1 + i);
    y++;
  });
  return y;
}

function parseGfx(cart: Cart, sec: RawSection) {
  forEachDataLine(sec, GFX_H, (clean, y, lineNo) => {
    for (let x = 0; x < Math.min(clean.length, GFX_W); x++) {
      cart.gfx[y * GFX_W + x] = hexDigit(clean[x]!, lineNo);
    }
  });
}

function parseGff(cart: Cart, sec: RawSection) {
  forEachDataLine(sec, 2, (clean, y, lineNo) => {
    readBytes(clean, lineNo)
      .slice(0, 128)
      .forEach((b, x) => (cart.flags[y * 128 + x] = b));
  });
}

function parseLabel(sec: RawSection): Uint8Array {
  const label = new Uint8Array(128 * 128);
  forEachDataLine(sec, 128, (clean, y, lineNo) => {
    for (let x = 0; x < Math.min(clean.length, 128); x++) label[y * 128 + x] = extDigit(clean[x]!, lineNo);
  });
  return label;
}

function parseMap(cart: Cart, sec: RawSection): number {
  return forEachDataLine(sec, MAP_H, (clean, y, lineNo) => {
    readBytes(clean, lineNo)
      .slice(0, MAP_W)
      .forEach((b, x) => (cart.map[y * MAP_W + x] = b));
  });
}

function parseSfx(cart: Cart, sec: RawSection) {
  forEachDataLine(sec, SFX_COUNT, (clean, y, lineNo) => {
    const header = readBytes(clean.slice(0, 8).padEnd(8, '0'), lineNo);
    const sfx: Sfx = {
      editorMode: header[0]!,
      speed: header[1]!,
      loopStart: header[2]!,
      loopEnd: header[3]!,
      notes: [],
    };
    const body = clean.slice(8);
    for (let n = 0; n < SFX_NOTES; n++) {
      const group = body.slice(n * 5, n * 5 + 5).padEnd(5, '0');
      const d = [...group].map((ch) => hexDigit(ch, lineNo));
      const wave = d[2]!;
      sfx.notes.push({
        pitch: ((d[0]! & 0x3) << 4) | d[1]!,
        waveform: wave & 0x7,
        customInstrument: (wave & 0x8) !== 0,
        volume: d[3]! & 0x7,
        effect: d[4]! & 0x7,
      });
    }
    cart.sfx[y] = sfx;
  });
}

function parseMusic(cart: Cart, sec: RawSection) {
  forEachDataLine(sec, MUSIC_COUNT, (clean, y, lineNo) => {
    const [flagsHex = '00', chans = ''] = clean.split(/\s+/);
    const flags = readBytes(flagsHex, lineNo)[0] ?? 0;
    const bytes = readBytes(chans.padEnd(8, '0'), lineNo);
    cart.music[y] = {
      flags,
      channels: [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!],
    };
  });
}

// --- serialize ----------------------------------------------------------------

function lastNonDefault(count: number, isDefault: (i: number) => boolean): number {
  let n = count;
  while (n > 0 && isDefault(n - 1)) n--;
  return n;
}

function rowIsZero(arr: Uint8Array, start: number, len: number): boolean {
  for (let i = start; i < start + len; i++) if (arr[i] !== 0) return false;
  return true;
}

function sfxIsDefault(sfx: Sfx, index: number): boolean {
  const d = emptySfx(index);
  return (
    sfx.editorMode === d.editorMode &&
    sfx.speed === d.speed &&
    sfx.loopStart === d.loopStart &&
    sfx.loopEnd === d.loopEnd &&
    sfx.notes.every((n) => n.pitch === 0 && n.waveform === 0 && n.volume === 0 && n.effect === 0 && !n.customInstrument)
  );
}

function musicIsDefault(m: MusicPattern): boolean {
  const d = emptyMusic();
  return m.flags === d.flags && m.channels.every((c, i) => c === d.channels[i]);
}

export function serializeSfxLine(sfx: Sfx): string {
  let s = hex2(sfx.editorMode) + hex2(sfx.speed) + hex2(sfx.loopStart) + hex2(sfx.loopEnd);
  for (let n = 0; n < SFX_NOTES; n++) {
    const note = sfx.notes[n];
    if (!note) {
      s += '00000';
      continue;
    }
    const wave = (note.waveform & 0x7) | (note.customInstrument ? 0x8 : 0);
    s += hex2(note.pitch & 0x3f) + hex1(wave) + hex1(note.volume & 0x7) + hex1(note.effect & 0x7);
  }
  return s;
}

export function serializeMusicLine(m: MusicPattern): string {
  return `${hex2(m.flags)} ${m.channels.map(hex2).join('')}`;
}

/** Canonical text of one section (header line + data lines), or '' if it would be empty. */
function canonicalSection(cart: Cart, name: string): string {
  const out: string[] = [];
  switch (name as KnownSection) {
    case 'lua':
      return `__lua__\n${cart.code}\n`;
    case 'gfx': {
      const rows = lastNonDefault(GFX_H, (y) => rowIsZero(cart.gfx, y * GFX_W, GFX_W));
      for (let y = 0; y < rows; y++) {
        let line = '';
        for (let x = 0; x < GFX_W; x++) line += hex1(cart.gfx[y * GFX_W + x]!);
        out.push(line);
      }
      break;
    }
    case 'label': {
      if (!cart.label) return '';
      for (let y = 0; y < 128; y++) {
        let line = '';
        for (let x = 0; x < 128; x++) line += extHex(cart.label[y * 128 + x]!);
        out.push(line);
      }
      break;
    }
    case 'gff': {
      const rows = lastNonDefault(2, (y) => rowIsZero(cart.flags, y * 128, 128));
      for (let y = 0; y < rows; y++) out.push(Array.from(cart.flags.subarray(y * 128, y * 128 + 128), hex2).join(''));
      break;
    }
    case 'map': {
      // Only the unshared top half is written; the rest lives in __gfx__.
      const rows = lastNonDefault(MAP_SHARED_ROW, (y) => rowIsZero(cart.map, y * MAP_W, MAP_W));
      for (let y = 0; y < rows; y++) out.push(Array.from(cart.map.subarray(y * MAP_W, y * MAP_W + MAP_W), hex2).join(''));
      break;
    }
    case 'sfx': {
      const rows = lastNonDefault(SFX_COUNT, (i) => sfxIsDefault(cart.sfx[i]!, i));
      for (let i = 0; i < rows; i++) out.push(serializeSfxLine(cart.sfx[i]!));
      break;
    }
    case 'music': {
      const rows = lastNonDefault(MUSIC_COUNT, (i) => musicIsDefault(cart.music[i]!));
      for (let i = 0; i < rows; i++) out.push(serializeMusicLine(cart.music[i]!));
      break;
    }
    default: {
      const extra = cart.extraSections.find((s) => s.name === name);
      if (!extra) return '';
      return [`__${name}__`, ...extra.lines].join('\n') + '\n';
    }
  }
  if (out.length === 0) return '';
  return [`__${name}__`, ...out].join('\n') + '\n';
}

function canonicalHeader(cart: Cart): string {
  return `${P8_HEADER}\nversion ${cart.version}\n`;
}

/** Final section order: original file order, with new sections slotted in canonical position. */
function sectionOrder(cart: Cart): string[] {
  const order = [...(cart.source?.order ?? [])];
  const wanted: string[] = [...KNOWN_SECTIONS, ...cart.extraSections.map((s) => s.name)];
  for (const name of wanted) {
    if (order.includes(name)) continue;
    const rank = wanted.indexOf(name);
    let insertAt = 0;
    order.forEach((existing, i) => {
      const r = wanted.indexOf(existing);
      if (r !== -1 && r < rank) insertAt = i + 1;
    });
    order.splice(insertAt, 0, name);
  }
  return order;
}

export function serializeP8(cart: Cart): string {
  const layout = cart.source;
  let text = '';

  text += layout && layout.version === cart.version ? layout.header : canonicalHeader(cart);

  for (const name of sectionOrder(cart)) {
    const canonical = canonicalSection(cart, name);
    const src = layout?.sections[name];
    const chunk = src && src.canonical === canonical ? src.raw : canonical;
    if (!chunk) continue;
    // A raw last section may lack its final newline; never glue two sections.
    if (text.length > 0 && !text.endsWith('\n')) text += '\n';
    text += chunk;
  }

  const eol = layout?.eol ?? '\n';
  return eol === '\n' ? text : text.replace(/\n/g, '\r\n');
}

/** Serialize ignoring the original formatting (always canonical). */
export function serializeP8Canonical(cart: Cart): string {
  const { source: _source, ...rest } = cart;
  return serializeP8(rest);
}
