import { describe, expect, it } from 'vitest';
import { composer } from './helpers';

describe('seeded, replayable sessions', () => {
  it('the same seed and settings compose identical music', () => {
    const a = composer('same-seed');
    const b = composer('same-seed');
    for (let n = 0; n < 30; n++) expect(b.getCycle(n)).toEqual(a.getCycle(n));
  });

  it('different seeds compose different music', () => {
    const a = composer('seed-a');
    const b = composer('seed-b');
    const sig = (c: ReturnType<typeof composer>) =>
      JSON.stringify([1, 2, 3, 4, 5].map((n) => c.phrase(n)?.notes.map((x) => x.deg)));
    expect(sig(a)).not.toEqual(sig(b));
  });

  it('jumping straight to a phrase equals listening up to it (share links)', () => {
    const listened = composer('fast-forward', { autoModulate: true, strict: true });
    for (let n = 0; n <= 45; n++) listened.getCycle(n);
    const jumped = composer('fast-forward', { autoModulate: true, strict: true });
    expect(jumped.getCycle(45)).toEqual(listened.getCycle(45));
  });

  it('settings changes shape the future, never the phrases already heard', () => {
    const c = composer('update');
    const heard = structuredClone(c.getCycle(10));
    c.getCycle(11);
    c.updateSettings({ busyness: 1, key: 'G' }, 10);
    expect(c.getCycle(10)).toEqual(heard);
    expect(c.getCycle(11).keyName).toBe('G major');
  });
});
