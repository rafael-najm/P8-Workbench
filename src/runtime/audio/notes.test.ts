import { describe, expect, it } from 'vitest';
import { parsePitch, pitchName } from './notes';

describe('note names', () => {
  it('formats pitches', () => {
    expect(pitchName(0)).toBe('c0');
    expect(pitchName(33)).toBe('a2');
    expect(pitchName(63)).toBe('d#5');
  });
  it.each([
    ['a2', 33],
    ['C#4', 49],
    ['eb1', 15],
    ['d-3', 38],
    [12, 12],
    ['40', 40],
    ['e5', null],
    ['h2', null],
    [64, null],
  ])('%j -> %j', (input, expected) => {
    expect(parsePitch(input as string | number)).toBe(expected);
  });
});
