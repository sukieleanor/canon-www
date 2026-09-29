/** Small numeric helpers shared by the audio modules. */

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** `v` when it is a finite number, otherwise `fallback`. */
export const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export const dbToGain = (db: number): number => 10 ** (db / 20);

export const mtof = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

/** Perceptual slider position (0..1) to linear gain: a squared law, i.e. 40·log10(v) dB. */
export const sliderGain = (v: number): number => {
  const x = clamp(num(v, 0), 0, 1);
  return x * x;
};

/** MIDI-style velocity (0..1) to linear gain. */
export const velocityGain = (v: number): number => clamp(num(v, 0.7), 0.02, 1) ** 1.4;

export const rand = (lo: number, hi: number, r: () => number = Math.random): number =>
  lo + (hi - lo) * r();

export const pick = <T>(items: readonly T[], r: () => number = Math.random): T =>
  items[Math.floor(r() * items.length) % items.length];

/** Deterministic PRNG (mulberry32) for generated buffers. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
