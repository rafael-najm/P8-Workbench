import { describe, expect, it } from 'vitest';
import { createEmptyCart } from '../../cart/cart';
import { cartToRom, MEM_SIZE } from '../memory';
import { Sequencer, TICK_SECONDS } from './sequencer';

function setup(edit: (cart: ReturnType<typeof createEmptyCart>) => void) {
  const cart = createEmptyCart();
  edit(cart);
  const ram = new Uint8Array(MEM_SIZE);
  ram.set(cartToRom(cart));
  const seq = new Sequencer(ram);
  const notes: string[] = [];
  seq.listener = { noteOn: (e) => notes.push(`${e.channel}:${e.sfx}:${e.note}`), channelStop: () => {} };
  return { seq, notes };
}

/** Advances time by whole notes of the given speed. */
function advance(seq: Sequencer, notes: number, speed: number) {
  for (let i = 0; i < notes; i++) seq.tick(speed * TICK_SECONDS + 1e-9);
}

describe('Sequencer', () => {
  it('plays 32 notes then stops', () => {
    const { seq } = setup((c) => (c.sfx[1]!.speed = 4));
    seq.sfx(1);
    expect(seq.channel(0)).toEqual({ sfx: 1, note: 0 });
    advance(seq, 31, 4);
    expect(seq.channel(0).note).toBe(31);
    advance(seq, 1, 4);
    expect(seq.channel(0).sfx).toBe(-1);
  });

  it('loops between loop start and loop end', () => {
    const { seq } = setup((c) => Object.assign(c.sfx[2]!, { speed: 2, loopStart: 4, loopEnd: 8 }));
    seq.sfx(2, 1);
    advance(seq, 10, 2);
    expect(seq.channel(1)).toEqual({ sfx: 2, note: 6 });
  });

  it('loop end 0 with loop start > 0 limits the length', () => {
    const { seq } = setup((c) => Object.assign(c.sfx[3]!, { speed: 1, loopStart: 5, loopEnd: 0 }));
    seq.sfx(3);
    advance(seq, 5, 1);
    expect(seq.channel(0).sfx).toBe(-1);
  });

  it('sfx(-1) stops, sfx(n, ch, offset, length) respects offset/length', () => {
    const { seq } = setup((c) => (c.sfx[4]!.speed = 1));
    seq.sfx(4, 2, 10, 3);
    expect(seq.channel(2).note).toBe(10);
    advance(seq, 3, 1);
    expect(seq.channel(2).sfx).toBe(-1);
    seq.sfx(4, 2);
    seq.sfx(-1, 2);
    expect(seq.channel(2).sfx).toBe(-1);
  });

  it('allocates free channels, avoiding channels reserved by music', () => {
    const { seq } = setup(() => {});
    seq.music(0, 0, 0b0011);
    seq.sfx(5);
    expect(seq.channel(2).sfx).toBe(5);
  });

  it('music advances patterns and honours loop flags', () => {
    const { seq } = setup((c) => {
      c.sfx[1]!.speed = 1;
      c.sfx[2]!.speed = 1;
      c.music[0] = { flags: 1, channels: [1, 0x42, 0x43, 0x44] };
      c.music[1] = { flags: 2, channels: [2, 0x42, 0x43, 0x44] };
    });
    seq.music(0);
    expect(seq.musicState().pattern).toBe(0);
    advance(seq, 32, 1);
    expect(seq.musicState().pattern).toBe(1);
    advance(seq, 32, 1);
    expect(seq.musicState()).toMatchObject({ pattern: 0, count: 2, playing: true });
    seq.music(-1);
    expect(seq.musicState().playing).toBe(false);
  });

  it('stop flag ends the music', () => {
    const { seq } = setup((c) => {
      c.sfx[1]!.speed = 1;
      c.music[0] = { flags: 4, channels: [1, 0x42, 0x43, 0x44] };
    });
    seq.music(0);
    advance(seq, 33, 1);
    expect(seq.musicState().playing).toBe(false);
  });

  it('emits note events for the synth', () => {
    const { seq, notes } = setup((c) => (c.sfx[1]!.speed = 1));
    seq.sfx(1, 3);
    advance(seq, 2, 1);
    expect(notes).toEqual(['3:1:0', '3:1:1', '3:1:2']);
  });
});
