/** Text rendered with the recreated PICO-8 font on a canvas (titles, labels, HUD). */
import { useEffect, useRef } from 'react';
import { toP8String } from '../../cart/p8scii';
import { charAdvance, FONT } from '../../runtime/font';

interface Props {
  text: string;
  /** Pixel scale (integer). */
  scale?: number;
  color?: string;
  /** Optional drop-shadow color, 1px down-right (in font pixels). */
  shadow?: string;
  className?: string;
}

export function PixelText({ text, scale = 2, color = '#fff1e8', shadow, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const p8 = toP8String(text.toLowerCase());
  let width = 0;
  for (let i = 0; i < p8.length; i++) width += charAdvance(p8.charCodeAt(i));
  width = Math.max(1, width - 1 + (shadow ? 1 : 0));
  const height = 5 + (shadow ? 1 : 0);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const draw = (ox: number, oy: number, fill: string) => {
      ctx.fillStyle = fill;
      let x = 0;
      for (let i = 0; i < p8.length; i++) {
        const code = p8.charCodeAt(i);
        const w = code >= 0x80 ? 7 : 3;
        for (let row = 0; row < 5; row++) {
          const bits = FONT[code * 5 + row]!;
          for (let col = 0; col < w; col++) if ((bits >> col) & 1) ctx.fillRect(x + col + ox, row + oy, 1, 1);
        }
        x += charAdvance(code);
      }
    };
    if (shadow) draw(1, 1, shadow);
    draw(0, 0, color);
  }, [p8, color, shadow]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      role="img"
      aria-label={text}
      className={`pixelated inline-block shrink-0 ${className ?? ''}`}
      style={{ width: width * scale, height: height * scale }}
    />
  );
}
