import { Composer, type ComposeSettings } from '../src/music/composer';
import type { CycleScore, ScoreNote } from '../src/music/score';

export const BASE_SETTINGS: ComposeSettings = {
  key: 'D',
  mood: 'bright',
  busyness: 0.5,
  strict: false,
  autoModulate: false,
  chordStyle: 'block',
  quotes: true,
};

export function composer(seed: string, patch: Partial<ComposeSettings> = {}): Composer {
  return new Composer(seed, { ...BASE_SETTINGS, ...patch });
}

export function melody(score: CycleScore, voice?: number): ScoreNote[] {
  return score.notes.filter(
    (n) => n.part === 'melody' && (voice === undefined || n.voice === voice),
  );
}

/**
 * Parallel fifths/octaves between pairs of canon voices: consecutive simultaneities (taken at every
 * onset of either voice) where both voices move the same way into the same perfect interval.
 */
export function countParallels(score: CycleScore): number {
  const voices = [0, 1, 2].map((v) => melody(score, v).filter((n) => !n.orn));
  const soundingAt = (notes: ScoreNote[], tick: number) =>
    notes.find((n) => n.tick <= tick && tick < n.tick + n.dur);
  let count = 0;
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      if (voices[a].length === 0 || voices[b].length === 0) continue;
      const times = [...new Set([...voices[a], ...voices[b]].map((n) => n.tick))].sort(
        (x, y) => x - y,
      );
      for (let i = 1; i < times.length; i++) {
        const x1 = soundingAt(voices[a], times[i - 1]);
        const x2 = soundingAt(voices[a], times[i]);
        const o1 = soundingAt(voices[b], times[i - 1]);
        const o2 = soundingAt(voices[b], times[i]);
        if (!x1 || !x2 || !o1 || !o2 || o1.midi === o2.midi || x1.midi === x2.midi) continue;
        const iv1 = (((x1.midi - o1.midi) % 12) + 12) % 12;
        const iv2 = (((x2.midi - o2.midi) % 12) + 12) % 12;
        const same = Math.sign(x2.midi - x1.midi) === Math.sign(o2.midi - o1.midi);
        if (same && iv1 === iv2 && (iv1 === 0 || iv1 === 7)) count++;
      }
    }
  }
  return count;
}
