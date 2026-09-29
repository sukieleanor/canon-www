import * as Tone from 'tone';

let configured = false;

/**
 * Creates (once) and resumes the shared AudioContext. Call it synchronously from a user gesture
 * (click / key press) before any Tone.js node or the Transport is created.
 */
export async function startAudio(): Promise<void> {
  if (!configured) {
    // 'playback' favours glitch-free output over latency; the long look-ahead keeps scheduling
    // steady even when the main thread is busy rendering visuals.
    Tone.setContext(new Tone.Context({ latencyHint: 'playback', lookAhead: 0.3 }));
    configured = true;
  }
  await Tone.start();
}

export function isAudioStarted(): boolean {
  return configured && Tone.getContext().state === 'running';
}
