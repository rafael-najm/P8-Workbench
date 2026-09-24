/** Note names <-> PICO-8 pitches (0 = c0 ... 63 = d#5). */
export const NOTE_NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'] as const;

export function pitchName(pitch: number): string {
  return `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12)}`;
}

/** Parses "c#3", "A2", "eb4", "d-1"-style names or plain numbers. Returns null if invalid or out of range. */
export function parsePitch(v: string | number): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 63 ? v : null;
  const s = v.trim().toLowerCase();
  if (/^\d+$/.test(s)) return parsePitch(Number(s));
  const m = /^([a-g])([#b-]?)(\d)$/.exec(s.replace('♯', '#').replace('♭', 'b'));
  if (!m) return null;
  let idx = NOTE_NAMES.indexOf(m[1] as (typeof NOTE_NAMES)[number]);
  if (m[2] === '#') idx++;
  else if (m[2] === 'b') idx--;
  const p = Number(m[3]) * 12 + idx;
  return p >= 0 && p <= 63 ? p : null;
}
