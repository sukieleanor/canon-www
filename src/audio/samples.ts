import type { AudioEnv } from './env';
import { SAMPLE_SETS, type SampleSetId } from './sampleManifest';

export type SetStatus = 'idle' | 'loading' | 'ready' | 'failed';

const FETCH_TIMEOUT_MS = 20000;
const RETRY_AFTER_FAILURE_MS = 30000;

/** One downloadable instrument: MIDI note number to decoded buffer. */
export class SampleSet {
  readonly id: SampleSetId;
  readonly buffers = new Map<number, AudioBuffer>();
  readonly totalBytes: number;
  status: SetStatus = 'idle';
  loadedBytes = 0;
  failedAt = 0;
  /** Settles (never rejects) when the current load attempt is over. */
  done: Promise<void> = Promise.resolve();

  constructor(id: SampleSetId) {
    this.id = id;
    this.totalBytes = SAMPLE_SETS[id].reduce((sum, file) => sum + file.bytes, 0);
  }

  get usable(): boolean {
    return this.status === 'ready';
  }
}

/**
 * Downloads and decodes sample sets on demand. Nothing is fetched until `request` is called, files
 * are retried with back-off, and a set that mostly fails is reported as failed so its instrument
 * keeps using the synthesised fallback.
 */
export class SampleLibrary {
  private readonly sets = new Map<SampleSetId, SampleSet>();
  private readonly listeners = new Set<() => void>();
  private readonly pending = new Set<AbortController>();
  private disposed = false;
  private readonly env: AudioEnv;
  private readonly baseUrl: string;

  constructor(env: AudioEnv, baseUrl: string) {
    this.env = env;
    this.baseUrl = baseUrl;
  }

  get(id: SampleSetId): SampleSet {
    let set = this.sets.get(id);
    if (!set) {
      set = new SampleSet(id);
      this.sets.set(id, set);
    }
    return set;
  }

  /** Starts loading a set (once) and returns it. */
  request(id: SampleSetId): SampleSet {
    const set = this.get(id);
    const retry = set.status === 'failed' && Date.now() - set.failedAt > RETRY_AFTER_FAILURE_MS;
    if (!this.disposed && (set.status === 'idle' || retry)) {
      set.status = 'loading';
      set.loadedBytes = 0;
      set.done = this.load(set);
    }
    return set;
  }

  /** 0..1 over the given sets. */
  progress(ids: Iterable<SampleSetId>): number {
    let loaded = 0;
    let total = 0;
    for (const id of ids) {
      const set = this.get(id);
      total += set.totalBytes;
      loaded += set.status === 'idle' ? 0 : set.loadedBytes;
    }
    return total === 0 ? 1 : Math.min(loaded / total, 1);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    for (const controller of this.pending) controller.abort();
    this.pending.clear();
    this.listeners.clear();
    this.sets.clear();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private async load(set: SampleSet): Promise<void> {
    const files = SAMPLE_SETS[set.id];
    let next = 0;
    const worker = async () => {
      while (next < files.length && !this.disposed) {
        const file = files[next++];
        try {
          const buffer = await this.fetchBuffer(this.baseUrl + file.file);
          set.buffers.set(file.midi, buffer);
        } catch {
          // The set is judged as a whole below.
        }
        set.loadedBytes += file.bytes;
        this.emit();
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    if (this.disposed) return;
    set.status = set.buffers.size * 2 >= files.length ? 'ready' : 'failed';
    if (set.status === 'failed') {
      set.failedAt = Date.now();
      set.buffers.clear();
    }
    this.emit();
  }

  private async fetchBuffer(url: string): Promise<AudioBuffer> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3 && !this.disposed; attempt++) {
      const controller = new AbortController();
      this.pending.add(controller);
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
        return await this.env.ctx.decodeAudioData(await response.arrayBuffer());
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 400 * 3 ** attempt));
      } finally {
        clearTimeout(timer);
        this.pending.delete(controller);
      }
    }
    throw lastError ?? new Error('sample library disposed');
  }
}

/** Resolves the samples directory against the page, whatever Vite's `base` is (dev '/' or build './'). */
export function sampleBaseUrl(): string {
  const root = typeof document !== 'undefined' ? document.baseURI : globalThis.location?.href;
  return new URL(`${import.meta.env.BASE_URL}samples/`, root).href;
}
