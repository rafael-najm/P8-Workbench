/** Buttons: btn()/btnp() state for up to 8 players. */

export const BUTTON_NAMES = ['left', 'right', 'up', 'down', 'o', 'x', 'menu'] as const;
export type ButtonName = (typeof BUTTON_NAMES)[number];

export function buttonIndex(name: string): number {
  const aliases: Record<string, number> = { z: 4, c: 4, n: 4, fire2: 4, v: 5, m: 5, fire: 5, fire1: 5, pause: 6 };
  const i = BUTTON_NAMES.indexOf(name as ButtonName);
  return i >= 0 ? i : (aliases[name] ?? -1);
}

const PLAYERS = 8;
const DEFAULT_DELAY = 15;
const DEFAULT_REPEAT = 4;

export class Input {
  /** Live state written by the host (keyboard, gamepad, scripted input). */
  private live = new Uint8Array(PLAYERS);
  /** Buttons pressed since the last latch (so taps shorter than a frame still register). */
  private tapped = new Uint8Array(PLAYERS);
  /** State latched at the start of the current frame. */
  private cur = new Uint8Array(PLAYERS);
  /** Frames each button has been held (player * 8 + button). */
  private held = new Uint16Array(PLAYERS * 8);
  /** btnp repeat settings (0 = default), read from memory each frame. */
  delay = 0;
  repeat = 0;

  setButton(player: number, button: number, down: boolean): void {
    if (player < 0 || player >= PLAYERS || button < 0 || button > 7) return;
    if (down) {
      this.live[player]! |= 1 << button;
      this.tapped[player]! |= 1 << button;
    } else this.live[player]! &= ~(1 << button);
  }

  /** Replaces a player's live state with a bitmask. */
  setMask(player: number, mask: number): void {
    if (player < 0 || player >= PLAYERS) return;
    this.tapped[player]! |= mask & ~this.live[player]! & 0xff;
    this.live[player] = mask & 0xff;
  }

  getMask(player: number): number {
    return this.live[player] ?? 0;
  }

  releaseAll(): void {
    this.live.fill(0);
    this.tapped.fill(0);
  }

  /** Called once per game frame, before _update. */
  latch(): void {
    for (let p = 0; p < PLAYERS; p++) {
      const mask = this.live[p]! | this.tapped[p]!;
      this.tapped[p] = 0;
      this.cur[p] = mask;
      for (let b = 0; b < 8; b++) {
        const i = p * 8 + b;
        this.held[i] = (mask >> b) & 1 ? Math.min(this.held[i]! + 1, 0xffff) : 0;
      }
    }
  }

  reset(): void {
    this.live.fill(0);
    this.tapped.fill(0);
    this.cur.fill(0);
    this.held.fill(0);
  }

  btn(i?: number, p?: number): boolean | number {
    if (i === undefined) return this.cur[0]! | (this.cur[1]! << 8);
    const player = p === undefined ? 0 : Math.floor(p);
    const b = Math.floor(i);
    if (player < 0 || player >= PLAYERS || b < 0 || b > 7) return false;
    return ((this.cur[player]! >> b) & 1) === 1;
  }

  private pressed(player: number, b: number): boolean {
    const h = this.held[player * 8 + b]!;
    if (h === 0) return false;
    if (h === 1) return true;
    const delay = this.delay || DEFAULT_DELAY;
    const rep = this.repeat || DEFAULT_REPEAT;
    if (delay === 255) return false;
    const t = h - 1 - delay;
    return t >= 0 && t % rep === 0;
  }

  btnp(i?: number, p?: number): boolean | number {
    if (i === undefined) {
      let mask = 0;
      for (let b = 0; b < 8; b++) {
        if (this.pressed(0, b)) mask |= 1 << b;
        if (this.pressed(1, b)) mask |= 1 << (b + 8);
      }
      return mask;
    }
    const player = p === undefined ? 0 : Math.floor(p);
    const b = Math.floor(i);
    if (player < 0 || player >= PLAYERS || b < 0 || b > 7) return false;
    return this.pressed(player, b);
  }
}
