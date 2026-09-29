import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  DEFAULT_SETTINGS,
  parseUrl,
  resolveInitialSettings,
  sanitizeSettings,
  shareQuery,
} from '../src/state/settings';

describe('settings', () => {
  it('round-trips share links', () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      seed: '424242',
      key: 'F#' as const,
      mood: 'wistful' as const,
      busyness: 0.8,
      tempo: 72,
    };
    const parsed = parseUrl(`?${shareQuery(settings, 37)}`);
    expect(parsed.at).toBe(37);
    expect(parsed.settings).toMatchObject({
      seed: '424242',
      key: 'F#',
      mood: 'wistful',
      busyness: 0.8,
      tempo: 72,
    });
  });

  it('ignores malformed URL values', () => {
    const parsed = parseUrl('?seed=<script>&key=H&tempo=9999&busy=abc&mood=angry&at=-4');
    expect(parsed.settings).toEqual({ tempo: 132 });
    expect(parsed.at).toBe(0);
  });

  it('sanitizes stored preferences', () => {
    expect(
      sanitizeSettings({
        volume: 7,
        scene: 'moon',
        strict: 'yes',
        layers: { bass: { on: false, volume: 0.3 } },
      }),
    ).toEqual({
      volume: 1,
      layers: { ...DEFAULT_SETTINGS.layers, bass: { on: false, volume: 0.3 } },
    });
  });

  it('applies presets to the backing layers', () => {
    const lofi = applyPreset(DEFAULT_SETTINGS, 'lofi');
    expect(lofi.layers.beat.on).toBe(true);
    expect(lofi.lofi).toBe(true);
    expect(lofi.melodyInstrument).toBe('piano');
    const melodyOnly = applyPreset(DEFAULT_SETTINGS, 'melody');
    expect(Object.values(melodyOnly.layers).every((l) => !l.on)).toBe(true);
  });

  it('lets a shared link win over saved preferences, with a fresh seed otherwise', () => {
    const storage = { getItem: () => JSON.stringify({ key: 'G', seed: '999' }), setItem: () => {} };
    const plain = resolveInitialSettings({ search: '', storage, newSeed: () => '777' });
    expect(plain.settings.key).toBe('G');
    expect(plain.settings.seed).toBe('777');
    expect(plain.fromLink).toBe(false);
    const linked = resolveInitialSettings({
      search: '?seed=31&key=Eb&preset=lofi',
      storage,
      newSeed: () => '777',
    });
    expect(linked.settings).toMatchObject({ seed: '31', key: 'Eb', preset: 'lofi', lofi: true });
    expect(linked.fromLink).toBe(true);
  });
});
