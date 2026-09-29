import * as Tone from 'tone';
import type { Mood } from '../types';
import type { AudioEnv } from './env';
import { seeded } from './util';

export interface ReverbProfile {
  /** Seconds for the tail to fall by 60 dB. */
  decay: number;
  preDelay: number;
  /** The tail's low-pass starts here and closes as the tail decays (air absorption). */
  cutoff: number;
  /** Linear return level; the impulse has unit energy so 0.25 is about −12 dB against the dry sound. */
  wet: number;
}

export const REVERB_PROFILES: Record<Mood, ReverbProfile> = {
  bright: { decay: 1.7, preDelay: 0.012, cutoff: 9500, wet: 0.2 },
  wistful: { decay: 2.5, preDelay: 0.02, cutoff: 6500, wet: 0.25 },
  dreamy: { decay: 4.4, preDelay: 0.034, cutoff: 4800, wet: 0.36 },
};

const CROSSFADE = 2;

/** Decorrelated stereo noise with an exponential, progressively darker decay; unit energy. */
function makeImpulse(ctx: Tone.BaseContext, p: ReverbProfile, seed: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const pre = Math.round(p.preDelay * sr);
  const length = pre + Math.round(p.decay * sr * 1.05);
  const buffer = ctx.createBuffer(2, length, sr);
  const k = 6.9078 / p.decay;
  const tailStart = Math.floor(length * 0.9);
  let energy = 0;
  for (let ch = 0; ch < 2; ch++) {
    const rnd = seeded(seed + ch * 7919);
    const data = buffer.getChannelData(ch);
    let lp = 0;
    let a = 1;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / sr;
      if (((i - pre) & 63) === 0) {
        const fc = Math.max(p.cutoff * 2 ** ((-2.4 * t) / p.decay), 600);
        a = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      }
      lp += a * (rnd() * 2 - 1 - lp);
      let env = Math.exp(-k * t) * (1 - Math.exp(-t / 0.012));
      if (i > tailStart)
        env *= 0.5 + 0.5 * Math.cos((Math.PI * (i - tailStart)) / (length - tailStart));
      const v = lp * env;
      data[i] = v;
      energy += v * v;
    }
  }
  const scale = 1 / Math.sqrt(energy / 2 || 1);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) data[i] *= scale;
  }
  return buffer;
}

class ReverbInstance {
  readonly out: Tone.Gain;
  private readonly conv: Tone.Convolver;

  constructor(
    env: AudioEnv,
    input: Tone.Gain,
    output: Tone.Gain,
    profile: ReverbProfile,
    level: number,
  ) {
    const nodes = env.run(() => {
      const conv = new Tone.Convolver({ normalize: false });
      conv.buffer = new Tone.ToneAudioBuffer(makeImpulse(env.ctx, profile, 1234));
      const out = new Tone.Gain(level);
      return { conv, out };
    });
    this.conv = nodes.conv;
    this.out = nodes.out;
    input.connect(this.conv);
    this.conv.connect(this.out);
    this.out.connect(output);
  }

  dispose(): void {
    this.conv.dispose();
    this.out.dispose();
  }
}

/**
 * One shared convolution reverb. A mood change builds the new impulse response and crossfades to
 * it, so the tail never jumps; the old convolver is disposed once it has faded out.
 */
export class ReverbBank {
  readonly input: Tone.Gain;
  readonly output: Tone.Gain;
  private mood: Mood;
  private active: ReverbInstance;
  private readonly env: AudioEnv;
  private readonly retiring = new Map<number, ReverbInstance>();

  constructor(env: AudioEnv, mood: Mood) {
    this.env = env;
    const nodes = env.run(() => ({ input: new Tone.Gain(1), output: new Tone.Gain(1) }));
    this.input = nodes.input;
    this.output = nodes.output;
    this.mood = mood;
    this.active = new ReverbInstance(
      env,
      this.input,
      this.output,
      REVERB_PROFILES[mood],
      REVERB_PROFILES[mood].wet,
    );
  }

  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    const profile = REVERB_PROFILES[mood];
    const old = this.active;
    this.active = new ReverbInstance(this.env, this.input, this.output, profile, 0);
    this.active.out.gain.targetRampTo(profile.wet, CROSSFADE);
    old.out.gain.targetRampTo(0, CROSSFADE);
    const id = this.env.ctx.setTimeout(() => {
      this.retiring.delete(id);
      old.dispose();
    }, CROSSFADE + 1);
    this.retiring.set(id, old);
  }

  dispose(): void {
    for (const [id, instance] of this.retiring) {
      this.env.ctx.clearTimeout(id);
      instance.dispose();
    }
    this.retiring.clear();
    this.active.dispose();
    this.input.dispose();
    this.output.dispose();
  }
}
