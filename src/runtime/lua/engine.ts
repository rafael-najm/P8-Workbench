/** wasmoon engine creation, shared by the runtime, the worker and tests. */
import { LuaEngine, LuaWasm } from 'wasmoon';

let wasmPromise: Promise<LuaWasm> | null = null;

/** Loads the Lua WebAssembly module once. `wasmUrl` is needed in browsers (Vite asset URL). */
export function loadLuaWasm(wasmUrl?: string): Promise<LuaWasm> {
  wasmPromise ??= LuaWasm.initialize(wasmUrl);
  return wasmPromise;
}

export async function createLuaEngine(wasmUrl?: string): Promise<{ engine: LuaEngine; wasm: LuaWasm }> {
  const wasm = await loadLuaWasm(wasmUrl);
  const engine = new LuaEngine(wasm, { injectObjects: false, enableProxy: false, openStandardLibs: true });
  return { engine, wasm };
}
