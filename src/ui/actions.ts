/** User-level actions shared by shortcuts, the command palette and buttons. */
import { useProject } from '../store/project';
import { useRuntime } from '../store/runtime';
import { toast } from '../store/toast';
import { game } from './game/controller';

export async function runGame(): Promise<void> {
  const { cart } = useProject.getState();
  if (!cart) return;
  const status = useRuntime.getState().status;
  if (status === 'running' || status === 'paused') {
    const err = await game.hotReload(cart);
    if (status === 'paused' && !err) game.resume();
    if (!err) toast('reloaded', 'success');
  } else {
    await game.run(cart);
  }
}

export async function restartGame(): Promise<void> {
  const { cart } = useProject.getState();
  if (cart) await game.run(cart);
}

export async function saveProject(): Promise<void> {
  await useProject.getState().save('save');
  const status = useRuntime.getState().status;
  const cart = useProject.getState().cart;
  if (cart && (status === 'running' || status === 'paused')) await game.hotReload(cart);
  toast('saved', 'success');
}

export function download(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCart(): void {
  const { name, exportP8 } = useProject.getState();
  download(`${name.replace(/[^\w.-]+/g, '_') || 'cart'}.p8`, exportP8());
}

export async function importFiles(files: FileList | File[]): Promise<number> {
  let imported = 0;
  for (const file of Array.from(files)) {
    if (!file.name.toLowerCase().endsWith('.p8')) {
      toast(`${file.name}: only .p8 text carts are supported`, 'error');
      continue;
    }
    try {
      const text = await file.text();
      await useProject.getState().importP8(text, file.name.replace(/\.p8$/i, ''));
      toast(`imported ${file.name}`, 'success');
      imported++;
    } catch (e) {
      toast(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }
  return imported;
}

export function pickAndImport(onImported?: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.p8';
  input.multiple = true;
  input.onchange = async () => {
    if (input.files && (await importFiles(input.files)) > 0) onImported?.();
  };
  input.click();
}

export async function newProject(): Promise<void> {
  const name = prompt('Cart name', 'untitled');
  if (name === null) return;
  await useProject.getState().create(name.trim() || 'untitled');
  game.stop();
}
