import type { PartId, Season, StageId } from '../types';
import type { ChordInstance } from './progression';
import type { Key } from './theory';

/** One note of a rendered cycle; times are ticks from the start of the cycle. */
export interface ScoreNote {
  part: PartId;
  voice: number;
  tick: number;
  /** Notated length in ticks. */
  dur: number;
  /** Sounding fraction of `dur` (articulation). */
  gate: number;
  midi: number;
  velocity: number;
  orn: boolean;
  /** Chord window 0..7 the note belongs to. */
  chord: number;
}

export interface CycleScore {
  cycle: number;
  key: Key;
  keyName: string;
  season: Season;
  keyChanged: boolean;
  stage: StageId;
  previousStage: StageId | null;
  stageChanged: boolean;
  intensity: number;
  voices: number;
  quote: boolean;
  chords: ChordInstance[];
  /** All parts, sorted by tick. */
  notes: ScoreNote[];
  /** Onset of the leading voice's final note (the phrase ending), if it plays this cycle. */
  phraseEndTick: number | null;
  melodyLowMidi: number;
  melodyHighMidi: number;
}

export interface PhraseSummary {
  cycle: number;
  stage: StageId;
  keyName: string;
  quote: boolean;
}
