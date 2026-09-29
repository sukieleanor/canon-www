/*
 * Audio harness: http://127.0.0.1:5173/dev/audio.html
 *
 * Buttons to hear every instrument, layer, scene, mood and the recorder, plus measurement helpers
 * (offline renders through Tone.Offline and real-time WAV captures) exposed on
 * `window.audioHarness` for scripted verification.
 */
import * as Tone from 'tone';
import {
  DRUM,
  LAYER_IDS,
  MELODY_INSTRUMENTS,
  MOODS,
  SCENE_IDS,
  SCENE_INFO,
  type ChordSoundId,
  type LayerId,
  type MelodyInstrumentId,
  type Mood,
  type PartId,
  type SceneId,
} from '../src/types';
import { startAudio } from '../src/audio/context';
import { createAudioEngine, type AudioEngineDebug } from '../src/audio/engine';
import { wavHeader } from '../src/audio/recorder';
import { SAMPLE_SETS } from '../src/audio/sampleManifest';
import type { AudioEngine, AudioSettings, PlayNote, RecordingFormat } from '../src/audio/types';

type DebugEngine = AudioEngine & { debug: AudioEngineDebug };

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const logEl = $<HTMLPreElement>('log');
const log = (...parts: unknown[]) => {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  logEl.textContent += `${line}\n`;
  logEl.scrollTop = logEl.scrollHeight;
};

/* ------------------------------------------------------------------ demo music */

interface ChordDemo {
  name: string;
  bass: number;
  triad: number[];
  melody: number[];
}

const CHORDS: ChordDemo[] = [
  { name: 'D', bass: 38, triad: [62, 66, 69], melody: [78, 76, 74, 73] },
  { name: 'A', bass: 45, triad: [64, 69, 73], melody: [71, 73, 76, 73] },
  { name: 'Bm', bass: 47, triad: [62, 66, 71], melody: [74, 71, 74, 78] },
  { name: 'F#m', bass: 42, triad: [61, 66, 69], melody: [73, 69, 73, 76] },
  { name: 'G', bass: 43, triad: [59, 62, 67], melody: [71, 74, 79, 74] },
  { name: 'D', bass: 38, triad: [62, 66, 69], melody: [78, 74, 69, 74] },
  { name: 'G', bass: 43, triad: [59, 62, 67], melody: [79, 74, 71, 74] },
  { name: 'A', bass: 45, triad: [64, 69, 73], melody: [76, 73, 69, 73] },
];

interface DemoOptions {
  parts: PartId[];
  voices: number;
  /** Multiplier on the composer-like velocities below (1 = typical; higher for stress tests). */
  level: number;
}

const ALL_PARTS: PartId[] = ['melody', 'bass', 'chords', 'pad', 'pizz', 'beat'];

/** Typical velocities of the composer (src/music/backingTrack.ts, stages.ts, canonVoices). */
const DEMO_VELOCITY = {
  melody: [0.68, 0.58],
  voice: [1, 0.9, 0.82],
  bass: 0.62,
  chordsBlock: [0.44, 0.34],
  chordsBroken: [0.42, 0.34],
  pad: 0.38,
  pizz: [0.55, 0.4, 0.48, 0.4],
  kick: 0.5,
  snare: 0.44,
  hat: [0.22, 0.15],
  openHat: 0.2,
};

/** Schedules one chord (two beats) of the demo on `engine`. */
function scheduleChord(
  engine: AudioEngine,
  cycle: number,
  index: number,
  t0: number,
  beat: number,
  o: DemoOptions,
): void {
  const chord = CHORDS[index];
  const has = (p: PartId) => o.parts.includes(p);
  const note = (n: Omit<PlayNote, 'velocity'>, velocity: number, time: number) =>
    engine.playNote({ ...n, velocity: Math.min(1, velocity * o.level) }, time);
  const eighth = beat / 2;
  if (has('bass'))
    note(
      { part: 'bass', voice: 0, midi: chord.bass, duration: beat * 1.9 },
      DEMO_VELOCITY.bass,
      t0,
    );
  if (has('chords')) {
    if (cycle % 2 === 0) {
      DEMO_VELOCITY.chordsBlock.forEach((velocity, strike) =>
        chord.triad.forEach((midi, i) =>
          note(
            { part: 'chords', voice: 0, midi, duration: beat * 0.95 },
            velocity,
            t0 + strike * beat + (strike === 0 ? i * 0.02 : 0),
          ),
        ),
      );
    } else {
      [0, 1, 2, 1].forEach((k, j) =>
        note(
          { part: 'chords', voice: 0, midi: chord.triad[k] + 12, duration: eighth },
          DEMO_VELOCITY.chordsBroken[j === 0 ? 0 : 1],
          t0 + j * eighth,
        ),
      );
    }
  }
  if (has('pad')) {
    chord.triad.forEach((midi) =>
      note({ part: 'pad', voice: 0, midi, duration: beat * 2.1 }, DEMO_VELOCITY.pad, t0),
    );
  }
  if (has('pizz')) {
    [0, 1, 2, 3].forEach((i) =>
      note(
        { part: 'pizz', voice: 0, midi: chord.triad[i % 3] - (i === 0 ? 12 : 0), duration: 0.22 },
        DEMO_VELOCITY.pizz[i],
        t0 + i * eighth,
      ),
    );
  }
  if (has('beat')) {
    const drum = (midi: number, velocity: number, time: number) =>
      note({ part: 'beat', voice: 0, midi, duration: 0.2 }, velocity, time);
    drum(DRUM.kick, DEMO_VELOCITY.kick, t0 + (index % 2 ? eighth : 0));
    drum(DRUM.snare, DEMO_VELOCITY.snare, t0 + beat);
    for (let k = 0; k < 4; k++)
      drum(
        k === 3 && index % 4 === 3 ? DRUM.openHat : DRUM.closedHat,
        k === 3 && index % 4 === 3 ? DEMO_VELOCITY.openHat : DEMO_VELOCITY.hat[k % 2],
        t0 + k * eighth,
      );
  }
  if (has('melody')) {
    for (let voice = 0; voice < o.voices; voice++) {
      const source = cycle * 8 + index - voice; // each echo trails by one chord
      if (source < 0) continue;
      const line = CHORDS[((source % 8) + 8) % 8].melody;
      line.forEach((midi, i) =>
        note(
          { part: 'melody', voice, midi, duration: eighth * 0.95 },
          DEMO_VELOCITY.melody[i === 0 ? 0 : 1] * DEMO_VELOCITY.voice[voice],
          t0 + i * eighth,
        ),
      );
    }
  }
}

/* ------------------------------------------------------------------ engine state */

const defaultSettings = (): AudioSettings => ({
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
});

let engine: DebugEngine | null = null;
let settings = defaultSettings();
let bpm = 76;
let loopTimer = 0;
let paused = false;
const beatSeconds = () => 60 / bpm;

function requireEngine(): DebugEngine {
  if (!engine) throw new Error('Start audio first.');
  return engine;
}

function apply(patch: Partial<AudioSettings>): void {
  settings = { ...settings, ...patch, layers: { ...settings.layers, ...patch.layers } };
  engine?.update(patch);
  refreshButtons();
}

function setLayer(id: LayerId, on: boolean, volume = settings.layers[id].volume): void {
  apply({ layers: { ...settings.layers, [id]: { on, volume } } });
}

async function startEngine(patch: Partial<AudioSettings> = {}): Promise<DebugEngine> {
  if (engine) return engine;
  settings = { ...settings, ...patch, layers: { ...settings.layers, ...patch.layers } };
  await startAudio();
  const created = (await createAudioEngine(settings)) as DebugEngine;
  created.onLoadProgress((p) => {
    $<HTMLProgressElement>('progress').value = p;
  });
  void created.ready.then(() => {
    $('status').textContent = `running · samples ready (${created.debug.neededSets().join(', ')})`;
  });
  engine = created;
  $('status').textContent = 'running · loading samples…';
  $<HTMLButtonElement>('start').disabled = true;
  return created;
}

function playDemo(parts: PartId[], chords = 8, voices = 3): void {
  const e = requireEngine();
  const ctx = Tone.getContext();
  const t0 = ctx.currentTime + 0.15;
  const beat = beatSeconds();
  for (let i = 0; i < chords; i++) {
    scheduleChord(e, 0, i % 8, t0 + i * beat * 2, beat, { parts, voices, level: 1 });
  }
}

function toggleLoop(): void {
  const e = requireEngine();
  const button = $('loop');
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = 0;
    button.classList.remove('on');
    return;
  }
  const ctx = Tone.getContext();
  let next = ctx.currentTime + 0.2;
  let step = 0;
  loopTimer = window.setInterval(() => {
    if (paused) return;
    const beat = beatSeconds();
    while (next < ctx.currentTime + 0.6) {
      scheduleChord(e, Math.floor(step / 8), step % 8, next, beat, {
        parts: ALL_PARTS,
        voices: 3,
        level: 1,
      });
      next += beat * 2;
      step++;
    }
  }, 100);
  button.classList.add('on');
}

/* ------------------------------------------------------------------ analysis */

const toDb = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

export interface Stats {
  seconds: number;
  peakDb: number;
  rmsDb: number;
  /** ITU-R BS.1770 integrated loudness (gated), in LUFS. */
  lufs: number;
  /** Loudest 1 s window. */
  loudRmsDb: number;
  dc: number;
  centroidHz: number;
  /** Energy share (%) below 250 Hz, 250–2k, 2k–6k, above 6k. */
  bands: number[];
  /** RMS of consecutive 250 ms windows in dB. */
  envelope: number[];
}

/** BS.1770 K-weighting (shelf plus high-pass) as [numerator, denominator] biquads for `rate`. */
function kFilters(rate: number): Array<[number[], number[]]> {
  const shelfK = Math.tan((Math.PI * 1681.974450955533) / rate);
  const shelfQ = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + shelfK / shelfQ + shelfK * shelfK;
  const shelf: [number[], number[]] = [
    [
      (vh + (vb * shelfK) / shelfQ + shelfK * shelfK) / a0,
      (2 * (shelfK * shelfK - vh)) / a0,
      (vh - (vb * shelfK) / shelfQ + shelfK * shelfK) / a0,
    ],
    [1, (2 * (shelfK * shelfK - 1)) / a0, (1 - shelfK / shelfQ + shelfK * shelfK) / a0],
  ];
  const highK = Math.tan((Math.PI * 38.13547087602444) / rate);
  const highQ = 0.5003270373238773;
  const d = 1 + highK / highQ + highK * highK;
  const high: [number[], number[]] = [
    [1, -2, 1],
    [1, (2 * (highK * highK - 1)) / d, (1 - highK / highQ + highK * highK) / d],
  ];
  return [shelf, high];
}

function kWeight(x: Float32Array, rate: number): Float64Array {
  let y = Float64Array.from(x);
  for (const [b, a] of kFilters(rate)) {
    const out = new Float64Array(y.length);
    let z1 = 0;
    let z2 = 0;
    for (let i = 0; i < y.length; i++) {
      const v = y[i];
      const o = b[0] * v + z1;
      z1 = b[1] * v - a[1] * o + z2;
      z2 = b[2] * v - a[2] * o;
      out[i] = o;
    }
    y = out;
  }
  return y;
}

/** Gated integrated loudness (400 ms blocks, 100 ms hop, -70 LUFS absolute and -10 LU relative gates). */
function integratedLufs(channels: Float32Array[], rate: number): number {
  const weighted = channels.map((c) => kWeight(c, rate));
  const hop = Math.round(rate * 0.1);
  const segments = Math.floor(weighted[0].length / hop);
  const power = new Float64Array(segments);
  for (let s = 0; s < segments; s++) {
    for (const w of weighted) {
      let sum = 0;
      for (let i = s * hop; i < (s + 1) * hop; i++) sum += w[i] * w[i];
      power[s] += sum / hop;
    }
  }
  const loudness = (ms: number) => -0.691 + 10 * Math.log10(ms);
  const blocks: number[] = [];
  for (let s = 0; s + 4 <= segments; s++)
    blocks.push((power[s] + power[s + 1] + power[s + 2] + power[s + 3]) / 4);
  const audible = blocks.filter((ms) => loudness(ms) > -70);
  if (audible.length === 0) return -120;
  const mean = (list: number[]) => list.reduce((s, v) => s + v, 0) / list.length;
  const gate = loudness(mean(audible)) - 10;
  const kept = audible.filter((ms) => loudness(ms) > gate);
  return loudness(mean(kept));
}

function analyse(channels: Float32Array[], rate: number): Stats {
  const n = channels[0].length;
  let peak = 0;
  let sum = 0;
  let dc = 0;
  const win = Math.floor(rate * 0.25);
  const envelope: number[] = [];
  let acc = 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of channels) {
      const v = c[i];
      peak = Math.max(peak, Math.abs(v));
      sum += v * v;
      dc += v;
      m += v / channels.length;
    }
    mono[i] = m;
    acc += m * m;
    if ((i + 1) % win === 0) {
      envelope.push(Math.round(toDb(Math.sqrt(acc / win)) * 10) / 10);
      acc = 0;
    }
  }
  let loud = -200;
  for (let i = 0; i + 4 <= envelope.length; i++) {
    const p = envelope.slice(i, i + 4).reduce((s, d) => s + 10 ** (d / 10), 0) / 4;
    loud = Math.max(loud, 10 * Math.log10(p));
  }
  // spectrum: average of Hann-windowed 8192-point frames
  const size = 8192;
  const spectrum = new Float64Array(size / 2);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let frames = 0;
  for (let start = 0; start + size <= n; start += size * 2) {
    for (let i = 0; i < size; i++) {
      re[i] = mono[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < size / 2; i++) spectrum[i] += re[i] * re[i] + im[i] * im[i];
    frames++;
  }
  const edges = [250, 2000, 6000];
  const bands = [0, 0, 0, 0];
  let total = 0;
  let weighted = 0;
  for (let i = 1; i < size / 2; i++) {
    const f = (i * rate) / size;
    const e = spectrum[i] / Math.max(frames, 1);
    total += e;
    weighted += e * f;
    bands[f < edges[0] ? 0 : f < edges[1] ? 1 : f < edges[2] ? 2 : 3] += e;
  }
  return {
    seconds: Math.round((n / rate) * 100) / 100,
    peakDb: Math.round(toDb(peak) * 100) / 100,
    rmsDb: Math.round(toDb(Math.sqrt(sum / (n * channels.length))) * 100) / 100,
    lufs: Math.round(integratedLufs(channels, rate) * 10) / 10,
    loudRmsDb: Math.round(loud * 100) / 100,
    dc: Math.round((dc / (n * channels.length)) * 1e6) / 1e6,
    centroidHz: Math.round(weighted / (total || 1)),
    bands: bands.map((b) => Math.round((b / (total || 1)) * 1000) / 10),
    envelope,
  };
}

let renderQueue: Promise<unknown> = Promise.resolve();

/**
 * Renders `seconds` of audio through a fresh engine inside Tone.Offline and returns the PCM.
 * Renders run one at a time: Tone.Offline swaps the global context, so overlapping renders would
 * corrupt each other.
 */
function renderChannels(
  patch: Partial<AudioSettings>,
  seconds: number,
  schedule: (e: DebugEngine) => void,
  opts: { synthOnly?: boolean } = {},
): Promise<{ channels: Float32Array[]; rate: number }> {
  const result = renderQueue.then(() => renderNow(patch, seconds, schedule, opts));
  renderQueue = result.catch(() => undefined);
  return result;
}

async function renderNow(
  patch: Partial<AudioSettings>,
  seconds: number,
  schedule: (e: DebugEngine) => void,
  opts: { synthOnly?: boolean } = {},
): Promise<{ channels: Float32Array[]; rate: number }> {
  let created: DebugEngine | null = null;
  const buffer = await Tone.Offline(async () => {
    created = (await createAudioEngine({ ...defaultSettings(), ...patch })) as DebugEngine;
    if (opts.synthOnly) created.debug.library.dispose();
    else await created.ready;
    schedule(created);
  }, seconds);
  (created as DebugEngine | null)?.dispose();
  return {
    channels: [buffer.getChannelData(0), buffer.getChannelData(1)],
    rate: buffer.sampleRate,
  };
}

async function render(
  patch: Partial<AudioSettings>,
  seconds: number,
  schedule: (e: DebugEngine) => void,
  opts: { synthOnly?: boolean } = {},
): Promise<Stats & { rate: number }> {
  const { channels, rate } = await renderChannels(patch, seconds, schedule, opts);
  return { ...analyse(channels, rate), rate };
}

/** 16-bit stereo WAV file of `channels`. */
function encodeWav(channels: Float32Array[], rate: number): Blob {
  const frames = channels[0].length;
  const pcm = new Int16Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const v = Math.max(-1, Math.min(1, channels[Math.min(c, channels.length - 1)][i]));
      pcm[i * 2 + c] = Math.round(v * 32767);
    }
  }
  return new Blob([wavHeader(frames, rate), pcm], { type: 'audio/wav' });
}

/** Sends a blob to a local collector (used by scripted checks to analyse renders outside the page). */
async function upload(name: string, blob: Blob, sink = 'http://127.0.0.1:5176/'): Promise<void> {
  const response = await fetch(sink + encodeURIComponent(name), { method: 'POST', body: blob });
  if (!response.ok) throw new Error(`upload of ${name} failed: HTTP ${response.status}`);
}

/** Everything a render needs, so measuring and exporting the same case stays consistent. */
interface Scenario {
  patch: Partial<AudioSettings>;
  seconds: number;
  schedule: (e: DebugEngine) => void;
  synthOnly?: boolean;
}

const runScenario = (s: Scenario) =>
  render(s.patch, s.seconds, s.schedule, { synthOnly: s.synthOnly });

async function exportScenario(name: string, s: Scenario): Promise<Stats & { rate: number }> {
  const { channels, rate } = await renderChannels(s.patch, s.seconds, s.schedule, {
    synthOnly: s.synthOnly,
  });
  await upload(`${name}.wav`, encodeWav(channels, rate));
  return { ...analyse(channels, rate), rate };
}

const trimEnvelope = (s: Stats) => ({ ...s, envelope: s.envelope.filter((_, i) => i % 4 === 0) });

/* ------------------------------------------------------------------ tests */

async function checkSamples(): Promise<unknown> {
  const ctx = Tone.getContext();
  const base = new URL(`${import.meta.env.BASE_URL}samples/`, document.baseURI).href;
  const failures: string[] = [];
  const sets: Record<string, unknown> = {};
  let files = 0;
  let bytes = 0;
  let decodedSeconds = 0;
  for (const [id, list] of Object.entries(SAMPLE_SETS)) {
    let peakMin = 0;
    let peakMax = -200;
    let rmsMin = 0;
    let rmsMax = -200;
    let maxSec = 0;
    let minSec = 1e9;
    let setBytes = 0;
    peakMin = 200;
    rmsMin = 200;
    for (const f of list) {
      try {
        const response = await fetch(base + f.file);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.arrayBuffer();
        if (data.byteLength !== f.bytes)
          failures.push(`${f.file}: size ${data.byteLength} != manifest ${f.bytes}`);
        setBytes += data.byteLength;
        const buffer = await ctx.decodeAudioData(data);
        const pcm = buffer.getChannelData(0);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < pcm.length; i++) {
          peak = Math.max(peak, Math.abs(pcm[i]));
          sum += pcm[i] * pcm[i];
        }
        const rms = Math.sqrt(sum / pcm.length);
        if (peak < 0.02) failures.push(`${f.file}: silent (peak ${peak})`);
        if (buffer.numberOfChannels !== 1)
          failures.push(`${f.file}: ${buffer.numberOfChannels} channels`);
        peakMin = Math.min(peakMin, toDb(peak));
        peakMax = Math.max(peakMax, toDb(peak));
        rmsMin = Math.min(rmsMin, toDb(rms));
        rmsMax = Math.max(rmsMax, toDb(rms));
        maxSec = Math.max(maxSec, buffer.duration);
        minSec = Math.min(minSec, buffer.duration);
        decodedSeconds += buffer.duration;
        files++;
      } catch (error) {
        failures.push(`${f.file}: ${String(error)}`);
      }
    }
    bytes += setBytes;
    const r = (x: number) => Math.round(x * 10) / 10;
    sets[id] = {
      files: list.length,
      kB: Math.round(setBytes / 1000),
      seconds: [r(minSec), r(maxSec)],
      peakDb: [r(peakMin), r(peakMax)],
      rmsDb: [r(rmsMin), r(rmsMax)],
    };
  }
  return {
    files,
    totalMB: Math.round(bytes / 1e4) / 100,
    decodedSeconds: Math.round(decodedSeconds),
    failures,
    sets,
  };
}

/** Output level of a 1 kHz tone entering melody voice 0, per input level (chain gain and limiting). */
async function measureChain(levels = [-50, -30, -20, -12, -6, -3, 0, 6, 12]): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const db of levels) {
    const s = await render(
      { masterVolume: 1, melodyVolume: 1 },
      2,
      (e) => {
        const osc = new Tone.Oscillator(1000, 'sine').start(0);
        const gain = new Tone.Gain(10 ** (db / 20));
        osc.chain(gain, e.debug.mixer.voiceInput(0));
      },
      { synthOnly: true },
    );
    // Skip the compressor's settling by looking at the last half second only
    out.push({ inDb: db, outPeakDb: s.peakDb, outRmsDb: s.rmsDb, env: s.envelope.slice(-3) });
  }
  return out;
}

const PHRASE_SECONDS = 7;

const DEFAULT_LAYER_VOLUME = 0.7;

/** Loudness each part should have alone at the default sliders: the melody leads, the bed sits under it. */
const TARGET_LUFS: Record<PartId, number> = {
  melody: -23.5,
  bass: -30,
  chords: -34.5,
  pad: -35.5,
  pizz: -37,
  beat: -37,
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/** One sound played alone (the demo phrase), at the default sliders or with every slider at maximum. */
function soundScenario(
  part: PartId,
  id: string,
  opts: { synthOnly?: boolean; full?: boolean } = {},
): Scenario {
  const defaults = defaultSettings();
  const volume = opts.full ? 1 : DEFAULT_LAYER_VOLUME;
  const patch: Partial<AudioSettings> = {
    masterVolume: opts.full ? 1 : defaults.masterVolume,
    melodyVolume: opts.full ? 1 : defaults.melodyVolume,
    layers: { ...allLayers(volume), ambience: { on: false, volume } },
  };
  if (part === 'melody') patch.melodyInstrument = id as MelodyInstrumentId;
  if (part === 'chords') patch.chordSound = id as ChordSoundId;
  return {
    patch,
    seconds: PHRASE_SECONDS,
    synthOnly: opts.synthOnly,
    schedule: (e) => {
      const t0 = e.debug.env.ctx.currentTime + 0.1;
      for (let i = 0; i < 4; i++) {
        // Melody: cycle 1 so all three canon voices sound from the first chord.
        scheduleChord(e, part === 'melody' ? 1 : i % 2, i, t0 + i * 1.5, 0.75, {
          parts: [part],
          voices: 3,
          level: 1,
        });
      }
    },
  };
}

const summary = (s: Stats) => ({
  lufs: s.lufs,
  peakDb: s.peakDb,
  rmsDb: s.rmsDb,
  centroid: s.centroidHz,
  bands: s.bands,
});

/** Loudness and colour of one sound at the default sliders, as samples and as its synth stand-in. */
async function measureSound(part: PartId, id: string): Promise<unknown> {
  const sampled = part === 'beat' ? null : await runScenario(soundScenario(part, id));
  const synth = await runScenario(soundScenario(part, id, { synthOnly: true }));
  const target = TARGET_LUFS[part];
  return {
    part,
    id,
    target,
    sampled: sampled && summary(sampled),
    synth: summary(synth),
    // The change (dB) each variant still needs to reach the target.
    sampledToTarget: sampled && round1(target - sampled.lufs),
    synthToTarget: round1(target - synth.lufs),
  };
}

async function measureAllSounds(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const id of MELODY_INSTRUMENTS) out.push(await measureSound('melody', id));
  for (const id of ['harpsichord', 'piano']) out.push(await measureSound('chords', id));
  for (const part of ['bass', 'pad', 'pizz', 'beat'] as const)
    out.push(await measureSound(part, part));
  return out;
}

function allLayers(volume: number, on = true): AudioSettings['layers'] {
  return Object.fromEntries(LAYER_IDS.map((id) => [id, { on, volume }])) as AudioSettings['layers'];
}

function playFull(e: DebugEngine, seconds: number, level: number): void {
  const t0 = e.debug.env.ctx.currentTime + 0.1;
  const beat = 60 / 90;
  for (let i = 0; i * beat * 2 < seconds; i++) {
    scheduleChord(e, 1 + Math.floor(i / 8), i % 8, t0 + i * beat * 2, beat, {
      parts: ALL_PARTS,
      voices: 3,
      level,
    });
  }
}

type MixKind = 'defaults' | 'melodyOnly' | 'max' | 'worst';

/** Whole-mix cases: default sliders, melody alone, every slider at maximum, and a worst-case chord stack. */
function mixScenario(kind: MixKind, seconds = 26): Scenario {
  switch (kind) {
    case 'defaults':
      return {
        patch: { layers: allLayers(DEFAULT_LAYER_VOLUME) },
        seconds,
        schedule: (e) => playFull(e, seconds - 3, 1),
      };
    case 'melodyOnly':
      return {
        patch: {},
        seconds,
        schedule: (e) => {
          const t0 = e.debug.env.ctx.currentTime + 0.1;
          for (let i = 0; i < 12; i++)
            scheduleChord(e, 1, i % 8, t0 + i * 1.6, 0.8, {
              parts: ['melody'],
              voices: 3,
              level: 1,
            });
        },
      };
    case 'max':
      return {
        patch: {
          masterVolume: 1,
          melodyVolume: 1,
          layers: allLayers(1),
          lofi: true,
          mood: 'dreamy',
        },
        seconds,
        schedule: (e) => playFull(e, seconds - 3, 1.6),
      };
    case 'worst':
      return {
        patch: {
          masterVolume: 1,
          melodyVolume: 1,
          melodyInstrument: 'piano',
          chordSound: 'piano',
          layers: allLayers(1),
        },
        seconds,
        schedule: (e) => {
          // Every part hits at full velocity on the same beats, with a tripled melody.
          const t0 = e.debug.env.ctx.currentTime + 0.1;
          for (let i = 0; i < 12; i++) {
            const t = t0 + i * 1.2;
            for (const midi of [55, 62, 67, 71, 74, 79, 83, 86]) {
              for (const part of ['melody', 'chords', 'pad', 'pizz'] as const)
                e.playNote({ part, voice: 0, midi, duration: 1, velocity: 1 }, t);
            }
            e.playNote({ part: 'melody', voice: 1, midi: 74, duration: 1, velocity: 1 }, t);
            e.playNote({ part: 'melody', voice: 2, midi: 74, duration: 1, velocity: 1 }, t);
            e.playNote({ part: 'bass', voice: 0, midi: 38, duration: 1, velocity: 1 }, t);
            e.playNote({ part: 'beat', voice: 0, midi: DRUM.kick, duration: 0.2, velocity: 1 }, t);
            e.playNote({ part: 'beat', voice: 0, midi: DRUM.snare, duration: 0.2, velocity: 1 }, t);
          }
        },
      };
  }
}

async function measureMix(): Promise<unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of ['defaults', 'melodyOnly', 'max', 'worst'] as const)
    out[kind] = trimEnvelope(await runScenario(mixScenario(kind)));
  return out;
}

/** One nature bed alone at the default sliders. */
function sceneScenario(scene: SceneId, seconds = 60): Scenario {
  return {
    patch: {
      scene,
      layers: {
        ...allLayers(DEFAULT_LAYER_VOLUME, false),
        ambience: { on: true, volume: DEFAULT_LAYER_VOLUME },
      },
    },
    seconds,
    schedule: () => undefined,
  };
}

async function measureScenes(seconds = 60): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const scene of SCENE_IDS) {
    const s = await runScenario(sceneScenario(scene, seconds));
    out.push({ scene, ...summary(s), envelope: s.envelope.filter((_, i) => i % 12 === 0) });
  }
  return out;
}

async function measureLofi(): Promise<unknown> {
  const crackleOnly = await render({ lofi: true }, 20, () => undefined);
  const phrase = (e: DebugEngine) => {
    const t0 = e.debug.env.ctx.currentTime + 0.1;
    for (let i = 0; i < 4; i++)
      scheduleChord(e, 1, i, t0 + i * 1.5, 0.75, { parts: ['melody'], voices: 3, level: 1 });
  };
  const clean = await render({ melodyInstrument: 'musicbox' }, 8, phrase);
  const tape = await render({ melodyInstrument: 'musicbox', lofi: true }, 8, phrase);
  return {
    crackleOnly: summary(crackleOnly),
    clean: summary(clean),
    tape: summary(tape),
  };
}

async function measureMoods(): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const mood of MOODS) {
    const s = await render(
      { mood, melodyInstrument: 'piano', masterVolume: 1, melodyVolume: 1 },
      12,
      (e) => {
        const t0 = e.debug.env.ctx.currentTime + 0.1;
        for (let i = 0; i < 3; i++)
          scheduleChord(e, 1, i, t0 + i * 1.5, 0.75, {
            parts: ['melody'],
            voices: 3,
            level: 1,
          });
      },
    );
    // tail: time after the last note (~5 s) for the level to drop 30 dB below the loudest window
    const env = s.envelope;
    const loud = Math.max(...env);
    const lastLoud = env.reduce((last, d, i) => (d > loud - 12 ? i : last), 0);
    let drop30 = env.findIndex((d, i) => i > lastLoud && d < loud - 30);
    if (drop30 < 0) drop30 = env.length;
    out.push({
      mood,
      rmsDb: s.rmsDb,
      peakDb: s.peakDb,
      centroid: s.centroidHz,
      bands: s.bands,
      tailSeconds30dB: (drop30 - lastLoud) * 0.25,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ real-time recording */

interface WavInfo {
  valid: boolean;
  channels: number;
  sampleRate: number;
  bits: number;
  frames: number;
  seconds: number;
  riffSize: number;
  dataBytes: number;
  byteLength: number;
  stats?: Stats;
}

async function parseWav(blob: Blob): Promise<WavInfo> {
  const data = await blob.arrayBuffer();
  const v = new DataView(data);
  const text = (o: number, n: number) => String.fromCharCode(...new Uint8Array(data, o, n));
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  const dataBytes = v.getUint32(40, true);
  const riffSize = v.getUint32(4, true);
  const frames = dataBytes / (channels * (bits / 8));
  const valid =
    text(0, 4) === 'RIFF' &&
    text(8, 4) === 'WAVE' &&
    text(12, 4) === 'fmt ' &&
    text(36, 4) === 'data' &&
    riffSize === data.byteLength - 8 &&
    dataBytes === data.byteLength - 44;
  const info: WavInfo = {
    valid,
    channels,
    sampleRate,
    bits,
    frames,
    seconds: frames / sampleRate,
    riffSize,
    dataBytes,
    byteLength: data.byteLength,
  };
  if (valid && bits === 16) {
    const pcm = new Int16Array(data, 44, frames * channels);
    const chans = Array.from({ length: channels }, (_, c) =>
      Float32Array.from({ length: frames }, (_, i) => pcm[i * channels + c] / 32768),
    );
    info.stats = analyse(chans, sampleRate);
  }
  return info;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real-time check of recording, pause/resume and scene changes through the actual AudioContext. */
async function recordingTest(format: RecordingFormat = 'wav'): Promise<unknown> {
  const e = requireEngine();
  apply({
    layers: {
      ...settings.layers,
      pad: { on: true, volume: 0.7 },
      ambience: { on: true, volume: 0.7 },
    },
  });
  await e.ready;
  const before = Tone.getContext().currentTime;
  await e.startRecording(format);
  let duplicate = 'no error';
  try {
    await e.startRecording(format);
  } catch (error) {
    duplicate = String(error);
  }
  const recording = e.isRecording;
  // 0-3 s music, 3-7 s paused (silence apart from the reverb tail), 7-10 s music again
  const beat = 0.5;
  for (let i = 0; i < 3; i++)
    scheduleChord(e, 0, i, Tone.getContext().currentTime + 0.2 + i * 1, beat, {
      parts: ['melody', 'pad'],
      voices: 2,
      level: 1,
    });
  await sleep(3200);
  e.setPlaying(false);
  const droppedWhilePaused = Tone.getContext().currentTime;
  e.playNote(
    { part: 'melody', voice: 0, midi: 72, duration: 1, velocity: 1 },
    droppedWhilePaused + 0.1,
  ); // must be ignored
  await sleep(3800);
  e.setPlaying(true);
  for (let i = 3; i < 6; i++)
    scheduleChord(e, 0, i, Tone.getContext().currentTime + 0.2 + (i - 3) * 1, beat, {
      parts: ['melody', 'pad'],
      voices: 2,
      level: 1,
    });
  await sleep(3200);
  const result = await e.stopRecording();
  const after = Tone.getContext().currentTime;
  const info: Record<string, unknown> = {
    format,
    recordingFlagWhileRunning: recording,
    secondStartRejected: duplicate,
    isRecordingAfterStop: e.isRecording,
    mimeType: result.mimeType,
    extension: result.extension,
    durationSec: Math.round(result.durationSec * 100) / 100,
    wallSeconds: Math.round((after - before) * 100) / 100,
    bytes: result.blob.size,
    blobType: result.blob.type,
  };
  if (result.extension === 'wav') {
    const wav = await parseWav(result.blob);
    info.wav = {
      ...wav,
      stats: wav.stats && {
        peakDb: wav.stats.peakDb,
        rmsDb: wav.stats.rmsDb,
        dc: wav.stats.dc,
        envelope: wav.stats.envelope,
      },
    };
  }
  return info;
}

/* ------------------------------------------------------------------ UI */

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Array<Node | string>
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const toggles = new Map<string, HTMLButtonElement>();
function button(
  parent: HTMLElement,
  key: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const b = make('button', { textContent: label, onclick: () => onClick() });
  b.id = key;
  toggles.set(key, b);
  parent.append(b);
  return b;
}

function slider(
  parent: HTMLElement,
  label: string,
  value: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const input = make('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    value: String(value),
  });
  input.oninput = () => onInput(Number(input.value));
  parent.append(make('label', {}, `${label} `, input));
  return input;
}

function refreshButtons(): void {
  for (const [key, b] of toggles) {
    const [group, id] = key.split(':');
    const on =
      group === 'melody'
        ? settings.melodyInstrument === id
        : group === 'chordsound'
          ? settings.chordSound === id
          : group === 'scene'
            ? settings.layers.ambience.on && settings.scene === id
            : group === 'mood'
              ? settings.mood === id
              : group === 'lofi'
                ? settings.lofi
                : group === 'layer'
                  ? settings.layers[id as LayerId].on
                  : false;
    b.classList.toggle('on', on);
  }
}

function buildUi(): void {
  const master = $('master');
  slider(master, 'Master', settings.masterVolume, (v) => apply({ masterVolume: v }));
  slider(master, 'Melody', settings.melodyVolume, (v) => apply({ melodyVolume: v }));

  const melody = $('melody');
  for (const id of MELODY_INSTRUMENTS) {
    button(melody, `melody:${id}`, id, () => {
      apply({ melodyInstrument: id });
      playDemo(['melody'], 4);
    });
  }

  const parts = $('parts');
  const soundButton = (
    key: string,
    label: string,
    layer: LayerId,
    patch: Partial<AudioSettings>,
    part: PartId,
  ) =>
    button(parts, key, label, () => {
      apply(patch);
      setLayer(layer, true);
      playDemo([part], 4, 1);
    });
  soundButton(
    'chordsound:harpsichord',
    'chords: harpsichord',
    'chords',
    { chordSound: 'harpsichord' },
    'chords',
  );
  soundButton('chordsound:piano', 'chords: piano', 'chords', { chordSound: 'piano' }, 'chords');
  soundButton('part:bass', 'bass (cello)', 'bass', {}, 'bass');
  soundButton('part:pad', 'pad (strings)', 'pad', {}, 'pad');
  soundButton('part:pizz', 'pizzicato', 'pizz', {}, 'pizz');
  soundButton('part:beat', 'lo-fi beat', 'beat', {}, 'beat');

  const layers = $('layers');
  for (const id of LAYER_IDS) {
    const label = make('label', { className: 'layer' });
    const check = make('input', { type: 'checkbox', checked: settings.layers[id].on });
    const range = make('input', {
      type: 'range',
      min: '0',
      max: '1',
      step: '0.01',
      value: String(settings.layers[id].volume),
    });
    check.onchange = () => setLayer(id, check.checked);
    range.oninput = () => setLayer(id, settings.layers[id].on, Number(range.value));
    label.append(check, id, range);
    label.id = `layer-${id}`;
    layers.append(label);
  }

  const scenes = $('scenes');
  for (const id of SCENE_IDS) {
    button(scenes, `scene:${id}`, SCENE_INFO[id].name, () => {
      setLayer('ambience', true);
      apply({ scene: id as SceneId });
      (document.querySelector('#layer-ambience input') as HTMLInputElement).checked = true;
    });
  }

  const colour = $('colour');
  for (const id of MOODS) button(colour, `mood:${id}`, id, () => apply({ mood: id as Mood }));
  button(colour, 'lofi:on', 'lo-fi (tape + crackle)', () => apply({ lofi: !settings.lofi }));

  $('start').onclick = () => {
    void startEngine().then(() => buildStatus());
  };
  $('playpause').onclick = () => {
    paused = !paused;
    requireEngine().setPlaying(!paused);
    $('playpause').textContent = paused ? 'Resume' : 'Pause';
  };
  $('loop').onclick = toggleLoop;
  $('bpm').oninput = (event) => {
    bpm = Number((event.target as HTMLInputElement).value);
  };

  let downloadUrl = '';
  const record = (format: RecordingFormat) => async () => {
    await requireEngine().startRecording(format);
    $('rec-info').textContent = `recording (${format})…`;
  };
  $('rec-wav').onclick = record('wav');
  $('rec-compressed').onclick = record('compressed');
  $('rec-stop').onclick = async () => {
    const result = await requireEngine().stopRecording();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    downloadUrl = URL.createObjectURL(result.blob);
    const link = make('a', { href: downloadUrl, download: `endless-canon.${result.extension}` });
    link.click();
    $('rec-info').textContent =
      `${result.mimeType} · ${(result.blob.size / 1e6).toFixed(2)} MB · ${result.durationSec.toFixed(1)} s`;
  };

  $('test-samples').onclick = async () => log(await checkSamples());
  $('test-all').onclick = async () => {
    log('sounds', await measureAllSounds());
    log('mix', await measureMix());
    log('scenes', await measureScenes());
    log('lofi', await measureLofi());
    log('moods', await measureMoods());
  };
  refreshButtons();
}

function buildStatus(): void {
  refreshButtons();
}

buildUi();

const harness = {
  Tone,
  startEngine,
  apply,
  setLayer,
  playDemo,
  checkSamples,
  measureChain,
  measureSound,
  measureAllSounds,
  measureMix,
  measureScenes,
  measureLofi,
  measureMoods,
  recordingTest,
  parseWav,
  render,
  renderChannels,
  runScenario,
  exportScenario,
  soundScenario,
  sceneScenario,
  mixScenario,
  encodeWav,
  upload,
  analyse,
  scheduleChord,
  get engine() {
    return engine;
  },
  defaultSettings,
};

declare global {
  interface Window {
    audioHarness: typeof harness;
  }
}
window.audioHarness = harness;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearInterval(loopTimer);
    engine?.dispose();
  });
}
