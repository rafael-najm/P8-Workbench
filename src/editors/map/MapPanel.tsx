import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { getMapTile, setMapTile } from '../../cart/cart';
import { MAP_H, MAP_SHARED_ROW, MAP_W } from '../../cart/types';
import { useEditor, type MapTool, type Selection } from '../../store/editor';
import { useProject } from '../../store/project';
import { toast } from '../../store/toast';
import { Icon } from '../../ui/components/Icon';
import { registerPanel } from '../../ui/panels/registry';
import { canRedo, canUndo, checkpoint, onHistoryChange, redo, undo } from '../history';
import { putPixels, sheetCanvas, sheetPixels } from '../render';
import { floodFill, linePoints, readBlock, type Block, type Point } from '../tools';

const TOOLS: { id: MapTool; label: string; key: string }[] = [
  { id: 'pencil', label: 'Paint tiles', key: 'd' },
  { id: 'rect', label: 'Fill rectangle', key: 'r' },
  { id: 'fill', label: 'Bucket fill', key: 'f' },
  { id: 'select', label: 'Select (copy/paste/delete)', key: 's' },
  { id: 'picker', label: 'Pick tile', key: 'i' },
  { id: 'eraser', label: 'Erase (tile 0)', key: 'e' },
];

let mapClipboard: Block | null = null;

export function MapPanel() {
  const cart = useProject((s) => s.cart);
  const rev = useProject((s) => `${s.revisions.gfx},${s.revisions.map}`);
  const ed = useEditor();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 8, y: 8 });
  const [showGrid, setShowGrid] = useState(true);
  const [hover, setHover] = useState<Point | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<Selection | null>(null);
  const [, setHist] = useState(0);
  useEffect(() => onHistoryChange(() => setHist((n) => n + 1)), []);

  const viewport = useRef<HTMLDivElement>(null);
  const mapCanvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ mode: 'pan' | 'tool'; sx: number; sy: number; px: number; py: number; start: Point; last: Point } | null>(null);
  const spaceDown = useRef(false);
  const [view, setView] = useState({ w: 600, h: 400 });
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setView({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // brush: selected sprite block (mapSelection is w x h tiles starting at `sprite`)
  const brush = useCallback((): Block => {
    const w = ed.mapSelection?.w ?? 1;
    const h = ed.mapSelection?.h ?? 1;
    const data = new Uint8Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = (ed.sprite + j * 16 + i) & 255;
    return { w, h, data };
  }, [ed.sprite, ed.mapSelection]);

  // --- rendering ---
  useEffect(() => {
    if (!cart) return;
    const ctx = mapCanvas.current?.getContext('2d');
    if (!ctx) return;
    const atlas = sheetCanvas(cart);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, MAP_W * 8, MAP_H * 8);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const t = getMapTile(cart, x, y);
        if (t === 0) continue;
        ctx.drawImage(atlas as CanvasImageSource, (t % 16) * 8, Math.floor(t / 16) * 8, 8, 8, x * 8, y * 8, 8, 8);
      }
    }
  }, [cart, rev]);

  useEffect(() => {
    const ctx = overlay.current?.getContext('2d');
    if (!ctx) return;
    const s = 8 * zoom;
    const W = MAP_W * s;
    const H = MAP_H * s;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.setTransform(1, 0, 0, 1, Math.round(pan.x), Math.round(pan.y));
    if (showGrid && zoom >= 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      for (let x = 1; x < MAP_W; x++) {
        ctx.moveTo(x * s + 0.5, 0);
        ctx.lineTo(x * s + 0.5, H);
      }
      for (let y = 1; y < MAP_H; y++) {
        ctx.moveTo(0, y * s + 0.5);
        ctx.lineTo(W, y * s + 0.5);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(41,173,255,0.22)';
      ctx.beginPath();
      for (let x = 16; x < MAP_W; x += 16) {
        ctx.moveTo(x * s + 0.5, 0);
        ctx.lineTo(x * s + 0.5, H);
      }
      for (let y = 16; y < MAP_H; y += 16) {
        ctx.moveTo(0, y * s + 0.5);
        ctx.lineTo(W, y * s + 0.5);
      }
      ctx.stroke();
    }
    // shared area (rows 32-63 = sprites 128-255)
    ctx.fillStyle = 'rgba(255,163,0,0.07)';
    ctx.fillRect(0, MAP_SHARED_ROW * s, W, (MAP_H - MAP_SHARED_ROW) * s);
    ctx.strokeStyle = '#ffa300';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, MAP_SHARED_ROW * s + 0.5);
    ctx.lineTo(W, MAP_SHARED_ROW * s + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffa300';
    ctx.font = '11px JetBrains Mono, monospace';
    ctx.fillText('rows 32-63: shared with sprites 128-255', 6, MAP_SHARED_ROW * s + 14);

    const rectOf = (r: Selection, color: string, dash = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (dash) ctx.setLineDash([5, 3]);
      ctx.strokeRect(r.x * s + 1, r.y * s + 1, r.w * s - 2, r.h * s - 2);
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    };
    if (preview) rectOf(preview, '#ff77a8');
    if (selection) rectOf(selection, '#ffec27', true);
    if (hover && !drag.current) {
      const b = ed.mapTool === 'pencil' ? brush() : { w: 1, h: 1 };
      rectOf({ x: hover[0], y: hover[1], w: b.w, h: b.h }, 'rgba(255,241,232,0.8)');
    }
  }, [zoom, pan, view, showGrid, hover, selection, preview, ed.mapTool, brush]);

  // --- editing ---
  const place = (block: Block, at: Point) => {
    useProject.getState().mutate(['map', ...(at[1] + block.h > MAP_SHARED_ROW ? (['gfx'] as const) : [])], (c) => {
      for (let j = 0; j < block.h; j++)
        for (let i = 0; i < block.w; i++) {
          const x = at[0] + i;
          const y = at[1] + j;
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          setMapTile(c, x, y, block.data[j * block.w + i]!);
        }
    });
  };
  const fillRect = (r: Selection, tile: number) => place({ w: r.w, h: r.h, data: new Uint8Array(r.w * r.h).fill(tile) }, [r.x, r.y]);

  const toCell = (e: ReactPointerEvent | PointerEvent): Point => {
    const r = overlay.current!.getBoundingClientRect();
    const s = 8 * zoom;
    return [Math.floor((e.clientX - r.left - pan.x) / s), Math.floor((e.clientY - r.top - pan.y) / s)];
  };

  const onDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cell = toCell(e);
    if (e.button === 1 || spaceDown.current || e.button === 2) {
      drag.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, start: cell, last: cell };
      return;
    }
    if (!cart) return;
    const tool = ed.mapTool;
    drag.current = { mode: 'tool', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, start: cell, last: cell };
    if (tool === 'picker') {
      ed.set({ sprite: getMapTile(cart, cell[0], cell[1]), mapSelection: null });
      return;
    }
    if (tool === 'select') {
      setSelection({ x: cell[0], y: cell[1], w: 1, h: 1 });
      return;
    }
    checkpoint(`map ${tool}`);
    if (tool === 'pencil') place(brush(), cell);
    else if (tool === 'eraser') place({ w: 1, h: 1, data: new Uint8Array(1) }, cell);
    else if (tool === 'fill') {
      const pts = floodFill((x, y) => getMapTile(cart, x, y), cell[0], cell[1], { x: 0, y: 0, w: MAP_W, h: MAP_H });
      useProject.getState().mutate(['map', 'gfx'], (c) => pts.forEach(([x, y]) => setMapTile(c, x, y, ed.sprite)));
    } else if (tool === 'rect') setPreview({ x: cell[0], y: cell[1], w: 1, h: 1 });
    if (cell[1] >= MAP_SHARED_ROW && tool !== 'rect') warnShared();
  };

  const onMove = (e: ReactPointerEvent) => {
    const cell = toCell(e);
    setHover(cell);
    const d = drag.current;
    if (!d) return;
    if (d.mode === 'pan') {
      setPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy });
      return;
    }
    const r = rectFrom(d.start, cell);
    if ((ed.mapTool === 'pencil' || ed.mapTool === 'eraser') && (cell[0] !== d.last[0] || cell[1] !== d.last[1])) {
      const b = ed.mapTool === 'pencil' ? brush() : { w: 1, h: 1, data: new Uint8Array(1) };
      // interpolate so fast strokes have no gaps
      for (const p of linePoints(d.last[0], d.last[1], cell[0], cell[1]).slice(1)) place(b, p);
    }
    else if (ed.mapTool === 'select') setSelection(r);
    else if (ed.mapTool === 'rect') setPreview(r);
    d.last = cell;
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode !== 'tool') return;
    if (ed.mapTool === 'rect' && preview) {
      fillRect(preview, ed.sprite);
      if (preview.y + preview.h > MAP_SHARED_ROW) warnShared();
      setPreview(null);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const rect = viewport.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const next = Math.max(0.25, Math.min(6, zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
    // keep the point under the cursor fixed
    setPan({ x: mx - ((mx - pan.x) / zoom) * next, y: my - ((my - pan.y) / zoom) * next });
    setZoom(next);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') {
      spaceDown.current = true;
      e.preventDefault();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'z') e.shiftKey ? redo() : undo();
    else if (ctrl && e.key.toLowerCase() === 'y') redo();
    else if (ctrl && e.key.toLowerCase() === 'c' && selection && cart) {
      mapClipboard = readBlock((x, y) => getMapTile(cart, x, y), selection);
      toast(`copied ${selection.w}x${selection.h} tiles`);
    } else if (ctrl && e.key.toLowerCase() === 'v' && mapClipboard) {
      checkpoint('map paste');
      const at: Point = selection ? [selection.x, selection.y] : (hover ?? [0, 0]);
      place(mapClipboard, at);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
      checkpoint('map clear');
      fillRect(selection, 0);
    } else if (!ctrl && TOOLS.some((t) => t.key === e.key)) ed.set({ mapTool: TOOLS.find((t) => t.key === e.key)!.id });
    else if (e.key === 'Escape' && selection) setSelection(null);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  if (!cart) return null;
  const s = 8 * zoom;
  return (
    <div className="flex h-full min-h-0 flex-col outline-none" tabIndex={0} onKeyDown={onKeyDown} onKeyUp={(e) => e.code === 'Space' && (spaceDown.current = false)} data-testid="map-editor">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        {TOOLS.map((t) => (
          <button key={t.id} className="btn-ghost px-2 text-[11px]" data-active={ed.mapTool === t.id} title={`${t.label} (${t.key})`} onClick={() => ed.set({ mapTool: t.id })}>
            {t.id}
          </button>
        ))}
        <div className="mx-1 h-4 w-px bg-line" />
        <button className="btn-ghost" onClick={() => setZoom((z) => Math.max(0.25, z / 1.25))} title="Zoom out">
          −
        </button>
        <span className="w-10 text-center text-[10px] text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
        <button className="btn-ghost" onClick={() => setZoom((z) => Math.min(6, z * 1.25))} title="Zoom in">
          +
        </button>
        <button className="btn-ghost text-[10px]" data-active={showGrid} onClick={() => setShowGrid(!showGrid)}>
          grid
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-dim tabular-nums">{hover && hover[0] >= 0 && hover[1] >= 0 && hover[0] < MAP_W && hover[1] < MAP_H ? `cell ${hover[0]},${hover[1]} = ${getMapTile(cart, hover[0], hover[1])}` : 'wheel: zoom · middle/right/space drag: pan'}</span>
        <button className="btn-ghost" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={() => undo()}>
          <Icon name="undo" size={12} />
        </button>
        <button className="btn-ghost" title="Redo (Ctrl+Y)" disabled={!canRedo()} onClick={() => redo()}>
          <Icon name="undo" size={12} className="-scale-x-100" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={viewport} className="relative min-w-0 flex-1 overflow-hidden bg-[#05070d]" onWheel={onWheel}>
          <div className="absolute top-0 left-0" style={{ transform: `translate(${Math.round(pan.x)}px, ${Math.round(pan.y)}px)`, width: MAP_W * s, height: MAP_H * s }}>
            <canvas ref={mapCanvas} width={MAP_W * 8} height={MAP_H * 8} className="pixelated absolute inset-0 h-full w-full" />
          </div>
          <canvas
              ref={overlay}
              width={view.w}
              height={view.h}
              className="absolute inset-0 h-full w-full cursor-crosshair"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => setHover(null)}
              onContextMenu={(e) => e.preventDefault()}
              data-testid="map-canvas"
            />
        </div>
        <TilePicker rev={rev} />
      </div>
    </div>
  );
}

let sharedWarned = false;
function warnShared() {
  if (sharedWarned) return;
  sharedWarned = true;
  toast('map rows 32-63 overwrite sprites 128-255 (shared memory)', 'info');
}

function rectFrom(a: Point, b: Point): Selection {
  const x = Math.min(a[0], b[0]);
  const y = Math.min(a[1], b[1]);
  return { x, y, w: Math.abs(a[0] - b[0]) + 1, h: Math.abs(a[1] - b[1]) + 1 };
}

function TilePicker({ rev }: { rev: string }) {
  const ed = useEditor();
  const canvas = useRef<HTMLCanvasElement>(null);
  const start = useRef<number | null>(null);
  const SCALE = 2;
  useEffect(() => {
    const cart = useProject.getState().cart;
    const ctx = canvas.current?.getContext('2d');
    if (cart && ctx) putPixels(ctx, sheetPixels(cart), 128, 128);
  }, [rev]);
  const pick = (e: ReactPointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const col = Math.max(0, Math.min(15, Math.floor(((e.clientX - r.left) / r.width) * 16)));
    const row = Math.max(0, Math.min(15, Math.floor(((e.clientY - r.top) / r.height) * 16)));
    return row * 16 + col;
  };
  const sel = ed.mapSelection ?? { x: 0, y: 0, w: 1, h: 1 };
  return (
    <div className="flex w-[272px] shrink-0 flex-col gap-2 border-l border-line p-2">
      <div className="flex items-center gap-2">
        <span className="label">tile</span>
        <span className="text-p8-yellow tabular-nums">{ed.sprite}</span>
        {sel.w * sel.h > 1 && <span className="text-[10px] text-dim">brush {sel.w}x{sel.h}</span>}
      </div>
      <div className="relative" style={{ width: 128 * SCALE, height: 128 * SCALE }}>
        <canvas
          ref={canvas}
          width={128}
          height={128}
          className="pixelated block h-full w-full cursor-pointer border border-line bg-black"
          onPointerDown={(e) => {
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            const n = pick(e);
            start.current = n;
            ed.set({ sprite: n, mapSelection: null });
          }}
          onPointerMove={(e) => {
            if (start.current === null) return;
            const a = start.current;
            const b = pick(e);
            const x0 = Math.min(a % 16, b % 16);
            const y0 = Math.min(a >> 4, b >> 4);
            ed.set({ sprite: y0 * 16 + x0, mapSelection: { x: x0, y: y0, w: Math.abs((a % 16) - (b % 16)) + 1, h: Math.abs((a >> 4) - (b >> 4)) + 1 } });
          }}
          onPointerUp={() => (start.current = null)}
          data-testid="tile-picker"
        />
        <div
          className="pointer-events-none absolute border-2 border-p8-white shadow-[0_0_0_1px_#000]"
          style={{ left: (ed.sprite % 16) * 8 * SCALE - 1, top: Math.floor(ed.sprite / 16) * 8 * SCALE - 1, width: sel.w * 8 * SCALE + 2, height: sel.h * 8 * SCALE + 2 }}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 border-t border-dashed border-p8-orange/60" />
      </div>
      <p className="text-[10px] leading-4 text-dim">
        Drag on the sheet for a multi-tile brush. Tile 0 is never drawn by map(). The lower half of the sheet is the same memory as map rows 32-63.
      </p>
    </div>
  );
}

registerPanel({ id: 'map', title: 'map', icon: 'map', shortcut: 'Ctrl+3', component: MapPanel });
