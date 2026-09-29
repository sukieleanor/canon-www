import { describe, expect, it } from 'vitest';
import { FavoritesStore, RewindBuffer } from '../src/music/history';

const summary = (cycle: number) => ({
  cycle,
  stage: 'calm' as const,
  keyName: 'D major',
  quote: false,
});

describe('rewind buffer', () => {
  it('remembers the last ten phrases and steps back through them', () => {
    const buffer = new RewindBuffer();
    for (let n = 1; n <= 15; n++) buffer.record(summary(n));
    expect(buffer.list().map((s) => s.cycle)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(buffer.before(15)?.cycle).toBe(14);
    expect(buffer.before(6)).toBeNull();
    buffer.record(summary(12));
    expect(buffer.list()).toHaveLength(10);
  });
});

describe('favourites', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it('saves, lists and removes favourite moments', () => {
    const store = new FavoritesStore(memory());
    const a = store.add({ seed: '123', cycle: 4, query: 'seed=123&at=4', label: 'Dawn' });
    store.add({ seed: '456', cycle: 9, query: 'seed=456&at=9', label: 'Rain' });
    expect(store.list().map((f) => f.label)).toEqual(['Rain', 'Dawn']);
    store.remove(a.id);
    expect(store.list().map((f) => f.seed)).toEqual(['456']);
  });

  it('survives corrupt or missing storage', () => {
    const broken = { getItem: () => '{not json', setItem: () => {} };
    expect(new FavoritesStore(broken).list()).toEqual([]);
    expect(new FavoritesStore(null).list()).toEqual([]);
  });
});
