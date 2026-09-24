/** Landing screen: live demo cart, project list, open example / new / import. */
import { useEffect, useRef, useState } from 'react';
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import { createEmptyCart } from '../cart/cart';
import { listProjects, type ProjectRecord } from '../persistence/db';
import { Machine } from '../runtime/machine';
import { SAMPLE_P8, useProject } from '../store/project';
import { importFiles, newProject, pickAndImport } from './actions';
import { Icon } from './components/Icon';
import { PixelText } from './components/PixelText';

const DEMO = `function _init() t=0 end
function _update60() t+=1 end
function _draw()
 cls(0)
 for i=0,40 do
  local a=i/40+t/600
  local r=30+sin(t/240+i/10)*12
  circfill(64+cos(a)*r,64+sin(a)*r,2+sin(i/8+t/90)*2,8+i%8)
 end
 for i=1,60 do pset((i*37+t/3)%128,(i*53)%128,i%3==0 and 7 or 5) end
 ?"\\^w\\^tpico",44,54,7
 ?"workbench",46,68,12
end`;

function DemoCart() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let m: Machine | null = null;
    let alive = true;
    void Machine.create({ wasmUrl: glueWasmUrl, seed: 3 }).then((mm) => {
      if (!alive) return mm.dispose();
      m = mm;
      m.load(createEmptyCart(DEMO));
      const ctx = ref.current?.getContext('2d');
      if (!ctx) return;
      const img = ctx.createImageData(128, 128);
      const px = new Uint32Array(img.data.buffer);
      const loop = () => {
        m!.tick();
        m!.render(px);
        ctx.putImageData(img, 0, 0);
        raf = requestAnimationFrame(loop);
      };
      loop();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      m?.dispose();
    };
  }, []);
  return <canvas ref={ref} width={128} height={128} className="pixelated h-64 w-64 border-2 border-line2 bg-black shadow-[var(--shadow-hard-lg)] sm:h-80 sm:w-80" />;
}

export function HomeScreen({ onEnter }: { onEnter(): void }) {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  useEffect(() => void listProjects().then(setProjects), []);
  const open = async (id: string) => {
    await useProject.getState().open(id);
    onEnter();
  };
  const openExample = async () => {
    await useProject.getState().importP8(SAMPLE_P8, 'nebula strike');
    onEnter();
  };

  return (
    <div
      className="h-full overflow-y-auto"
      data-testid="home"
      onDragOver={(e) => e.preventDefault()}
      onDrop={async (e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length && (await importFiles(e.dataTransfer.files)) > 0) onEnter();
      }}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-10 px-4 py-10 md:flex-row md:items-start">
        <div className="flex flex-col items-center gap-4 animate-pop">
          <DemoCart />
          <PixelText text="pico workbench" scale={4} color="#ff77a8" shadow="#1d2b53" />
          <p className="max-w-80 text-center text-[12px] text-muted">PICO-8 game workspace in the browser: full-screen editor, sprite/map/sound editors and an AI agent that edits, runs and playtests your game.</p>
        </div>
        <div className="w-full max-w-md flex-1 animate-slide-up">
          <div className="mb-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => void openExample()} data-testid="open-example"><Icon name="play" size={12} /> open example</button>
            <button className="btn" onClick={async () => { await newProject(); onEnter(); }}><Icon name="plus" size={12} /> new cart</button>
            <button className="btn" onClick={() => pickAndImport(onEnter)}><Icon name="upload" size={12} /> import .p8</button>
          </div>
          <div className="label mb-2">your carts</div>
          <div className="border border-line bg-panel">
            {projects === null && <div className="p-4 text-dim">loading…</div>}
            {projects?.length === 0 && <div className="p-4 text-dim">No carts yet. Open the example or drop a .p8 file anywhere.</div>}
            {projects?.map((p) => (
              <button key={p.id} onClick={() => void open(p.id)} className="flex w-full items-center gap-3 border-b border-line/60 px-3 py-2 text-left last:border-0 hover:bg-panel2">
                <Icon name="game" size={14} className="text-p8-blue" />
                <span className="flex-1 truncate">{p.name}</span>
                <span className="text-[11px] text-dim">{p.tokens ?? '?'} tokens · {new Date(p.updatedAt).toLocaleDateString()}</span>
              </button>
            ))}
          </div>
          {projects && projects.length > 0 && <button className="btn mt-3" onClick={onEnter}>continue last cart →</button>}
        </div>
      </div>
    </div>
  );
}
