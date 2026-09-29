/** 32-bit string hash (cyrb53 mixing, truncated). */
export function hash32(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** Small, fast seeded PRNG (mulberry32) that behaves identically in every browser. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += Math.max(0, w);
    if (total <= 0) return items[0];
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  weightedKey<K extends string>(weights: Partial<Record<K, number>>): K {
    const keys = Object.keys(weights) as K[];
    return this.weighted(
      keys,
      keys.map((k) => weights[k] ?? 0),
    );
  }

  /** Independent sub-stream derived from the current state. */
  fork(label: string | number): Rng {
    return new Rng(hash32(`${this.state}:${label}`));
  }
}

/**
 * Counter-based streams: every (seed, purpose, index) gets its own generator, so one part of the
 * music never shifts the random choices of another.
 */
export function rngFor(seed: string, stream: string, index = 0): Rng {
  return new Rng(hash32(`${seed}|${stream}|${index}`));
}

export function randomSeed(): string {
  return String(100000 + Math.floor(Math.random() * 900000));
}
