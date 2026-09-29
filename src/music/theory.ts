import type { Mode } from '../types';

export const TONIC_IDS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
export type TonicId = (typeof TONIC_IDS)[number];

const TONIC_LABELS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

export const SCALE_STEPS: Record<Mode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export interface Key {
  readonly tonicPc: number;
  readonly mode: Mode;
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isTonicId(value: string): value is TonicId {
  return (TONIC_IDS as readonly string[]).includes(value);
}

export function tonicPcOf(id: TonicId): number {
  return TONIC_IDS.indexOf(id);
}

export function tonicIdOf(pc: number): TonicId {
  return TONIC_IDS[mod(pc, 12)];
}

export function tonicLabel(pc: number): string {
  return TONIC_LABELS[mod(pc, 12)];
}

/** Flat spelling for flat tonics and flat key signatures (F, B♭, E♭, A♭, D♭ major and relatives). */
export function prefersFlats(key: Key): boolean {
  if (TONIC_LABELS[mod(key.tonicPc, 12)].includes('♭')) return true;
  const relativeMajor = key.mode === 'major' ? key.tonicPc : key.tonicPc + 3;
  return [5, 10, 3, 8, 1].includes(mod(relativeMajor, 12));
}

export function pcName(pc: number, key: Key): string {
  return (prefersFlats(key) ? FLAT_NAMES : SHARP_NAMES)[mod(pc, 12)];
}

export function keyName(key: Key): string {
  return `${tonicLabel(key.tonicPc)} ${key.mode}`;
}

export function sameKey(a: Key, b: Key): boolean {
  return mod(a.tonicPc, 12) === mod(b.tonicPc, 12) && a.mode === b.mode;
}

/**
 * Semitones above the tonic for a diatonic degree (0 = tonic, 7 = octave, negatives go down).
 * `raiseLeading` gives melodic-minor 6th and 7th degrees, used over the major V chord in minor.
 */
export function degreeToSemitones(deg: number, mode: Mode, raiseLeading = false): number {
  const d = mod(deg, 7);
  let semis = Math.floor(deg / 7) * 12 + SCALE_STEPS[mode][d];
  if (raiseLeading && mode === 'minor' && (d === 5 || d === 6)) semis += 1;
  return semis;
}

/** Melody reference tonic: the tonic between C4 and B4. */
export function melodyRef(key: Key): number {
  return 60 + mod(key.tonicPc, 12);
}

/** Ground-bass tonic between G2 and F♯3, keeping the eight-note line in cello/contrabass range. */
export function bassRef(key: Key): number {
  return 43 + mod(key.tonicPc - 7, 12);
}

export function degreeToMidi(
  deg: number,
  key: Key,
  raiseLeading = false,
  ref = melodyRef(key),
): number {
  return ref + degreeToSemitones(deg, key.mode, raiseLeading);
}

/** Nearest diatonic degree to a MIDI pitch (ties resolve downwards). */
export function midiToDegree(midi: number, key: Key, ref = melodyRef(key)): number {
  const estimate = Math.round(((midi - ref) * 7) / 12);
  let best = estimate;
  let bestDist = Infinity;
  for (let d = estimate - 2; d <= estimate + 2; d++) {
    const dist = Math.abs(degreeToMidi(d, key, false, ref) - midi);
    if (dist < bestDist) {
      best = d;
      bestDist = dist;
    }
  }
  return best;
}

/** Degree bounds that keep a line inside an absolute MIDI range. */
export function degreeBounds(
  key: Key,
  lowMidi: number,
  highMidi: number,
  ref = melodyRef(key),
): { lo: number; hi: number } {
  let lo = midiToDegree(lowMidi, key, ref);
  while (degreeToMidi(lo, key, false, ref) < lowMidi) lo++;
  let hi = midiToDegree(highMidi, key, ref);
  while (degreeToMidi(hi, key, false, ref) > highMidi) hi--;
  return { lo, hi };
}

export function chordName(rootPc: number, minor: boolean, key: Key): string {
  return pcName(rootPc, key) + (minor ? 'm' : '');
}

/** Scientific pitch name with ASCII accidentals, e.g. "F#4". */
export function midiName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  return `${names[mod(midi, 12)]}${Math.floor(midi / 12) - 1}`;
}
