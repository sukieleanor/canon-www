import * as Tone from 'tone';
import type { AudioEnv } from './env';
import type { RecordingFormat, RecordingResult } from './types';
import workletSource from './worklets/recorder.worklet.js?raw';

/** Hard cap that bounds memory whatever the UI does: about 70 MB of 16-bit stereo PCM. */
export const MAX_RECORDING_SECONDS = 360;

export interface RecordingSession {
  /** Stops capturing and resolves with the recording. */
  stop(): Promise<RecordingResult>;
  /** Stops capturing and throws the data away. */
  cancel(): void;
}

interface WorkletHost {
  audioWorklet?: { addModule(url: string): Promise<void> };
}

/**
 * One module load per context. Tone's own `addAudioWorkletModule` keeps a single promise per
 * context, so it would ignore this module whenever one of Tone's worklets was added first.
 */
const loadedWorklets = new WeakMap<object, Promise<void>>();

export function wavHeader(frames: number, sampleRate: number): ArrayBuffer {
  const bytes = frames * 4;
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 2, true); // stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, bytes, true);
  return buffer;
}

async function workletAvailable(env: AudioEnv): Promise<boolean> {
  const raw = env.ctx.rawContext as WorkletHost;
  if (!raw.audioWorklet) return false;
  let loading = loadedWorklets.get(raw);
  if (!loading) {
    // A blob URL, not a bundled asset: Vite inlines a file this small as a data: URL, which some
    // browsers refuse to load as a worklet module.
    const url = URL.createObjectURL(new Blob([workletSource], { type: 'text/javascript' }));
    loading = raw.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
    loadedWorklets.set(raw, loading);
  }
  try {
    await loading;
    return true;
  } catch (error) {
    loadedWorklets.delete(raw);
    console.warn('[audio] recorder worklet unavailable, recording compressed audio instead', error);
    return false;
  }
}

async function startWav(env: AudioEnv, source: Tone.ToneAudioNode): Promise<RecordingSession> {
  const ctx = env.ctx;
  const sampleRate = ctx.sampleRate;
  const node = ctx.createAudioWorkletNode('ec-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: { maxFrames: sampleRate * MAX_RECORDING_SECONDS },
  });
  // The worklet is silent; routing it to the destination just keeps it in the render graph.
  const sink = env.run(() => new Tone.Gain(0));
  source.connect(node);
  Tone.connect(node, sink);
  sink.connect(ctx.destination);

  const chunks: Array<Int16Array<ArrayBuffer>> = [];
  let frames = 0;
  let finished!: () => void;
  const done = new Promise<void>((resolve) => (finished = resolve));
  node.port.onmessage = (event: MessageEvent) => {
    const data = event.data as { type: string; pcm?: Int16Array<ArrayBuffer>; frames?: number };
    if (data.type === 'data' && data.pcm) {
      chunks.push(data.pcm);
      frames += data.pcm.length / 2;
    } else if (data.type === 'done') {
      finished();
    }
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    source.disconnect(node);
    node.disconnect();
    node.port.onmessage = null;
    node.port.close();
    sink.dispose();
  };

  return {
    async stop() {
      node.port.postMessage({ type: 'stop' });
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))]);
      close();
      const blob = new Blob([wavHeader(frames, sampleRate), ...chunks], { type: 'audio/wav' });
      chunks.length = 0;
      return { blob, mimeType: 'audio/wav', extension: 'wav', durationSec: frames / sampleRate };
    },
    cancel() {
      close();
      chunks.length = 0;
    },
  };
}

const MIME_CANDIDATES: Array<{ mime: string; extension: RecordingResult['extension'] }> = [
  { mime: 'audio/webm;codecs=opus', extension: 'webm' },
  { mime: 'audio/ogg;codecs=opus', extension: 'ogg' },
  { mime: 'audio/mp4;codecs=mp4a.40.2', extension: 'm4a' },
  { mime: 'audio/mp4', extension: 'm4a' },
  { mime: 'audio/webm', extension: 'webm' },
];

function startCompressed(env: AudioEnv, source: Tone.ToneAudioNode): RecordingSession {
  if (typeof MediaRecorder === 'undefined')
    throw new Error('Recording is not supported in this browser.');
  const ctx = env.ctx;
  const choice = MIME_CANDIDATES.find((c) => MediaRecorder.isTypeSupported(c.mime));
  const destination = ctx.createMediaStreamDestination();
  source.connect(destination);
  const recorder = new MediaRecorder(destination.stream, {
    ...(choice ? { mimeType: choice.mime } : {}),
    audioBitsPerSecond: 160000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
  const startedAt = ctx.currentTime;
  recorder.start(1000);
  const limit = setTimeout(() => {
    if (recorder.state !== 'inactive') recorder.stop();
  }, MAX_RECORDING_SECONDS * 1000);

  const close = () => {
    clearTimeout(limit);
    source.disconnect(destination);
    destination.disconnect();
    for (const track of destination.stream.getTracks()) track.stop();
  };

  return {
    async stop() {
      const endedAt = ctx.currentTime;
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      close();
      const mimeType = recorder.mimeType || choice?.mime || 'audio/webm';
      const extension =
        MIME_CANDIDATES.find((c) => mimeType.startsWith(c.mime.split(';')[0]))?.extension ?? 'webm';
      const blob = new Blob(chunks, { type: mimeType });
      chunks.length = 0;
      return {
        blob,
        mimeType,
        extension,
        durationSec: Math.min(endedAt - startedAt, MAX_RECORDING_SECONDS),
      };
    },
    cancel() {
      recorder.ondataavailable = null;
      if (recorder.state !== 'inactive') recorder.stop();
      close();
      chunks.length = 0;
    },
  };
}

/**
 * Starts capturing `source` (the master output). 'wav' records lossless 16-bit stereo PCM through
 * an AudioWorklet and falls back to compressed audio where worklets are unavailable (for example
 * on insecure origins); 'compressed' uses MediaRecorder (webm/opus, ogg/opus or mp4/aac).
 */
export async function startRecordingSession(
  env: AudioEnv,
  source: Tone.ToneAudioNode,
  format: RecordingFormat,
): Promise<RecordingSession> {
  if (format === 'wav' && (await workletAvailable(env))) return startWav(env, source);
  return startCompressed(env, source);
}
