import { listModels, type ModelInfo } from './openrouter';

let cache: ModelInfo[] = [];
export const cachedModels = () => cache;
export async function fetchModels(): Promise<ModelInfo[]> {
  if (!cache.length) cache = await listModels();
  return cache;
}
