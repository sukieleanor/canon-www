import * as Tone from 'tone';
import { LAYER_IDS, MELODY_INSTRUMENTS, MOODS, SCENE_IDS, type ChordSoundId } from '../types';
import { Ambience } from './ambience';
import { createEnv, type AudioEnv } from './env';
import {
  BACKING_SPECS,
  CHORD_SPECS,
  InstrumentBank,
  MELODY_SPECS,
  type NoteRequest,
} from './instruments';
import { Crackle } from './lofi';
import { Mixer, type MixerSettings } from './mixer';
import { startRecordingSession, type RecordingSession } from './recorder';
import { SampleLibrary, sampleBaseUrl } from './samples';
import type { SampleSetId } from './sampleManifest';
import type {
  AudioEngine,
  AudioSettings,
  PlayNote,
  RecordingFormat,
  RecordingResult,
} from './types';
import { clamp, num } from './util';

/** Notes this far behind the audio clock are dropped instead of being played late. */
const LATE_NOTE_TOLERANCE = 0.05;
const ORNAMENT_SOFTNESS = 0.72;
const MAX_WARNINGS = 5;

const DEFAULT_SETTINGS: AudioSettings = {
  masterVolume: 0.8,
  melodyVolume: 0.8,
  melodyInstrument: 'strings',
  chordSound: 'harpsichord',
  layers: {
    bass: { on: false, volume: 0.7 },
    chords: { on: false, volume: 0.7 },
    pad: { on: false, volume: 0.7 },
    pizz: { on: false, volume: 0.7 },
    beat: { on: false, volume: 0.7 },
    ambience: { on: false, volume: 0.7 },
  },
  mood: 'bright',
  lofi: false,
  scene: 'forest',
};

const oneOf = <T extends string>(list: readonly T[], value: unknown, fallback: T): T =>
  list.includes(value as T) ? (value as T) : fallback;

/** Merges a (possibly partial or malformed) patch into complete, in-range settings. */
function merge(base: AudioSettings, patch: Partial<AudioSettings>): AudioSettings {
  const layers = { ...base.layers };
  for (const id of LAYER_IDS) {
    const mix = patch.layers?.[id];
    if (mix) {
      layers[id] = {
        on: mix.on === undefined ? layers[id].on : Boolean(mix.on),
        volume: clamp(num(mix.volume, layers[id].volume), 0, 1),
      };
    }
  }
  return {
    masterVolume: clamp(num(patch.masterVolume, base.masterVolume), 0, 1),
    melodyVolume: clamp(num(patch.melodyVolume, base.melodyVolume), 0, 1),
    melodyInstrument: oneOf(MELODY_INSTRUMENTS, patch.melodyInstrument, base.melodyInstrument),
    chordSound: oneOf<ChordSoundId>(['harpsichord', 'piano'], patch.chordSound, base.chordSound),
    layers,
    mood: oneOf(MOODS, patch.mood, base.mood),
    lofi: patch.lofi === undefined ? base.lofi : Boolean(patch.lofi),
    scene: oneOf(SCENE_IDS, patch.scene, base.scene),
  };
}

function mixerSettings(s: AudioSettings): MixerSettings {
  return {
    masterVolume: s.masterVolume,
    melodyVolume: s.melodyVolume,
    layers: s.layers,
    mood: s.mood,
    lofi: s.lofi,
  };
}

/** Extra handles for the dev harness; not part of the AudioEngine contract. */
export interface AudioEngineDebug {
  readonly env: AudioEnv;
  readonly mixer: Mixer;
  readonly library: SampleLibrary;
  readonly bank: InstrumentBank;
  neededSets(): SampleSetId[];
}

class Engine implements AudioEngine {
  readonly debug: AudioEngineDebug;
  private readonly env: AudioEnv;
  private readonly mixer: Mixer;
  private readonly library: SampleLibrary;
  private readonly bank: InstrumentBank;
  private readonly ambience: Ambience;
  private readonly crackle: Crackle;
  private readonly listeners = new Set<(progress: number) => void>();
  private readonly unsubscribe: () => void;
  private settings: AudioSettings;
  private session: RecordingSession | null = null;
  private starting = false;
  private playing = true;
  private disposed = false;
  private lastProgress = -1;
  private warnings = 0;

  constructor(env: AudioEnv, settings: AudioSettings) {
    this.env = env;
    this.settings = settings;
    this.mixer = new Mixer(env, mixerSettings(settings));
    this.library = new SampleLibrary(env, sampleBaseUrl());
    this.bank = new InstrumentBank(env, this.mixer, this.library);
    this.ambience = new Ambience(env, this.mixer.ambienceInput, settings.scene);
    this.crackle = new Crackle(env, this.mixer.crackleInput);
    this.ambience.setEnabled(settings.layers.ambience.on);
    this.crackle.setEnabled(settings.lofi);
    this.unsubscribe = this.library.subscribe(() => {
      this.bank.syncSamples();
      this.emitProgress();
    });
    this.requestSamples();
    this.bank.warm(settings);
    this.debug = {
      env,
      mixer: this.mixer,
      library: this.library,
      bank: this.bank,
      neededSets: () => this.neededSets(),
    };
  }

  get ready(): Promise<void> {
    return Promise.all(this.neededSets().map((id) => this.library.get(id).done)).then(
      () => undefined,
    );
  }

  get isRecording(): boolean {
    return this.session !== null;
  }

  playNote(note: PlayNote, time: number): void {
    try {
      if (this.disposed || !this.playing) return;
      const now = this.env.ctx.currentTime;
      if (!Number.isFinite(time) || time < now - LATE_NOTE_TOLERANCE) return;
      const midi = num(note?.midi, NaN);
      if (!Number.isFinite(midi)) return;
      const ornament = note.ornament === true;
      const request: NoteRequest = {
        midi,
        duration: clamp(num(note.duration, 0.5), 0.03, 30),
        time: Math.max(time, now),
        velocity: clamp(num(note.velocity, 0.7), 0, 1) * (ornament ? ORNAMENT_SOFTNESS : 1),
      };
      const s = this.settings;
      switch (note.part) {
        case 'melody':
          this.bank.melody(
            request,
            s.melodyInstrument,
            clamp(Math.round(num(note.voice, 0)), 0, 2),
          );
          break;
        case 'bass':
          if (s.layers.bass.on) this.bank.bass(request);
          break;
        case 'chords':
          if (s.layers.chords.on) this.bank.chords(request, s.chordSound);
          break;
        case 'pad':
          if (s.layers.pad.on) this.bank.pad(request);
          break;
        case 'pizz':
          if (s.layers.pizz.on) this.bank.pizz(request);
          break;
        case 'beat':
          if (s.layers.beat.on) this.bank.drums(midi, request.time, request.velocity);
          break;
        default:
          break;
      }
    } catch (error) {
      // A bad note must never take the music down; report the first few only.
      if (this.warnings++ < MAX_WARNINGS) console.warn('[audio] note dropped', error);
    }
  }

  update(patch: Partial<AudioSettings>): void {
    if (this.disposed) return;
    try {
      const previous = this.settings;
      const next = merge(previous, patch);
      this.settings = next;
      if (next.masterVolume !== previous.masterVolume) this.mixer.setMaster(next.masterVolume);
      if (next.melodyVolume !== previous.melodyVolume)
        this.mixer.setMelodyVolume(next.melodyVolume);
      for (const id of LAYER_IDS) {
        const before = previous.layers[id];
        const after = next.layers[id];
        if (before.on === after.on && before.volume === after.volume) continue;
        this.mixer.setLayer(id, after);
        if (id === 'ambience') this.ambience.setEnabled(after.on);
      }
      if (next.mood !== previous.mood) this.mixer.setMood(next.mood);
      if (next.lofi !== previous.lofi) {
        this.mixer.setLofi(next.lofi);
        this.crackle.setEnabled(next.lofi);
      }
      if (next.scene !== previous.scene) this.ambience.setScene(next.scene);
      this.requestSamples();
      this.bank.warm(next);
    } catch (error) {
      if (this.warnings++ < MAX_WARNINGS) console.warn('[audio] update failed', error);
    }
  }

  setPlaying(playing: boolean): void {
    if (this.disposed || playing === this.playing) return;
    this.playing = playing;
    if (playing) this.bank.warm(this.settings);
    else this.bank.hushAll();
    this.ambience.setPlaying(playing);
    this.crackle.setPlaying(playing);
  }

  onLoadProgress(listener: (progress: number) => void): () => void {
    this.listeners.add(listener);
    queueMicrotask(() => {
      if (this.listeners.has(listener)) listener(this.progress());
    });
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startRecording(format: RecordingFormat): Promise<void> {
    if (this.disposed) throw new Error('The audio engine was disposed.');
    if (this.session || this.starting) throw new Error('Already recording.');
    this.starting = true;
    try {
      this.session = await startRecordingSession(this.env, this.mixer.output, format);
    } finally {
      this.starting = false;
    }
  }

  async stopRecording(): Promise<RecordingResult> {
    const session = this.session;
    if (!session) throw new Error('Not recording.');
    this.session = null;
    return session.stop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session?.cancel();
    this.session = null;
    this.unsubscribe();
    this.listeners.clear();
    this.ambience.dispose();
    this.crackle.dispose();
    this.bank.dispose();
    this.library.dispose();
    this.mixer.dispose();
  }

  /** Sample sets the current settings need; everything else stays unloaded. */
  private neededSets(): SampleSetId[] {
    const s = this.settings;
    const sets = new Set<SampleSetId>([MELODY_SPECS[s.melodyInstrument].set]);
    if (s.layers.bass.on) sets.add(BACKING_SPECS.bass.set);
    if (s.layers.chords.on) sets.add(CHORD_SPECS[s.chordSound].set);
    if (s.layers.pad.on) sets.add(BACKING_SPECS.pad.set);
    if (s.layers.pizz.on) sets.add(BACKING_SPECS.pizz.set);
    return [...sets];
  }

  private requestSamples(): void {
    for (const id of this.neededSets()) this.library.request(id);
    this.emitProgress();
  }

  private progress(): number {
    return this.library.progress(this.neededSets());
  }

  private emitProgress(): void {
    const progress = this.progress();
    if (progress === this.lastProgress) return;
    this.lastProgress = progress;
    for (const listener of [...this.listeners]) listener(progress);
  }
}

/**
 * Builds the whole audio graph and returns immediately; sample downloads run in the background
 * (see `ready` and `onLoadProgress`) while synthesised voices cover for them. Call it after
 * `startAudio()` has resolved.
 */
export async function createAudioEngine(settings: AudioSettings): Promise<AudioEngine> {
  return new Engine(createEnv(Tone.getContext()), merge(DEFAULT_SETTINGS, settings));
}
