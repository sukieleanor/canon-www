#!/usr/bin/env node
/**
 * Downloads the free-licensed source samples, converts them to compact mono MP3s under
 * public/samples/<set>/, and regenerates public/samples/CREDITS.md and
 * src/audio/sampleManifest.ts.
 *
 *   node scripts/samples/fetch-samples.mjs [--only piano,violin] [--check] [--force]
 *
 *   --only   convert just these sets (the manifest and credits are always regenerated in full)
 *   --check  do not download, convert or write anything; only verify the pitch of the existing MP3s
 *   --force  re-download sources even if cached
 *
 * Requires Node 20+, network access to github.com / raw.githubusercontent.com / tonejs.github.io
 * and ffmpeg (with libmp3lame) on the PATH. Sources are cached in $SAMPLE_CACHE
 * (default: <tmpdir>/endless-canon-samples).
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'public/samples');
const MANIFEST_TS = path.join(ROOT, 'src/audio/sampleManifest.ts');
const CACHE_DIR = process.env.SAMPLE_CACHE || path.join(os.tmpdir(), 'endless-canon-samples');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;

const SR = 44100;
const NAMES = ['C', 'Cs', 'D', 'Ds', 'E', 'F', 'Fs', 'G', 'Gs', 'A', 'As', 'B'];
const noteName = (midi) => `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;

/* ---------------------------------------------------------------- sources */

const VSCO = 'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/master/';
const FLUID = 'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/FluidR3_GM/';
const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const vscoUrl = (p) => VSCO + p.split('/').map(encodeURIComponent).join('/');

/*
 * Each set lists the notes to keep as [sounding MIDI number, source URL]. VSCO 2 CE names most
 * ensemble/woodwind/bass files with middle C = C3 (one octave lower than the sounding pitch); the
 * pitch check at the end of the script guards against mistakes here.
 */
const LICENSES = {
  salamander: {
    name: 'Salamander Grand Piano V3',
    author: 'Alexander Holm',
    license: 'CC BY 3.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    url: 'https://sites.google.com/site/salamanderpiano/ (files from https://tonejs.github.io/audio/salamander/)',
    notice:
      'Attribution required: "Salamander Grand Piano" by Alexander Holm, licensed under CC BY 3.0. ' +
      'Samples were trimmed, converted to mono and re-encoded as MP3.',
  },
  vsco: {
    name: 'VSCO 2 Community Edition (VS Chamber Orchestra)',
    author: 'Versilian Studios LLC / Sam Gossner (recorded with Simon Dalzell, Ivy Audio)',
    license: 'CC0 1.0 Universal (public domain dedication)',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    url: 'https://github.com/sgossner/VSCO-2-CE (homepage: http://vis.versilstudios.net/vsco-community.html)',
    notice:
      "No attribution is legally required under CC0; credit is given at the authors' request. " +
      'Samples were trimmed, level-matched, converted to mono and re-encoded as MP3.',
  },
  fluid: {
    name: 'FluidR3 GM SoundFont, rendered to MP3 by midi-js-soundfonts',
    author: 'Frank Wen (FluidR3 GM); Benjamin Gleitzman (midi-js-soundfonts)',
    license: 'CC BY 3.0 (as stated by the midi-js-soundfonts distribution)',
    licenseUrl: 'https://creativecommons.org/licenses/by/3.0/',
    url: 'https://github.com/gleitz/midi-js-soundfonts (FluidR3_GM)',
    notice:
      'Attribution required: FluidR3 GM SoundFont by Frank Wen, via midi-js-soundfonts by Benjamin Gleitzman. ' +
      'Samples were trimmed, converted to mono and re-encoded as MP3.',
  },
};

const salamander = (list) => list.map(([file, midi]) => ({ midi, url: SALAMANDER + file }));
const vsco = (dir, list) => list.map(([file, midi]) => ({ midi, url: vscoUrl(`${dir}/${file}`) }));
const fluid = (dir, list) => list.map(([file, midi]) => ({ midi, url: `${FLUID}${dir}/${file}` }));

/**
 * maxSec/fadeSec: kept length and fade-out; rmsDb: loudness target measured over the first 3 s;
 * kbps: MP3 bitrate (mono); tune: false keeps the original tuning; skipAttack: drop the slow bow/breath
 * onset so short notes sound at full level (the sampler's fade-in supplies the attack); role: what the
 * set is for.
 */
const SETS = [
  {
    id: 'piano',
    tune: false,
    role: 'Melody "piano" and "piano" chord sound',
    source: 'salamander',
    maxSec: 6.5,
    fadeSec: 1.2,
    rmsDb: -21,
    kbps: 80,
    notes: salamander([
      ['A2.mp3', 45],
      ['C3.mp3', 48],
      ['Ds3.mp3', 51],
      ['Fs3.mp3', 54],
      ['A3.mp3', 57],
      ['C4.mp3', 60],
      ['Ds4.mp3', 63],
      ['Fs4.mp3', 66],
      ['A4.mp3', 69],
      ['C5.mp3', 72],
      ['Ds5.mp3', 75],
      ['Fs5.mp3', 78],
      ['A5.mp3', 81],
      ['C6.mp3', 84],
      ['Ds6.mp3', 87],
      ['Fs6.mp3', 90],
    ]),
  },
  {
    id: 'violin',
    skipAttack: true,
    role: 'Melody "strings" (solo violin, arco with vibrato, piano dynamic)',
    source: 'vsco',
    maxSec: 5,
    fadeSec: 1.1,
    rmsDb: -21,
    kbps: 96,
    notes: vsco('Strings/Solo Violin/Arco Vib', [
      ['LLVln_ArcoVib_G3_p.wav', 55],
      ['LLVln_ArcoVib_C4_p.wav', 60],
      ['LLVln_ArcoVib_E4_p.wav', 64],
      ['LLVln_ArcoVib_G4_p.wav', 67],
      ['LLVln_ArcoVib_C5_p.wav', 72],
      ['LLVln_ArcoVib_E5_p.wav', 76],
      ['LLVln_ArcoVib_G5_p.wav', 79],
      ['LLVln_ArcoVib_C6_p.wav', 84],
      ['LLVln_ArcoVib_E6_p.wav', 88],
      ['LLVln_ArcoVib_G6_p.wav', 91],
    ]),
  },
  {
    id: 'flute',
    skipAttack: true,
    role: 'Melody "flute" (concert flute, sustained with light vibrato)',
    source: 'vsco',
    maxSec: 4.6,
    fadeSec: 1,
    rmsDb: -22,
    kbps: 96,
    notes: vsco('Woodwinds/Flute/susvib', [
      ['LDFlute_susvib_C3_v1_1.wav', 60],
      ['LDFlute_susvib_E3_v1_1.wav', 64],
      ['LDFlute_susvib_A3_v1_1.wav', 69],
      ['LDFlute_susvib_C4_v1_1.wav', 72],
      ['LDFlute_susvib_E4_v1_1.wav', 76],
      ['LDFlute_susvib_A4_v1_1.wav', 81],
      ['LDFlute_susvib_C5_v1_1.wav', 84],
      ['LDFlute_susvib_E5_v1_1.wav', 88],
      ['LDFlute_susvib_A5_v1_1.wav', 93],
    ]),
  },
  {
    id: 'harp',
    role: 'Melody "harp"',
    source: 'vsco',
    maxSec: 5,
    fadeSec: 1.3,
    rmsDb: -22,
    kbps: 80,
    notes: vsco('Strings/Harp', [
      ['KSHarp_E3_mf.wav', 52],
      ['KSHarp_G3_mf.wav', 55],
      ['KSHarp_B3_mf.wav', 59],
      ['KSHarp_D4_mf.wav', 62],
      ['KSHarp_F4_mf.wav', 65],
      ['KSHarp_A4_mf.wav', 69],
      ['KSHarp_C5_mf.wav', 72],
      ['KSHarp_E5_mf.wav', 76],
      ['KSHarp_G5_mf.wav', 79],
      ['KSHarp_B5_mf.wav', 83],
      ['KSHarp_D6_mf.wav', 86],
      ['KSHarp_F6_mf.wav', 89],
    ]),
  },
  {
    id: 'musicbox',
    tune: false,
    role: 'Melody "musicbox"',
    source: 'fluid',
    maxSec: 3.4,
    fadeSec: 0.8,
    rmsDb: -24,
    kbps: 80,
    notes: fluid('music_box-mp3', [
      ['G3.mp3', 55],
      ['B3.mp3', 59],
      ['D4.mp3', 62],
      ['Gb4.mp3', 66],
      ['A4.mp3', 69],
      ['Db5.mp3', 73],
      ['E5.mp3', 76],
      ['Ab5.mp3', 80],
      ['B5.mp3', 83],
      ['D6.mp3', 86],
      ['Gb6.mp3', 90],
    ]),
  },
  {
    id: 'cello',
    skipAttack: true,
    role: 'Ground bass (cello section, sustained with vibrato)',
    source: 'vsco',
    maxSec: 6,
    fadeSec: 1.2,
    rmsDb: -20,
    kbps: 96,
    notes: vsco('Strings/Cello Section/susvib', [
      ['susvib_C1_v1_1.wav', 36],
      ['susvib_E1_v1_1.wav', 40],
      ['susvib_G1_v1_1.wav', 43],
      ['susvib_B1_v1_1.wav', 47],
      ['susvib_D2_v1_1.wav', 50],
      ['susvib_F2_v1_1.wav', 53],
      ['susvib_A2_v1_1.wav', 57],
    ]),
  },
  {
    id: 'pad',
    skipAttack: true,
    role: 'Pad (viola section, sustained with vibrato)',
    source: 'vsco',
    maxSec: 7,
    fadeSec: 1.6,
    rmsDb: -22,
    kbps: 96,
    notes: vsco('Strings/Viola Section/susvib', [
      ['ViolaEns_susvib_C2_v1_1.wav', 48],
      ['ViolaEns_susvib_E2_v1_1.wav', 52],
      ['ViolaEns_susvib_G2_v1_1.wav', 55],
      ['ViolaEns_susvib_B2_v1_1.wav', 59],
      ['ViolaEns_susvib_D3_v1_1.wav', 62],
      ['ViolaEns_susvib_F3_v1_1.wav', 65],
      ['ViolaEns_susvib_A3_v1_1.wav', 69],
      ['ViolaEns_susvib_C4_v1_1.wav', 72],
      ['ViolaEns_susvib_E4_v1_1.wav', 76],
      ['ViolaEns_susvib_G4_v1_1.wav', 79],
    ]),
  },
  {
    id: 'pizz',
    role: 'Pizzicato strings (viola section pizzicato)',
    source: 'vsco',
    maxSec: 1.8,
    fadeSec: 0.5,
    rmsDb: -24,
    kbps: 80,
    notes: vsco('Strings/Viola Section/pizz', [
      ['ViolaEns_pizz_C2_v1_rr1.wav', 48],
      ['ViolaEns_pizz_E2_v1_rr1.wav', 52],
      ['ViolaEns_pizz_G2_v1_rr1.wav', 55],
      ['ViolaEns_pizz_B2_v1_rr1.wav', 59],
      ['ViolaEns_pizz_D3_v1_rr1.wav', 62],
      ['ViolaEns_pizz_F3_v1_rr1.wav', 65],
      ['ViolaEns_pizz_A3_v1_rr1.wav', 69],
      ['ViolaEns_pizz_C4_v1_rr1.wav', 72],
      ['ViolaEns_pizz_E4_v1_rr1.wav', 76],
    ]),
  },
  {
    id: 'harpsichord',
    tune: false,
    role: '"Harpsichord" chord sound',
    source: 'fluid',
    maxSec: 3,
    fadeSec: 0.7,
    rmsDb: -23,
    kbps: 80,
    notes: fluid('harpsichord-mp3', [
      ['A2.mp3', 45],
      ['C3.mp3', 48],
      ['Eb3.mp3', 51],
      ['Gb3.mp3', 54],
      ['A3.mp3', 57],
      ['C4.mp3', 60],
      ['Eb4.mp3', 63],
      ['Gb4.mp3', 66],
      ['A4.mp3', 69],
      ['C5.mp3', 72],
      ['Eb5.mp3', 75],
      ['Gb5.mp3', 78],
      ['A5.mp3', 81],
    ]),
  },
];

/* ---------------------------------------------------------------- helpers */

async function download(url, dest, force) {
  if (!force && existsSync(dest) && (await stat(dest)).size > 0) return;
  await mkdir(path.dirname(dest), { recursive: true });
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
      return;
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  throw new Error(`download failed: ${url} (${lastError})`);
}

async function ffmpeg(argv, binary = 'ffmpeg') {
  return run(binary, ['-v', 'error', ...argv], { encoding: 'buffer', maxBuffer: 1 << 29 });
}

/** Decodes to mono float32 at `rate` (optionally applying an ffmpeg filter chain first). */
async function decode(file, rate = SR, filter) {
  const argv = ['-i', file, '-ac', '1', '-ar', String(rate)];
  if (filter) argv.push('-af', filter);
  argv.push('-f', 'f32le', '-');
  const { stdout } = await ffmpeg(argv);
  return new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
}

const db = (x) => 20 * Math.log10(Math.max(x, 1e-9));

/** YIN pitch (MIDI, fractional) of one window, or null. */
function yin(x, start, rate, size = 4096) {
  const minLag = Math.floor(rate / 2200);
  const maxLag = Math.floor(rate / 28);
  if (start + size + maxLag >= x.length) return null;
  const d = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < size; i++) {
      const diff = x[start + i] - x[start + i + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }
  const cm = new Float64Array(maxLag + 1);
  cm[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    cm[tau] = (d[tau] * tau) / (running || 1);
  }
  let best = -1;
  for (let tau = minLag; tau < maxLag; tau++) {
    if (cm[tau] < 0.12) {
      while (tau + 1 < maxLag && cm[tau + 1] < cm[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 1) return null;
  const a = cm[best - 1];
  const b = cm[best];
  const c = cm[best + 1];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return 69 + 12 * Math.log2(rate / (best + shift) / 440);
}

/** Offset in cents; low plucked notes with a weak fundamental may read an octave high. */
function centsOff(measured, expected) {
  let d = measured - expected;
  if (expected < 56) for (const k of [12, 24]) if (Math.abs(d - k) < 0.6) d -= k;
  return d * 100;
}

/** Median pitch (fractional MIDI) of the settled part of a note, or null when nothing pitched is found. */
async function medianPitch(file) {
  const rate = 22050;
  const x = await decode(file, rate);
  const collect = (times) =>
    times.map((t) => yin(x, Math.floor(t * rate), rate, 2048)).filter((p) => p !== null);
  let found = collect([0.35, 0.5, 0.7, 1, 1.4, 1.9, 2.5]);
  if (found.length < 3) found = found.concat(collect([0.04, 0.08, 0.12, 0.18, 0.25]));
  if (found.length < 2) return null;
  found.sort((p, q) => p - q);
  return found[Math.floor(found.length / 2)];
}

/** Seconds until a bowed or blown note reaches its sustained level (see `skipAttack`). */
function sustainStart(x, rate) {
  const hop = Math.floor(rate * 0.01);
  const win = Math.floor(rate * 0.04);
  const env = [];
  for (let i = 0; i + win < x.length && env.length < 200; i += hop) {
    let sum = 0;
    for (let n = 0; n < win; n++) sum += x[i + n] * x[i + n];
    env.push(Math.sqrt(sum / win));
  }
  const settled = env.slice(50, Math.min(env.length, 200)).sort((a, b) => a - b);
  if (settled.length === 0) return 0;
  const reference = settled[Math.floor(settled.length * 0.85)];
  const first = env.findIndex((e) => e >= 0.75 * reference);
  return Math.min(Math.max(first * 0.01 - 0.02, 0), 0.7);
}

/* ---------------------------------------------------------------- conversion */

async function convertNote(set, note, raw, dest) {
  // 1. tuning: nudge samples that are more than 10 cents off towards the nearest exact pitch.
  const measured = await medianPitch(raw);
  let cents = measured === null ? 0 : centsOff(measured, note.midi);
  if (measured !== null && Math.abs(cents) > 60) {
    throw new Error(
      `${set.id}/${noteName(note.midi)}: source sounds ${measured.toFixed(2)}, expected ${note.midi}`,
    );
  }
  // Pianos are stretch-tuned and GM bells are inharmonic, so their YIN reading is not a tuning error.
  if (Math.abs(cents) < 10 || set.tune === false) cents = 0;
  const ratio = 2 ** (-cents / 1200);
  const tune = cents === 0 ? '' : `asetrate=${(SR * ratio).toFixed(2)},aresample=${SR},`;
  const lead = `aresample=${SR},${tune}silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.004`;
  const start = set.skipAttack ? sustainStart(await decode(raw, 22050, lead), 22050) : 0;
  const head = `${lead},atrim=start=${start.toFixed(3)}:end=${(start + set.maxSec).toFixed(3)},asetpts=PTS-STARTPTS`;

  // 2. level: match the RMS of the first 3 s to the set target without pushing peaks above -1.5 dBFS.
  const pcm = await decode(raw, SR, head);
  const win = Math.min(pcm.length, 3 * SR);
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (i < win) sum += pcm[i] * pcm[i];
    peak = Math.max(peak, Math.abs(pcm[i]));
  }
  const rms = Math.sqrt(sum / Math.max(win, 1));
  const gain = Math.min(set.rmsDb - db(rms), -1.5 - db(peak));
  const seconds = pcm.length / SR;
  const fade = Math.min(set.fadeSec, seconds / 2);
  const fadeStart = seconds - fade;
  const filter = `${head},volume=${gain.toFixed(2)}dB,afade=t=in:d=0.008,afade=t=out:st=${fadeStart.toFixed(3)}:d=${fade.toFixed(3)}:curve=qsin`;

  await mkdir(path.dirname(dest), { recursive: true });
  await ffmpeg([
    '-y',
    '-i',
    raw,
    '-af',
    filter,
    '-ac',
    '1',
    '-ar',
    String(SR),
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${set.kbps}k`,
    '-id3v2_version',
    '0',
    dest,
  ]);
  return { seconds, gain, cents, start, rmsDb: db(rms) };
}

async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    }),
  );
  return results;
}

/* ---------------------------------------------------------------- outputs */

/** Formats generated source with the repository's Prettier settings (returned unchanged when unavailable). */
async function formatSource(file, text) {
  try {
    const prettier = await import('prettier');
    const options = (await prettier.resolveConfig(file)) ?? {};
    return await prettier.format(text, { ...options, filepath: file });
  } catch {
    return text;
  }
}

function creditsMarkdown() {
  const used = new Set(SETS.map((s) => s.source));
  const lines = [
    '# Sample credits',
    '',
    'The MP3 files in this directory are derived from the freely licensed sample libraries below.',
    'They were trimmed, level-matched, converted to mono and re-encoded as MP3 by',
    '`scripts/samples/fetch-samples.mjs` (run it to regenerate this directory and this file).',
    'All licenses permit commercial use. Drums, ambience, vinyl crackle and all fallback voices are',
    'synthesised in code and use no samples.',
    '',
  ];
  for (const key of used) {
    const l = LICENSES[key];
    lines.push(`## ${l.name}`, '');
    lines.push(`- Author: ${l.author}`);
    lines.push(`- Source: ${l.url}`);
    lines.push(`- License: ${l.license} — ${l.licenseUrl}`);
    lines.push(`- Notice: ${l.notice}`, '');
    lines.push('| Folder | Used for | Files | Original files |', '| --- | --- | --- | --- |');
    for (const set of SETS.filter((s) => s.source === key)) {
      const first = set.notes[0].url;
      const dir = decodeURIComponent(first.slice(0, first.lastIndexOf('/') + 1));
      lines.push(
        `| \`${set.id}/\` | ${set.role} | ${set.notes.length} | ${dir.replace(VSCO, '').replace(FLUID, 'FluidR3_GM/').replace(SALAMANDER, 'salamander/')} |`,
      );
    }
    lines.push('');
  }
  lines.push(
    '## Not a sample license issue',
    '',
    "Pachelbel's Canon in D is in the public domain; only the sound recordings above carry licenses.",
    '',
  );
  return lines.join('\n');
}

function manifestTs(entries) {
  const out = [
    '/* Generated by scripts/samples/fetch-samples.mjs — do not edit by hand. */',
    '',
    'export interface SampleFile {',
    '  /** Sounding pitch as a MIDI note number. */',
    '  midi: number;',
    '  /** Path below public/samples/. */',
    '  file: string;',
    '  bytes: number;',
    '}',
    '',
    `export type SampleSetId = ${SETS.map((s) => `'${s.id}'`).join(' | ')};`,
    '',
    'export const SAMPLE_SETS: Record<SampleSetId, readonly SampleFile[]> = {',
  ];
  for (const set of SETS) {
    out.push(`  ${set.id}: [`);
    for (const e of entries[set.id]) {
      out.push(`    { midi: ${e.midi}, file: '${e.file}', bytes: ${e.bytes} },`);
    }
    out.push('  ],');
  }
  out.push('};', '');
  return out.join('\n');
}

/* ---------------------------------------------------------------- main */

async function main() {
  const entries = {};
  const report = [];
  let totalBytes = 0;
  let failed = false;

  for (const set of SETS) {
    const selected = !only || only.has(set.id);
    entries[set.id] = [];
    const jobs = set.notes.map((note) => ({
      note,
      raw: path.join(
        CACHE_DIR,
        set.source,
        decodeURIComponent(note.url.split('/').slice(-1)[0]).replace(/[#/\s]/g, '_') + `.${set.id}`,
      ),
      rel: `${set.id}/${noteName(note.midi)}.mp3`,
    }));
    if (selected && !flag('check')) {
      console.log(`\n== ${set.id}: ${set.notes.length} notes`);
      await pool(jobs, 6, (job) => download(job.note.url, job.raw, flag('force')));
      await pool(jobs, 3, async (job) => {
        const dest = path.join(OUT_DIR, job.rel);
        const r = await convertNote(set, job.note, job.raw, dest);
        console.log(
          `  ${noteName(job.note.midi).padEnd(4)} ${r.seconds.toFixed(2)}s  src ${r.rmsDb.toFixed(1)} dB -> ${set.rmsDb} dB (gain ${r.gain.toFixed(1)})  tune ${r.cents.toFixed(0)}c  skip ${r.start.toFixed(2)}s`,
        );
      });
    }
    for (const job of jobs) {
      const dest = path.join(OUT_DIR, job.rel);
      if (!existsSync(dest)) {
        console.error(`missing output ${job.rel}`);
        failed = true;
        continue;
      }
      const bytes = (await stat(dest)).size;
      totalBytes += bytes;
      entries[set.id].push({ midi: job.note.midi, file: job.rel, bytes });
      if (flag('check') || selected) {
        const p = await medianPitch(dest);
        const off = p === null ? NaN : centsOff(p, job.note.midi);
        if (p === null || Math.abs(off) > 45) {
          console.error(
            `  PITCH ${job.rel}: detected ${p === null ? 'nothing' : p.toFixed(2)}, expected ${job.note.midi}`,
          );
          failed = true;
        }
        report.push({ file: job.rel, off });
      }
    }
  }

  if (!flag('check')) {
    await writeFile(path.join(OUT_DIR, 'CREDITS.md'), creditsMarkdown());
    await writeFile(MANIFEST_TS, await formatSource(MANIFEST_TS, manifestTs(entries)));
  }
  const worst = report.reduce(
    (m, r) => (Number.isNaN(r.off) ? m : Math.max(m, Math.abs(r.off))),
    0,
  );
  console.log(`\n${report.length} files checked, worst pitch offset ${worst.toFixed(0)} cents`);
  console.log(`total ${(totalBytes / 1e6).toFixed(2)} MB in ${OUT_DIR}`);
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
