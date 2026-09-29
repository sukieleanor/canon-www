/*
 * Cooperative time slicing. The procedural art is painted by generators that `yield` whenever the
 * current slice has used its share of a frame, so the engine can spread scene construction over
 * many frames instead of blocking the main thread (which also runs the audio scheduler).
 */

export type Steps<T = void> = Generator<void, T, void>;

/** Longest stretch a generator runs before yielding. */
export const SLICE_MS = 3;

let sliceStart = 0;

/** The engine calls this right before resuming a generator. */
export function beginSlice(): void {
  sliceStart = performance.now();
}

/** True when the running slice is spent and the generator should `yield`. */
export function due(): boolean {
  return performance.now() - sliceStart > SLICE_MS;
}

/** Runs a generator to completion synchronously (debug pages, tests). */
export function drain<T>(steps: Steps<T>): T {
  for (;;) {
    beginSlice();
    const r = steps.next();
    if (r.done) return r.value;
  }
}

export type Trace = (label: string, ms: number) => void;
let tracer: Trace | null = null;

/** Dev hook: receives the duration of every build slice, GPU upload/compile and frame render. */
export function setTrace(fn: Trace | null): void {
  tracer = fn;
}

/** Reports the time since `since` (a performance.now() reading) under `label`. */
export function mark(label: string, since: number): void {
  if (tracer) tracer(label, performance.now() - since);
}

export function traced<T>(label: string, fn: () => T): T {
  if (!tracer) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    tracer(label, performance.now() - t0);
  }
}
