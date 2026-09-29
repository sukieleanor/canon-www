import type { Mode, SceneId, Season, StageId } from './types';

/*
 * Music → visuals/UI events. The scheduler emits them through Tone.Draw so they arrive
 * (on the main thread, via requestAnimationFrame) close to the moment they are heard.
 * `time` is always the AudioContext time the event sounds at.
 */

export interface NoteOnEvent {
  /** Canon voice: 0 = leader, 1 and 2 = echoes one and two phrases behind. */
  voice: number;
  midi: number;
  /** Pitch normalised to the melody range of the current key: 0 = lowest, 1 = highest. */
  pitch01: number;
  /** 0..1 */
  velocity: number;
  /** Seconds. */
  duration: number;
  /** Fast decorative note (trill, turn, grace note). */
  ornament: boolean;
  cycle: number;
  time: number;
}

export interface BassNoteEvent {
  midi: number;
  velocity: number;
  duration: number;
  /** 0..7 position in the Canon chord loop. */
  chordIndex: number;
  time: number;
}

export interface ChordChangeEvent {
  /** 0..7 position in the Canon chord loop (I V vi iii IV I IV V). */
  chordIndex: number;
  roman: string;
  /** Display name, e.g. "Bm" or "F♯m". */
  name: string;
  rootPc: number;
  minor: boolean;
  cycle: number;
  /** Seconds until the next chord change. */
  duration: number;
  time: number;
}

export interface StageChangeEvent {
  stage: StageId;
  previous: StageId | null;
  /** 0..1 how busy/energetic the stage is. */
  intensity: number;
  cycle: number;
  time: number;
}

export interface KeyChangeEvent {
  /** Display name of the tonic, e.g. "D" or "B♭". */
  tonic: string;
  tonicPc: number;
  mode: Mode;
  season: Season;
  cycle: number;
  /** True for the key the session starts in. */
  initial: boolean;
  time: number;
}

export interface CycleEvent {
  cycle: number;
  stage: StageId;
  /** Number of canon voices sounding in this cycle (0–3). */
  voices: number;
  keyName: string;
  mode: Mode;
  /** This phrase nods to Pachelbel's famous descending line. */
  quote: boolean;
  /** Seconds the cycle lasts at the current tempo. */
  duration: number;
  time: number;
}

export interface PhraseEndEvent {
  cycle: number;
  time: number;
}

export interface BeatEvent {
  /** 0..15 beat within the cycle. */
  beat: number;
  cycle: number;
  downbeat: boolean;
  time: number;
}

export interface MusicEvents {
  transport: { playing: boolean };
  cycle: CycleEvent;
  noteOn: NoteOnEvent;
  bassNote: BassNoteEvent;
  chordChange: ChordChangeEvent;
  stageChange: StageChangeEvent;
  keyChange: KeyChangeEvent;
  phraseEnd: PhraseEndEvent;
  beat: BeatEvent;
  /** Emitted by the visual engine whenever the scene changes (manual pick or auto-rotate). */
  sceneChange: { scene: SceneId; auto: boolean };
}

type Handler<T> = (payload: T) => void;

/** Minimal typed pub/sub. Handler errors are isolated so a visual bug can never stop the music. */
export class EventBus<M extends object> {
  private readonly handlers = new Map<keyof M, Set<Handler<never>>>();

  on<K extends keyof M>(type: K, handler: Handler<M[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<never>);
    return () => this.off(type, handler);
  }

  off<K extends keyof M>(type: K, handler: Handler<M[K]>): void {
    this.handlers.get(type)?.delete(handler as Handler<never>);
  }

  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as Handler<M[K]>)(payload);
      } catch (err) {
        console.error(`[events] ${String(type)} handler failed`, err);
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export type MusicBus = EventBus<MusicEvents>;
