import type { StageId } from '../types';
import { CHORDS_PER_CYCLE, TICKS_PER_CHORD, TICKS_PER_CYCLE } from './constants';
import { matchesOriginal } from './pachelbel';
import type { Rng } from './random';
import { checkPhrase } from './rules';
import { STAGES, type ContourType, type FigureType, type StageDef } from './stages';
import { degreeToSemitones, type Key, mod } from './theory';

export interface PhraseNote {
  tick: number;
  dur: number;
  /** Scale degree relative to the key's melody reference tonic (0 = tonic, 7 = octave above). */
  deg: number;
  vel: number;
  gate: number;
  /** Chord window 0..7. */
  chord: number;
  orn?: boolean;
}

export interface Phrase {
  cycle: number;
  stage: StageId;
  key: Key;
  notes: PhraseNote[];
  /** Chord-tone degrees (mod 7) of each window at composition time. */
  chordDegrees: number[][];
  lo: number;
  hi: number;
  quote: boolean;
  plan: string;
}

export interface QuoteRequest {
  line: readonly number[];
  /** Quote only the first half, then continue freely. */
  partial: boolean;
}

/** Marker for "no note sounding" in strict-mode pitch timelines. */
export const SILENT = -999;
/** Resolution (ticks) of strict-mode pitch timelines. */
export const TIMELINE_SLOT = 6;

export interface MelodyRequest {
  cycle: number;
  rng: Rng;
  stage: StageId;
  /** Previous stage, on the first cycle of a new stage (its figures are borrowed for a smooth handover). */
  handoverFrom: StageId | null;
  busyness: number;
  key: Key;
  chordDegrees: number[][];
  lo: number;
  hi: number;
  /** Degree nearest the middle of the melody range. */
  center: number;
  /** Final note of the previous phrase, as a degree of this key. */
  prevEnd: number | null;
  /** Direction of a leap into the previous phrase's final note (0 = none). */
  prevLeap: number;
  /** Semitones (above the melody reference) of voices sounding against this phrase, per TIMELINE_SLOT. */
  others: readonly Int16Array[];
  strict: boolean;
  quote: QuoteRequest | null;
}

interface Motif {
  cell: readonly number[];
  figure: FigureType;
  dir: number;
  intervals: number[];
}

const ORNAMENT_UNIT = 6;
const PARALLEL_COST = 12;

/**
 * Composes one two-bar phrase (one pass of the eight-chord loop):
 *  1. choose a motif (rhythm cell + melodic figure) and a development plan;
 *  2. pick a skeleton of chord tones on the strong beats (smooth, contour-shaped, cadencing);
 *  3. fill each chord window with the motif, solved as a small constraint problem so weak beats
 *     are chord, passing or neighbour tones and leaps step back;
 *  4. add ornaments and dynamics.
 * Every result passes checkPhrase() and never copies an original Pachelbel phrase exactly.
 */
export function generatePhrase(req: MelodyRequest): Phrase {
  for (let attempt = 0; attempt < 6; attempt++) {
    const rng = attempt === 0 ? req.rng : req.rng.fork(`retry${attempt}`);
    const phrase = compose(req, rng, attempt >= 3);
    if (phrase && checkPhrase(phrase).length === 0 && !matchesOriginal(phrase)) return phrase;
  }
  return fallbackPhrase(req);
}

function compose(req: MelodyRequest, rng: Rng, simple: boolean): Phrase | null {
  const stage = STAGES[req.stage];
  const plan = simple
    ? 'sequence'
    : rng.weighted(['sequence', 'aabb', 'abab', 'aaab'] as const, [4, 2.5, 1.5, 2]);
  const a = makeMotif(stage, req.busyness, rng, simple);
  const b = simple
    ? a
    : rng.chance(0.55)
      ? transformMotif(a, rng)
      : makeMotif(stage, req.busyness, rng, false);
  const motifs: Motif[] = [];
  for (let i = 0; i < CHORDS_PER_CYCLE; i++) {
    const useB =
      plan === 'aabb' ? i >= 4 : plan === 'abab' ? i % 2 === 1 : plan === 'aaab' ? i >= 6 : false;
    motifs.push(useB ? b : a);
  }
  if (req.handoverFrom && !simple) {
    const borrowed = makeMotif(STAGES[req.handoverFrom], req.busyness, rng, false);
    if (rng.chance(0.75)) motifs[0] = borrowed;
    if (rng.chance(0.4)) motifs[1] = borrowed;
  }

  const cells = motifs.map((m) => m.cell);
  if (req.quote) {
    // A quoted line must be heard on every strong beat it covers.
    for (let i = 0; i < (req.quote.partial ? 4 : 7); i++) {
      if (cells[i].some((d) => d < 0)) cells[i] = [48, 48];
    }
  }
  cells[7] = cadentialCell(cells[7], req.quote !== null);
  const intervals = motifs.map((m, i) =>
    i === 7 ? figureIntervals(m.figure, noteCount(cells[7]), m.dir, rng) : m.intervals,
  );

  const skeleton = chooseSkeleton(req, cells, stage, rng);
  if (!skeleton) return null;
  const cadence = noteCount(cells[7]) === 1 ? skeleton.path[7] : cadenceNote(skeleton.path[7], req);
  if (cadence === null) return null;

  const ctx = windowContext(req);
  const notes: PhraseNote[] = [];
  let before: number | null = null;
  for (let i = 0; i < CHORDS_PER_CYCLE; i++) {
    const cell = cells[i];
    const t0 = i * TICKS_PER_CHORD;
    const durs = cell.filter((d) => d > 0);
    const spec: WindowSpec = {
      tick0: t0 + (cell[0] < 0 ? -cell[0] : 0),
      durs,
      start: skeleton.path[i],
      target: i < 7 ? skeleton.path[i + 1] : null,
      final: i === 7 ? cadence : null,
      intervals: intervals[i],
      tones: req.chordDegrees[i],
      before: cell[0] < 0 ? null : before,
    };
    // Strict mode forbids parallels outright, and only tolerates them when nothing else fits.
    const degs =
      (ctx.strict ? realizeWindow(spec, { ...ctx, forbidParallels: true }, rng) : null) ??
      realizeWindow(spec, ctx, rng);
    if (!degs) return null;
    let t = t0;
    let k = 0;
    for (const d of cell) {
      if (d < 0) {
        t -= d;
        before = null;
        continue;
      }
      notes.push({ tick: t, dur: d, deg: degs[k], vel: 0, gate: stage.gate, chord: i });
      before = degs[k];
      k++;
      t += d;
    }
  }

  shapeDynamics(notes, stage, rng);
  return {
    cycle: req.cycle,
    stage: req.stage,
    key: req.key,
    notes: ornament(notes, stage, req.lo, req.hi, rng),
    chordDegrees: req.chordDegrees,
    lo: req.lo,
    hi: req.hi,
    quote: skeleton.quoted,
    plan: `${plan}:${a.figure}/${b.figure}`,
  };
}

// ---------------------------------------------------------------------------------------------
// Motifs

export function noteCount(cell: readonly number[]): number {
  let n = 0;
  for (const d of cell) if (d > 0) n++;
  return n;
}

function pickCell(stage: StageDef, busyness: number, rng: Rng): readonly number[] {
  const counts = stage.rhythms.map((r) => noteCount(r.durs));
  const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
  const weights = stage.rhythms.map(
    (r, i) => r.w * Math.exp((2.2 * (busyness - 0.5) * (counts[i] - mean)) / Math.max(1, mean)),
  );
  return rng.weighted(stage.rhythms, weights).durs;
}

function makeMotif(stage: StageDef, busyness: number, rng: Rng, simple: boolean): Motif {
  const cell = pickCell(stage, busyness, rng);
  const figure: FigureType = simple ? 'step' : rng.weightedKey(stage.figures);
  // A slight preference for falling lines, like Pachelbel's.
  const dir = rng.chance(0.55) ? -1 : 1;
  const intervals = figureIntervals(figure, noteCount(cell), dir, rng);
  if (!simple && intervals.length > 1 && rng.chance(0.25)) {
    const k = rng.int(0, intervals.length - 1);
    const tweak = intervals[k] + (rng.chance(0.5) ? 1 : -1);
    if (Math.abs(tweak) <= 2) intervals[k] = tweak;
  }
  return { cell, figure, dir, intervals };
}

function transformMotif(m: Motif, rng: Rng): Motif {
  const kind = rng.weighted(['invert', 'retrograde', 'vary'] as const, [3, 1.5, 2]);
  if (kind === 'invert') return { ...m, dir: -m.dir, intervals: m.intervals.map((x) => -x) };
  if (kind === 'retrograde') return { ...m, intervals: [...m.intervals].reverse().map((x) => -x) };
  const intervals = [...m.intervals];
  if (intervals.length > 0) {
    const k = rng.int(0, intervals.length - 1);
    const tweak = intervals[k] + (rng.chance(0.5) ? 1 : -1);
    if (Math.abs(tweak) <= 2) intervals[k] = tweak;
  }
  return { ...m, intervals };
}

/** Target intervals (in scale steps) between the notes of one window. */
export function figureIntervals(figure: FigureType, m: number, dir: number, rng: Rng): number[] {
  const n = Math.max(0, m - 1);
  const cyc = (pattern: number[]) =>
    Array.from({ length: n }, (_, k) => pattern[k % pattern.length]);
  switch (figure) {
    case 'hold':
      return cyc([0]);
    case 'step':
      return cyc([dir]);
    case 'run': {
      const turn = n > 4 ? Math.floor(n * 0.6) : n;
      return Array.from({ length: n }, (_, k) => (k < turn ? dir : -dir));
    }
    case 'neighbor':
      return cyc([dir, -dir]);
    case 'arpeggio':
      return cyc([2 * dir, 2 * dir, -dir]);
    case 'turn':
      return cyc([dir, -dir, -dir, dir]);
    case 'leap': {
      const out = cyc([-dir]);
      if (n > 0) out[0] = (rng.chance(0.5) ? 3 : 4) * dir;
      return out;
    }
    case 'zigzag':
      return cyc([2 * dir, -dir]);
    case 'pedal':
      return cyc([2 * dir, -2 * dir]);
  }
}

/** The last window ends on a note long enough to feel like an ending. */
function cadentialCell(cell: readonly number[], needTwo: boolean): number[] {
  const count = noteCount(cell);
  const last = cell[cell.length - 1];
  if (last >= 48 && (!needTwo || count >= 2)) return [...cell];
  if (count === 1 && needTwo) return [48, 48];
  const out: number[] = [];
  let t = 0;
  for (const d of cell) {
    if (t + Math.abs(d) > 48) break;
    out.push(d);
    t += Math.abs(d);
  }
  out.push(TICKS_PER_CHORD - t);
  return out.some((d) => d > 0) ? out : [TICKS_PER_CHORD];
}

// ---------------------------------------------------------------------------------------------
// Skeleton: one chord tone per strong beat

function contourShape(type: ContourType, x: number, phase: number): number {
  switch (type) {
    case 'descending':
      return 1 - 2 * x;
    case 'ascending':
      return 2 * x - 1;
    case 'arch':
      return 2 * Math.sin(Math.PI * x) - 1;
    case 'valley':
      return 1 - 2 * Math.sin(Math.PI * x);
    case 'wave':
      return Math.sin(2 * Math.PI * x + phase);
    case 'plateau':
      return 0.25 * Math.sin(2 * Math.PI * x + phase);
  }
}

/** Places a famous line (given in D-major degrees from D4) in this key's range, or null. */
function placeQuote(line: readonly number[], req: MelodyRequest): number[] | null {
  let best: number[] | null = null;
  let bestDist = Infinity;
  for (const shift of [0, -7, 7]) {
    const placed = line.map((d) => d + shift);
    if (placed.some((d) => d < req.lo || d > req.hi)) continue;
    const mean = placed.reduce((s, d) => s + d, 0) / placed.length;
    if (Math.abs(mean - req.center) < bestDist) {
      bestDist = Math.abs(mean - req.center);
      best = placed;
    }
  }
  return best;
}

function chooseSkeleton(
  req: MelodyRequest,
  cells: readonly (readonly number[])[],
  stage: StageDef,
  rng: Rng,
): { path: number[]; quoted: boolean } | null {
  const counts = cells.map(noteCount);
  const contour = rng.weightedKey(stage.contours);
  const amp = rng.range(stage.amp[0], stage.amp[1]);
  const center = req.center + stage.lift + rng.int(-1, 1);
  const phase = rng.range(0, Math.PI * 2);
  const quoteLine = req.quote ? placeQuote(req.quote.line, req) : null;
  let quoted = quoteLine !== null;

  const cands: number[][] = [];
  for (let i = 0; i < CHORDS_PER_CYCLE; i++) {
    const tones = req.chordDegrees[i];
    let list: number[] = [];
    for (let d = req.lo; d <= req.hi; d++) if (tones.includes(mod(d, 7))) list.push(d);
    if (i === 7) {
      // The final window must be able to reach a stable ending (5th degree) smoothly.
      const root = req.chordDegrees[7][0];
      const allowed = counts[7] === 1 ? [root] : counts[7] <= 3 ? [root, mod(root + 2, 7)] : null;
      if (allowed) list = list.filter((d) => allowed.includes(mod(d, 7)));
    }
    if (quoteLine && (i < 4 || !req.quote?.partial)) {
      if (list.includes(quoteLine[i])) list = [quoteLine[i]];
      else quoted = false;
    }
    if (list.length === 0) return null;
    cands.push(list);
  }

  // Strict mode keeps strong beats apart from the other voices, so their approaches can't be parallel.
  const strongBeatClash = (i: number, d: number) => {
    if (!req.strict) return 0;
    const slot = (i * TICKS_PER_CHORD) / TIMELINE_SLOT;
    const semis = degreeToSemitones(d, req.key.mode);
    let c = 0;
    for (const other of req.others) {
      const o = other[slot];
      if (o === SILENT) continue;
      const iv = mod(semis - o, 12);
      c += iv === 0 ? 2.5 : iv === 7 || iv === 5 ? 0.8 : 0;
    }
    return c;
  };
  const unary = (i: number, d: number) =>
    0.32 * Math.abs(d - (center + amp * contourShape(contour, i / 7, phase))) +
    rng.next() * 0.7 +
    (d === req.lo || d === req.hi ? 0.4 : 0) +
    strongBeatClash(i, d);
  const startCost = (d: number) => {
    if (req.prevEnd === null) return 0;
    const delta = d - req.prevEnd;
    const size = Math.abs(delta);
    let c = [0.7, 0, 0.3, 1.2, 2, 2.8, 3.6, 4.4][Math.min(size, 7)] + Math.max(0, size - 7);
    if (req.prevLeap !== 0 && (Math.sign(delta) === req.prevLeap || size > 2)) c += 3;
    return c;
  };
  const transition = (i: number, p: number, d: number) => {
    const size = Math.abs(d - p);
    // A single-note window makes the skeleton move a heard interval: keep it a step or a third.
    if (counts[i] === 1 ? size >= 3 : size > 6) return Infinity;
    let c = [1.1, 0, 0.45, 1.3, 2.1, 3, 4][size];
    if (req.strict && counts[i] === 1) {
      const mode = req.key.mode;
      c += parallelPenalty(
        req.others,
        degreeToSemitones(p, mode),
        degreeToSemitones(d, mode),
        i * TICKS_PER_CHORD,
        (i + 1) * TICKS_PER_CHORD,
      );
    }
    return c;
  };

  let cost = cands[0].map((d) => unary(0, d) + startCost(d));
  const back: number[][] = [];
  for (let i = 1; i < CHORDS_PER_CYCLE; i++) {
    const next: number[] = [];
    const bp: number[] = [];
    for (const d of cands[i]) {
      let best = Infinity;
      let arg = -1;
      cands[i - 1].forEach((p, j) => {
        const c = cost[j] + transition(i - 1, p, d);
        if (c < best) {
          best = c;
          arg = j;
        }
      });
      next.push(best + unary(i, d));
      bp.push(arg);
    }
    cost = next;
    back.push(bp);
  }
  let bestJ = -1;
  let best = Infinity;
  cost.forEach((c, j) => {
    if (c < best) {
      best = c;
      bestJ = j;
    }
  });
  if (!Number.isFinite(best)) return null;
  const path = new Array<number>(CHORDS_PER_CYCLE);
  path[7] = cands[7][bestJ];
  for (let i = 7; i >= 1; i--) {
    bestJ = back[i - 1][bestJ];
    path[i - 1] = cands[i - 1][bestJ];
  }
  return { path, quoted };
}

/** Nearest stable ending (root of the final chord — normally the key's 5th) to the last skeleton note. */
function cadenceNote(last: number, req: MelodyRequest): number | null {
  const root = req.chordDegrees[7][0];
  let best: number | null = null;
  for (let d = req.lo; d <= req.hi; d++) {
    if (mod(d, 7) !== root) continue;
    if (
      best === null ||
      Math.abs(d - last) < Math.abs(best - last) ||
      (Math.abs(d - last) === Math.abs(best - last) &&
        Math.abs(d - req.center) < Math.abs(best - req.center))
    ) {
      best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Figuration: a DP over (previous note, current note) states

interface WindowSpec {
  tick0: number;
  durs: readonly number[];
  start: number;
  /** First note of the next window (approached by step or third), or null in the last window. */
  target: number | null;
  /** Fixed final note of the phrase (last window only). */
  final: number | null;
  intervals: readonly number[];
  tones: readonly number[];
  /** Note sounding right before `start`, when joined to it. */
  before: number | null;
}

interface WindowContext {
  lo: number;
  hi: number;
  strict: boolean;
  forbidParallels: boolean;
  others: readonly Int16Array[];
  /** Semitones above the reference for each degree index (degree - lo). */
  semis: Int32Array;
}

function windowContext(req: MelodyRequest): WindowContext {
  const size = req.hi - req.lo + 1;
  const semis = new Int32Array(size);
  for (let i = 0; i < size; i++) semis[i] = degreeToSemitones(i + req.lo, req.key.mode);
  return {
    lo: req.lo,
    hi: req.hi,
    strict: req.strict,
    forbidParallels: false,
    others: req.others,
    semis,
  };
}

function parallelCost(ctx: WindowContext, bi: number, ci: number, t1: number, t2: number): number {
  const s1 = ctx.semis[bi];
  const s2 = ctx.semis[ci];
  return parallelPenalty(ctx.others, s1, s2, t1, t2);
}

/**
 * Penalty for moving s1 → s2 at tick t2 against the other voices. Consecutive simultaneities only
 * change at onsets, so the comparison is between the other voice just before t2 and at t2.
 */
function parallelPenalty(
  others: readonly Int16Array[],
  s1: number,
  s2: number,
  t1: number,
  t2: number,
): number {
  let cost = 0;
  const i1 = Math.max((t1 / TIMELINE_SLOT) | 0, ((t2 / TIMELINE_SLOT) | 0) - 1);
  const i2 = (t2 / TIMELINE_SLOT) | 0;
  for (const other of others) {
    if (i2 >= other.length) continue;
    const o1 = other[i1];
    const o2 = other[i2];
    if (o1 === SILENT || o2 === SILENT) continue;
    if (s2 === o2) cost += 0.3;
    if (o1 === o2 || s1 === s2) continue;
    const iv1 = mod(s1 - o1, 12);
    const iv2 = mod(s2 - o2, 12);
    // Parallel fifths or octaves: same perfect interval, both voices moving the same way.
    if (iv1 === iv2 && (iv1 === 0 || iv1 === 7) && Math.sign(s2 - s1) === Math.sign(o2 - o1)) {
      cost += PARALLEL_COST;
    }
  }
  return cost;
}

function realizeWindow(spec: WindowSpec, ctx: WindowContext, rng: Rng): number[] | null {
  const m = spec.durs.length;
  if (m === 1) return [spec.start];
  const { lo, hi } = ctx;
  const D = hi - lo + 1;
  const NONE = D;
  const rows = D + 1;
  const startIdx = spec.start - lo;
  if (startIdx < 0 || startIdx >= D) return null;

  const ticks: number[] = [];
  let t = spec.tick0;
  for (const d of spec.durs) {
    ticks.push(t);
    t += d;
  }
  const endTick = t;
  const tone = new Uint8Array(D);
  for (let i = 0; i < D; i++) tone[i] = spec.tones.includes(mod(i + lo, 7)) ? 1 : 0;
  const noise = new Float64Array(m * D);
  for (let i = 0; i < noise.length; i++) noise[i] = rng.next() * 0.45;

  let cost = new Float64Array(rows * D).fill(Infinity);
  const beforeIdx =
    spec.before !== null && spec.before >= lo && spec.before <= hi ? spec.before - lo : NONE;
  cost[beforeIdx * D + startIdx] = 0;
  const backs: Int16Array[] = [];

  for (let k = 0; k < m - 1; k++) {
    const next = new Float64Array(rows * D).fill(Infinity);
    const bp = new Int16Array(rows * D).fill(-1);
    const fixed = k + 1 === m - 1 && spec.final !== null ? spec.final - lo : -1;
    const want = spec.intervals[k];
    for (let ai = 0; ai < rows; ai++) {
      for (let bi = 0; bi < D; bi++) {
        const base = cost[ai * D + bi];
        if (base === Infinity) continue;
        const hasA = ai !== NONE;
        const inStep = hasA ? bi - ai : 0;
        const inSize = inStep < 0 ? -inStep : inStep;
        for (let ci = 0; ci < D; ci++) {
          if (fixed >= 0 && ci !== fixed) continue;
          const step = ci - bi;
          const size = step < 0 ? -step : step;
          if (size > 7 || size === 6) continue;
          if (size >= 3 && Math.abs(ctx.semis[ci] - ctx.semis[bi]) === 6) continue;
          if (fixed >= 0 && size > 2) continue;
          if (hasA && inSize >= 3 && (Math.sign(step) !== -Math.sign(inStep) || size > 2)) continue;
          // The note at position k (k ≥ 1) is on a weak position.
          if (k >= 1 && !tone[bi] && !(inSize === 1 && size === 1)) continue;
          let c = base + noise[(k + 1) * D + ci];
          if (want !== undefined) c += 0.9 * Math.min(3, Math.abs(step - want));
          if (size >= 3) c += 0.5 * (size - 2);
          if (size === 0 && want !== 0) c += 0.6;
          if (ctx.strict) {
            const pen = parallelCost(ctx, bi, ci, ticks[k], ticks[k + 1]);
            if (ctx.forbidParallels && pen >= PARALLEL_COST) continue;
            c += pen;
          }
          const idx = bi * D + ci;
          if (c < next[idx]) {
            next[idx] = c;
            bp[idx] = ai;
          }
        }
      }
    }
    cost = next;
    backs.push(bp);
  }

  const target = spec.target !== null ? spec.target - lo : -1;
  let best = Infinity;
  let bestA = -1;
  let bestB = -1;
  for (let ai = 0; ai < D; ai++) {
    for (let bi = 0; bi < D; bi++) {
      let c = cost[ai * D + bi];
      if (c === Infinity) continue;
      if (target >= 0) {
        const step = target - bi;
        const size = step < 0 ? -step : step;
        if (size > 2) continue;
        const inStep = bi - ai;
        const inSize = inStep < 0 ? -inStep : inStep;
        if (inSize >= 3 && (Math.sign(step) !== -Math.sign(inStep) || size === 0)) continue;
        if (!tone[bi] && !(inSize === 1 && size === 1)) continue;
        c += size === 1 ? 0 : size === 2 ? 0.3 : 0.7;
        if (ctx.strict) {
          const pen = parallelCost(ctx, bi, target, ticks[m - 1], endTick);
          if (ctx.forbidParallels && pen >= PARALLEL_COST) continue;
          c += pen;
        }
      } else if (spec.final !== null && bi !== spec.final - lo) {
        continue;
      }
      if (c < best) {
        best = c;
        bestA = ai;
        bestB = bi;
      }
    }
  }
  if (best === Infinity) return null;

  const out = new Array<number>(m);
  out[m - 1] = bestB + lo;
  out[m - 2] = bestA + lo;
  let b = bestA;
  let c = bestB;
  for (let k = m - 2; k >= 1; k--) {
    const a = backs[k][b * D + c];
    out[k - 1] = a + lo;
    c = b;
    b = a;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dynamics and ornaments

function shapeDynamics(notes: PhraseNote[], stage: StageDef, rng: Rng): void {
  for (const n of notes) {
    const arch = 0.07 * Math.sin((Math.PI * n.tick) / TICKS_PER_CYCLE);
    const accent = n.tick % TICKS_PER_CHORD === 0 ? 0.05 : n.tick % 48 === 0 ? 0.025 : 0;
    n.vel = Math.min(
      0.95,
      Math.max(0.15, stage.velocity + arch + accent + rng.range(-0.025, 0.025)),
    );
    n.gate = stage.id === 'playful' ? (n.dur <= 24 ? 0.62 : 0.85) : stage.gate;
  }
}

function ornament(
  notes: PhraseNote[],
  stage: StageDef,
  lo: number,
  hi: number,
  rng: Rng,
): PhraseNote[] {
  const out: PhraseNote[] = [];
  const u = ORNAMENT_UNIT;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const next = notes[i + 1];
    const last = i === notes.length - 1;
    const penultimate = i === notes.length - 2;
    let p = stage.ornament;
    // A cadential trill before the phrase ending is very Baroque.
    if (penultimate && n.chord === 7 && n.dur >= 48 && stage.id !== 'rest') {
      p = Math.max(p, stage.id === 'ornamented' ? 0.7 : 0.25);
    }
    if (last || n.dur < 24 || !rng.chance(p)) {
      out.push(n);
      continue;
    }
    const upper = Math.min(n.deg + 1, hi + 1);
    const kind =
      n.dur >= 48
        ? rng.weighted(['trill', 'turn', 'mordent'] as const, [penultimate ? 5 : 2, 1.5, 1.5])
        : rng.weighted(['mordent', 'grace'] as const, [1.5, 1]);
    const orn = (tick: number, dur: number, deg: number, scale: number): PhraseNote => ({
      ...n,
      tick,
      dur,
      deg,
      vel: n.vel * scale,
      gate: 0.95,
      orn: true,
    });

    if (kind === 'trill') {
      const end = n.tick + Math.floor((n.dur * 0.75) / u) * u;
      out.push({ ...n, dur: u });
      let t = n.tick + u;
      let up = true;
      while (t + u <= end) {
        out.push(orn(t, u, up ? upper : n.deg, 0.8));
        t += u;
        up = !up;
      }
      out.push(orn(t, n.tick + n.dur - t, n.deg, 0.85));
    } else if (kind === 'turn' && n.deg - 1 >= lo - 1) {
      const half = n.tick + Math.floor(n.dur / 2 / u) * u;
      out.push({ ...n, dur: half - n.tick });
      const seq = [upper, n.deg, n.deg - 1, n.deg];
      let t = half;
      seq.forEach((deg, j) => {
        out.push(orn(t, j === 3 ? n.tick + n.dur - t : u, deg, 0.8));
        t += u;
      });
    } else if (kind === 'grace' && next && next.tick === n.tick + n.dur) {
      out.push({ ...n, dur: n.dur - u });
      // Lean into the next note from the side the current note is not on (no repeated pitch).
      const grace = next.deg + 1 <= hi + 1 && next.deg + 1 !== n.deg ? next.deg + 1 : next.deg - 1;
      out.push({ ...orn(n.tick + n.dur - u, u, grace, 0.7), vel: next.vel * 0.7 });
    } else {
      out.push({ ...n, dur: u });
      out.push(orn(n.tick + u, u, upper, 0.8));
      out.push(orn(n.tick + 2 * u, n.dur - 2 * u, n.deg, 0.9));
    }
  }
  return out;
}

/** Guaranteed-valid phrase: one chord tone per chord, moving by step or third. */
function fallbackPhrase(req: MelodyRequest): Phrase {
  const rng = req.rng.fork('fallback');
  const cells = Array.from({ length: CHORDS_PER_CYCLE }, () => [TICKS_PER_CHORD]);
  const skeleton = chooseSkeleton({ ...req, quote: null }, cells, STAGES.calm, rng);
  const path =
    skeleton?.path ??
    Array.from({ length: CHORDS_PER_CYCLE }, (_, i) => {
      for (let d = req.center; d <= req.hi; d++)
        if (req.chordDegrees[i].includes(mod(d, 7))) return d;
      return req.center;
    });
  const notes: PhraseNote[] = path.map((deg, i) => ({
    tick: i * TICKS_PER_CHORD,
    dur: TICKS_PER_CHORD,
    deg,
    vel: 0,
    gate: 1,
    chord: i,
  }));
  shapeDynamics(notes, STAGES.calm, rng);
  return {
    cycle: req.cycle,
    stage: req.stage,
    key: req.key,
    notes,
    chordDegrees: req.chordDegrees,
    lo: req.lo,
    hi: req.hi,
    quote: false,
    plan: 'fallback',
  };
}
