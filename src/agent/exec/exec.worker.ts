/// <reference lib="webworker" />
import { loadLuaWasm } from '../../runtime/lua/engine';
import { InProcessExecutor } from './executor';

const exec = new InProcessExecutor();
self.onmessage = async (e: MessageEvent<{ id: number; method: keyof InProcessExecutor; args: unknown[]; wasmUrl: string }>) => {
  const { id, method, args, wasmUrl } = e.data;
  try {
    await loadLuaWasm(wasmUrl);
    const fn = exec[method] as (...a: unknown[]) => Promise<unknown>;
    self.postMessage({ id, result: await fn.apply(exec, args) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
