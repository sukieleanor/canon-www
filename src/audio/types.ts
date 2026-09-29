import type { ChordSoundId, LayerId, MelodyInstrumentId, Mood, PartId, SceneId } from '../types';

export interface PlayNote {
  part: PartId;
  /** Canon voice for melody notes (0 = leader, 1 and 2 = echoes); 0 for other parts. */
  voice: number;
  /** MIDI note number. For part 'beat' a General MIDI drum number (see DRUM in ../types). */
  midi: number;
  /** Sounding length in seconds (articulation already applied by the composer). */
  duration: number;
  /** 0..1 */
  velocity: number;
  /** Fast decorative note (trill, turn, grace note). */
  ornament?: boolean;
}

export interface LayerMix {
  on: boolean;
  /** 0..1 */
  volume: number;
}

export interface AudioSettings {
  /** 0..1, perceptual (mapped to decibels internally). */
  masterVolume: number;
  /** 0..1 */
  melodyVolume: number;
  melodyInstrument: MelodyInstrumentId;
  chordSound: ChordSoundId;
  layers: Record<LayerId, LayerMix>;
  /** 'dreamy' means a longer, wetter reverb and a softer tone. */
  mood: Mood;
  /** Warm low-passed "tape" tone plus vinyl crackle. */
  lofi: boolean;
  /** Selects the nature-ambience bed. */
  scene: SceneId;
}

export type RecordingFormat = 'wav' | 'compressed';

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  extension: 'wav' | 'webm' | 'ogg' | 'm4a';
  durationSec: number;
}

export interface AudioEngine {
  /** Schedule a note at an AudioContext time in seconds. Must never throw. */
  playNote(note: PlayNote, time: number): void;
  /** Apply any subset of settings; level changes ramp smoothly (no clicks). */
  update(settings: Partial<AudioSettings>): void;
  /** Play/pause: fade continuous beds (ambience, crackle) in/out and release held notes on pause. */
  setPlaying(playing: boolean): void;
  /** Resolves when the samples for the current settings are loaded (synth fallbacks sound meanwhile). Never rejects. */
  readonly ready: Promise<void>;
  /** Sample-loading progress 0..1 for the current settings. Returns an unsubscribe function. */
  onLoadProgress(listener: (progress: number) => void): () => void;
  startRecording(format: RecordingFormat): Promise<void>;
  stopRecording(): Promise<RecordingResult>;
  readonly isRecording: boolean;
  dispose(): void;
}
