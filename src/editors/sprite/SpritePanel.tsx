import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getGfxPixel, setGfxPixel } from '../../cart/cart';
import { PALETTE_HEX, PALETTE_NAMES, PALETTE_RGB } from '../../runtime/palette';
import { useEditor, type Selection, type SpriteTool } from '../../store/editor';
import { useProject } from '../../store/project';
import { toast } from '../../store/toast';
import { Icon } from '../../ui/components/Icon';
import { registerPanel } from '../../ui/panels/registry';
import { canRedo, canUndo, checkpoint, onHistoryChange, redo, undo } from '../history';
import { putPixels, sheetPixels, spriteOrigin } from '../render';
import {
  brushPoints,
  ellipsePoints,
  flipBlock,
  floodFill,
  linePoints,
  quantizeToPalette,
  readBlock,
  rectPoints,
  rotateBlock,
  type Block,
  type Point,
} from '../tools';

const TOOLS: { id: SpriteTool; label: string; key: string; icon?: string }[] = [
  { id: 'pencil', label: 'Pencil', key: 'd' },
  { id: 'eraser', label: 'Eraser', key: 'e' },
  { id: 'fill', label: 'Fill', key: 'f' },
  { id: 'line', label: 'Line', key: 'l' },
  { id: 'rect', label: 'Rectangle', key: 'r' },
  { id: 'rectfill', label: 'Filled rectangle', key: 'R' },
  { id: 'circ', label: 'Ellipse', key: 'o' },
  { id: 'circfill', label: 'Filled ellipse', key: 'O' },
  { id: 'select', label: 'Select / move', key: 's' },
  { id: 'picker', label: 'Color picker', key: 'i' },
];

/** Small glyphs for the tool buttons (drawn as 5x5 pixel masks). */
const TOOL_GLYPH: Record<SpriteTool, string[]> = {
  pencil: ['....#', '...##', '..##.', '.##..', '#....'],
  eraser: ['..###', '.#..#', '#..#.', '#.#..', '###..'],
  fill: ['.#...', '#.#..', '#..#.', '.#..#', '..###'],
  line: ['....#', '...#.', '..#..', '.#...', '#....'],
  rect: ['#####', '#...#', '#...#', '#...#', '#####'],
  rectfill: ['#####', '#####', '#####', '#####', '#####'],
  circ: ['.###.', '#...#', '#...#', '#...#', '.###.'],
  circfill: ['.###.', '#####', '#####', '#####', '.###.'],
  select: ['##.##', '#...#', '.....', '#...#', '##.##'],
  picker: ['...##', '..###', '.##..', '##...', '#....'],
};

function Glyph({ rows }: { rows: string[] }) {
  return (
    <svg width={12} height={12} viewBox="0 0 5 5" shapeRendering="crispEdges">
      <path d={rows.flatMap((r, y) => [...r].map((c, x) => (c === '#' ? `M${x} ${y}h1v1h-1z` : ''))).join('')} fill="currentColor" />
    </svg>
  );
}

let clipboard: Block | null = null;

/** Part of `b` placed at `at` that falls inside a w x h area. */
function clipBlock(b: Block, at: { x: number; y: number }, w: number, h: number): Block {
  const x0 = Math.max(0, at.x);
  const y0 = Math.max(0, at.y);
  const x1 = Math.min(w, at.x + b.w);
  const y1 = Math.min(h, at.y + b.h);
  const cw = Math.max(0, x1 - x0);
  const ch = Math.max(0, y1 - y0);
  const data = new Uint8Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) data[j * cw + i] = b.data[(y0 - at.y + j) * b.w + (x0 - at.x + i)]!;
  return { w: cw, h: ch, data };
}

const FLAG_COLORS = [8, 9, 10, 11, 12, 13, 14, 15];

function useCartRev(kinds: ('gfx' | 'flags' | 'map')[]) {
  return useProject((s) => kinds.map((k) => s.revisions[k]).join(','));
}

export function SpritePanel() {
  const cart = useProject((s) => s.cart);
  const rev = useCartRev(['gfx', 'flags']);
  const ed = useEditor();
  const [, setHist] = useState(0);
  useEffect(() => onHistoryChange(() => setHist((n) => n + 1)), []);

  const size = ed.spriteSize;
  const [ox, oy] = spriteOrigin(ed.sprite);
  const blockW = Math.min(size * 8, 128 - ox);
  const blockH = Math.min(size * 8, 128 - oy);

  const setPixels = useCallback(
    (pts: Point[], color: number) => {
      useProject.getState().mutate('gfx', (c) => {
        for (const [x, y] of pts) {
          if (x < 0 || y < 0 || x >= blockW || y >= blockH) continue;
          setGfxPixel(c, ox + x, oy + y, color);
        }
      });
    },
    [ox, oy, blockW, blockH],
  );

  const getPx = useCallback((x: number, y: number) => (cart ? getGfxPixel(cart, ox + x, oy + y) : 0), [cart, ox, oy]);

  // --- block operations (selection or whole block) ---
  const target = (): Selection => ed.selection ?? { x: 0, y: 0, w: blockW, h: blockH };
  const writeBlock = (b: Block, at: { x: number; y: number }) => {
    useProject.getState().mutate('gfx', (c) => {
      for (let j = 0; j < b.h; j++)
        for (let i = 0; i < b.w; i++) {
          const x = ox + at.x + i;
          const y = oy + at.y + j;
          if (x < 0 || y < 0 || x > 127 || y > 127) continue;
          setGfxPixel(c, x, y, b.data[j * b.w + i]!);
        }
    });
  };
  const transform = (fn: (b: Block) => Block, label: string) => {
    const t = target();
    const b = readBlock(getPx, t);
    const out = fn(b);
    if (out.w !== b.w || out.h !== b.h) {
      if (t.w !== t.h) return toast('rotate needs a square selection', 'error');
    }
    checkpoint(label);
    writeBlock(out, t);
  };
  const copy = () => {
    clipboard = readBlock(getPx, target());
    const hex = Array.from({ length: clipboard.h }, (_, j) => Array.from(clipboard!.data.subarray(j * clipboard!.w, (j + 1) * clipboard!.w), (v) => v.toString(16)).join('')).join('\n');
    void navigator.clipboard?.writeText(hex).catch(() => {});
    toast(`copied ${clipboard.w}x${clipboard.h}`);
  };
  const pasteBlock = (b: Block) => {
    const at = ed.selection ?? { x: 0, y: 0 };
    checkpoint('paste');
    // paste relative to the sheet so large images can span beyond the block
    useProject.getState().mutate('gfx', (c) => {
      for (let j = 0; j < b.h; j++)
        for (let i = 0; i < b.w; i++) {
          const x = ox + at.x + i;
          const y = oy + at.y + j;
          if (x > 127 || y > 127) continue;
          setGfxPixel(c, x, y, b.data[j * b.w + i]!);
        }
    });
  };
  const clearSel = () => {
    const t = target();
    checkpoint('clear');
    setPixels(rectPoints(t.x, t.y, t.x + t.w - 1, t.y + t.h - 1, true), 0);
  };

  const onPaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        const bmp = await createImageBitmap(file);
        const w = Math.min(128, bmp.width);
        const h = Math.min(128, bmp.height);
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        const data = quantizeToPalette(ctx.getImageData(0, 0, w, h).data, PALETTE_RGB.slice(0, 16));
        pasteBlock({ w, h, data });
        toast(`pasted ${w}x${h} image (converted to the palette)`, 'success');
        return;
      }
    }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    const rows = text.trim().split(/\r?\n/);
    if (rows.length && rows.every((r) => /^[0-9a-f]+$/i.test(r) && r.length === rows[0]!.length)) {
      e.preventDefault();
      const w = rows[0]!.length;
      pasteBlock({ w, h: rows.length, data: Uint8Array.from(rows.join(''), (ch) => parseInt(ch, 16)) });
    } else if (clipboard) {
      e.preventDefault();
      pasteBlock(clipboard);
    }
  };

  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const handler = (e: ClipboardEvent) => void onPaste(e);
    el.addEventListener('paste', handler);
    return () => el.removeEventListener('paste', handler);
  });

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === 'z') (e.shiftKey ? redo() : undo()) || undefined;
    else if (ctrl && e.key.toLowerCase() === 'y') redo();
    else if (ctrl && e.key.toLowerCase() === 'c') copy();
    else if (ctrl && e.key.toLowerCase() === 'v') return; // handled by the paste event
    else if (e.key === 'Delete' || e.key === 'Backspace') clearSel();
    else if (!ctrl && e.key === 'h') transform((b) => flipBlock(b, true), 'flip');
    else if (!ctrl && e.key === 'v') transform((b) => flipBlock(b, false), 'flip');
    else if (!ctrl && e.key === 't') transform(rotateBlock, 'rotate');
    else if (!ctrl && TOOLS.some((t) => t.key === e.key)) ed.set({ tool: TOOLS.find((t) => t.key === e.key)!.id });
    else if (!ctrl && e.key === '[') ed.set({ brush: Math.max(1, ed.brush - 1) });
    else if (!ctrl && e.key === ']') ed.set({ brush: Math.min(4, ed.brush + 1) });
    else if (!ctrl && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -16, ArrowDown: 16 }[e.key];
      ed.set({ sprite: Math.max(0, Math.min(255, ed.sprite + d * size)), selection: null });
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (!cart) return null;

  return (
    <div ref={rootRef} tabIndex={0} onKeyDown={onKeyDown} className="flex h-full min-h-0 flex-col outline-none" data-testid="sprite-editor">
      <div className="flex h-9 shrink-0 flex-wrap items-center gap-0.5 border-b border-line px-1.5">
        {TOOLS.map((t) => (
          <button key={t.id} className="btn-ghost" data-active={ed.tool === t.id} title={`${t.label} (${t.key})`} onClick={() => ed.set({ tool: t.id })} data-tool={t.id}>
            <Glyph rows={TOOL_GLYPH[t.id]} />
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-line" />
        <span className="text-[10px] text-dim">brush</span>
        {[1, 2, 3, 4].map((b) => (
          <button key={b} className="btn-ghost w-5 text-[10px]" data-active={ed.brush === b} onClick={() => ed.set({ brush: b })}>
            {b}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-line" />
        <button className="btn-ghost text-[10px]" title="Flip horizontally (h)" onClick={() => transform((b) => flipBlock(b, true), 'flip')}>
          ⇆
        </button>
        <button className="btn-ghost text-[10px]" title="Flip vertically (v)" onClick={() => transform((b) => flipBlock(b, false), 'flip')}>
          ⇅
        </button>
        <button className="btn-ghost text-[10px]" title="Rotate 90° (t)" onClick={() => transform(rotateBlock, 'rotate')}>
          ⟳
        </button>
        <button className="btn-ghost text-[10px]" title="Copy (Ctrl+C)" onClick={copy}>
          copy
        </button>
        <button className="btn-ghost text-[10px]" title="Paste (Ctrl+V; also PNG images)" onClick={() => clipboard && pasteBlock(clipboard)}>
          paste
        </button>
        <div className="flex-1" />
        <button className="btn-ghost" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={() => undo()}>
          <Icon name="undo" size={12} />
        </button>
        <button className="btn-ghost" title="Redo (Ctrl+Y)" disabled={!canRedo()} onClick={() => redo()}>
          <Icon name="undo" size={12} className="-scale-x-100" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        <ZoomCanvas key={`${ox},${oy},${blockW},${blockH}`} ox={ox} oy={oy} w={blockW} h={blockH} rev={rev} setPixels={setPixels} getPx={getPx} writeBlock={writeBlock} />
        <div className="flex w-[400px] shrink-0 flex-col gap-2 overflow-y-auto">
          <SheetView rev={rev} />
          <Palette />
          <Flags rev={rev} />
          <AnimPreview rev={rev} />
        </div>
      </div>
    </div>
  );
}

// --- zoomed block canvas ---------------------------------------------------------------

interface ZoomProps {
  ox: number;
  oy: number;
  w: number;
  h: number;
  rev: string;
  setPixels(pts: Point[], color: number): void;
  getPx(x: number, y: number): number;
  writeBlock(b: Block, at: { x: number; y: number }): void;
}

function ZoomCanvas({ ox, oy, w, h, rev, setPixels, getPx, writeBlock }: ZoomProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [scale, setScale] = useState(16);
  const ed = useEditor();
  const drag = useRef<{ start: Point; last: Point; color: number; moving?: { block: Block; from: Selection; base: Block } } | null>(null);
  const [preview, setPreview] = useState<{ pts: Point[]; color: number } | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (!e) return;
      setScale(Math.max(2, Math.floor(Math.min((e.contentRect.width - 4) / w, (e.contentRect.height - 24) / h))));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  // draw block pixels
  useEffect(() => {
    const cart = useProject.getState().cart;
    const ctx = canvas.current?.getContext('2d');
    if (!cart || !ctx) return;
    const all = sheetPixels(cart);
    const px = new Uint32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = all[(oy + y) * 128 + ox + x]!;
    putPixels(ctx, px, w, h);
  }, [rev, ox, oy, w, h]);

  // overlay: grid, preview, selection
  useEffect(() => {
    const c = overlay.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (scale >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 1; x < w; x++) {
        ctx.moveTo(x * scale + 0.5, 0);
        ctx.lineTo(x * scale + 0.5, h * scale);
      }
      for (let y = 1; y < h; y++) {
        ctx.moveTo(0, y * scale + 0.5);
        ctx.lineTo(w * scale, y * scale + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(41,173,255,0.25)';
      ctx.beginPath();
      for (let x = 8; x < w; x += 8) {
        ctx.moveTo(x * scale + 0.5, 0);
        ctx.lineTo(x * scale + 0.5, h * scale);
      }
      for (let y = 8; y < h; y += 8) {
        ctx.moveTo(0, y * scale + 0.5);
        ctx.lineTo(w * scale, y * scale + 0.5);
      }
      ctx.stroke();
    }
    if (preview) {
      ctx.fillStyle = PALETTE_HEX[preview.color]!;
      for (const [x, y] of preview.pts) if (x >= 0 && y >= 0 && x < w && y < h) ctx.fillRect(x * scale, y * scale, scale, scale);
    }
    if (hover && ed.tool !== 'select' && ed.tool !== 'fill' && ed.tool !== 'picker') {
      ctx.strokeStyle = 'rgba(255,241,232,0.7)';
      for (const [x, y] of brushPoints(hover[0], hover[1], ed.tool === 'pencil' || ed.tool === 'eraser' ? ed.brush : 1)) ctx.strokeRect(x * scale + 0.5, y * scale + 0.5, scale - 1, scale - 1);
    }
    const sel = ed.selection;
    if (sel) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#ffec27';
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.x * scale + 1, sel.y * scale + 1, sel.w * scale - 2, sel.h * scale - 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }
  }, [scale, w, h, preview, ed.selection, ed.tool, ed.brush, hover]);

  const toPixel = (e: ReactPointerEvent): Point => {
    const r = overlay.current!.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * w), Math.floor(((e.clientY - r.top) / r.height) * h)];
  };

  const shapePts = (a: Point, b: Point): Point[] => {
    switch (ed.tool) {
      case 'line':
        return linePoints(a[0], a[1], b[0], b[1]);
      case 'rect':
        return rectPoints(a[0], a[1], b[0], b[1], false);
      case 'rectfill':
        return rectPoints(a[0], a[1], b[0], b[1], true);
      case 'circ':
        return ellipsePoints(a[0], a[1], b[0], b[1], false);
      case 'circfill':
        return ellipsePoints(a[0], a[1], b[0], b[1], true);
      default:
        return [];
    }
  };

  const onDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = toPixel(e);
    const secondary = e.button === 2;
    const color = ed.tool === 'eraser' ? 0 : secondary ? ed.color2 : ed.color;
    if (ed.tool === 'picker') {
      const c = getPx(p[0], p[1]);
      ed.set(secondary ? { color2: c } : { color: c });
      return;
    }
    if (ed.tool === 'select') {
      const sel = ed.selection;
      if (sel && p[0] >= sel.x && p[1] >= sel.y && p[0] < sel.x + sel.w && p[1] < sel.y + sel.h) {
        checkpoint('move');
        // lift the selection: the base (with a hole) is recomposed on every move
        const block = readBlock(getPx, sel);
        setPixels(rectPoints(sel.x, sel.y, sel.x + sel.w - 1, sel.y + sel.h - 1, true), 0);
        const base = readBlock(getPx, { x: 0, y: 0, w, h });
        writeBlock(block, sel);
        drag.current = { start: p, last: p, color, moving: { block, from: sel, base } };
      } else {
        drag.current = { start: p, last: p, color };
        ed.set({ selection: null });
      }
      return;
    }
    checkpoint(ed.tool);
    if (ed.tool === 'fill') {
      setPixels(floodFill(getPx, p[0], p[1], { x: 0, y: 0, w, h }), color);
      return;
    }
    drag.current = { start: p, last: p, color };
    if (ed.tool === 'pencil' || ed.tool === 'eraser') setPixels(brushPoints(p[0], p[1], ed.brush), color);
    else setPreview({ pts: shapePts(p, p), color });
  };

  const onMove = (e: ReactPointerEvent) => {
    const p = toPixel(e);
    setHover(p);
    const d = drag.current;
    if (!d) return;
    if (ed.tool === 'pencil' || ed.tool === 'eraser') {
      const pts = linePoints(d.last[0], d.last[1], p[0], p[1]).flatMap(([x, y]) => brushPoints(x, y, ed.brush));
      setPixels(pts, d.color);
    } else if (ed.tool === 'select') {
      if (d.moving) {
        const { block, from, base } = d.moving;
        const at = { x: from.x + p[0] - d.start[0], y: from.y + p[1] - d.start[1] };
        writeBlock(base, { x: 0, y: 0 });
        writeBlock(clipBlock(block, at, w, h), { x: Math.max(0, at.x), y: Math.max(0, at.y) });
        ed.set({ selection: { ...at, w: from.w, h: from.h } });
      } else {
        const x = Math.max(0, Math.min(d.start[0], p[0]));
        const y = Math.max(0, Math.min(d.start[1], p[1]));
        const x2 = Math.min(w - 1, Math.max(d.start[0], p[0]));
        const y2 = Math.min(h - 1, Math.max(d.start[1], p[1]));
        ed.set({ selection: { x, y, w: x2 - x + 1, h: y2 - y + 1 } });
      }
    } else {
      setPreview({ pts: shapePts(d.start, p), color: d.color });
    }
    d.last = p;
  };

  const onUp = (e: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (preview) {
      setPixels(shapePts(d.start, toPixel(e)), d.color);
      setPreview(null);
    }
  };

  const [hx, hy] = hover ?? [-1, -1];
  return (
    <div ref={wrap} className="flex min-w-0 flex-1 flex-col items-center gap-1 overflow-hidden">
      <div className="relative border border-line2 shadow-[var(--shadow-hard)]" style={{ width: w * scale, height: h * scale, background: 'repeating-conic-gradient(#1a2133 0 25%, #121829 0 50%) 0 0 / 16px 16px' }}>
        <canvas ref={canvas} width={w} height={h} className="pixelated absolute inset-0 h-full w-full" />
        <canvas
          ref={overlay}
          width={w * scale}
          height={h * scale}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={() => setHover(null)}
          onContextMenu={(e) => e.preventDefault()}
          data-testid="sprite-canvas"
        />
      </div>
      <div className="text-[10px] text-dim tabular-nums">
        {hover && hx >= 0 && hy >= 0 && hx < w && hy < h ? `x ${ox + hx} y ${oy + hy} · color ${getPx(hx, hy)}` : `sheet ${ox},${oy} · ${w}x${h}`}
      </div>
    </div>
  );
}

// --- spritesheet ------------------------------------------------------------------------

function SheetView({ rev }: { rev: string }) {
  const ed = useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const tab = ed.tab;
  const SCALE = 3;

  useEffect(() => {
    const cart = useProject.getState().cart;
    const ctx = canvas.current?.getContext('2d');
    if (!cart || !ctx) return;
    const all = sheetPixels(cart);
    putPixels(ctx, all.subarray(tab * 32 * 128, (tab + 1) * 32 * 128), 128, 32);
  }, [rev, tab]);

  const selRow = Math.floor(ed.sprite / 16) - tab * 4;
  const selCol = ed.sprite % 16;
  const pick = (e: ReactPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const col = Math.floor(((e.clientX - r.left) / r.width) * 16);
    const row = Math.floor(((e.clientY - r.top) / r.height) * 4);
    return Math.max(0, Math.min(255, (tab * 4 + row) * 16 + col));
  };

  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        {[0, 1, 2, 3].map((t) => (
          <button key={t} className="btn-ghost h-6 text-[11px]" data-active={tab === t} onClick={() => ed.set({ tab: t })}>
            {t}
          </button>
        ))}
        <span className="ml-1 text-[10px] text-dim">sprite</span>
        <span className="text-[12px] text-p8-yellow tabular-nums">{hover ?? ed.sprite}</span>
        <div className="flex-1" />
        {[1, 2, 4].map((s) => (
          <button key={s} className="btn-ghost h-6 text-[10px]" data-active={ed.spriteSize === s} title={`Edit ${s * 8}x${s * 8}`} onClick={() => ed.set({ spriteSize: s as 1 | 2 | 4, selection: null })}>
            {s * 8}
          </button>
        ))}
      </div>
      <div className="relative" style={{ width: 128 * SCALE, height: 32 * SCALE }}>
        <canvas
          ref={canvas}
          width={128}
          height={32}
          className="pixelated block h-full w-full cursor-pointer border border-line bg-black"
          onPointerDown={(e) => {
            ed.set({ sprite: pick(e), selection: null });
          }}
          onPointerMove={(e) => setHover(pick(e))}
          onPointerLeave={() => setHover(null)}
          data-testid="sprite-sheet"
        />
        {selRow >= 0 && selRow < 4 && (
          <div
            className="pointer-events-none absolute border-2 border-p8-white shadow-[0_0_0_1px_#000]"
            style={{ left: selCol * 8 * SCALE - 1, top: selRow * 8 * SCALE - 1, width: ed.spriteSize * 8 * SCALE + 2, height: ed.spriteSize * 8 * SCALE + 2 }}
          />
        )}
      </div>
      {tab >= 2 && <div className="mt-1 text-[10px] text-p8-orange">tabs 2-3 share memory with map rows 32-63</div>}
    </div>
  );
}

function Palette() {
  const ed = useEditor();
  return (
    <div className="flex items-center gap-2">
      <div className="grid grid-cols-8 gap-0.5" data-testid="palette">
        {PALETTE_HEX.slice(0, 16).map((hex, i) => (
          <button
            key={i}
            title={`${i} ${PALETTE_NAMES[i]} (right-click: secondary)`}
            onClick={() => ed.set({ color: i })}
            onContextMenu={(e) => {
              e.preventDefault();
              ed.set({ color2: i });
            }}
            className="relative h-6 w-6 border border-black transition-transform duration-100 hover:scale-110"
            style={{ background: hex, outline: ed.color === i ? '2px solid #fff1e8' : ed.color2 === i ? '2px dashed #83769c' : undefined, outlineOffset: -1, zIndex: ed.color === i ? 1 : 0 }}
          >
            {ed.color === i && <span className="absolute inset-0 grid place-items-center text-[9px] mix-blend-difference">{i}</span>}
          </button>
        ))}
      </div>
      <div className="relative h-10 w-10 shrink-0" title="primary / secondary color">
        <div className="absolute top-3 left-3 h-6 w-6 border border-black" style={{ background: PALETTE_HEX[ed.color2] }} />
        <div className="absolute top-0 left-0 h-6 w-6 border border-black" style={{ background: PALETTE_HEX[ed.color] }} />
      </div>
    </div>
  );
}

function Flags({ rev }: { rev: string }) {
  const ed = useEditor();
  const cart = useProject.getState().cart;
  const flags = useMemo(() => cart?.flags[ed.sprite] ?? 0, [cart, ed.sprite, rev]);
  const toggle = (bit: number) => {
    checkpoint('flags');
    useProject.getState().mutate('flags', (c) => (c.flags[ed.sprite] = c.flags[ed.sprite]! ^ (1 << bit)));
  };
  return (
    <div className="flex items-center gap-1.5" data-testid="flags">
      <span className="text-[10px] text-dim">flags</span>
      {FLAG_COLORS.map((c, bit) => (
        <button
          key={bit}
          title={`flag ${bit}`}
          onClick={() => toggle(bit)}
          className="h-4 w-4 rounded-full border border-black transition-transform duration-100 hover:scale-125"
          style={{ background: (flags >> bit) & 1 ? PALETTE_HEX[c] : '#1a2133', boxShadow: (flags >> bit) & 1 ? `0 0 6px ${PALETTE_HEX[c]}` : undefined }}
        />
      ))}
      <span className="text-[10px] text-dim tabular-nums">= {flags}</span>
    </div>
  );
}

function AnimPreview({ rev }: { rev: string }) {
  const ed = useEditor();
  const { from, to, fps, playing } = ed.anim;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(from);
  const size = ed.spriteSize * 8;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setFrame((f) => (f + ed.spriteSize > to || f < from ? from : f + ed.spriteSize)), 1000 / fps);
    return () => clearInterval(id);
  }, [playing, from, to, fps, ed.spriteSize]);

  useEffect(() => {
    const cart = useProject.getState().cart;
    const ctx = canvas.current?.getContext('2d');
    if (!cart || !ctx) return;
    const all = sheetPixels(cart);
    const n = playing ? frame : ed.sprite;
    const [sx, sy] = spriteOrigin(n);
    const px = new Uint32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) px[y * size + x] = sx + x < 128 && sy + y < 128 ? all[(sy + y) * 128 + sx + x]! : 0xff000000;
    putPixels(ctx, px, size, size);
  }, [frame, rev, playing, ed.sprite, size]);

  const set = (patch: Partial<typeof ed.anim>) => ed.set({ anim: { ...ed.anim, ...patch } });
  return (
    <div className="flex items-center gap-2 border-t border-line pt-2" data-testid="anim-preview">
      <canvas ref={canvas} width={size} height={size} className="pixelated h-16 w-16 border border-line bg-black" />
      <div className="flex flex-col gap-1 text-[11px]">
        <div className="flex items-center gap-1">
          <span className="text-dim">frames</span>
          <input className="input h-6 w-12" type="number" min={0} max={255} value={from} onChange={(e) => set({ from: Number(e.target.value) })} />
          <span className="text-dim">to</span>
          <input className="input h-6 w-12" type="number" min={0} max={255} value={to} onChange={(e) => set({ to: Number(e.target.value) })} />
          <button className="btn-ghost h-6 text-[10px]" title="Use the selected sprite as start" onClick={() => set({ from: ed.sprite })}>
            ⇤ sel
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn h-6" onClick={() => set({ playing: !playing })}>
            <Icon name={playing ? 'pause' : 'play'} size={10} /> {playing ? 'stop' : 'play'}
          </button>
          <input type="range" min={1} max={30} value={fps} onChange={(e) => set({ fps: Number(e.target.value) })} />
          <span className="w-10 text-dim tabular-nums">{fps} fps</span>
        </div>
      </div>
    </div>
  );
}

registerPanel({ id: 'sprites', title: 'sprites', icon: 'sprite', shortcut: 'Ctrl+2', component: SpritePanel });
