import { describe, expect, it } from 'vitest';
import { buildCycleChords } from '../src/music/progression';
import {
  degreeBounds,
  degreeToMidi,
  degreeToSemitones,
  type Key,
  keyName,
  melodyRef,
  midiName,
  midiToDegree,
} from '../src/music/theory';

const D_MAJOR: Key = { tonicPc: 2, mode: 'major' };
const D_MINOR: Key = { tonicPc: 2, mode: 'minor' };

describe('theory', () => {
  it('maps scale degrees to semitones in major and minor', () => {
    const degrees = [0, 1, 2, 3, 4, 5, 6, 7];
    expect(degrees.map((d) => degreeToSemitones(d, 'major'))).toEqual([0, 2, 4, 5, 7, 9, 11, 12]);
    expect(degrees.map((d) => degreeToSemitones(d, 'minor'))).toEqual([0, 2, 3, 5, 7, 8, 10, 12]);
    expect(degreeToSemitones(-1, 'major')).toBe(-1);
    expect(degreeToSemitones(-3, 'major')).toBe(-5);
    expect(degreeToSemitones(6, 'minor', true)).toBe(11);
    expect(degreeToSemitones(5, 'minor', true)).toBe(9);
  });

  it('places the D major melody on D4–D6', () => {
    expect(melodyRef(D_MAJOR)).toBe(62);
    expect(degreeBounds(D_MAJOR, 62, 86)).toEqual({ lo: 0, hi: 14 });
    expect(midiName(degreeToMidi(9, D_MAJOR))).toBe('F#5');
  });

  it('keeps every key inside the same absolute range', () => {
    for (let pc = 0; pc < 12; pc++) {
      for (const mode of ['major', 'minor'] as const) {
        const key = { tonicPc: pc, mode };
        const { lo, hi } = degreeBounds(key, 62, 86);
        expect(degreeToMidi(lo, key)).toBeGreaterThanOrEqual(62);
        expect(degreeToMidi(hi, key)).toBeLessThanOrEqual(86);
        expect(hi - lo).toBeGreaterThanOrEqual(13);
      }
    }
  });

  it('round-trips MIDI and degrees', () => {
    for (let d = -5; d < 20; d++) expect(midiToDegree(degreeToMidi(d, D_MAJOR), D_MAJOR)).toBe(d);
  });

  it('names keys with proper accidentals', () => {
    expect(keyName(D_MAJOR)).toBe('D major');
    expect(keyName({ tonicPc: 10, mode: 'minor' })).toBe('B♭ minor');
  });
});

describe('Canon progression', () => {
  const names = (key: Key) => buildCycleChords(key, null, null, null).map((c) => c.name);

  it('spells the loop in D major and the minor variant from the plan', () => {
    expect(names(D_MAJOR)).toEqual(['D', 'A', 'Bm', 'F♯m', 'G', 'D', 'G', 'A']);
    expect(names(D_MINOR)).toEqual(['Dm', 'Am', 'B♭', 'F', 'Gm', 'Dm', 'Gm', 'A']);
  });

  it('moves the same Roman numerals to any key', () => {
    expect(names({ tonicPc: 7, mode: 'major' })).toEqual([
      'G',
      'D',
      'Em',
      'Bm',
      'C',
      'G',
      'C',
      'D',
    ]);
    expect(names({ tonicPc: 3, mode: 'major' })).toEqual([
      'E♭',
      'B♭',
      'Cm',
      'Gm',
      'A♭',
      'E♭',
      'A♭',
      'B♭',
    ]);
    expect(names({ tonicPc: 0, mode: 'major' })).toEqual([
      'C',
      'G',
      'Am',
      'Em',
      'F',
      'C',
      'F',
      'G',
    ]);
  });

  it('walks the ground bass D A B F♯ G D G A', () => {
    const bass = buildCycleChords(D_MAJOR, null, null, null).map((c) => midiName(c.bassMidi));
    expect(bass).toEqual(['D3', 'A2', 'B2', 'F#2', 'G2', 'D2', 'G2', 'A2']);
  });

  it('voice-leads the chord layer smoothly inside E3–E5', () => {
    const chords = buildCycleChords(D_MAJOR, null, null, null);
    for (const c of chords) {
      expect(c.voicing).toHaveLength(3);
      expect(Math.min(...c.voicing)).toBeGreaterThanOrEqual(52);
      expect(Math.max(...c.voicing)).toBeLessThanOrEqual(76);
      expect(new Set(c.voicing.map((m) => m % 12))).toEqual(new Set(c.pcs));
    }
    for (let i = 1; i < chords.length; i++) {
      const moved = chords[i].voicing.reduce(
        (s, m, j) => s + Math.abs(m - chords[i - 1].voicing[j]),
        0,
      );
      expect(moved).toBeLessThanOrEqual(7);
    }
  });

  it('prepares a modulation with a diatonic pivot chord', () => {
    const aToG = buildCycleChords(
      { tonicPc: 9, mode: 'major' },
      { tonicPc: 7, mode: 'major' },
      null,
      null,
    );
    expect(aToG[7].name).toBe('D');
    expect(aToG[7].pivot).toBe(true);
    expect(midiName(aToG[7].bassMidi)).toBe('F#2');
    const dToA = buildCycleChords(D_MAJOR, { tonicPc: 9, mode: 'major' }, null, null);
    expect(dToA[7].name).toBe('A');
    expect(dToA[7].pivot).toBe(false);
  });
});
