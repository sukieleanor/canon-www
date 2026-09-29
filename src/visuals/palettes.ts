import type { Season, StageId } from '../types';

/** Colour helpers plus the chord palettes, season looks and stage looks shared by every scene. */

export type RGB = readonly [number, number, number];

export function hex(n: number): RGB {
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Packs 0..1 floats into a 0xRRGGBB tint without allocating. */
export function pack(r: number, g: number, b: number): number {
  return (
    ((clamp01(r) * 255 + 0.5) << 16) | ((clamp01(g) * 255 + 0.5) << 8) | (clamp01(b) * 255 + 0.5)
  );
}

export function packArr(c: ArrayLike<number>): number {
  return pack(c[0], c[1], c[2]);
}

export interface ChordMood {
  tint: RGB;
  /** How strongly the tint bleeds into sky and light colours. */
  amt: number;
  light: number;
  sat: number;
}

/** One palette per position of the Canon loop: I V vi iii IV I IV V. Minor chords are cooler and softer. */
export const CHORD_MOODS: readonly ChordMood[] = [
  { tint: hex(0xffc978), amt: 0.3, light: 1.03, sat: 1.06 }, // I: golden, warm
  { tint: hex(0xa4d8ff), amt: 0.26, light: 1.07, sat: 1.0 }, // V: bright, clear
  { tint: hex(0xb9a6f2), amt: 0.32, light: 0.95, sat: 0.86 }, // vi: soft lavender
  { tint: hex(0x7bd0c6), amt: 0.3, light: 0.93, sat: 0.82 }, // iii: teal, misty
  { tint: hex(0xff9fb4), amt: 0.3, light: 1.01, sat: 1.0 }, // IV: rose
  { tint: hex(0xffb45a), amt: 0.34, light: 1.05, sat: 1.08 }, // I: amber arrival
  { tint: hex(0xffbf98), amt: 0.28, light: 1.0, sat: 1.02 }, // IV: peach
  { tint: hex(0xbdefff), amt: 0.27, light: 1.09, sat: 0.98 }, // V: open sky
];

export interface SeasonLook {
  warm: number;
  sat: number;
  light: number;
  foliage: RGB;
  grass: RGB;
}

export const SEASON_LOOKS: Record<Season, SeasonLook> = {
  spring: { warm: 0.02, sat: 1.05, light: 1.02, foliage: hex(0x86c268), grass: hex(0x8ccb6c) },
  summer: { warm: 0.1, sat: 1.1, light: 1.03, foliage: hex(0x3f8f52), grass: hex(0x559f4c) },
  autumn: { warm: 0.26, sat: 1.12, light: 0.98, foliage: hex(0xd07a30), grass: hex(0xb98d3c) },
  winter: { warm: -0.22, sat: 0.6, light: 1.02, foliage: hex(0x9db0c6), grass: hex(0xd3dbe5) },
};

export interface StageLook {
  /** Brightness multiplier. */
  light: number;
  /** -1 cool .. +1 warm. */
  warmth: number;
  mist: number;
  wind: number;
  sparkle: number;
  /** 0 day .. 1 twilight. */
  dusk: number;
  /** Rain intensity for the rain scene. */
  rain: number;
}

export const STAGE_LOOKS: Record<StageId, StageLook> = {
  calm: { light: 0.94, warmth: 0.3, mist: 0.6, wind: 0.1, sparkle: 0.1, dusk: 0, rain: 0.25 }, // soft dawn
  flowing: { light: 1.0, warmth: 0.05, mist: 0.28, wind: 0.3, sparkle: 0.25, dusk: 0, rain: 0.45 }, // clear morning
  lively: { light: 1.08, warmth: -0.02, mist: 0.1, wind: 0.6, sparkle: 0.4, dusk: 0, rain: 0.75 }, // bright, breezy
  playful: { light: 1.03, warmth: -0.08, mist: 0.14, wind: 0.92, sparkle: 0.85, dusk: 0, rain: 0.92 }, // windy, sparkly
  ornamented: { light: 0.98, warmth: 0.62, mist: 0.22, wind: 0.3, sparkle: 0.6, dusk: 0, rain: 0.55 }, // golden hour
  rest: { light: 0.64, warmth: -0.16, mist: 0.42, wind: 0.03, sparkle: 0.18, dusk: 1, rain: 0.2 }, // twilight
};

/** Everything a scene needs to recolour a base colour for the current chord, stage and season. */
export interface Grade {
  gain: Float32Array;
  sat: number;
  tint: Float32Array;
  tintAmt: number;
}

export function createGrade(): Grade {
  return { gain: new Float32Array([1, 1, 1]), sat: 1, tint: new Float32Array([1, 1, 1]), tintAmt: 0 };
}

/** Recolours (r,g,b) into out[o..o+2]. `role` scales how far the chord tint reaches (sky 1 .. dark ground ~0.3). */
export function gradeInto(
  out: Float32Array | number[],
  o: number,
  r: number,
  g: number,
  b: number,
  gr: Grade,
  role: number,
): void {
  r *= gr.gain[0];
  g *= gr.gain[1];
  b *= gr.gain[2];
  const l = r * 0.3 + g * 0.59 + b * 0.11;
  const s = gr.sat;
  r = l + (r - l) * s;
  g = l + (g - l) * s;
  b = l + (b - l) * s;
  const k = gr.tintAmt * role;
  const tl = 0.55 + 0.9 * l;
  out[o] = r + (gr.tint[0] * tl - r) * k;
  out[o + 1] = g + (gr.tint[1] * tl - g) * k;
  out[o + 2] = b + (gr.tint[2] * tl - b) * k;
}

export function mixInto(
  out: Float32Array | number[],
  o: number,
  a: ArrayLike<number>,
  b: ArrayLike<number>,
  t: number,
): void {
  out[o] = a[0] + (b[0] - a[0]) * t;
  out[o + 1] = a[1] + (b[1] - a[1]) * t;
  out[o + 2] = a[2] + (b[2] - a[2]) * t;
}

/** Base colours for the three canon voices: warm gold, cool cyan-white, rose-violet. */
export const VOICE_COLORS: readonly RGB[] = [hex(0xffd88a), hex(0xa9e6ff), hex(0xf0a8e6)];

/** Small seeded PRNG so every scene looks the same each time it is built. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
