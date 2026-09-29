import { describe, expect, it } from 'vitest';
import { composer, melody } from './helpers';

describe('canon voices', () => {
  it('echo voices repeat the leader one and two phrases later', () => {
    const c = composer('round', { autoModulate: false });
    let checked = 0;
    for (let n = 3; n < 60; n++) {
      const score = c.getCycle(n);
      const sig = (notes: ReturnType<typeof melody>) => notes.map((x) => [x.tick, x.midi]);
      if (score.voices >= 2) {
        expect(sig(melody(score, 1))).toEqual(sig(melody(c.getCycle(n - 1), 0)));
        checked++;
      }
      if (score.voices >= 3) {
        expect(sig(melody(score, 2))).toEqual(sig(melody(c.getCycle(n - 2), 0)));
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('starts with the ground bass alone, then adds one voice per cycle', () => {
    const c = composer('entries');
    expect([0, 1, 2, 3].map((n) => c.getCycle(n).voices)).toEqual([0, 1, 2, 3]);
    const intro = c.getCycle(0);
    expect(melody(intro)).toHaveLength(0);
    expect(intro.notes.filter((n) => n.part === 'bass')).toHaveLength(8);
  });

  it('thins to one or two voices while resting and re-enters gradually', () => {
    let rests = 0;
    for (let s = 0; s < 8; s++) {
      const c = composer(`rest-${s}`);
      let prev = 0;
      for (let n = 0; n < 150; n++) {
        const score = c.getCycle(n);
        if (score.stage === 'rest') {
          rests++;
          expect(score.voices).toBeLessThanOrEqual(2);
        }
        expect(score.voices - prev).toBeLessThanOrEqual(1);
        prev = score.voices;
      }
    }
    expect(rests).toBeGreaterThan(0);
  });

  it('transposes the echoes when the key changes', () => {
    const c = composer('modulate', { autoModulate: true });
    const score = c.getCycle(28);
    expect(score.keyChanged).toBe(true);
    expect(score.keyName).toBe('A major');
    for (const note of melody(score)) {
      const pc = ((note.midi % 12) + 12) % 12;
      // A major scale (with passing tones) — no G natural or D♯ from the old key.
      expect([9, 11, 1, 2, 4, 6, 8]).toContain(pc);
    }
  });
});
