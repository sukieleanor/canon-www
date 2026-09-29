import { Sprite, type Texture } from 'pixi.js';

export const TAU = Math.PI * 2;

export function sprite(texture: Texture, additive = false, ax = 0.5, ay = 0.5): Sprite {
  const s = new Sprite(texture);
  s.anchor.set(ax, ay);
  s.eventMode = 'none';
  if (additive) s.blendMode = 'add';
  return s;
}

export function rr(a: number, b: number): number {
  return a + (b - a) * Math.random();
}

export function smooth(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return c * c * (3 - 2 * c);
}

/** Fade-in over the first `a` of life and fade-out over the last `b`. */
export function envelope(t: number, a: number, b: number): number {
  return smooth(t / a) * (1 - smooth((t - (1 - b)) / b));
}

/** Turns an event rate (per second) into whole spawns, carrying the remainder in `acc`. */
export function takeSpawns(acc: number, rate: number, dt: number): [number, number] {
  const v = acc + rate * dt;
  const n = Math.floor(v);
  return [n, v - n];
}
