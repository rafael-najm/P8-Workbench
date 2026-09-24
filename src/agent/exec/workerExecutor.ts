/** Executor backed by a Web Worker (keeps the UI and the user's game untouched). */
import glueWasmUrl from 'wasmoon/dist/glue.wasm?url';
import ExecWorker from './exec.worker?worker';
import type { Executor } from './executor';

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();

function call<T>(method: string, args: unknown[], timeoutMs = 120_000): Promise<T> {
  if (!worker) {
    worker = new ExecWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error) p.reject(new Error(e.data.error)); else p.resolve(e.data.result);
    };
  }
  const id = nextId++;
  const wasmUrl = new URL(glueWasmUrl, location.href).href;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      pending.delete(id);
      worker?.terminate();
      worker = null;
      reject(new Error('execution timed out (worker restarted)'));
    }, timeoutMs);
    pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v as T); }, reject: (e) => { clearTimeout(t); reject(e); } });
    worker!.postMessage({ id, method, args, wasmUrl });
  });
}

export const workerExecutor: Executor = {
  runGame: (p8, a) => call('runGame', [p8, a]),
  screenshots: (p8, a) => call('screenshots', [p8, a]),
  readGlobals: (p8, n, d) => call('readGlobals', [p8, n, d]),
  evalLua: (p8, c) => call('evalLua', [p8, c]),
  playtest: (p8, a) => call('playtest', [p8, a], 600_000),
};
