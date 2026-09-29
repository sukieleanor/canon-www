import type { PhraseSummary } from './score';

export const REWIND_CAPACITY = 10;

/** The most recent phrases heard, so Rewind can step back to a variation you liked. */
export class RewindBuffer {
  private readonly items: PhraseSummary[] = [];
  private readonly capacity: number;

  constructor(capacity = REWIND_CAPACITY) {
    this.capacity = capacity;
  }

  record(summary: PhraseSummary): void {
    const existing = this.items.findIndex((s) => s.cycle === summary.cycle);
    if (existing >= 0) this.items.splice(existing, 1);
    this.items.push(summary);
    this.items.sort((a, b) => a.cycle - b.cycle);
    while (this.items.length > this.capacity) this.items.shift();
  }

  list(): readonly PhraseSummary[] {
    return this.items;
  }

  /** The latest remembered phrase that started before `cycle`. */
  before(cycle: number): PhraseSummary | null {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (this.items[i].cycle < cycle) return this.items[i];
    }
    return null;
  }

  clear(): void {
    this.items.length = 0;
  }
}

export interface Favorite {
  id: string;
  seed: string;
  cycle: number;
  /** Share-link query string that reproduces the moment. */
  query: string;
  label: string;
  savedAt: number;
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const FAVORITES_KEY = 'endless-canon:favorites';
const MAX_FAVORITES = 50;

function isFavorite(value: unknown): value is Favorite {
  const f = value as Favorite;
  return (
    typeof f === 'object' &&
    f !== null &&
    typeof f.id === 'string' &&
    typeof f.seed === 'string' &&
    typeof f.cycle === 'number' &&
    typeof f.query === 'string' &&
    typeof f.label === 'string' &&
    typeof f.savedAt === 'number'
  );
}

/** Saved seeds/moments, kept in localStorage. */
export class FavoritesStore {
  private readonly storage: KeyValueStore | null;

  constructor(storage: KeyValueStore | null) {
    this.storage = storage;
  }

  list(): Favorite[] {
    try {
      const raw = this.storage?.getItem(FAVORITES_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(isFavorite) : [];
    } catch {
      return [];
    }
  }

  add(fav: Omit<Favorite, 'id' | 'savedAt'>): Favorite {
    const entry: Favorite = {
      ...fav,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      savedAt: Date.now(),
    };
    this.save(
      [entry, ...this.list().filter((f) => f.query !== entry.query)].slice(0, MAX_FAVORITES),
    );
    return entry;
  }

  remove(id: string): void {
    this.save(this.list().filter((f) => f.id !== id));
  }

  private save(list: Favorite[]): void {
    try {
      this.storage?.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch {
      // Storage may be full or disabled (private browsing); favourites are a nicety.
    }
  }
}
