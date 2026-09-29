import type { Mode } from '../types';
import { CHORDS_PER_CYCLE, TICKS_PER_CHORD } from './constants';
import {
  bassRef,
  chordName,
  degreeToSemitones,
  type Key,
  mod,
  SCALE_STEPS,
  sameKey,
  tonicLabel,
} from './theory';

export interface ChordDef {
  roman: string;
  /** Root as a scale degree (0 = tonic). */
  root: number;
  minor: boolean;
  /** Ground-bass note as a degree relative to the bass tonic (negative = below). */
  bass: number;
}

/**
 * The Canon loop — I V vi iii IV I IV V — and the plan's minor variant (i v VI III iv i iv V).
 * The bass degrees give Pachelbel's ground: D A B F♯ G D G A in D major.
 */
export const CANON_LOOP: Record<Mode, readonly ChordDef[]> = {
  major: [
    { roman: 'I', root: 0, minor: false, bass: 0 },
    { roman: 'V', root: 4, minor: false, bass: -3 },
    { roman: 'vi', root: 5, minor: true, bass: -2 },
    { roman: 'iii', root: 2, minor: true, bass: -5 },
    { roman: 'IV', root: 3, minor: false, bass: -4 },
    { roman: 'I', root: 0, minor: false, bass: -7 },
    { roman: 'IV', root: 3, minor: false, bass: -4 },
    { roman: 'V', root: 4, minor: false, bass: -3 },
  ],
  minor: [
    { roman: 'i', root: 0, minor: true, bass: 0 },
    { roman: 'v', root: 4, minor: true, bass: -3 },
    { roman: 'VI', root: 5, minor: false, bass: -2 },
    { roman: 'III', root: 2, minor: false, bass: -5 },
    { roman: 'iv', root: 3, minor: true, bass: -4 },
    { roman: 'i', root: 0, minor: true, bass: -7 },
    { roman: 'iv', root: 3, minor: true, bass: -4 },
    { roman: 'V', root: 4, minor: false, bass: -3 },
  ],
};

export interface ChordInstance {
  index: number;
  roman: string;
  name: string;
  rootPc: number;
  minor: boolean;
  /** Chord-tone scale degrees (0–6) in the cycle's key. */
  degrees: number[];
  /** Root, third and fifth pitch classes. */
  pcs: number[];
  /** Minor-mode V: the melody uses raised 6th/7th degrees. */
  raiseLeading: boolean;
  bassMidi: number;
  /** Close triad for the chords layer (E3–E5), voice-led from the previous chord. */
  voicing: number[];
  /** Low root plus a triad for the string pad. */
  pad: number[];
  /** Substituted final chord that prepares the next key. */
  pivot: boolean;
  tick: number;
}

export function chordDegrees(root: number): number[] {
  return [mod(root, 7), mod(root + 2, 7), mod(root + 4, 7)];
}

export function triadPcs(rootPc: number, minor: boolean): number[] {
  return [mod(rootPc, 12), mod(rootPc + (minor ? 3 : 4), 12), mod(rootPc + 7, 12)];
}

export function scalePcs(key: Key): number[] {
  return SCALE_STEPS[key.mode].map((s) => mod(key.tonicPc + s, 12));
}

/**
 * Dominant of the next key when it is a diatonic major triad of the current key (e.g. A major → G
 * major goes through D, which is IV in A). Such a pivot needs no chromatic melody notes.
 */
export function pivotChord(from: Key, to: Key): { rootDeg: number; rootPc: number } | null {
  if (sameKey(from, to)) return null;
  const rootPc = mod(to.tonicPc + 7, 12);
  const scale = scalePcs(from);
  if (!triadPcs(rootPc, false).every((pc) => scale.includes(pc))) return null;
  return { rootDeg: scale.indexOf(rootPc), rootPc };
}

function nearestWithPc(pc: number, target: number): number {
  const below = target - mod(target - pc, 12);
  return target - below <= below + 12 - target ? below : below + 12;
}

/** Close-position triad inside [lo, hi] that moves least from `prev` (or sits nearest `center`). */
export function voiceTriad(
  pcs: readonly number[],
  prev: readonly number[] | null,
  lo: number,
  hi: number,
  center: number,
): number[] {
  let best: number[] = [];
  let bestScore = Infinity;
  for (let inv = 0; inv < 3; inv++) {
    const order = [pcs[inv], pcs[(inv + 1) % 3], pcs[(inv + 2) % 3]];
    for (let base = lo; base <= hi; base++) {
      if (mod(base, 12) !== order[0]) continue;
      const notes = [base];
      for (let j = 1; j < 3; j++) {
        let n = notes[j - 1] + 1;
        while (mod(n, 12) !== order[j]) n++;
        notes.push(n);
      }
      if (notes[2] > hi) continue;
      const score =
        prev && prev.length === 3
          ? Math.abs(notes[0] - prev[0]) +
            Math.abs(notes[1] - prev[1]) +
            Math.abs(notes[2] - prev[2])
          : Math.abs((notes[0] + notes[1] + notes[2]) / 3 - center);
      if (score < bestScore - 1e-9) {
        bestScore = score;
        best = notes;
      }
    }
  }
  return best;
}

/**
 * The eight chords of one cycle. When `nextKey` differs and a diatonic pivot exists, the final V is
 * replaced by the new key's dominant (in first inversion if its root repeats the previous bass).
 */
export function buildCycleChords(
  key: Key,
  nextKey: Key | null,
  prevVoicing: readonly number[] | null,
  prevPad: readonly number[] | null,
): ChordInstance[] {
  const loop = CANON_LOOP[key.mode];
  const scale = SCALE_STEPS[key.mode];
  const bRef = bassRef(key);
  const pivot = nextKey ? pivotChord(key, nextKey) : null;
  const chords: ChordInstance[] = [];
  let voicing: number[] | null = prevVoicing ? [...prevVoicing] : null;
  let padUpper = prevPad && prevPad.length === 4 ? prevPad.slice(1) : null;

  for (let i = 0; i < CHORDS_PER_CYCLE; i++) {
    const def = loop[i];
    let root = def.root;
    let minor = def.minor;
    let roman = def.roman;
    let rootPc = mod(key.tonicPc + scale[root], 12);
    let bassMidi = bRef + degreeToSemitones(def.bass, key.mode);
    let isPivot = false;
    const raiseLeading = key.mode === 'minor' && def.roman === 'V';

    if (i === CHORDS_PER_CYCLE - 1 && pivot && nextKey && pivot.rootDeg !== 4) {
      root = pivot.rootDeg;
      minor = false;
      rootPc = pivot.rootPc;
      roman = `V/${tonicLabel(nextKey.tonicPc)}`;
      isPivot = true;
      const bassPc = rootPc === chords[i - 1].rootPc ? mod(rootPc + 4, 12) : rootPc;
      bassMidi = nearestWithPc(bassPc, bassMidi);
    }

    const pcs = triadPcs(rootPc, minor);
    voicing = voiceTriad(pcs, voicing, 52, 76, 64);
    padUpper = voiceTriad(pcs, padUpper, 55, 79, 67);
    const padRoot = 40 + mod(rootPc - 4, 12);
    chords.push({
      index: i,
      roman,
      name: chordName(rootPc, minor, key),
      rootPc,
      minor,
      degrees: chordDegrees(root),
      pcs,
      raiseLeading: raiseLeading && !isPivot,
      bassMidi,
      voicing,
      pad: [padRoot, ...padUpper],
      pivot: isPivot,
      tick: i * TICKS_PER_CHORD,
    });
  }
  return chords;
}
