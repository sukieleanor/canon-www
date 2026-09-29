import * as Tone from 'tone';
import { DRUM } from '../types';
import type { AudioEnv } from './env';
import { velocityGain } from './util';

/** A synthesised voice that stands in for a sampled instrument. */
export interface NoteSynth {
  readonly output: Tone.ToneAudioNode;
  triggerAttackRelease(hz: number, duration: number, time: number, velocity: number): void;
  dispose(): void;
}

export type SynthKind =
  'bowed' | 'cello' | 'flute' | 'piano' | 'harp' | 'musicbox' | 'harpsichord' | 'pad' | 'pizz';

interface Poly extends Tone.ToneAudioNode {
  triggerAttackRelease(notes: number, duration: number, time: number, velocity: number): unknown;
}

/** A polyphonic synth followed by effects that all its voices share. */
class PolyChain implements NoteSynth {
  readonly output: Tone.ToneAudioNode;
  private readonly poly: Poly;
  private readonly chain: Tone.ToneAudioNode[];

  constructor(poly: Poly, chain: Tone.ToneAudioNode[]) {
    this.poly = poly;
    this.chain = chain;
    poly.chain(...chain);
    this.output = chain[chain.length - 1] ?? poly;
  }

  triggerAttackRelease(hz: number, duration: number, time: number, velocity: number): void {
    this.poly.triggerAttackRelease(hz, duration, time, velocity);
  }

  dispose(): void {
    this.poly.dispose();
    for (const node of this.chain) node.dispose();
  }
}

/** Tone's voice option types leave out `detune`, which its oscillators accept at runtime. */
const loose = (options: object): never => options as never;

const filter = (type: BiquadFilterType, frequency: number, Q = 0.7) =>
  new Tone.Filter({ type, frequency, Q, rolloff: -12 });

/** Each factory must run inside `env.run` so the nodes belong to the engine's context. */
const FACTORIES: Record<SynthKind, (detune: number) => NoteSynth> = {
  bowed: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.Synth,
        maxPolyphony: 5,
        options: loose({
          oscillator: { type: 'sawtooth', detune },
          envelope: { attack: 0.09, decay: 0.2, sustain: 0.85, release: 0.3 },
        }),
      }),
      [filter('lowpass', 3000), new Tone.Vibrato({ frequency: 5.3, depth: 0.1 })],
    ),
  cello: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.Synth,
        maxPolyphony: 4,
        options: loose({
          oscillator: { type: 'sawtooth', detune },
          envelope: { attack: 0.07, decay: 0.3, sustain: 0.8, release: 0.45 },
        }),
      }),
      [filter('lowpass', 650, 0.8), new Tone.Vibrato({ frequency: 4.8, depth: 0.06 })],
    ),
  flute: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.Synth,
        maxPolyphony: 4,
        options: loose({
          oscillator: { type: 'custom', partials: [1, 0.22, 0.07, 0.02], detune },
          envelope: { attack: 0.07, decay: 0.1, sustain: 0.85, release: 0.22 },
        }),
      }),
      [filter('lowpass', 4500), new Tone.Vibrato({ frequency: 5, depth: 0.08 })],
    ),
  piano: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.FMSynth,
        maxPolyphony: 10,
        options: loose({
          harmonicity: 1,
          modulationIndex: 1.6,
          oscillator: { type: 'sine', detune },
          modulation: { type: 'sine' },
          envelope: { attack: 0.004, decay: 1.6, sustain: 0, release: 0.4 },
          modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
        }),
      }),
      [filter('lowpass', 5000)],
    ),
  harp: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.FMSynth,
        maxPolyphony: 8,
        options: loose({
          harmonicity: 2,
          modulationIndex: 1.2,
          oscillator: { type: 'sine', detune },
          modulation: { type: 'sine' },
          envelope: { attack: 0.003, decay: 1.8, sustain: 0, release: 0.5 },
          modulationEnvelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.2 },
        }),
      }),
      [filter('lowpass', 6000)],
    ),
  musicbox: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.FMSynth,
        maxPolyphony: 8,
        options: loose({
          harmonicity: 5.4,
          modulationIndex: 6,
          oscillator: { type: 'sine', detune },
          modulation: { type: 'sine' },
          envelope: { attack: 0.001, decay: 1.4, sustain: 0, release: 0.3 },
          modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.1 },
        }),
      }),
      [filter('lowpass', 9000)],
    ),
  harpsichord: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.Synth,
        maxPolyphony: 10,
        options: loose({
          oscillator: { type: 'sawtooth', detune },
          envelope: { attack: 0.001, decay: 0.5, sustain: 0, release: 0.05 },
        }),
      }),
      [filter('highpass', 220), filter('lowpass', 4200)],
    ),
  pad: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.Synth,
        maxPolyphony: 10,
        options: loose({
          oscillator: { type: 'fatsawtooth', count: 3, spread: 20, detune },
          envelope: { attack: 0.9, decay: 0.5, sustain: 0.85, release: 1.8 },
        }),
      }),
      [filter('lowpass', 1600, 0.5)],
    ),
  pizz: (detune) =>
    new PolyChain(
      new Tone.PolySynth({
        voice: Tone.FMSynth,
        maxPolyphony: 8,
        options: loose({
          harmonicity: 1,
          modulationIndex: 1,
          oscillator: { type: 'sine', detune },
          modulation: { type: 'sine' },
          envelope: { attack: 0.002, decay: 0.25, sustain: 0, release: 0.05 },
          modulationEnvelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.05 },
        }),
      }),
      [filter('lowpass', 2600)],
    ),
};

export function createSynth(env: AudioEnv, kind: SynthKind, detune = 0): NoteSynth {
  return env.run(() => FACTORIES[kind](detune));
}

/** Soft, warm lo-fi drums (General MIDI numbers, see DRUM), all synthesised. */
export class DrumKit {
  readonly output: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[] = [];
  private readonly kick: Tone.MembraneSynth;
  private readonly rim: Tone.MembraneSynth;
  private readonly snareBody: Tone.MembraneSynth;
  private readonly snareNoise: Tone.NoiseSynth;
  private readonly closedHat: Tone.NoiseSynth;
  private readonly openHat: Tone.NoiseSynth;

  constructor(env: AudioEnv) {
    const own = <T extends Tone.ToneAudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    const nodes = env.run(() => {
      const output = own(new Tone.Gain(1));
      const strip = (level: number, ...chain: Tone.ToneAudioNode[]) => {
        const gain = own(new Tone.Gain(level));
        chain.forEach(own);
        return { chain, gain };
      };

      const kickOut = strip(0.9);
      const kick = own(
        new Tone.MembraneSynth({
          pitchDecay: 0.045,
          octaves: 2.6,
          oscillator: { type: 'sine' },
          envelope: { attack: 0.002, decay: 0.34, sustain: 0, release: 0.1 },
        }),
      );
      kick.chain(kickOut.gain, output);

      const rimOut = strip(0.32, filter('highpass', 500));
      const rim = own(
        new Tone.MembraneSynth({
          pitchDecay: 0.006,
          octaves: 1.2,
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 },
        }),
      );
      rim.chain(...rimOut.chain, rimOut.gain, output);

      const snareBody = own(
        new Tone.MembraneSynth({
          pitchDecay: 0.02,
          octaves: 0.8,
          oscillator: { type: 'triangle' },
          envelope: { attack: 0.001, decay: 0.13, sustain: 0, release: 0.05 },
        }),
      );
      const snareBodyGain = own(new Tone.Gain(0.35));
      snareBody.chain(snareBodyGain, output);
      const snareOut = strip(0.42, filter('bandpass', 1900, 0.8), filter('lowpass', 6500));
      const snareNoise = own(
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.05 },
        }),
      );
      snareNoise.chain(...snareOut.chain, snareOut.gain, output);

      const closedOut = strip(0.3, filter('bandpass', 8500, 0.7));
      const closedHat = own(
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.001, decay: 0.045, sustain: 0, release: 0.01 },
        }),
      );
      closedHat.chain(...closedOut.chain, closedOut.gain, output);

      const openOut = strip(0.24, filter('bandpass', 8000, 0.7));
      const openHat = own(
        new Tone.NoiseSynth({
          noise: { type: 'white' },
          envelope: { attack: 0.002, decay: 0.32, sustain: 0, release: 0.1 },
        }),
      );
      openHat.chain(...openOut.chain, openOut.gain, output);

      return { output, kick, rim, snareBody, snareNoise, closedHat, openHat };
    });
    this.output = nodes.output;
    this.kick = nodes.kick;
    this.rim = nodes.rim;
    this.snareBody = nodes.snareBody;
    this.snareNoise = nodes.snareNoise;
    this.closedHat = nodes.closedHat;
    this.openHat = nodes.openHat;
  }

  trigger(gm: number, time: number, velocity: number): void {
    const v = velocityGain(velocity);
    switch (gm) {
      case DRUM.kick:
        this.kick.triggerAttackRelease(52, 0.34, time, v);
        break;
      case DRUM.rim:
        this.rim.triggerAttackRelease(950, 0.05, time, v);
        break;
      case DRUM.snare:
        this.snareBody.triggerAttackRelease(185, 0.13, time, v);
        this.snareNoise.triggerAttackRelease(0.17, time, v);
        break;
      case DRUM.closedHat:
        this.openHat.triggerRelease(time);
        this.closedHat.triggerAttackRelease(0.045, time, v);
        break;
      case DRUM.openHat:
        this.openHat.triggerAttackRelease(0.32, time, v);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    for (const node of this.nodes.reverse()) node.dispose();
    this.nodes.length = 0;
  }
}
