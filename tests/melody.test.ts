import { describe, expect, it } from 'vitest';
import { TICKS_PER_CHORD } from '../src/music/constants';
import { checkPhrase, mainLine } from '../src/music/rules';
import type { StageId } from '../src/types';
import { composer, melody } from './helpers';

const KEYS = ['D', 'G', 'Eb', 'A', 'C', 'F#'] as const;
const MOODS = ['bright', 'wistful', 'dreamy'] as const;

describe('melody rules (plan §4.1)', () => {
  it('every phrase follows the rules across seeds, keys, moods and busyness', () => {
    const failures: string[] = [];
    for (let s = 0; s < 24; s++) {
      const c = composer(`rules-${s}`, {
        key: KEYS[s % KEYS.length],
        mood: MOODS[s % MOODS.length],
        busyness: (s % 5) / 4,
        autoModulate: s % 2 === 0,
        strict: s % 3 === 0,
      });
      for (let n = 1; n <= 60; n++) {
        const phrase = c.phrase(n);
        if (!phrase) throw new Error('missing phrase');
        const violations = checkPhrase(phrase);
        if (violations.length > 0) {
          failures.push(
            `${s}/${n} ${phrase.plan}: ${violations.map((v) => `${v.rule}@${v.tick}`).join(', ')}`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('puts chord tones on every strong beat, in every sounding voice', () => {
    for (let s = 0; s < 6; s++) {
      const c = composer(`strong-${s}`, { mood: MOODS[s % 3], autoModulate: true });
      for (let n = 1; n <= 90; n++) {
        const score = c.getCycle(n);
        for (const note of melody(score)) {
          if (note.orn || note.tick % TICKS_PER_CHORD !== 0) continue;
          expect(score.chords[note.chord].pcs).toContain(((note.midi % 12) + 12) % 12);
        }
      }
    }
  });

  it('keeps the leading voice between D4 and D6', () => {
    const c = composer('range', { key: 'A', autoModulate: true });
    for (let n = 1; n <= 120; n++) {
      for (const note of melody(c.getCycle(n), 0)) {
        expect(note.midi).toBeGreaterThanOrEqual(note.orn ? 60 : 62);
        expect(note.midi).toBeLessThanOrEqual(note.orn ? 88 : 86);
      }
    }
  });

  it('ends each phrase on a stable note', () => {
    const c = composer('cadence');
    for (let n = 1; n <= 40; n++) {
      const line = mainLine(c.phrase(n)?.notes ?? []);
      const last = line[line.length - 1].note;
      expect(((last.deg % 7) + 7) % 7).toBe(4);
    }
  });

  it('gives each stage its own note speed', () => {
    const speed: Partial<Record<StageId, number[]>> = {};
    for (let s = 0; s < 8; s++) {
      const c = composer(`speed-${s}`);
      for (let n = 1; n <= 100; n++) {
        const p = c.phrase(n);
        if (!p) continue;
        (speed[p.stage] ??= []).push(mainLine(p.notes).length);
      }
    }
    const avg = (id: StageId) => {
      const list = speed[id] ?? [];
      return list.reduce((a, b) => a + b, 0) / Math.max(1, list.length);
    };
    expect(avg('calm')).toBeLessThan(avg('flowing'));
    expect(avg('flowing')).toBeLessThan(avg('lively'));
    expect(avg('rest')).toBeLessThan(avg('flowing'));
  });

  it('ornaments the ornamented stage', () => {
    let ornamented = 0;
    let withOrnaments = 0;
    for (let s = 0; s < 10; s++) {
      const c = composer(`orn-${s}`);
      for (let n = 1; n <= 80; n++) {
        const p = c.phrase(n);
        if (p?.stage !== 'ornamented') continue;
        ornamented++;
        if (p.notes.some((x) => x.orn)) withOrnaments++;
      }
    }
    expect(ornamented).toBeGreaterThan(0);
    expect(withOrnaments / ornamented).toBeGreaterThan(0.8);
  });
});
