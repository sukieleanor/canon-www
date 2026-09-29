import { TICKS_PER_CHORD, TICKS_PER_CYCLE } from './constants';
import type { Phrase, PhraseNote } from './melodyGenerator';
import { degreeToSemitones, mod } from './theory';

export type RuleName =
  'timing' | 'range' | 'strong-beat' | 'weak-beat' | 'leap' | 'interval' | 'cadence';

export interface RuleViolation {
  rule: RuleName;
  tick: number;
  message: string;
}

export interface LineNote {
  note: PhraseNote;
  /** Length including any ornament notes that decorate it. */
  span: number;
  /** The next main note starts exactly when this one (with its ornaments) ends. */
  joinsNext: boolean;
}

/** The underlying melodic line: ornament notes are folded into the note they decorate. */
export function mainLine(notes: readonly PhraseNote[]): LineNote[] {
  const sorted = [...notes].sort((a, b) => a.tick - b.tick);
  const line: LineNote[] = [];
  for (const n of sorted) {
    if (!n.orn) {
      line.push({ note: n, span: n.dur, joinsNext: false });
      continue;
    }
    const last = line[line.length - 1];
    if (last && last.note.tick + last.span === n.tick) last.span += n.dur;
  }
  for (let i = 0; i < line.length - 1; i++) {
    const cur = line[i];
    const nextTick = line[i + 1].note.tick;
    // Grace notes steal time from the end of the note before them.
    const graceGap = sorted.some(
      (n) => n.orn && n.tick >= cur.note.tick + cur.span && n.tick < nextTick,
    )
      ? sorted
          .filter((n) => n.orn && n.tick >= cur.note.tick + cur.span && n.tick < nextTick)
          .reduce((sum, n) => sum + n.dur, 0)
      : 0;
    cur.joinsNext = cur.note.tick + cur.span + graceGap === nextTick;
  }
  return line;
}

export function isLeap(interval: number): boolean {
  return Math.abs(interval) >= 3;
}

/** Melodic intervals that are never allowed: sevenths, beyond an octave, tritone leaps. */
export function forbiddenInterval(a: number, b: number, mode: Phrase['key']['mode']): boolean {
  const size = Math.abs(b - a);
  if (size > 7 || size === 6) return true;
  if (size >= 3 && Math.abs(degreeToSemitones(b, mode) - degreeToSemitones(a, mode)) === 6)
    return true;
  return false;
}

/** Checks the melody-writing rules from the plan (§4.1). Returns an empty list when all hold. */
export function checkPhrase(phrase: Phrase): RuleViolation[] {
  const out: RuleViolation[] = [];
  const all = [...phrase.notes].sort((a, b) => a.tick - b.tick);
  for (let i = 0; i < all.length; i++) {
    const n = all[i];
    if (n.tick < 0 || n.tick + n.dur > TICKS_PER_CYCLE || n.dur <= 0) {
      out.push({ rule: 'timing', tick: n.tick, message: 'note outside the cycle' });
    }
    if (i > 0 && all[i - 1].tick + all[i - 1].dur > n.tick) {
      out.push({ rule: 'timing', tick: n.tick, message: 'overlapping notes in one voice' });
    }
    if (n.orn && (n.deg < phrase.lo - 1 || n.deg > phrase.hi + 1)) {
      out.push({ rule: 'range', tick: n.tick, message: `ornament ${n.deg} out of range` });
    }
  }

  const line = mainLine(phrase.notes);
  const isTone = (n: PhraseNote) => phrase.chordDegrees[n.chord].includes(mod(n.deg, 7));
  for (let i = 0; i < line.length; i++) {
    const { note } = line[i];
    const prev = i > 0 && line[i - 1].joinsNext ? line[i - 1].note : null;
    const next = line[i].joinsNext && i + 1 < line.length ? line[i + 1].note : null;

    if (note.deg < phrase.lo || note.deg > phrase.hi) {
      out.push({ rule: 'range', tick: note.tick, message: `degree ${note.deg} out of range` });
    }
    if (note.tick % TICKS_PER_CHORD === 0) {
      if (!isTone(note)) {
        out.push({
          rule: 'strong-beat',
          tick: note.tick,
          message: 'strong beat is not a chord tone',
        });
      }
    } else if (!isTone(note)) {
      const stepIn = prev !== null && Math.abs(note.deg - prev.deg) === 1;
      const stepOut = next !== null && Math.abs(next.deg - note.deg) === 1;
      if (!stepIn || !stepOut) {
        out.push({
          rule: 'weak-beat',
          tick: note.tick,
          message: 'non-chord tone is not a passing or neighbour note',
        });
      }
    }
    if (prev) {
      const into = note.deg - prev.deg;
      if (forbiddenInterval(prev.deg, note.deg, phrase.key.mode)) {
        out.push({ rule: 'interval', tick: note.tick, message: `forbidden interval ${into}` });
      }
      if (isLeap(into)) {
        const back = next ? next.deg - note.deg : 0;
        if (!next || Math.sign(back) !== -Math.sign(into) || Math.abs(back) > 2) {
          out.push({ rule: 'leap', tick: note.tick, message: 'leap not followed by a step back' });
        }
      }
    }
  }

  // Phrases end on the root of the final chord: the dominant (the key's 5th — stable over both V
  // and I), or the new key's 5th when the final chord is a modulation pivot.
  const last = line[line.length - 1];
  if (last && mod(last.note.deg, 7) !== phrase.chordDegrees[7][0]) {
    out.push({
      rule: 'cadence',
      tick: last.note.tick,
      message: 'phrase does not end on a stable note',
    });
  }
  return out;
}
