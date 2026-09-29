import { describe, expect, it } from 'vitest';
import { composer } from './helpers';

describe('endurance (plan §11)', () => {
  it('composes hours of music with bounded memory and steady variety', () => {
    const c = composer('endurance', { autoModulate: true, strict: true });
    const keys = new Set<string>();
    const seasons = new Set<string>();
    const started = performance.now();
    // 1500 cycles ≈ 4.5 hours at the default tempo.
    for (let n = 0; n <= 1500; n++) {
      const score = c.getCycle(n);
      keys.add(score.keyName);
      seasons.add(score.season);
      expect(score.notes.length).toBeGreaterThan(0);
    }
    expect(c.cachedCycles().length).toBeLessThanOrEqual(26);
    expect(keys).toEqual(new Set(['D major', 'A major', 'G major']));
    expect(seasons.size).toBe(4);
    expect(performance.now() - started).toBeLessThan(60_000);
  }, 90_000);
});
