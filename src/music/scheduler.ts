import * as Tone from 'tone';
import type { AudioEngine } from '../audio/types';
import type { MusicBus, MusicEvents } from '../events';
import type { PartId, StageId } from '../types';
import type { Composer } from './composer';
import { BEATS_PER_CHORD, BEATS_PER_CYCLE, TICKS_PER_BEAT } from './constants';
import type { CycleScore, ScoreNote } from './score';
import { tonicLabel } from './theory';

export interface SchedulerOptions {
  composer: Composer;
  /** Null runs silently (events only). */
  audio: AudioEngine | null;
  bus: MusicBus;
  /** Muted backing layers are not scheduled at all. */
  isPartEnabled: (part: PartId) => boolean;
  tempo: number;
}

/**
 * Events that only matter to the visuals. Tone.Draw drops them when they are late (a busy main
 * thread must not cause bursts of stale particles) and they are skipped while the tab is hidden.
 * Everything else drives UI state, the rewind history or scene seasons, so it is always delivered.
 */
const VISUAL_ONLY = new Set<keyof MusicEvents>([
  'noteOn',
  'bassNote',
  'beat',
  'chordChange',
  'phraseEnd',
]);

/**
 * Plays the composer's cycles on the Tone.js Transport. Every beat schedules the notes that start
 * within it (Tone's look-ahead keeps audio steady while visuals render), and every musical event
 * is mirrored onto the bus via Tone.Draw so visuals and UI move with what is heard.
 */
export class Scheduler {
  private composer: Composer;
  private readonly audio: AudioEngine | null;
  private readonly bus: MusicBus;
  private readonly isPartEnabled: (part: PartId) => boolean;
  private readonly transport = Tone.getTransport();
  private repeatId: number | null = null;
  private cycle = 0;
  private beat = 0;
  private score: CycleScore | null = null;
  private cursor = 0;
  private pendingJump: number | null = null;
  private pendingComposer: Composer | null = null;
  private lastStage: StageId | null = null;
  private lastKey: string | null = null;
  private latency = 0;
  private playing = false;
  private started = false;

  constructor(opts: SchedulerOptions) {
    this.composer = opts.composer;
    this.audio = opts.audio;
    this.bus = opts.bus;
    this.isPartEnabled = opts.isPartEnabled;
    this.transport.bpm.value = opts.tempo;
  }

  /** Cycle currently being scheduled (a fraction of a second ahead of what is heard). */
  get currentCycle(): number {
    return this.cycle;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get hasStarted(): boolean {
    return this.started;
  }

  /** Target of a jump that waits for the next chord boundary. */
  get pendingCycle(): number | null {
    return this.pendingJump;
  }

  get activeComposer(): Composer {
    return this.pendingComposer ?? this.composer;
  }

  start(cycle = 0): void {
    this.cycle = Math.max(0, cycle);
    this.beat = 0;
    this.score = null;
    this.pendingJump = null;
    this.lastStage = null;
    this.lastKey = null;
    if (this.repeatId === null) {
      this.repeatId = this.transport.scheduleRepeat((time) => this.onBeat(time), '4n', 0);
    }
    // Headroom so a busy first frame after pressing Play can't make the first notes late.
    this.transport.start('+0.2');
    this.started = true;
    this.setPlaying(true);
  }

  pause(): void {
    if (!this.playing) return;
    this.transport.pause();
    this.setPlaying(false);
  }

  resume(): void {
    if (this.playing) return;
    if (!this.started) {
      this.start(this.cycle);
      return;
    }
    this.transport.start('+0.1');
    this.setPlaying(true);
  }

  setTempo(bpm: number): void {
    this.transport.bpm.rampTo(bpm, 1.5);
  }

  /**
   * Moves to the start of a phrase (rewind, favourites, a new piece) at the next chord boundary,
   * optionally switching to another composer at the same moment.
   */
  jumpTo(cycle: number, composer?: Composer): void {
    this.pendingJump = Math.max(0, Math.floor(cycle));
    if (composer) this.pendingComposer = composer;
    if (!this.playing) this.applyJump();
  }

  dispose(): void {
    if (this.repeatId !== null) this.transport.clear(this.repeatId);
    this.repeatId = null;
    this.transport.stop();
    this.setPlaying(false);
  }

  private setPlaying(playing: boolean): void {
    this.playing = playing;
    this.audio?.setPlaying(playing);
    this.bus.emit('transport', { playing });
  }

  private applyJump(): void {
    if (this.pendingComposer) this.composer = this.pendingComposer;
    this.pendingComposer = null;
    if (this.pendingJump !== null) this.cycle = this.pendingJump;
    this.pendingJump = null;
    this.beat = 0;
    this.score = null;
    this.lastStage = null;
  }

  private onBeat(time: number): void {
    // Jumps wait for a chord boundary so the harmony never breaks mid-chord.
    if (this.pendingJump !== null && this.beat % BEATS_PER_CHORD === 0) this.applyJump();
    if (this.beat === 0 || this.score === null) this.beginCycle(time);
    const score = this.score as CycleScore;
    const secPerTick = 60 / (this.transport.bpm.value * TICKS_PER_BEAT);
    const from = this.beat * TICKS_PER_BEAT;
    const to = from + TICKS_PER_BEAT;
    while (this.cursor < score.notes.length && score.notes[this.cursor].tick < to) {
      const note = score.notes[this.cursor++];
      if (note.tick >= from)
        this.play(note, score, time + (note.tick - from) * secPerTick, secPerTick);
    }
    if (this.beat % BEATS_PER_CHORD === 0) {
      const index = this.beat / BEATS_PER_CHORD;
      const chord = score.chords[index];
      this.emit(time, 'chordChange', {
        chordIndex: index,
        roman: chord.roman,
        name: chord.name,
        rootPc: chord.rootPc,
        minor: chord.minor,
        cycle: score.cycle,
        duration: BEATS_PER_CHORD * TICKS_PER_BEAT * secPerTick,
        time,
      });
    }
    this.emit(time, 'beat', {
      beat: this.beat,
      cycle: score.cycle,
      downbeat: this.beat % 4 === 0,
      time,
    });
    this.beat++;
    if (this.beat >= BEATS_PER_CYCLE) {
      this.beat = 0;
      this.cycle++;
    }
  }

  private beginCycle(time: number): void {
    const score = this.composer.getCycle(this.cycle);
    this.score = score;
    this.cursor = 0;
    const raw = Tone.getContext().rawContext as unknown as {
      outputLatency?: number;
      baseLatency?: number;
    };
    this.latency = raw.outputLatency || raw.baseLatency || 0;
    if (score.keyName !== this.lastKey) {
      this.emit(time, 'keyChange', {
        tonic: tonicLabel(score.key.tonicPc),
        tonicPc: score.key.tonicPc,
        mode: score.key.mode,
        season: score.season,
        cycle: score.cycle,
        initial: this.lastKey === null,
        time,
      });
    }
    if (score.stage !== this.lastStage) {
      this.emit(time, 'stageChange', {
        stage: score.stage,
        previous: this.lastStage,
        intensity: score.intensity,
        cycle: score.cycle,
        time,
      });
    }
    this.emit(time, 'cycle', {
      cycle: score.cycle,
      stage: score.stage,
      voices: score.voices,
      keyName: score.keyName,
      mode: score.key.mode,
      quote: score.quote,
      duration: (BEATS_PER_CYCLE * 60) / this.transport.bpm.value,
      time,
    });
    this.lastKey = score.keyName;
    this.lastStage = score.stage;
    // Compose the next phrase now, well before its downbeat.
    this.composer.getCycle(this.cycle + 1);
  }

  private play(note: ScoreNote, score: CycleScore, time: number, secPerTick: number): void {
    if (note.part !== 'melody' && !this.isPartEnabled(note.part)) return;
    const duration = Math.max(0.04, note.dur * secPerTick * note.gate);
    // Tiny deterministic offsets keep the three voices from sounding mechanical.
    const nudge =
      note.part === 'melody'
        ? note.voice * 0.004 +
          (((note.tick * 7 + note.voice * 13 + score.cycle * 5) % 5) - 2) * 0.0015
        : 0;
    const at = time + nudge;
    this.audio?.playNote(
      {
        part: note.part,
        voice: note.voice,
        midi: note.midi,
        duration,
        velocity: note.velocity,
        ornament: note.orn,
      },
      at,
    );
    if (note.part === 'melody') {
      const span = score.melodyHighMidi - score.melodyLowMidi;
      this.emit(at, 'noteOn', {
        voice: note.voice,
        midi: note.midi,
        pitch01: Math.min(1, Math.max(0, (note.midi - score.melodyLowMidi) / span)),
        velocity: note.velocity,
        duration,
        ornament: note.orn,
        cycle: score.cycle,
        time: at,
      });
      if (note.voice === 0 && !note.orn && note.tick === score.phraseEndTick) {
        this.emit(at, 'phraseEnd', { cycle: score.cycle, time: at });
      }
    } else if (note.part === 'bass') {
      this.emit(at, 'bassNote', {
        midi: note.midi,
        velocity: note.velocity,
        duration,
        chordIndex: note.chord,
        time: at,
      });
    }
  }

  private emit<K extends keyof MusicEvents>(time: number, type: K, payload: MusicEvents[K]): void {
    const visualOnly = VISUAL_ONLY.has(type);
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      // requestAnimationFrame is paused in hidden tabs, so Draw would pile events up for hours.
      if (!visualOnly) this.bus.emit(type, payload);
      return;
    }
    if (visualOnly) {
      Tone.getDraw().schedule(() => this.bus.emit(type, payload), time + this.latency);
      return;
    }
    const delay = (time + this.latency - Tone.getContext().currentTime) * 1000;
    window.setTimeout(() => this.bus.emit(type, payload), Math.max(0, delay));
  }
}
