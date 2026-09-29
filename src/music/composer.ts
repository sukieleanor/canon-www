import type { ChordStyle, Mode, Mood, StageId } from '../types';
import { SEASONS } from '../types';
import { generateBacking } from './backingTrack';
import { nextVoiceCount, voiceAssignments } from './canonVoices';
import {
  MELODY_HIGH_MIDI,
  MELODY_LOW_MIDI,
  MODULATION_PERIOD,
  TICKS_PER_CYCLE,
  VOICE_COUNT,
} from './constants';
import {
  generatePhrase,
  type Phrase,
  type PhraseNote,
  type QuoteRequest,
  SILENT,
  TIMELINE_SLOT,
} from './melodyGenerator';
import { FAMOUS_LINES } from './pachelbel';
import { buildCycleChords, type ChordInstance } from './progression';
import { rngFor } from './random';
import { mainLine } from './rules';
import type { CycleScore, PhraseSummary, ScoreNote } from './score';
import { nextStage, stageLength, STAGES } from './stages';
import {
  degreeBounds,
  degreeToMidi,
  type Key,
  keyName,
  melodyRef,
  midiToDegree,
  mod,
  sameKey,
  tonicPcOf,
  type TonicId,
} from './theory';

/** Settings that change what is composed (tempo, mix and visuals do not). */
export interface ComposeSettings {
  key: TonicId;
  mood: Mood;
  /** 0 = calm … 1 = lively. */
  busyness: number;
  /** Avoid parallel fifths/octaves between canon voices. */
  strict: boolean;
  /** Drift to related keys every few minutes (I → V → IV → I). */
  autoModulate: boolean;
  chordStyle: ChordStyle;
  /** Allow occasional nods to Pachelbel's famous lines. */
  quotes: boolean;
}

interface CycleState {
  cycle: number;
  key: Key;
  keyChanged: boolean;
  seasonIndex: number;
  stage: StageId;
  previousStage: StageId | null;
  stageStart: number;
  stageLength: number;
  stageSlot: number;
  stageBusyness: number;
  voices: number;
  phrase: Phrase | null;
  chords: ChordInstance[];
  lastQuote: number;
  score: CycleScore | null;
}

/** Cycles kept behind the newest generated one (rewind reaches ten phrases back). */
const KEEP_BEHIND = 24;
/** Echo voices sit slightly behind the leader so the round stays clear. */
const VOICE_GAIN = [1, 0.9, 0.82];
const MODULATION_STEPS = [0, 7, 5];

export function modeForMood(mood: Mood): Mode {
  return mood === 'wistful' ? 'minor' : 'major';
}

/**
 * Deterministic, endless composer. Cycle n depends only on the seed, the settings and cycle n-1's
 * state; random choices come from per-cycle streams, so replays and share links are exact.
 */
export class Composer {
  readonly seed: string;
  private settings: ComposeSettings;
  private readonly states = new Map<number, CycleState>();

  constructor(seed: string, settings: ComposeSettings) {
    this.seed = seed;
    this.settings = { ...settings };
  }

  getSettings(): ComposeSettings {
    return { ...this.settings };
  }

  /** New settings apply from `keepThrough + 1`; cycles already heard stay as they were. */
  updateSettings(patch: Partial<ComposeSettings>, keepThrough: number): void {
    this.settings = { ...this.settings, ...patch };
    for (const n of [...this.states.keys()]) if (n > keepThrough) this.states.delete(n);
  }

  getCycle(n: number): CycleScore {
    const state = this.state(Math.max(0, Math.floor(n)));
    if (!state.score) state.score = this.render(state);
    return state.score;
  }

  summary(n: number): PhraseSummary {
    const s = this.state(Math.max(0, Math.floor(n)));
    return {
      cycle: s.cycle,
      stage: s.stage,
      keyName: keyName(s.key),
      quote: s.phrase?.quote ?? false,
    };
  }

  /** The leading voice's phrase for cycle n (null for the bass-only intro). */
  phrase(n: number): Phrase | null {
    return this.state(Math.max(0, Math.floor(n))).phrase;
  }

  cachedCycles(): number[] {
    return [...this.states.keys()].sort((a, b) => a - b);
  }

  keyAt(n: number): Key {
    const base: Key = {
      tonicPc: tonicPcOf(this.settings.key),
      mode: modeForMood(this.settings.mood),
    };
    if (!this.settings.autoModulate || n < 1) return base;
    const step = Math.floor(n / MODULATION_PERIOD);
    return {
      tonicPc: mod(base.tonicPc + MODULATION_STEPS[step % MODULATION_STEPS.length], 12),
      mode: base.mode,
    };
  }

  private busyness(): number {
    const shift =
      this.settings.mood === 'dreamy' ? -0.15 : this.settings.mood === 'wistful' ? -0.05 : 0;
    return Math.min(1, Math.max(0, this.settings.busyness + shift));
  }

  private state(n: number): CycleState {
    const cached = this.states.get(n);
    if (cached) return cached;
    let from = n - 1;
    while (from >= 0 && !this.states.has(from)) from--;
    let prev = from >= 0 ? (this.states.get(from) ?? null) : null;
    for (let c = from + 1; c <= n; c++) {
      const s = this.advance(prev, c);
      this.states.set(c, s);
      this.states.delete(c - KEEP_BEHIND - 1);
      prev = s;
    }
    for (const k of this.states.keys()) if (k < n - KEEP_BEHIND) this.states.delete(k);
    return this.states.get(n) as CycleState;
  }

  private advance(prev: CycleState | null, n: number): CycleState {
    const settings = this.settings;
    const busy = this.busyness();
    const key = this.keyAt(n);
    const keyChanged = prev ? !sameKey(prev.key, key) : true;

    // Stage machine: a new slot when the current one runs out, or when busyness moved a lot.
    let stage: StageId = 'calm';
    let previousStage: StageId | null = null;
    let stageStart = 0;
    let length: number;
    let slot = 0;
    let stageBusyness = busy;
    if (!prev) {
      length = rngFor(this.seed, 'stage', 0).int(3, 5);
    } else if (
      n - prev.stageStart >= prev.stageLength ||
      (Math.abs(busy - prev.stageBusyness) >= 0.3 && n - prev.stageStart >= 1)
    ) {
      slot = prev.stageSlot + 1;
      const rng = rngFor(this.seed, 'stage', slot);
      stage = nextStage(prev.stage, busy, rng);
      length = stageLength(stage, busy, rng);
      previousStage = prev.stage;
      stageStart = n;
    } else {
      stage = prev.stage;
      previousStage = prev.previousStage;
      stageStart = prev.stageStart;
      length = prev.stageLength;
      slot = prev.stageSlot;
      stageBusyness = prev.stageBusyness;
    }

    const voices = nextVoiceCount(prev?.voices ?? 0, n, stage, n - stageStart);
    const nextKey = this.keyAt(n + 1);
    const chords = buildCycleChords(
      key,
      sameKey(key, nextKey) ? null : nextKey,
      prev ? prev.chords[7].voicing : null,
      prev ? prev.chords[7].pad : null,
    );

    let phrase: Phrase | null = null;
    let lastQuote = prev?.lastQuote ?? -1000;
    if (n >= 1) {
      const quote = this.pickQuote(n, stage, lastQuote);
      const ref = melodyRef(key);
      const { lo, hi } = degreeBounds(key, MELODY_LOW_MIDI, MELODY_HIGH_MIDI, ref);
      const { prevEnd, prevLeap } = this.phraseEnding(prev?.phrase ?? null, key);
      const others = settings.strict
        ? [prev?.phrase ?? null, this.states.get(n - 2)?.phrase ?? null]
            .filter((p): p is Phrase => p !== null)
            .map((p) => this.timeline(p, key, chords))
        : [];
      phrase = generatePhrase({
        cycle: n,
        rng: rngFor(this.seed, 'melody', n),
        stage,
        handoverFrom: stageStart === n ? previousStage : null,
        busyness: busy,
        key,
        chordDegrees: chords.map((c) => c.degrees),
        lo,
        hi,
        center: midiToDegree(74, key, ref),
        prevEnd,
        prevLeap,
        others,
        strict: settings.strict,
        quote,
      });
      if (phrase.quote) lastQuote = n;
    }

    return {
      cycle: n,
      key,
      keyChanged,
      seasonIndex: prev ? prev.seasonIndex + (keyChanged ? 1 : 0) : 0,
      stage,
      previousStage,
      stageStart,
      stageLength: length,
      stageSlot: slot,
      stageBusyness,
      voices,
      phrase,
      chords,
      lastQuote,
      score: null,
    };
  }

  private pickQuote(n: number, stage: StageId, lastQuote: number): QuoteRequest | null {
    if (!this.settings.quotes || stage === 'lively' || stage === 'playful') return null;
    if (n - lastQuote < 16) return null;
    const rng = rngFor(this.seed, 'quote', n);
    // A likely nod in the first phrase helps listeners recognise the Canon; later ones are rare.
    if (!rng.chance(n === 1 ? 0.5 : 0.1)) return null;
    return {
      line: rng.chance(0.6) ? FAMOUS_LINES.descending : FAMOUS_LINES.answer,
      partial: rng.chance(0.4),
    };
  }

  private phraseEnding(
    phrase: Phrase | null,
    key: Key,
  ): { prevEnd: number | null; prevLeap: number } {
    if (!phrase) return { prevEnd: null, prevLeap: 0 };
    const line = mainLine(phrase.notes);
    const last = line[line.length - 1];
    const before = line[line.length - 2];
    const midi = degreeToMidi(last.note.deg, phrase.key);
    const prevEnd = midiToDegree(midi, key);
    const jump = before && before.joinsNext ? last.note.deg - before.note.deg : 0;
    return { prevEnd, prevLeap: Math.abs(jump) >= 3 ? Math.sign(jump) : 0 };
  }

  /** MIDI pitch of a phrase note when heard in `key` over `chords` (echoes follow modulations). */
  private melodyMidi(
    phrase: Phrase,
    note: PhraseNote,
    key: Key,
    chords: readonly ChordInstance[],
  ): number {
    const refNow = melodyRef(key);
    const diff = refNow - melodyRef(phrase.key);
    let deg = note.deg + (diff > 6 ? -7 : diff < -6 ? 7 : 0);
    const chord = chords[note.chord];
    const composed = phrase.chordDegrees[note.chord];
    // Only around a modulation pivot can an echo meet a different chord: fall onto its chord tones.
    if (composed.some((d) => !chord.degrees.includes(d)))
      deg = nearestChordTone(deg, chord.degrees);
    return degreeToMidi(deg, key, chord.raiseLeading, refNow);
  }

  private timeline(phrase: Phrase, key: Key, chords: readonly ChordInstance[]): Int16Array {
    const ref = melodyRef(key);
    const line = new Int16Array(TICKS_PER_CYCLE / TIMELINE_SLOT).fill(SILENT);
    for (const note of phrase.notes) {
      const semis = this.melodyMidi(phrase, note, key, chords) - ref;
      const end = Math.min(line.length, Math.ceil((note.tick + note.dur) / TIMELINE_SLOT));
      for (let i = Math.floor(note.tick / TIMELINE_SLOT); i < end; i++) line[i] = semis;
    }
    return line;
  }

  private render(st: CycleState): CycleScore {
    const notes: ScoreNote[] = [];
    let phraseEndTick: number | null = null;
    for (const { voice, phraseCycle } of voiceAssignments(
      st.cycle,
      Math.min(st.voices, VOICE_COUNT),
    )) {
      const phrase =
        phraseCycle === st.cycle ? st.phrase : (this.states.get(phraseCycle)?.phrase ?? null);
      if (!phrase) continue;
      for (const note of phrase.notes) {
        notes.push({
          part: 'melody',
          voice,
          tick: note.tick,
          dur: note.dur,
          gate: note.gate,
          midi: this.melodyMidi(phrase, note, st.key, st.chords),
          velocity: Math.min(1, note.vel * VOICE_GAIN[voice]),
          orn: note.orn === true,
          chord: note.chord,
        });
      }
      if (voice === 0) {
        const line = mainLine(phrase.notes);
        phraseEndTick = line[line.length - 1]?.note.tick ?? null;
      }
    }
    notes.push(
      ...generateBacking({
        chords: st.chords,
        stage: st.stage,
        chordStyle: this.settings.chordStyle,
        rng: rngFor(this.seed, 'backing', st.cycle),
      }),
    );
    notes.sort((a, b) => a.tick - b.tick);
    return {
      cycle: st.cycle,
      key: st.key,
      keyName: keyName(st.key),
      season: SEASONS[st.seasonIndex % SEASONS.length],
      keyChanged: st.keyChanged,
      stage: st.stage,
      previousStage: st.previousStage,
      stageChanged: st.stageStart === st.cycle,
      intensity: STAGES[st.stage].intensity,
      voices: st.voices,
      quote: st.phrase?.quote ?? false,
      chords: st.chords,
      notes,
      phraseEndTick,
      melodyLowMidi: MELODY_LOW_MIDI,
      melodyHighMidi: MELODY_HIGH_MIDI,
    };
  }
}

function nearestChordTone(deg: number, tones: readonly number[]): number {
  for (let off = 0; off <= 3; off++) {
    if (tones.includes(mod(deg - off, 7))) return deg - off;
    if (tones.includes(mod(deg + off, 7))) return deg + off;
  }
  return deg;
}
