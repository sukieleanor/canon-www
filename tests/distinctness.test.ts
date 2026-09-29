import { describe, expect, it } from 'vitest';
import { FAMOUS_LINES, matchesOriginal, ORIGINAL_PHRASES } from '../src/music/pachelbel';
import { mainLine } from '../src/music/rules';
import { composer } from './helpers';

describe('distinct from the original (plan §11)', () => {
  it('recognises the original phrases themselves', () => {
    for (const original of ORIGINAL_PHRASES) {
      const notes = original.notes.map((n) => ({
        ...n,
        vel: 0.5,
        gate: 1,
        chord: Math.floor(n.tick / 96),
      }));
      expect(matchesOriginal({ notes })).toBe(original.name);
      const lifted = notes.map((n) => ({ ...n, deg: n.deg + 7 }));
      expect(matchesOriginal({ notes: lifted })).toBe(original.name);
    }
  });

  it('never reproduces an original two-bar phrase, while nodding to it rarely', () => {
    let total = 0;
    let quotes = 0;
    for (let s = 0; s < 30; s++) {
      const c = composer(`distinct-${s}`, {
        busyness: (s % 4) / 3,
        mood: s % 5 === 0 ? 'dreamy' : 'bright',
      });
      for (let n = 1; n <= 120; n++) {
        const phrase = c.phrase(n);
        if (!phrase) continue;
        total++;
        expect(matchesOriginal(phrase)).toBeNull();
        if (!phrase.quote) continue;
        quotes++;
        // A quote follows a famous line on the strong beats (in some octave) but is varied.
        const strong = mainLine(phrase.notes)
          .filter((l) => l.note.tick % 96 === 0)
          .map((l) => l.note.deg);
        const lines = [FAMOUS_LINES.descending, FAMOUS_LINES.answer];
        const follows = lines.some((line) =>
          [0, -7, 7].some((shift) => line.slice(0, 4).every((d, i) => strong[i] === d + shift)),
        );
        expect(follows).toBe(true);
      }
    }
    expect(quotes).toBeGreaterThan(0);
    expect(quotes / total).toBeLessThan(0.1);
  });
});
