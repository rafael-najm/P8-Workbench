/** Editor playback: sends the cart's audio data to the preview player and mirrors timing for the UI. */
import type { Cart } from '../../cart/types';
import { Sequencer } from '../../runtime/audio/sequencer';
import { audio } from '../../runtime/audio/webaudio';
import { cartToRom, MEM_SIZE } from '../../runtime/memory';

export function cartRam(cart: Cart): Uint8Array {
  const ram = new Uint8Array(MEM_SIZE);
  ram.set(cartToRom(cart));
  return ram;
}

type Listener = (state: { sfx: number; note: number; pattern: number } | null) => void;

let raf = 0;
let mirror: Sequencer | null = null;
const listeners = new Set<Listener>();

function loop(last: number) {
  raf = requestAnimationFrame((now) => {
    if (!mirror) return;
    mirror.tick(Math.min(0.1, (now - last) / 1000));
    const ch = mirror.channel(0);
    const ms = mirror.musicState();
    const playing = ms.playing || [0, 1, 2, 3].some((i) => mirror!.channel(i).sfx >= 0);
    const state = playing ? { sfx: ch.sfx, note: ch.note, pattern: ms.pattern } : null;
    listeners.forEach((l) => l(state));
    if (playing) loop(now);
    else mirror = null;
  });
}

export function playSfx(cart: Cart, n: number): void {
  const ram = cartRam(cart);
  audio.preview(ram, { sfx: n });
  mirror = new Sequencer(ram);
  mirror.sfx(n, 0);
  cancelAnimationFrame(raf);
  loop(performance.now());
}

export function playMusic(cart: Cart, pattern: number): void {
  const ram = cartRam(cart);
  audio.preview(ram, { music: pattern });
  mirror = new Sequencer(ram);
  mirror.music(pattern);
  cancelAnimationFrame(raf);
  loop(performance.now());
}

export function stopPlayback(): void {
  audio.stopPreview();
  mirror = null;
  cancelAnimationFrame(raf);
  listeners.forEach((l) => l(null));
}

export function onPlayback(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
