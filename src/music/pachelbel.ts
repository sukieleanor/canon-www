import type { Phrase } from './melodyGenerator';
import { mainLine } from './rules';
import { mod } from './theory';

/*
 * Reference material from Pachelbel's Canon (public domain), written as scale degrees of D major
 * relative to D4 on our grid (one chord = 96 ticks, so the original's quarter note = 96).
 * Cross-checked against the Mutopia Project edition (Jim Paterson, CC BY 3.0).
 */

/** The two famous descending lines the composer occasionally nods to. */
export const FAMOUS_LINES = {
  /** F♯ E D C♯ B A B C♯ */
  descending: [9, 8, 7, 6, 5, 4, 5, 6],
  /** D C♯ B A G F♯ G E */
  answer: [7, 6, 5, 4, 3, 2, 3, 1],
} as const;

export interface OriginalPhrase {
  name: string;
  notes: { tick: number; dur: number; deg: number }[];
}

const even = (degs: number[], dur: number) => degs.map((deg, i) => ({ tick: i * dur, dur, deg }));

export const ORIGINAL_PHRASES: OriginalPhrase[] = [
  { name: 'Opening descent (violin I, bars 3–4)', notes: even([9, 8, 7, 6, 5, 4, 5, 6], 96) },
  { name: 'Second descent (bars 5–6)', notes: even([7, 6, 5, 4, 3, 2, 3, 1], 96) },
  { name: 'Second descent, arrangement ending', notes: even([7, 6, 5, 4, 3, 2, 3, 5], 96) },
  { name: 'Broken descent (arrangement)', notes: even([2, -3, 0, 2, 5, 7, 5, 6], 96) },
  {
    name: 'Arpeggiated line (bars 7–8)',
    notes: even([0, 2, 4, 3, 2, 0, 2, 1, 0, -2, 0, 4, 3, 5, 4, 3], 48),
  },
  {
    name: 'Running line (bars 9–10)',
    notes: even(
      [
        7, 6, 7, 0, -1, 4, 1, 2, 0, 7, 6, 5, 6, 9, 11, 12, 10, 9, 8, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
        3, 2, 1,
      ],
      24,
    ),
  },
  {
    name: 'Running line, lower-octave arrangement',
    notes: even(
      [
        7, 6, 7, 0, -1, 4, 1, 2, 0, 7, 6, 5, 6, 2, 4, 5, 3, 2, 1, 3, 2, 1, 0, 6, 5, 4, 3, 2, 1, 3,
        2, 1,
      ],
      24,
    ),
  },
];

/**
 * Name of the original phrase this phrase copies exactly (same rhythm and pitches, allowing only an
 * octave/key transposition), or null. Rhythmically varied quotes are allowed — they are nods.
 */
export function matchesOriginal(phrase: Pick<Phrase, 'notes'>): string | null {
  const line = mainLine(phrase.notes);
  for (const original of ORIGINAL_PHRASES) {
    if (original.notes.length !== line.length) continue;
    const shift = line[0].note.deg - original.notes[0].deg;
    if (mod(shift, 7) !== 0) continue;
    const same = original.notes.every((o, i) => {
      const n = line[i];
      return n.note.tick === o.tick && n.span === o.dur && n.note.deg - o.deg === shift;
    });
    if (same) return original.name;
  }
  return null;
}
