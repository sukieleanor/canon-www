import * as Tone from 'tone';
import type { AudioEnv } from './env';
import { seeded } from './util';

const LEVEL = 0.05;
const LOOP_SECONDS = 14;
const RATE = 24000;

/** Faint hiss plus random pops in clusters, rendered once into a looping mono buffer. */
function makeCrackle(env: AudioEnv): AudioBuffer {
  const length = LOOP_SECONDS * RATE;
  const buffer = env.ctx.createBuffer(1, length, RATE);
  const data = buffer.getChannelData(0);
  const rnd = seeded(20240611);
  let hissLow = 0;
  for (let i = 0; i < length; i++) {
    hissLow += 0.5 * (rnd() * 2 - 1 - hissLow);
    data[i] = hissLow * 0.02;
  }
  // Pop density wanders slowly, so the crackle comes in clusters.
  let density = 1;
  let t = 0;
  while (t < LOOP_SECONDS) {
    density = Math.min(2.6, Math.max(0.25, density + (rnd() - 0.5) * 0.7));
    t += -Math.log(1 - rnd()) / (7 * density);
    const start = Math.floor(t * RATE);
    const big = rnd() < 0.04;
    const amp = Math.exp((rnd() - 0.5) * 2.4) * (big ? 0.7 : 0.12) * (rnd() < 0.5 ? -1 : 1);
    const tau = (big ? 0.0035 : 0.0006 + rnd() * 0.0014) * RATE;
    for (let n = 0; n < tau * 6 && start + n < length; n++) {
      data[start + n] += amp * (0.4 + 0.6 * (rnd() * 2 - 1)) * Math.exp(-n / tau);
    }
  }
  let peak = 0;
  for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
  for (let i = 0; i < length; i++) data[i] /= peak || 1;
  return buffer;
}

/** Vinyl crackle bed: exists (and costs) only while lo-fi is on and playback is running. */
export class Crackle {
  private readonly env: AudioEnv;
  private readonly out: Tone.Gain;
  private source: Tone.ToneBufferSource | null = null;
  private buffer: Tone.ToneAudioBuffer | null = null;
  private enabled = false;
  private playing = true;
  private stopTimer = -1;

  constructor(env: AudioEnv, destination: Tone.ToneAudioNode) {
    this.env = env;
    this.out = env.run(() => new Tone.Gain(0));
    this.out.connect(destination);
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
    this.env.ctx.clearTimeout(this.stopTimer);
    this.source?.dispose();
    this.buffer?.dispose();
    this.out.dispose();
    this.source = null;
  }

  private sync(): void {
    const active = this.enabled && this.playing;
    this.env.ctx.clearTimeout(this.stopTimer);
    if (active) {
      if (!this.source) this.start();
      this.out.gain.targetRampTo(LEVEL, 1.5);
    } else if (this.source) {
      this.out.gain.targetRampTo(0, 1.2);
      const source = this.source;
      this.stopTimer = this.env.ctx.setTimeout(() => {
        source.dispose();
        if (this.source === source) this.source = null;
      }, 1.8);
    }
  }

  private start(): void {
    this.buffer ??= this.env.run(() => new Tone.ToneAudioBuffer(makeCrackle(this.env)));
    const buffer = this.buffer;
    this.source = this.env.run(() => {
      const source = new Tone.ToneBufferSource({ url: buffer, loop: true });
      source.connect(this.out);
      return source;
    });
    this.source.start(this.env.ctx.currentTime, Math.random() * LOOP_SECONDS);
  }
}
