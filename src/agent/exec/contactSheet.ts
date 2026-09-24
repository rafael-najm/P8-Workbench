/** Builds a labelled contact sheet from several 128x128 screens (palette indices). */
import { FONT } from '../../runtime/font';

export function contactSheet(screens: { label: string; pixels: Uint8Array }[], columns = 4): { pixels: Uint8Array; width: number; height: number } {
  const cols = Math.min(columns, screens.length);
  const rows = Math.ceil(screens.length / cols);
  const cellW = 128;
  const cellH = 128 + 8;
  const gap = 2;
  const width = cols * cellW + (cols + 1) * gap;
  const height = rows * cellH + (rows + 1) * gap;
  const out = new Uint8Array(width * height).fill(1); // dark blue background
  screens.forEach((s, i) => {
    const cx = gap + (i % cols) * (cellW + gap);
    const cy = gap + Math.floor(i / cols) * (cellH + gap);
    for (let y = 0; y < 128; y++) out.set(s.pixels.subarray(y * 128, y * 128 + 128), (cy + 8 + y) * width + cx);
    // label in white
    let x = cx + 1;
    for (const ch of s.label.toLowerCase()) {
      const code = ch.charCodeAt(0) & 0x7f;
      for (let row = 0; row < 5; row++) {
        const bits = FONT[code * 5 + row]!;
        for (let col = 0; col < 3; col++) if ((bits >> col) & 1) out[(cy + 1 + row) * width + x + col] = 7;
      }
      x += 4;
    }
  });
  return { pixels: out, width, height };
}
