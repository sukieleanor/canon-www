import * as Tone from 'tone';
import type { ChordSoundId, LayerId, MelodyInstrumentId } from '../types';
import type { AudioEnv } from './env';
import { VOICE_PROFILES, type BackingPart, type Mixer } from './mixer';
import type { SampleLibrary } from './samples';
import type { SampleSetId } from './sampleManifest';
import { createSynth, DrumKit, type NoteSynth, type SynthKind } from './synths';
import type { LayerMix } from './types';
import { mtof, velocityGain } from './util';

export interface SoundSpec {
  set: SampleSetId;
  synth: SynthKind;
  /** Sampler fade-in and fade-out (seconds): soft bow attacks, natural releases. */
  attack: number;
  release: number;
  /**
   * Level trims (measured with the dev harness at BS.1770 loudness) that bring the sampled sound
   * and its synthesised stand-in to the same loudness as the other sounds of its part.
   */
  sampleGain: number;
  synthGain: number;
}

export const MELODY_SPECS: Record<MelodyInstrumentId, SoundSpec> = {
  strings: {
    set: 'violin',
    synth: 'bowed',
    attack: 0.07,
    release: 0.4,
    sampleGain: 1,
    synthGain: 0.167,
  },
  piano: {
    set: 'piano',
    synth: 'piano',
    attack: 0,
    release: 0.35,
    sampleGain: 0.287,
    synthGain: 0.6,
  },
  harp: {
    set: 'harp',
    synth: 'harp',
    attack: 0,
    release: 0.5,
    sampleGain: 0.384,
    synthGain: 0.58,
  },
  flute: {
    set: 'flute',
    synth: 'flute',
    attack: 0.06,
    release: 0.25,
    sampleGain: 0.88,
    synthGain: 0.125,
  },
  musicbox: {
    set: 'musicbox',
    synth: 'musicbox',
    attack: 0,
    release: 0.4,
    sampleGain: 0.362,
    synthGain: 0.645,
  },
};

export const CHORD_SPECS: Record<ChordSoundId, SoundSpec> = {
  harpsichord: {
    set: 'harpsichord',
    synth: 'harpsichord',
    attack: 0,
    release: 0.2,
    sampleGain: 1,
    synthGain: 1.145,
  },
  piano: {
    set: 'piano',
    synth: 'piano',
    attack: 0,
    release: 0.3,
    sampleGain: 0.94,
    synthGain: 1.9,
  },
};

export const BACKING_SPECS: Record<'bass' | 'pad' | 'pizz', SoundSpec> = {
  bass: {
    set: 'cello',
    synth: 'cello',
    attack: 0.05,
    release: 0.4,
    sampleGain: 1,
    synthGain: 0.275,
  },
  pad: { set: 'pad', synth: 'pad', attack: 0.9, release: 1.6, sampleGain: 1, synthGain: 0.34 },
  pizz: { set: 'pizz', synth: 'pizz', attack: 0, release: 0.25, sampleGain: 1, synthGain: 1.79 },
};

/** Longest sample tail plus release: nothing from a retired generation can still be sounding. */
const RETIRE_AFTER = 10;

interface Generation {
  out: Tone.Gain;
  sampler: Tone.Sampler | null;
  synth: NoteSynth | null;
}

/**
 * One sound of the ensemble: a lazily created sampler over the shared decoded buffers plus a
 * synthesised stand-in that plays until (or instead of) the samples. `hush` silences everything
 * still sounding or scheduled by swapping in a fresh output stage and fading the old one away.
 */
export class PitchedSound {
  private readonly env: AudioEnv;
  private readonly spec: SoundSpec;
  private readonly sink: Tone.ToneAudioNode;
  private readonly detune: number;
  private buffers: ReadonlyMap<number, AudioBuffer> | null = null;
  private gen: Generation;
  private readonly cleanup = new Map<number, () => void>();
  private used = false;

  constructor(env: AudioEnv, spec: SoundSpec, sink: Tone.ToneAudioNode, detune = 0) {
    this.env = env;
    this.spec = spec;
    this.sink = sink;
    this.detune = detune;
    this.gen = this.newGeneration();
  }

  get sampled(): boolean {
    return this.buffers !== null;
  }

  /** Hands over the decoded samples (or `null` to fall back to the synth for good). */
  setSamples(buffers: ReadonlyMap<number, AudioBuffer> | null): void {
    if (this.buffers === buffers) return;
    this.buffers = buffers;
    const { sampler, synth } = this.gen;
    if (sampler) {
      this.gen.sampler = null;
      this.later(() => sampler.dispose(), RETIRE_AFTER);
    }
    if (buffers && synth) {
      this.gen.synth = null;
      this.later(() => synth.dispose(), RETIRE_AFTER);
    }
    if (this.used) this.warm();
  }

  /** Builds the sampler or synth ahead of the first note, so no nodes are created inside a scheduling callback. */
  warm(): void {
    this.used = true;
    if (this.buffers) {
      this.gen.sampler ??= this.makeSampler(this.buffers);
    } else {
      this.gen.synth ??= this.makeSynth();
    }
  }

  play(midi: number, duration: number, time: number, gain: number): void {
    this.warm();
    const hz = mtof(midi);
    if (this.buffers) {
      this.gen.sampler?.triggerAttackRelease(hz, duration, time, gain * this.spec.sampleGain);
    } else {
      this.gen.synth?.triggerAttackRelease(hz, duration, time, gain * this.spec.synthGain);
    }
  }

  /** Fast release of everything sounding or already scheduled; later notes use a clean stage. */
  hush(): void {
    const old = this.gen;
    this.gen = this.newGeneration();
    old.out.gain.cancelScheduledValues(0);
    old.out.gain.targetRampTo(0, 0.06);
    this.later(() => this.disposeGeneration(old), RETIRE_AFTER);
  }

  dispose(): void {
    this.disposeGeneration(this.gen);
    for (const [id, dispose] of this.cleanup) {
      this.env.ctx.clearTimeout(id);
      dispose();
    }
    this.cleanup.clear();
  }

  private newGeneration(): Generation {
    const out = this.env.run(() => new Tone.Gain(1));
    out.connect(this.sink);
    return { out, sampler: null, synth: null };
  }

  private makeSampler(buffers: ReadonlyMap<number, AudioBuffer>): Tone.Sampler {
    return this.env.run(() => {
      const urls: Record<string, Tone.ToneAudioBuffer> = {};
      for (const [midi, buffer] of buffers) urls[String(midi)] = new Tone.ToneAudioBuffer(buffer);
      const sampler = new Tone.Sampler({
        urls,
        attack: this.spec.attack,
        release: this.spec.release,
        curve: 'exponential',
      });
      sampler.connect(this.gen.out);
      return sampler;
    });
  }

  private makeSynth(): NoteSynth {
    const synth = createSynth(this.env, this.spec.synth, this.detune);
    synth.output.connect(this.gen.out);
    return synth;
  }

  private disposeGeneration(gen: Generation): void {
    gen.sampler?.dispose();
    gen.synth?.dispose();
    gen.out.dispose();
  }

  private later(dispose: () => void, seconds: number): void {
    const id = this.env.ctx.setTimeout(() => {
      this.cleanup.delete(id);
      dispose();
    }, seconds);
    this.cleanup.set(id, dispose);
  }
}

export interface NoteRequest {
  midi: number;
  duration: number;
  time: number;
  /** Velocity 0..1 (already softened for ornaments). */
  velocity: number;
}

/** Creates the ensemble's sounds on first use and routes notes to them. */
export class InstrumentBank {
  private readonly env: AudioEnv;
  private readonly mixer: Mixer;
  private readonly library: SampleLibrary;
  private readonly sounds = new Map<string, PitchedSound>();
  private drumKit: DrumKit | null = null;

  constructor(env: AudioEnv, mixer: Mixer, library: SampleLibrary) {
    this.env = env;
    this.mixer = mixer;
    this.library = library;
  }

  melody(note: NoteRequest, instrument: MelodyInstrumentId, voice: number): void {
    const g = velocityGain(note.velocity);
    this.mixer.shapeVoice(voice, note.time, g);
    this.melodyVoice(instrument, voice).play(note.midi, note.duration, note.time, g);
  }

  chords(note: NoteRequest, sound: ChordSoundId): void {
    this.backing('chords', `chords:${sound}`, CHORD_SPECS[sound], note);
  }

  bass(note: NoteRequest): void {
    this.backing('bass', 'bass', BACKING_SPECS.bass, note);
  }

  pad(note: NoteRequest): void {
    this.backing('pad', 'pad', BACKING_SPECS.pad, note);
  }

  pizz(note: NoteRequest): void {
    this.backing('pizz', 'pizz', BACKING_SPECS.pizz, note);
  }

  drums(gm: number, time: number, velocity: number): void {
    this.kit().trigger(gm, time, velocity);
  }

  /**
   * Builds the voices the settings will play, so notes only trigger them. Call it from outside
   * scheduling callbacks (engine creation, settings changes, resume).
   */
  warm(s: {
    melodyInstrument: MelodyInstrumentId;
    chordSound: ChordSoundId;
    layers: Record<LayerId, LayerMix>;
  }): void {
    for (let voice = 0; voice < VOICE_PROFILES.length; voice++)
      this.melodyVoice(s.melodyInstrument, voice).warm();
    const { layers } = s;
    if (layers.bass.on) this.backingSound('bass', 'bass', BACKING_SPECS.bass).warm();
    if (layers.chords.on)
      this.backingSound('chords', `chords:${s.chordSound}`, CHORD_SPECS[s.chordSound]).warm();
    if (layers.pad.on) this.backingSound('pad', 'pad', BACKING_SPECS.pad).warm();
    if (layers.pizz.on) this.backingSound('pizz', 'pizz', BACKING_SPECS.pizz).warm();
    if (layers.beat.on) this.kit();
  }

  /** A sample set finished loading (or failed): give its decoded buffers to every sound using it. */
  syncSamples(): void {
    for (const [key, sound] of this.sounds) {
      const set = this.library.get(this.specOf(key).set);
      sound.setSamples(set.usable ? set.buffers : null);
    }
  }

  hushAll(): void {
    for (const sound of this.sounds.values()) sound.hush();
  }

  dispose(): void {
    for (const sound of this.sounds.values()) sound.dispose();
    this.sounds.clear();
    this.drumKit?.dispose();
    this.drumKit = null;
  }

  private readonly specs = new Map<string, SoundSpec>();

  private specOf(key: string): SoundSpec {
    const spec = this.specs.get(key);
    if (!spec) throw new Error(`unknown sound ${key}`);
    return spec;
  }

  private kit(): DrumKit {
    if (!this.drumKit) {
      this.drumKit = new DrumKit(this.env);
      this.drumKit.output.connect(this.mixer.partInput('beat'));
    }
    return this.drumKit;
  }

  private melodyVoice(instrument: MelodyInstrumentId, voice: number): PitchedSound {
    return this.sound(`melody:${instrument}:${voice}`, MELODY_SPECS[instrument], () => ({
      sink: this.mixer.voiceInput(voice),
      detune: VOICE_PROFILES[voice].detune,
    }));
  }

  private backingSound(part: BackingPart, key: string, spec: SoundSpec): PitchedSound {
    return this.sound(key, spec, () => ({ sink: this.mixer.partInput(part), detune: 0 }));
  }

  private backing(part: BackingPart, key: string, spec: SoundSpec, note: NoteRequest): void {
    this.backingSound(part, key, spec).play(
      note.midi,
      note.duration,
      note.time,
      velocityGain(note.velocity),
    );
  }

  private sound(
    key: string,
    spec: SoundSpec,
    route: () => { sink: Tone.ToneAudioNode; detune: number },
  ): PitchedSound {
    let sound = this.sounds.get(key);
    if (!sound) {
      const { sink, detune } = route();
      sound = new PitchedSound(this.env, spec, sink, detune);
      this.sounds.set(key, sound);
      this.specs.set(key, spec);
      const set = this.library.get(spec.set);
      if (set.usable) sound.setSamples(set.buffers);
    }
    return sound;
  }
}
