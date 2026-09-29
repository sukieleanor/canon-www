export type QualityTier = 'high' | 'medium' | 'low';

export const TIER_ORDER: readonly QualityTier[] = ['high', 'medium', 'low'];

export interface TierSettings {
  /** Upper bound for the render resolution (device pixel ratio). */
  maxResolution: number;
  /** Multiplier for particle caps. */
  particles: number;
  /** Shader detail 0..1. */
  detail: number;
}

export const TIERS: Record<QualityTier, TierSettings> = {
  high: { maxResolution: 2, particles: 1, detail: 1 },
  medium: { maxResolution: 1.5, particles: 0.65, detail: 0.7 },
  low: { maxResolution: 1, particles: 0.4, detail: 0.4 },
};

const SLOW_MS = 21.5;
const GOOD_MS = 17.8;

/**
 * Watches real frame intervals in one-second windows. Drops a tier after two slow windows and
 * climbs back only after a long clean stretch; every failed climb doubles the wait (hysteresis).
 */
export class QualityGovernor {
  tier: QualityTier = 'high';
  /** Smoothed frames per second. */
  fps = 60;
  private acc = 0;
  private frames = 0;
  private slow = 0;
  private good = 0;
  private warmup = 4;
  private clock = 0;
  private lastUp = -1e9;
  private upHold = 20;

  /** Feed each frame's real interval. Returns true when the tier changed. */
  frame(elapsedMs: number): boolean {
    if (!(elapsedMs > 0) || elapsedMs > 1000) return false;
    this.fps += (1000 / elapsedMs - this.fps) * 0.05;
    this.acc += elapsedMs;
    this.frames++;
    if (this.acc < 1000) return false;
    const mean = this.acc / this.frames;
    const seconds = this.acc / 1000;
    this.acc = 0;
    this.frames = 0;
    this.clock += seconds;
    if (this.warmup > 0) {
      this.warmup -= seconds;
      return false;
    }
    if (mean > SLOW_MS) {
      this.slow++;
      this.good = 0;
    } else if (mean < GOOD_MS) {
      this.good++;
      this.slow = 0;
    } else {
      this.slow = 0;
    }
    const i = TIER_ORDER.indexOf(this.tier);
    if (this.slow >= 2 && i < TIER_ORDER.length - 1) {
      if (this.clock - this.lastUp < 40) this.upHold = Math.min(240, this.upHold * 2);
      return this.move(i + 1);
    }
    if (this.good >= this.upHold && i > 0) {
      this.lastUp = this.clock;
      return this.move(i - 1);
    }
    if (this.clock - this.lastUp > 180) this.upHold = Math.max(20, this.upHold / 2);
    return false;
  }

  /** Call after the tab was hidden or the canvas resized: those frames say nothing about speed. */
  reset(warmup = 3): void {
    this.acc = 0;
    this.frames = 0;
    this.slow = 0;
    this.good = 0;
    this.warmup = warmup;
  }

  private move(i: number): boolean {
    this.tier = TIER_ORDER[i];
    this.reset(2.5);
    return true;
  }
}
