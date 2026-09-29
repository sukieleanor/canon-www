import * as Tone from 'tone';

/**
 * The audio context all nodes of one engine live in. Tone creates nodes in whichever context is
 * globally active, and that changes while `Tone.Offline` renders (used by the dev harness), so
 * anything created lazily goes through `run`.
 */
export interface AudioEnv {
  readonly ctx: Tone.BaseContext;
  /** Runs `fn` with `ctx` as Tone's active context (nodes created inside belong to it). */
  run<T>(fn: () => T): T;
}

export function createEnv(ctx: Tone.BaseContext = Tone.getContext()): AudioEnv {
  return {
    ctx,
    run<T>(fn: () => T): T {
      const previous = Tone.getContext();
      if (previous === ctx) return fn();
      Tone.setContext(ctx);
      try {
        return fn();
      } finally {
        Tone.setContext(previous);
      }
    },
  };
}
