import * as Tone from 'tone';
import type { SceneId } from '../types';
import type { AudioEnv } from './env';
import { dbToGain, pick, rand } from './util';

/*
 * Synthesised nature beds: filtered noise for wind, water and rain, FM-style chirps for birds,
 * gated oscillators for crickets. Continuous parts are built once per bed; the random events
 * (songs, laps, gusts, thunder) are scheduled a couple of seconds ahead by one shared timer, so
 * nothing accumulates: a bed owns a fixed set of nodes and disposes them all when it fades out.
 */

const FADE_SECONDS = 3.5;
const TICK_SECONDS = 0.5;
const HORIZON_SECONDS = 2.5;

/** Per-scene trim (dB) that brings every bed to the same loudness (−35 LUFS at the default sliders). */
const SCENE_TRIM_DB: Record<SceneId, number> = {
  forest: 5.3,
  lake: -4.7,
  mountain: 5.7,
  blossom: 8,
  aurora: -4,
  rain: -8,
};

export interface Bed {
  readonly out: Tone.Gain;
  tick(now: number, to: number): void;
  dispose(): void;
}

interface AutomatedParam {
  setTargetAtTime(value: number, startTime: number, timeConstant: number): unknown;
}

/** Random event times: calls back for every event that falls before the scheduling horizon. */
class Stream {
  private next: number;
  private readonly min: number;
  private readonly max: number;

  constructor(min: number, max: number, first: number) {
    this.min = min;
    this.max = max;
    this.next = first;
  }

  run(now: number, to: number, fn: (time: number) => void): void {
    if (this.next < now) this.next = now;
    while (this.next < to) {
      fn(this.next);
      this.next += rand(this.min, this.max);
    }
  }
}

interface Chirp {
  /** Start relative to the beginning of the song. */
  at: number;
  f0: number;
  f1: number;
  dur: number;
  amp: number;
  vibRate?: number;
  vibDepth?: number;
}

/** A song: sequence of chirps. */
type Song = () => Chirp[];

const SONGS: Record<string, Song> = {
  tweet: () => {
    const base = rand(2600, 3600);
    const gap = rand(0.13, 0.2);
    return Array.from({ length: 2 + Math.floor(Math.random() * 4) }, (_, i) => ({
      at: i * gap,
      f0: base * (1 + 0.03 * i),
      f1: base * (1 + 0.03 * i) * 1.22,
      dur: rand(0.07, 0.1),
      amp: 0.8 - 0.07 * i,
    }));
  },
  trill: () => {
    const base = rand(3000, 4200);
    return [
      {
        at: 0,
        f0: base,
        f1: base * rand(0.9, 1.15),
        dur: rand(0.5, 1.1),
        amp: 0.6,
        vibRate: rand(24, 38),
        vibDepth: rand(300, 600),
      },
    ];
  },
  whistle: () => {
    const base = rand(2200, 3000);
    const shape = [1, 1.19, 0.94, 0.8];
    return Array.from({ length: 3 + Math.floor(Math.random() * 2) }, (_, i) => {
      const f0 = base * shape[i];
      return {
        at: i * 0.42,
        f0,
        f1: f0 * rand(0.92, 1.08),
        dur: rand(0.28, 0.36),
        amp: 0.7,
        vibRate: 5.5,
        vibDepth: 30,
      };
    });
  },
  warble: () => {
    const base = rand(2400, 3200);
    return Array.from({ length: 8 + Math.floor(Math.random() * 6) }, (_, i) => {
      const f0 = base * rand(0.8, 1.4);
      return {
        at: i * 0.085,
        f0,
        f1: f0 * rand(0.85, 1.2),
        dur: rand(0.05, 0.08),
        amp: rand(0.5, 0.8),
      };
    });
  },
  cuckoo: () => [
    { at: 0, f0: 740, f1: 650, dur: 0.22, amp: 0.55 },
    { at: 0.36, f0: 740, f1: 640, dur: 0.24, amp: 0.55 },
  ],
  kree: () => {
    const f0 = rand(3200, 3700);
    return Array.from({ length: 1 + Math.floor(Math.random() * 2) }, (_, i) => ({
      at: i * 1.1,
      f0,
      f1: f0 * rand(0.55, 0.65),
      dur: rand(0.55, 0.8),
      amp: 0.55,
      vibRate: 12,
      vibDepth: 180,
    }));
  },
  hoot: () => {
    const f = rand(320, 380);
    return [
      { at: 0, f0: f, f1: f * 0.94, dur: 0.42, amp: 0.7, vibRate: 3, vibDepth: 5 },
      { at: 0.62, f0: f, f1: f * 0.94, dur: 0.42, amp: 0.7, vibRate: 3, vibDepth: 5 },
      { at: 1.3, f0: f * 1.02, f1: f * 0.9, dur: 0.85, amp: 0.65, vibRate: 3, vibDepth: 6 },
    ];
  },
  drop: () => {
    const f0 = rand(900, 2400);
    return [{ at: 0, f0, f1: f0 * rand(1.1, 1.5), dur: rand(0.05, 0.09), amp: rand(0.2, 0.5) }];
  },
};

/** One voice that can sing chirps: FM sine through a soft shaper, low-pass ("distance") and pan. */
class BirdVoice {
  busyUntil = 0;
  private readonly carrier: Tone.Oscillator;
  private readonly vibrato: Tone.Oscillator;
  private readonly vibratoDepth: Tone.Gain;
  private readonly amp: Tone.Gain;

  constructor(
    own: <T extends Tone.ToneAudioNode>(node: T) => T,
    out: Tone.ToneAudioNode,
    pan: number,
    cutoff: number,
    drive: number,
  ) {
    this.carrier = own(new Tone.Oscillator({ type: 'sine', frequency: 3000 }));
    this.vibrato = own(new Tone.Oscillator({ type: 'sine', frequency: 20 }));
    this.vibratoDepth = own(new Tone.Gain(0));
    this.amp = own(new Tone.Gain(0));
    const shaper = own(new Tone.WaveShaper((x) => Math.tanh(drive * x) / Math.tanh(drive), 1024));
    const tone = own(new Tone.Filter({ type: 'lowpass', frequency: cutoff, Q: 0.5, rolloff: -12 }));
    const panner = own(new Tone.Panner(pan));
    this.vibrato.chain(this.vibratoDepth, this.carrier.frequency);
    this.carrier.chain(shaper, this.amp, tone, panner, out);
    this.carrier.start();
    this.vibrato.start();
  }

  sing(time: number, chirps: Chirp[], level: number): number {
    let end = time;
    for (const c of chirps) {
      const t = time + c.at;
      const stop = t + c.dur;
      this.carrier.frequency.setValueAtTime(c.f0, t);
      this.carrier.frequency.exponentialRampToValueAtTime(c.f1, stop);
      this.vibrato.frequency.setValueAtTime(c.vibRate ?? 1, t);
      this.vibratoDepth.gain.setValueAtTime(c.vibDepth ?? 0, t);
      this.vibratoDepth.gain.setValueAtTime(0, stop + 0.01);
      const gain = this.amp.gain;
      gain.setValueAtTime(0.0001, t);
      gain.exponentialRampToValueAtTime(c.amp * level, t + Math.min(0.02, c.dur * 0.3));
      gain.exponentialRampToValueAtTime(0.0001, stop);
      gain.setValueAtTime(0, stop + 0.005);
      end = Math.max(end, stop);
    }
    this.busyUntil = end;
    return end;
  }
}

class BedBuilder {
  readonly out: Tone.Gain;
  private readonly fade: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[] = [];
  private readonly tickers: Array<(now: number, to: number) => void> = [];
  private readonly start: number;
  readonly own = <T extends Tone.ToneAudioNode>(node: T): T => {
    this.nodes.push(node);
    return node;
  };

  constructor(start: number, trimDb: number) {
    this.start = start;
    this.out = this.own(new Tone.Gain(dbToGain(trimDb)));
    this.fade = this.own(new Tone.Gain(1));
    this.out.connect(this.fade);
  }

  /** Looping noise through a filter chain into `out`; returns the filters and the level stage. */
  noise(type: 'white' | 'pink' | 'brown', level: number, filters: Tone.Filter[], rate = 1) {
    const noise = this.own(new Tone.Noise({ type, playbackRate: rate }));
    const gain = this.own(new Tone.Gain(level));
    filters.forEach((f) => this.own(f));
    noise.chain(...filters, gain, this.out);
    noise.start();
    return { filters, gain };
  }

  /** Slow random drift of a parameter between `lo` and `hi`. */
  wander(
    param: AutomatedParam,
    lo: number,
    hi: number,
    gapMin: number,
    gapMax: number,
    tau: number,
  ): void {
    const stream = new Stream(gapMin, gapMax, this.start + rand(0, gapMin));
    this.tickers.push((now, to) =>
      stream.run(now, to, (t) => param.setTargetAtTime(rand(lo, hi), t, tau)),
    );
  }

  event(
    gapMin: number,
    gapMax: number,
    firstMin: number,
    firstMax: number,
    fn: (time: number) => void,
  ): void {
    const stream = new Stream(gapMin, gapMax, this.start + rand(firstMin, firstMax));
    this.tickers.push((now, to) => stream.run(now, to, fn));
  }

  bird(pan: number, cutoff: number, drive = 1.3): BirdVoice {
    return new BirdVoice(this.own, this.out, pan, cutoff, drive);
  }

  /** Random songs from `voices`, never two at once on one voice. */
  songs(
    voices: BirdVoice[],
    repertoire: Array<[string, number]>,
    gapMin: number,
    gapMax: number,
    level: number,
    firstMax = 3,
  ): void {
    const total = repertoire.reduce((s, [, w]) => s + w, 0);
    this.event(gapMin, gapMax, 0.3, firstMax, (t) => {
      const free = voices.filter((v) => v.busyUntil < t);
      if (free.length === 0) return;
      let roll = Math.random() * total;
      let name = repertoire[0][0];
      for (const [n, w] of repertoire) {
        roll -= w;
        if (roll <= 0) {
          name = n;
          break;
        }
      }
      pick(free).sing(t, SONGS[name](), level);
    });
  }

  finish(): Bed {
    const { fade: out, nodes, tickers } = this;
    return {
      out,
      tick: (now, to) => tickers.forEach((run) => run(now, to)),
      dispose: () => {
        for (const node of nodes.reverse()) node.dispose();
        nodes.length = 0;
        tickers.length = 0;
      },
    };
  }
}

const lp = (f: number, Q = 0.5) =>
  new Tone.Filter({ type: 'lowpass', frequency: f, Q, rolloff: -12 });
const hp = (f: number, Q = 0.5) =>
  new Tone.Filter({ type: 'highpass', frequency: f, Q, rolloff: -12 });
const bp = (f: number, Q = 0.5) =>
  new Tone.Filter({ type: 'bandpass', frequency: f, Q, rolloff: -12 });

/** A slowly varying breeze: band-passed pink noise whose colour and strength drift. */
function breeze(
  b: BedBuilder,
  level: number,
  lo: number,
  hi: number,
  gainLo: number,
  gainHi: number,
  Q = 0.5,
): void {
  const wind = b.noise('pink', level, [bp((lo + hi) / 2, Q)]);
  b.wander(wind.filters[0].frequency, lo, hi, 3, 7, 1.5);
  b.wander(wind.gain.gain, gainLo, gainHi, 3, 8, 2);
}

/** Rare, long rumble: rising then falling brown noise with a closing low-pass. */
function thunder(b: BedBuilder, level: number): void {
  const rumble = b.noise('brown', 0, [lp(260, 0.7)], 0.8);
  const filter = rumble.filters[0].frequency;
  const gain = rumble.gain.gain;
  b.event(40, 85, 12, 25, (t) => {
    const bumps = 1 + Math.floor(Math.random() * 3);
    let at = t;
    for (let i = 0; i < bumps; i++) {
      const rise = rand(0.9, 2.2);
      const fall = rand(3.5, 7);
      const peak = level * rand(0.5, 1) * (i === 0 ? 1 : 0.6);
      gain.setValueAtTime(0.0001, at);
      gain.exponentialRampToValueAtTime(peak, at + rise);
      gain.exponentialRampToValueAtTime(0.0001, at + rise + fall);
      filter.setValueAtTime(rand(200, 300), at);
      filter.exponentialRampToValueAtTime(rand(60, 90), at + rise + fall);
      at += rise + rand(0.6, 1.8);
    }
  });
}

function cricket(
  b: BedBuilder,
  pan: number,
  freq: number,
  pulseRate: number,
  groupRate: number,
  level: number,
): void {
  const carrier = b.own(new Tone.Oscillator({ type: 'sine', frequency: freq }));
  const pulse = b.own(new Tone.LFO({ frequency: pulseRate, min: 0, max: 1, type: 'sine' }));
  const group = b.own(new Tone.LFO({ frequency: groupRate, min: 0, max: 1, type: 'sine' }));
  const pulseShape = b.own(new Tone.WaveShaper((x) => (x < 0.3 ? 0 : (x - 0.3) / 0.7), 1024));
  const groupShape = b.own(
    new Tone.WaveShaper((x) => (x < 0.45 ? 0 : x > 0.55 ? 1 : (x - 0.45) / 0.1), 1024),
  );
  const pulseGate = b.own(new Tone.Gain(0));
  const groupGate = b.own(new Tone.Gain(0));
  const rest = b.own(new Tone.Gain(level));
  const tone = b.own(lp(6500));
  const panner = b.own(new Tone.Panner(pan));
  pulse.chain(pulseShape, pulseGate.gain);
  group.chain(groupShape, groupGate.gain);
  carrier.chain(pulseGate, groupGate, rest, tone, panner, b.out);
  carrier.start();
  pulse.start();
  group.start();
  b.wander(carrier.frequency, freq * 0.96, freq * 1.04, 4, 9, 1);
  b.wander(group.frequency, groupRate * 0.75, groupRate * 1.3, 3, 8, 1);
  b.wander(pulse.frequency, pulseRate * 0.85, pulseRate * 1.15, 4, 9, 1);
  b.event(5, 14, 1, 6, (t) => {
    // Crickets fall silent for a few seconds now and then.
    rest.gain.setTargetAtTime(0.0001, t, 0.4);
    rest.gain.setTargetAtTime(level, t + rand(2, 6), 0.6);
  });
}

/** Builders create a scene's nodes; they run inside `env.run` so they belong to the engine's context. */
const BEDS: Record<SceneId, (b: BedBuilder) => void> = {
  forest: (b) => {
    breeze(b, 0.3, 450, 1100, 0.1, 0.32);
    const birds = [b.bird(-0.7, 8000), b.bird(-0.25, 7500), b.bird(0.3, 8500), b.bird(0.75, 7000)];
    b.songs(
      birds,
      [
        ['tweet', 35],
        ['whistle', 20],
        ['warble', 20],
        ['trill', 15],
        ['cuckoo', 10],
      ],
      1,
      3.8,
      0.16,
    );
  },
  lake: (b) => {
    const swell = b.noise('brown', 0.5, [lp(900, 0.7)]);
    b.wander(swell.gain.gain, 0.3, 0.6, 2, 5, 1.6);
    const laps = b.noise('pink', 0, [bp(1300, 1.2)], 0.9);
    b.wander(laps.filters[0].frequency, 900, 1700, 2, 5, 1);
    b.event(1.1, 3, 0.2, 1.5, (t) => {
      laps.gain.gain.setTargetAtTime(rand(0.25, 0.6), t, 0.18);
      laps.gain.gain.setTargetAtTime(0.02, t + 0.35, 0.5);
    });
    breeze(b, 0.15, 400, 800, 0.05, 0.16, 0.4);
    const bird = b.bird(0.5, 3500);
    b.songs(
      [bird],
      [
        ['tweet', 50],
        ['whistle', 50],
      ],
      9,
      22,
      0.12,
      8,
    );
  },
  mountain: (b) => {
    breeze(b, 0.5, 250, 650, 0.15, 0.55, 3.5);
    const rumble = b.noise('brown', 0.12, [lp(220, 0.7)]);
    b.wander(rumble.gain.gain, 0.06, 0.16, 3, 7, 2);
    const gust = b.noise('pink', 0, [bp(500, 2.5)], 1.1);
    b.event(7, 16, 2, 8, (t) => {
      gust.gain.gain.setTargetAtTime(rand(0.3, 0.55), t, 1.6);
      gust.gain.gain.setTargetAtTime(0.02, t + rand(2.5, 4), 2);
      gust.filters[0].frequency.setTargetAtTime(rand(350, 800), t, 2);
    });
    const bird = b.bird(-0.3, 6500);
    b.songs(
      [bird],
      [
        ['kree', 60],
        ['whistle', 40],
      ],
      10,
      24,
      0.14,
      6,
    );
  },
  blossom: (b) => {
    breeze(b, 0.2, 600, 1300, 0.08, 0.24, 0.6);
    const birds = [b.bird(-0.4, 6500), b.bird(0.45, 6000)];
    b.songs(
      birds,
      [
        ['tweet', 50],
        ['whistle', 30],
        ['warble', 20],
      ],
      3,
      8,
      0.11,
      2,
    );
  },
  aurora: (b) => {
    cricket(b, -0.5, 4300, 30, 2.2, 0.16);
    cricket(b, 0.5, 4650, 27, 1.7, 0.14);
    cricket(b, 0.05, 3950, 33, 2.7, 0.12);
    const wind = b.noise('pink', 0.1, [lp(420, 0.6)]);
    b.wander(wind.gain.gain, 0.05, 0.16, 4, 9, 2.5);
    const owl = b.bird(-0.2, 900, 1);
    b.songs([owl], [['hoot', 1]], 35, 80, 0.2, 25);
  },
  rain: (b) => {
    const rain = b.noise('pink', 0.55, [hp(700), lp(7500)]);
    b.wander(rain.gain.gain, 0.42, 0.65, 4, 10, 3);
    b.noise('white', 0.1, [bp(5500, 0.5)]);
    b.noise('brown', 0.15, [lp(300, 0.7)], 0.9);
    const drops = [b.bird(-0.5, 6000, 1), b.bird(0.5, 6000, 1)];
    b.songs(drops, [['drop', 1]], 0.35, 1.4, 0.4, 1);
    thunder(b, 0.45);
  },
};

interface ActiveBed {
  scene: SceneId;
  bed: Bed;
  retiring: boolean;
}

/** Crossfading nature ambience for the current scene, live only while enabled and playing. */
export class Ambience {
  private readonly env: AudioEnv;
  private readonly destination: Tone.ToneAudioNode;
  private readonly beds: ActiveBed[] = [];
  private readonly timeouts = new Set<number>();
  private scene: SceneId;
  private enabled = false;
  private playing = true;
  private timer = -1;

  constructor(env: AudioEnv, destination: Tone.ToneAudioNode, scene: SceneId) {
    this.env = env;
    this.destination = destination;
    this.scene = scene;
  }

  setScene(scene: SceneId): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.sync();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.sync();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.sync();
  }

  dispose(): void {
    const ctx = this.env.ctx;
    if (this.timer !== -1) ctx.clearInterval(this.timer);
    this.timer = -1;
    for (const id of this.timeouts) ctx.clearTimeout(id);
    this.timeouts.clear();
    for (const { bed } of this.beds) bed.dispose();
    this.beds.length = 0;
  }

  private sync(): void {
    const active = this.enabled && this.playing;
    if (active) {
      let current = this.beds.find((b) => b.scene === this.scene && !b.retiring);
      if (!current) {
        current = this.create(this.scene);
        this.beds.push(current);
        current.bed.out.gain.targetRampTo(1, FADE_SECONDS);
      }
      for (const other of this.beds)
        if (other !== current && !other.retiring) this.retire(other, FADE_SECONDS);
      if (this.timer === -1) {
        this.timer = this.env.ctx.setInterval(() => this.tick(), TICK_SECONDS);
      }
    } else {
      for (const bed of this.beds) if (!bed.retiring) this.retire(bed, 1.4);
    }
  }

  private create(scene: SceneId): ActiveBed {
    const bed = this.env.run(() => {
      const builder = new BedBuilder(this.env.ctx.currentTime, SCENE_TRIM_DB[scene]);
      BEDS[scene](builder);
      const finished = builder.finish();
      finished.out.gain.value = 0;
      finished.out.connect(this.destination);
      return finished;
    });
    return { scene, bed, retiring: false };
  }

  private retire(active: ActiveBed, seconds: number): void {
    active.retiring = true;
    active.bed.out.gain.targetRampTo(0, seconds);
    const id = this.env.ctx.setTimeout(() => {
      this.timeouts.delete(id);
      active.bed.dispose();
      const index = this.beds.indexOf(active);
      if (index !== -1) this.beds.splice(index, 1);
      if (this.beds.length === 0 && this.timer !== -1) {
        this.env.ctx.clearInterval(this.timer);
        this.timer = -1;
      }
    }, seconds + 0.6);
    this.timeouts.add(id);
  }

  private tick(): void {
    const now = this.env.ctx.currentTime;
    const to = now + HORIZON_SECONDS;
    for (const { bed, retiring } of this.beds) if (!retiring) bed.tick(now, to);
  }
}
