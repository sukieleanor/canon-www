import * as Tone from 'tone';
import type { Mood } from '../types';
import type { AudioEnv } from './env';
import { ReverbBank } from './reverb';
import type { LayerMix } from './types';
import { clamp, dbToGain, sliderGain } from './util';

export type BackingPart = 'bass' | 'chords' | 'pad' | 'pizz' | 'beat';

/** Canon voices: the leader is centred and brightest; the echoes step back and sit left and right. */
export const VOICE_PROFILES = [
  { levelDb: 0, pan: 0, cutoff: 16000, send: 0.45, detune: 0 },
  { levelDb: -1.5, pan: -0.4, cutoff: 10500, send: 0.6, detune: 4 },
  { levelDb: -3, pan: 0.4, cutoff: 7500, send: 0.75, detune: -4 },
] as const;

/**
 * Level of each part with its slider at maximum. With the sounds' own gains these put every part
 * at its target loudness in the dev harness (melody −23.5 LUFS, bass −30, chords −34.5, pad −35.5,
 * pizzicato and beat −37, ambience −35 at the default sliders): the melody leads, the bed sits
 * underneath.
 */
const TRIM_DB = {
  melody: -0.2,
  bass: -5.3,
  chords: -11.4,
  pad: -8.2,
  pizz: -8.4,
  beat: -9.9,
  ambience: 0,
};
const PART_SEND: Record<BackingPart, number> = {
  bass: 0.1,
  chords: 0.4,
  pad: 0.55,
  pizz: 0.45,
  beat: 0.2,
};
const PART_PAN: Record<BackingPart, number> = {
  bass: 0,
  chords: -0.2,
  pad: 0,
  pizz: 0.25,
  beat: 0,
};

/** Gain of the master fader at slider position 1. */
const MASTER_TRIM_DB = 0;
/** Sources are recorded and normalised with plenty of headroom; this brings the mix up to level ahead of the compressor. */
const DRIVE_DB = 12;
/** The dynamics compressors add make-up gain of their own; these cancel it (measured, see dev/audio.ts). */
const COMP_MAKEUP_DB = 4.73;
const LIMITER_MAKEUP_DB = 0.86;

/** Mood colouring of the whole mix: high-shelf (dB at 3.5 kHz) and melody-voice brightness. */
const MOOD_TONE: Record<Mood, { shelfDb: number; bright: number }> = {
  bright: { shelfDb: 0, bright: 1 },
  wistful: { shelfDb: -2.5, bright: 0.85 },
  dreamy: { shelfDb: -5, bright: 0.7 },
};

/** Final safety net: linear below the knee, saturating smoothly towards −1 dBFS (0.891), never above. */
function softClip(x: number): number {
  const a = Math.abs(x);
  const knee = 0.8;
  const ceiling = 0.891;
  const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
  return x < 0 ? -y : y;
}

/** A gain stage that follows a slider and an on/off switch with click-free ramps. */
class Fader {
  readonly gain: Tone.Gain;
  private on = true;
  private readonly trimDb: number;

  constructor(env: AudioEnv, trimDb: number) {
    this.trimDb = trimDb;
    this.gain = env.run(() => new Tone.Gain(0));
  }

  set(on: boolean, volume: number, immediate = false): void {
    const toggled = on !== this.on;
    this.on = on;
    const target = on ? sliderGain(volume) * dbToGain(this.trimDb) : 0;
    if (immediate) {
      this.gain.gain.cancelScheduledValues(0);
      this.gain.gain.value = target;
    } else {
      this.gain.gain.targetRampTo(target, toggled ? (on ? 0.5 : 0.7) : 0.08);
    }
  }
}

interface VoiceChannel {
  input: Tone.Gain;
  tone: Tone.Filter;
  fader: Fader;
}

export interface MixerSettings {
  masterVolume: number;
  melodyVolume: number;
  layers: Record<BackingPart | 'ambience', LayerMix>;
  mood: Mood;
  lofi: boolean;
}

/**
 * Signal flow:
 *
 *   melody voices ─┐
 *   bass/chords/   ├→ fader → dry ─→ music bus ─→ mood shelf ─→ (tape | dry) ─→ compressor ─┐
 *   pad/pizz/beat ─┘        └→ send → reverb ───→ music bus                                  │
 *   ambience → fader ──────────────────────────────────────────────────────────────────────→ sum
 *   vinyl crackle ─────────────────────────────────────────────────────────────────────────→ sum
 *   sum → master → sub-bass filter → limiter → soft clip → output (recorder tap, destination)
 */
export class Mixer {
  /** Final tap after the limiter; feeds the destination and the recorder. */
  output!: Tone.Gain;
  ambienceInput!: Tone.Gain;
  crackleInput!: Tone.Gain;
  private readonly nodes: Tone.ToneAudioNode[] = [];
  private readonly voices: VoiceChannel[] = [];
  private readonly parts = {} as Record<BackingPart, { input: Tone.Gain; fader: Fader }>;
  private ambienceFader!: Fader;
  private reverb!: ReverbBank;
  private shelf!: Tone.Filter;
  private tapeDry!: Tone.Gain;
  private tapeWet!: Tone.Gain;
  private master!: Tone.Gain;
  private compressor!: Tone.Compressor;
  private limiter!: Tone.Compressor;
  private moodBright = 1;

  constructor(env: AudioEnv, settings: MixerSettings) {
    const own = <T extends Tone.ToneAudioNode>(node: T): T => {
      this.nodes.push(node);
      return node;
    };
    env.run(() => {
      const musicBus = own(new Tone.Gain(1));
      this.reverb = new ReverbBank(env, settings.mood);
      this.reverb.output.connect(musicBus);
      this.shelf = own(new Tone.Filter({ type: 'highshelf', frequency: 3500, Q: 0.7, gain: 0 }));
      musicBus.connect(this.shelf);

      // Warm tape colour, crossfaded in and out by the lo-fi switch.
      this.tapeDry = own(new Tone.Gain(1));
      this.tapeWet = own(new Tone.Gain(0));
      const tapeLow = own(
        new Tone.Filter({ type: 'lowpass', frequency: 5200, Q: 0.5, rolloff: -12 }),
      );
      const tapeHigh = own(new Tone.Filter({ type: 'highpass', frequency: 70, rolloff: -12 }));
      const tapeSat = own(new Tone.WaveShaper((x) => Math.tanh(1.5 * x) / 1.5, 2048));
      const tapeWow = own(new Tone.Vibrato({ frequency: 0.6, depth: 0.28 }));
      this.shelf.connect(this.tapeDry);
      this.shelf.chain(tapeHigh, tapeLow, tapeSat, tapeWow, this.tapeWet);

      this.compressor = own(
        new Tone.Compressor({ threshold: -22, ratio: 2.2, attack: 0.03, release: 0.28, knee: 14 }),
      );
      const compTrim = own(new Tone.Gain(dbToGain(-COMP_MAKEUP_DB)));
      const drive = own(new Tone.Gain(dbToGain(DRIVE_DB)));
      this.tapeDry.connect(drive);
      this.tapeWet.connect(drive);
      drive.chain(this.compressor, compTrim);

      const sum = own(new Tone.Gain(1));
      compTrim.connect(sum);
      this.ambienceFader = new Fader(env, TRIM_DB.ambience);
      this.ambienceInput = own(new Tone.Gain(1));
      this.ambienceInput.chain(this.ambienceFader.gain, sum);
      this.crackleInput = own(new Tone.Gain(1));
      this.crackleInput.connect(sum);

      this.master = own(new Tone.Gain(0));
      const subGuard = own(new Tone.Filter({ type: 'highpass', frequency: 28, rolloff: -12 }));
      this.limiter = own(
        new Tone.Compressor({ threshold: -1.5, ratio: 20, attack: 0.002, release: 0.09, knee: 0 }),
      );
      const limiterTrim = own(new Tone.Gain(dbToGain(-LIMITER_MAKEUP_DB)));
      const clip = own(new Tone.WaveShaper(softClip, 2048));
      this.output = own(new Tone.Gain(1));
      sum.chain(this.master, subGuard, this.limiter, limiterTrim, clip, this.output);
      this.output.connect(env.ctx.destination);

      // Melody: three canon voices sharing one tone filter, fader and pan each.
      VOICE_PROFILES.forEach((profile) => {
        const input = own(new Tone.Gain(1));
        const tone = own(
          new Tone.Filter({ type: 'lowpass', frequency: profile.cutoff, Q: 0.5, rolloff: -12 }),
        );
        const fader = new Fader(env, TRIM_DB.melody + profile.levelDb);
        const pan = own(new Tone.Panner(profile.pan));
        const send = own(new Tone.Gain(profile.send));
        input.chain(tone, fader.gain, pan, musicBus);
        pan.chain(send, this.reverb.input);
        this.nodes.push(fader.gain);
        this.voices.push({ input, tone, fader });
      });

      const backing: BackingPart[] = ['bass', 'chords', 'pad', 'pizz', 'beat'];
      for (const part of backing) {
        const input = own(new Tone.Gain(1));
        const fader = new Fader(env, TRIM_DB[part]);
        const pan = own(new Tone.Panner(PART_PAN[part]));
        const send = own(new Tone.Gain(PART_SEND[part]));
        if (part === 'beat') {
          const soften = own(
            new Tone.Filter({ type: 'lowpass', frequency: 7500, Q: 0.5, rolloff: -12 }),
          );
          input.chain(soften, fader.gain, pan, musicBus);
        } else {
          input.chain(fader.gain, pan, musicBus);
        }
        pan.chain(send, this.reverb.input);
        this.nodes.push(fader.gain);
        this.parts[part] = { input, fader };
      }
    });
    this.nodes.push(this.ambienceFader.gain);
    this.apply(settings, true);
  }

  voiceInput(voice: number): Tone.Gain {
    return this.voices[clamp(Math.round(voice), 0, this.voices.length - 1)].input;
  }

  partInput(part: BackingPart): Tone.Gain {
    return this.parts[part].input;
  }

  /** Brightness of a melody note: the voice's low-pass follows the note's dynamics. */
  shapeVoice(voice: number, time: number, brightness: number): void {
    const index = clamp(Math.round(voice), 0, this.voices.length - 1);
    const fc =
      VOICE_PROFILES[index].cutoff * this.moodBright * (0.55 + 0.45 * clamp(brightness, 0, 1));
    this.voices[index].tone.frequency.setTargetAtTime(fc, time, 0.03);
  }

  apply(settings: MixerSettings, immediate = false): void {
    this.setMaster(settings.masterVolume, immediate);
    this.setMelodyVolume(settings.melodyVolume, immediate);
    for (const part of Object.keys(this.parts) as BackingPart[]) {
      const mix = settings.layers[part];
      this.parts[part].fader.set(mix.on, mix.volume, immediate);
    }
    this.ambienceFader.set(settings.layers.ambience.on, settings.layers.ambience.volume, immediate);
    this.setMood(settings.mood, immediate);
    this.setLofi(settings.lofi, immediate);
  }

  setMaster(volume: number, immediate = false): void {
    const target = sliderGain(volume) * dbToGain(MASTER_TRIM_DB);
    if (immediate) this.master.gain.value = target;
    else this.master.gain.targetRampTo(target, 0.08);
  }

  setMelodyVolume(volume: number, immediate = false): void {
    for (const voice of this.voices) voice.fader.set(true, volume, immediate);
  }

  setLayer(layer: BackingPart | 'ambience', mix: LayerMix): void {
    const fader = layer === 'ambience' ? this.ambienceFader : this.parts[layer].fader;
    fader.set(mix.on, mix.volume);
  }

  setMood(mood: Mood, immediate = false): void {
    const tone = MOOD_TONE[mood];
    this.moodBright = tone.bright;
    if (immediate) this.shelf.gain.value = tone.shelfDb;
    else this.shelf.gain.targetRampTo(tone.shelfDb, 1.5);
    this.reverb.setMood(mood);
  }

  setLofi(on: boolean, immediate = false): void {
    const dry = on ? 0 : 1;
    const wet = on ? 1 : 0;
    if (immediate) {
      this.tapeDry.gain.value = dry;
      this.tapeWet.gain.value = wet;
    } else {
      this.tapeDry.gain.targetRampTo(dry, 1.2);
      this.tapeWet.gain.targetRampTo(wet, 1.2);
    }
  }

  dispose(): void {
    this.reverb.dispose();
    for (const node of this.nodes.reverse()) node.dispose();
    this.nodes.length = 0;
  }
}
