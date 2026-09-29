import type { BassNoteEvent, ChordChangeEvent, MusicBus, NoteOnEvent } from '../events';
import type { StageChangeEvent } from '../events';
import { SEASONS, type StageId } from '../types';
import {
  CHORD_MOODS,
  SEASON_LOOKS,
  STAGE_LOOKS,
  clamp01,
  createGrade,
  type Grade,
  type StageLook,
} from './palettes';

/*
 * Music → visuals (plan §6.2). Events arrive via Tone.Draw close to the moment they are heard, so
 * arrival is treated as "now" and the AudioContext `time` field is ignored. The mapper turns the
 * discrete events into smoothed, shared stimuli that every scene reads once per frame, and forwards
 * the few one-shot triggers (note, bass, phrase end) to the active scene.
 */

/** One melody note, reused between calls: scenes must not keep a reference. */
export interface NoteStimulus {
  voice: number;
  pitch01: number;
  velocity: number;
  duration: number;
  ornament: boolean;
  /** Stable horizontal slot for the pitch: the echo voices land where the leader did. */
  x01: number;
  /** Combined visual strength 0..1 (velocity, ornaments are fainter). */
  strength: number;
}

export interface MapperSink {
  note(n: NoteStimulus): void;
  bass(strength: number): void;
  phraseEnd(): void;
}

export interface Stimuli {
  /** Animation clock in seconds; runs slower in reduced motion. */
  time: number;
  /** Frame time scaled by `motion`: use for drift and physics. */
  dt: number;
  realDt: number;
  playing: boolean;
  reduced: boolean;
  /** 1 normal .. 0.3 reduced: speed multiplier for drift and fall. */
  motion: number;
  /** 1 .. 0: amplitude of sway, parallax and camera-like motion. */
  sway: number;
  /** 1 .. 0: quick flashes and flares. */
  flash: number;
  /** Particle-count multiplier from quality tier and reduced motion. */
  capScale: number;
  /** Shader detail 0..1 from the quality tier. */
  detail: number;
  /** Smoothed loudness/busyness 0..1. */
  energy: number;
  /** Fast-reacting note density 0..1. */
  activity: number;
  wind: number;
  /** Decaying pulse from the ground bass. */
  bass: number;
  swell: number;
  bassCount: number;
  chordIndex: number;
  /** Smoothed 0..1 for minor chords. */
  minor: number;
  /** 1 right after a chord change, decays in about a second. */
  chordPulse: number;
  /** 1 right after a phrase end, decays over a few seconds. */
  phrase: number;
  grade: Grade;
  mist: number;
  sparkle: number;
  dusk: number;
  rain: number;
  light: number;
  warmth: number;
  /** Season weights: spring, summer, autumn, winter (sum to 1). */
  season: Float32Array;
  foliage: Float32Array;
  grass: Float32Array;
  snow: number;
  autumn: number;
  stage: StageId;
}

const RATE_TAU = 2;
const SEASON_LIST = SEASONS.map((k) => SEASON_LOOKS[k]);

function frac(v: number): number {
  return v - Math.floor(v);
}

export class MusicMapper {
  readonly s: Stimuli;
  private readonly sink: MapperSink;
  private readonly offs: Array<() => void> = [];
  private readonly note: NoteStimulus = {
    voice: 0,
    pitch01: 0,
    velocity: 0,
    duration: 0,
    ornament: false,
    x01: 0,
    strength: 0,
  };
  private tokens = 8;
  private rate = 0;
  private reduceTarget: boolean;
  private reduceAmt: number;
  private hasChord = false;
  private hasStage = false;
  private minorTarget = 0;
  private chordTarget = CHORD_MOODS[0];
  private readonly cur = { tint: new Float32Array(CHORD_MOODS[0].tint), amt: 0, light: 1, sat: 1 };
  private stageTarget: StageLook = STAGE_LOOKS.calm;
  private readonly stageCur: StageLook = { ...STAGE_LOOKS.calm };
  private stageIntensity = 0.3;
  private seasonTarget = 0;

  constructor(bus: MusicBus, sink: MapperSink, reduced: boolean) {
    this.sink = sink;
    this.reduceTarget = reduced;
    this.reduceAmt = reduced ? 1 : 0;
    this.cur.amt = CHORD_MOODS[0].amt;
    this.cur.light = CHORD_MOODS[0].light;
    this.cur.sat = CHORD_MOODS[0].sat;
    this.s = {
      time: 0,
      dt: 0,
      realDt: 0,
      playing: false,
      reduced,
      motion: reduced ? 0.3 : 1,
      sway: reduced ? 0 : 1,
      flash: reduced ? 0 : 1,
      capScale: 1,
      detail: 1,
      energy: 0.14,
      activity: 0,
      wind: 0.15,
      bass: 0,
      swell: 0,
      bassCount: 0,
      chordIndex: 0,
      minor: 0,
      chordPulse: 0,
      phrase: 0,
      grade: createGrade(),
      mist: STAGE_LOOKS.calm.mist,
      sparkle: STAGE_LOOKS.calm.sparkle,
      dusk: 0,
      rain: STAGE_LOOKS.calm.rain,
      light: STAGE_LOOKS.calm.light,
      warmth: STAGE_LOOKS.calm.warmth,
      season: new Float32Array([1, 0, 0, 0]),
      foliage: new Float32Array(3),
      grass: new Float32Array(3),
      snow: 0,
      autumn: 0,
      stage: 'calm',
    };
    this.offs.push(
      bus.on('transport', (e) => {
        this.s.playing = !!e.playing;
      }),
      bus.on('noteOn', (e) => this.onNote(e)),
      bus.on('bassNote', (e) => this.onBass(e)),
      bus.on('chordChange', (e) => this.onChord(e)),
      bus.on('stageChange', (e) => this.onStage(e)),
      bus.on('keyChange', (e) => {
        const i = SEASONS.indexOf(e.season);
        if (i >= 0) this.seasonTarget = i;
      }),
      bus.on('phraseEnd', () => {
        this.s.phrase = 1;
        this.sink.phraseEnd();
      }),
    );
    this.update(0);
  }

  setReduced(on: boolean): void {
    this.reduceTarget = on;
    this.s.reduced = on;
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private onNote(e: NoteOnEvent): void {
    const w = (e.ornament ? 0.35 : 1) * (0.55 + 0.45 * clamp01(e.velocity));
    this.rate += w / RATE_TAU;
    const cost = e.ornament ? 1.5 : 1;
    if (this.tokens < cost) return;
    this.tokens -= cost;
    const n = this.note;
    n.voice = e.voice >= 2 ? 2 : e.voice >= 1 ? 1 : 0;
    n.pitch01 = Number.isFinite(e.pitch01) ? clamp01(e.pitch01) : 0.5;
    n.velocity = Number.isFinite(e.velocity) ? clamp01(e.velocity) : 0.7;
    n.duration = e.duration > 0 ? e.duration : 0.5;
    n.ornament = !!e.ornament;
    n.x01 = 0.07 + 0.86 * frac(e.midi * 0.6180339 + 0.31 + n.voice * 0.017);
    n.strength = (0.45 + 0.55 * n.velocity) * (n.ornament ? 0.55 : 1);
    this.sink.note(n);
  }

  private onBass(e: BassNoteEvent): void {
    const st = 0.55 + 0.45 * clamp01(e.velocity);
    this.s.bass = Math.max(this.s.bass, st);
    this.s.bassCount++;
    this.sink.bass(st);
  }

  private onChord(e: ChordChangeEvent): void {
    const i = ((e.chordIndex % 8) + 8) % 8;
    this.chordTarget = CHORD_MOODS[i];
    this.minorTarget = e.minor ? 1 : 0;
    this.s.chordIndex = i;
    this.s.chordPulse = 1;
    if (!this.hasChord) {
      this.hasChord = true;
      this.cur.tint.set(this.chordTarget.tint);
      this.cur.amt = this.chordTarget.amt;
      this.cur.light = this.chordTarget.light;
      this.cur.sat = this.chordTarget.sat;
      this.s.minor = this.minorTarget;
    }
  }

  private onStage(e: StageChangeEvent): void {
    this.stageTarget = STAGE_LOOKS[e.stage] ?? STAGE_LOOKS.calm;
    this.stageIntensity = clamp01(e.intensity);
    this.s.stage = e.stage;
    if (!this.hasStage && e.previous === null) Object.assign(this.stageCur, this.stageTarget);
    this.hasStage = true;
  }

  update(realDt: number): void {
    const s = this.s;
    const dt = Math.min(Math.max(realDt, 0), 0.1);
    s.realDt = dt;

    this.reduceAmt += ((this.reduceTarget ? 1 : 0) - this.reduceAmt) * (1 - Math.exp(-dt / 0.7));
    s.motion = 1 - 0.7 * this.reduceAmt;
    s.sway = 1 - this.reduceAmt;
    s.flash = Math.max(0, 1 - this.reduceAmt * 2);
    s.dt = dt * s.motion;
    s.time += s.dt;
    const slow = 1 + 2 * this.reduceAmt;

    this.tokens = Math.min(9, this.tokens + dt * 26);

    // Loudness/busyness: leaky count of recent notes, weighted by velocity.
    this.rate *= Math.exp(-dt / RATE_TAU);
    const busy = s.playing
      ? Math.min(1, 0.82 * Math.sqrt(this.rate / 13) + 0.18 * this.stageIntensity)
      : 0;
    const eTarget = 0.14 + 0.86 * busy;
    s.energy += (eTarget - s.energy) * (1 - Math.exp(-dt / (eTarget > s.energy ? 0.9 : 2.6)));
    s.activity += (Math.min(1, this.rate / 9) - s.activity) * (1 - Math.exp(-dt / 0.25));

    s.bass *= Math.exp(-dt / 0.5);
    s.swell += (s.bass - s.swell) * (1 - Math.exp(-dt / 0.6));
    s.chordPulse *= Math.exp(-dt / 0.6);
    s.phrase *= Math.exp(-dt / 2.8);

    // Palette glides over about a second; slower when motion is reduced.
    const kc = 1 - Math.exp(-dt / (0.32 * slow));
    const cur = this.cur;
    const ct = this.chordTarget;
    for (let i = 0; i < 3; i++) cur.tint[i] += (ct.tint[i] - cur.tint[i]) * kc;
    cur.amt += (ct.amt - cur.amt) * kc;
    cur.light += (ct.light - cur.light) * kc;
    cur.sat += (ct.sat - cur.sat) * kc;
    s.minor += (this.minorTarget - s.minor) * kc;

    // Stage (time of day / weather) and season blend over several seconds.
    const ks = 1 - Math.exp(-dt / (1.8 * slow));
    const sc = this.stageCur;
    const st = this.stageTarget;
    sc.light += (st.light - sc.light) * ks;
    sc.warmth += (st.warmth - sc.warmth) * ks;
    sc.mist += (st.mist - sc.mist) * ks;
    sc.wind += (st.wind - sc.wind) * ks;
    sc.sparkle += (st.sparkle - sc.sparkle) * ks;
    sc.dusk += (st.dusk - sc.dusk) * ks;
    sc.rain += (st.rain - sc.rain) * ks;

    const kSeason = 1 - Math.exp(-dt / (2.2 * slow));
    const w = s.season;
    let warm = sc.warmth;
    let sat = cur.sat;
    let light = sc.light * cur.light;
    for (let i = 0; i < 4; i++) {
      w[i] += ((i === this.seasonTarget ? 1 : 0) - w[i]) * kSeason;
      const look = SEASON_LIST[i];
      warm += w[i] * look.warm;
      sat *= 1 + w[i] * (look.sat - 1);
      light *= 1 + w[i] * (look.light - 1);
    }
    for (let c = 0; c < 3; c++) {
      let f = 0;
      let g = 0;
      for (let i = 0; i < 4; i++) {
        f += w[i] * SEASON_LIST[i].foliage[c];
        g += w[i] * SEASON_LIST[i].grass[c];
      }
      s.foliage[c] = f;
      s.grass[c] = g;
    }
    s.snow = w[3];
    s.autumn = w[2];

    sat *= 1 - 0.1 * s.minor - 0.1 * sc.dusk;
    light *= 1 - 0.03 * s.minor;
    const dusk = sc.dusk;
    const g = s.grade;
    g.gain[0] = light * (1 + 0.16 * warm) * (1 - 0.2 * dusk);
    g.gain[1] = light * (1 + 0.02 * warm) * (1 - 0.16 * dusk);
    g.gain[2] = light * (1 - 0.2 * warm) * (1 + 0.04 * dusk);
    g.sat = sat;
    g.tint[0] = cur.tint[0];
    g.tint[1] = cur.tint[1];
    g.tint[2] = cur.tint[2];
    g.tintAmt = cur.amt * (1 - 0.3 * dusk);

    s.mist = Math.min(1, sc.mist + 0.08 * s.minor);
    s.sparkle = sc.sparkle;
    s.dusk = dusk;
    s.rain = sc.rain;
    s.light = sc.light;
    s.warmth = warm;
    s.wind = Math.min(1, 0.08 + 0.4 * s.energy + 0.55 * sc.wind);
  }
}
