import type { StageId } from '../types';
import type { Rng } from './random';

export type FigureType =
  'hold' | 'step' | 'run' | 'neighbor' | 'arpeggio' | 'turn' | 'leap' | 'zigzag' | 'pedal';

export type ContourType = 'descending' | 'ascending' | 'arch' | 'valley' | 'wave' | 'plateau';

/** Durations in ticks for one chord window (96 ticks); negative values are rests. */
export interface RhythmCell {
  durs: readonly number[];
  w: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  feel: string;
  /** 0..1 energy, used for busyness weighting and visuals. */
  intensity: number;
  rhythms: readonly RhythmCell[];
  figures: Partial<Record<FigureType, number>>;
  contours: Partial<Record<ContourType, number>>;
  /** Skeleton contour amplitude range, in scale degrees. */
  amp: readonly [number, number];
  /** Register shift of the skeleton relative to the middle of the range. */
  lift: number;
  /** Probability that an eligible note is ornamented. */
  ornament: number;
  velocity: number;
  /** Sounding fraction of each note (1 = legato). */
  gate: number;
}

const cell = (durs: number[], w: number): RhythmCell => ({ durs, w });

export const STAGES: Record<StageId, StageDef> = {
  calm: {
    id: 'calm',
    name: 'Calm',
    feel: 'Long, singing notes',
    intensity: 0.15,
    rhythms: [
      cell([96], 3),
      cell([48, 48], 3),
      cell([72, 24], 1.5),
      cell([48, 24, 24], 1),
      cell([24, 24, 48], 0.8),
    ],
    figures: { hold: 1, step: 2.5, neighbor: 1.5, arpeggio: 0.6 },
    contours: { descending: 3, arch: 2, plateau: 1.5, wave: 1 },
    amp: [1.5, 3],
    lift: -1,
    ornament: 0.03,
    velocity: 0.56,
    gate: 1,
  },
  flowing: {
    id: 'flowing',
    name: 'Flowing',
    feel: 'Gentle stepwise lines',
    intensity: 0.4,
    rhythms: [
      cell([24, 24, 24, 24], 4),
      cell([48, 24, 24], 1.5),
      cell([24, 24, 48], 1.2),
      cell([36, 12, 24, 24], 1),
      cell([24, 12, 12, 24, 24], 0.8),
    ],
    figures: { step: 3, neighbor: 2, arpeggio: 2, turn: 1, zigzag: 1 },
    contours: { descending: 2.5, arch: 2, wave: 2, ascending: 1, valley: 1 },
    amp: [2, 3.5],
    lift: 0,
    ornament: 0.04,
    velocity: 0.62,
    gate: 0.95,
  },
  lively: {
    id: 'lively',
    name: 'Lively',
    feel: 'Running scales',
    intensity: 0.8,
    rhythms: [
      cell([12, 12, 12, 12, 12, 12, 12, 12], 4),
      cell([24, 12, 12, 24, 12, 12], 1.5),
      cell([12, 12, 24, 12, 12, 24], 1.5),
      cell([12, 12, 12, 12, 24, 24], 1.5),
      cell([24, 24, 12, 12, 12, 12], 1),
    ],
    figures: { run: 3, step: 2, turn: 2, zigzag: 1.5, arpeggio: 1.5, pedal: 1 },
    contours: { wave: 2, arch: 2, descending: 2, ascending: 1.5, valley: 1 },
    amp: [2.5, 4],
    lift: 1,
    ornament: 0.03,
    velocity: 0.68,
    gate: 0.86,
  },
  playful: {
    id: 'playful',
    name: 'Playful',
    feel: 'Leaps, arpeggios, dotted rhythms',
    intensity: 0.7,
    rhythms: [
      cell([36, 12, 36, 12], 2),
      cell([24, 12, 12, 24, 24], 1.5),
      cell([12, 24, 12, 24, 24], 1),
      cell([16, 16, 16, 16, 16, 16], 1.5),
      cell([24, 24, 12, 12, 24], 1),
      cell([48, 16, 16, 16], 1),
    ],
    figures: { arpeggio: 3, leap: 2.5, zigzag: 1.5, pedal: 1.5, neighbor: 1 },
    contours: { wave: 2.5, arch: 1.5, valley: 1.5, ascending: 1, descending: 1 },
    amp: [2.5, 4.5],
    lift: 1,
    ornament: 0.05,
    velocity: 0.7,
    gate: 0.72,
  },
  ornamented: {
    id: 'ornamented',
    name: 'Ornamented',
    feel: 'Trills, turns, grace notes',
    intensity: 0.55,
    rhythms: [
      cell([48, 48], 2),
      cell([72, 24], 1.5),
      cell([24, 24, 48], 1.5),
      cell([24, 24, 24, 24], 1.5),
      cell([48, 24, 24], 1),
    ],
    figures: { step: 2, neighbor: 2, arpeggio: 1, leap: 1, turn: 1 },
    contours: { descending: 2, arch: 2, wave: 1.5, plateau: 1 },
    amp: [2, 3.5],
    lift: 0,
    ornament: 0.45,
    velocity: 0.64,
    gate: 0.92,
  },
  rest: {
    id: 'rest',
    name: 'Rest',
    feel: 'Thin back to one or two voices, breathe',
    intensity: 0.05,
    rhythms: [
      cell([96], 4),
      cell([48, 48], 2),
      cell([72, 24], 1),
      cell([48, -48], 1.5),
      cell([-48, 48], 0.6),
    ],
    figures: { hold: 1.5, step: 1.5, neighbor: 1 },
    contours: { descending: 2, plateau: 2, arch: 1 },
    amp: [1, 2.5],
    lift: -2,
    ornament: 0.02,
    velocity: 0.5,
    gate: 1,
  },
};

/** Mostly follows the original's build-up (calm → flowing → lively → …), remixed endlessly. */
const NEXT: Record<StageId, Partial<Record<StageId, number>>> = {
  calm: { flowing: 0.7, ornamented: 0.12, lively: 0.1, playful: 0.08 },
  flowing: { lively: 0.45, ornamented: 0.2, playful: 0.2, calm: 0.15 },
  lively: { playful: 0.4, ornamented: 0.25, flowing: 0.2, rest: 0.15 },
  playful: { ornamented: 0.3, lively: 0.25, rest: 0.25, flowing: 0.2 },
  ornamented: { rest: 0.4, flowing: 0.25, calm: 0.2, playful: 0.15 },
  rest: { calm: 0.5, flowing: 0.35, ornamented: 0.15 },
};

/** Busy listeners drift towards energetic stages, calm listeners towards quiet ones. */
export function nextStage(current: StageId, busyness: number, rng: Rng): StageId {
  const options = Object.entries(NEXT[current]) as [StageId, number][];
  const weights = options.map(
    ([id, w]) => w * Math.exp(4 * (busyness - 0.5) * (STAGES[id].intensity - 0.45)),
  );
  return rng.weighted(
    options.map(([id]) => id),
    weights,
  );
}

/** Each stage lasts 2–6 cycles. */
export function stageLength(stage: StageId, busyness: number, rng: Rng): number {
  const bias = (busyness - 0.5) * (STAGES[stage].intensity - 0.45) * 2.5;
  const lengths = [2, 3, 4, 5, 6];
  return rng.weighted(
    lengths,
    lengths.map((len) => Math.max(0.15, 1 + bias * (len - 4))),
  );
}
