import type { AudioSettings, LayerMix } from '../audio/types';
import type { ComposeSettings } from '../music/composer';
import { MAX_START_CYCLE } from '../music/constants';
import { isTonicId, type TonicId } from '../music/theory';
import {
  LAYER_IDS,
  MELODY_INSTRUMENTS,
  MOODS,
  PRESET_IDS,
  SCENE_IDS,
  type ChordSoundId,
  type ChordStyle,
  type LayerId,
  type MelodyInstrumentId,
  type Mood,
  type PresetId,
  type SceneId,
} from '../types';

export type ReducedMotionPref = 'auto' | 'on' | 'off';

export interface Settings {
  seed: string;
  key: TonicId;
  mood: Mood;
  /** Beats per minute; one chord lasts two beats. */
  tempo: number;
  /** 0 = calm … 1 = lively. */
  busyness: number;
  volume: number;
  melodyInstrument: MelodyInstrumentId;
  melodyVolume: number;
  layers: Record<LayerId, LayerMix>;
  chordStyle: ChordStyle;
  chordSound: ChordSoundId;
  lofi: boolean;
  preset: PresetId | 'custom';
  scene: SceneId;
  autoRotate: boolean;
  autoModulate: boolean;
  strict: boolean;
  quotes: boolean;
  reducedMotion: ReducedMotionPref;
}

export const TEMPO_RANGE = { min: 56, max: 132 } as const;
export const MOOD_TEMPO: Record<Mood, number> = { bright: 88, wistful: 76, dreamy: 64 };

export interface PresetDef {
  label: string;
  description: string;
  layers: Record<LayerId, boolean>;
  melodyInstrument: MelodyInstrumentId;
  chordSound: ChordSoundId;
  chordStyle: ChordStyle;
  lofi: boolean;
}

export const PRESETS: Record<PresetId, PresetDef> = {
  melody: {
    label: 'Melody only',
    description: 'Just the three canon voices',
    layers: { bass: false, chords: false, pad: false, pizz: false, beat: false, ambience: false },
    melodyInstrument: 'piano',
    chordSound: 'harpsichord',
    chordStyle: 'block',
    lofi: false,
  },
  quartet: {
    label: 'Classic quartet',
    description: 'Three violins over the cello ground bass',
    layers: { bass: true, chords: false, pad: false, pizz: false, beat: false, ambience: true },
    melodyInstrument: 'strings',
    chordSound: 'harpsichord',
    chordStyle: 'block',
    lofi: false,
  },
  orchestra: {
    label: 'Full orchestra',
    description: 'Bass, harpsichord, string pad and pizzicato',
    layers: { bass: true, chords: true, pad: true, pizz: true, beat: false, ambience: true },
    melodyInstrument: 'strings',
    chordSound: 'harpsichord',
    chordStyle: 'block',
    lofi: false,
  },
  lofi: {
    label: 'Lo-fi',
    description: 'Soft beat, warm piano and vinyl crackle',
    layers: { bass: true, chords: true, pad: false, pizz: false, beat: true, ambience: true },
    melodyInstrument: 'piano',
    chordSound: 'piano',
    chordStyle: 'broken',
    lofi: true,
  },
};

export const DEFAULT_SETTINGS: Settings = {
  seed: '1',
  key: 'D',
  mood: 'bright',
  tempo: MOOD_TEMPO.bright,
  busyness: 0.5,
  volume: 0.8,
  melodyInstrument: 'strings',
  melodyVolume: 0.8,
  layers: {
    bass: { on: true, volume: 0.7 },
    chords: { on: false, volume: 0.55 },
    pad: { on: false, volume: 0.5 },
    pizz: { on: false, volume: 0.5 },
    beat: { on: false, volume: 0.5 },
    ambience: { on: true, volume: 0.45 },
  },
  chordStyle: 'block',
  chordSound: 'harpsichord',
  lofi: false,
  preset: 'quartet',
  scene: 'lake',
  autoRotate: true,
  autoModulate: true,
  strict: false,
  quotes: true,
  reducedMotion: 'auto',
};

export function cloneSettings(s: Settings): Settings {
  return {
    ...s,
    layers: Object.fromEntries(LAYER_IDS.map((id) => [id, { ...s.layers[id] }])) as Record<
      LayerId,
      LayerMix
    >,
  };
}

export function applyPreset(s: Settings, id: PresetId): Settings {
  const preset = PRESETS[id];
  const next = cloneSettings(s);
  for (const layer of LAYER_IDS) next.layers[layer].on = preset.layers[layer];
  next.melodyInstrument = preset.melodyInstrument;
  next.chordSound = preset.chordSound;
  next.chordStyle = preset.chordStyle;
  next.lofi = preset.lofi;
  next.preset = id;
  return next;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export function isValidSeed(seed: unknown): seed is string {
  return typeof seed === 'string' && /^[\w-]{1,32}$/.test(seed);
}

/** Keeps only well-formed fields (for localStorage data that may be stale or tampered with). */
export function sanitizeSettings(input: unknown): Partial<Settings> {
  if (typeof input !== 'object' || input === null) return {};
  const src = input as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (isValidSeed(src.seed)) out.seed = src.seed;
  if (typeof src.key === 'string' && isTonicId(src.key)) out.key = src.key;
  if (isOneOf(MOODS, src.mood)) out.mood = src.mood;
  const tempo = num(src.tempo);
  if (tempo !== null) out.tempo = clamp(Math.round(tempo), TEMPO_RANGE.min, TEMPO_RANGE.max);
  const busy = num(src.busyness);
  if (busy !== null) out.busyness = clamp(busy, 0, 1);
  const volume = num(src.volume);
  if (volume !== null) out.volume = clamp(volume, 0, 1);
  const melodyVolume = num(src.melodyVolume);
  if (melodyVolume !== null) out.melodyVolume = clamp(melodyVolume, 0, 1);
  if (isOneOf(MELODY_INSTRUMENTS, src.melodyInstrument))
    out.melodyInstrument = src.melodyInstrument;
  if (isOneOf(['block', 'broken'] as const, src.chordStyle)) out.chordStyle = src.chordStyle;
  if (isOneOf(['harpsichord', 'piano'] as const, src.chordSound)) out.chordSound = src.chordSound;
  if (isOneOf([...PRESET_IDS, 'custom'] as const, src.preset)) out.preset = src.preset;
  if (isOneOf(SCENE_IDS, src.scene)) out.scene = src.scene;
  if (isOneOf(['auto', 'on', 'off'] as const, src.reducedMotion))
    out.reducedMotion = src.reducedMotion;
  for (const flag of ['lofi', 'autoRotate', 'autoModulate', 'strict', 'quotes'] as const) {
    if (typeof src[flag] === 'boolean') out[flag] = src[flag] as boolean;
  }
  if (typeof src.layers === 'object' && src.layers !== null) {
    const layers = { ...DEFAULT_SETTINGS.layers };
    let any = false;
    for (const id of LAYER_IDS) {
      const l = (src.layers as Record<string, unknown>)[id] as Record<string, unknown> | undefined;
      const vol = num(l?.volume);
      if (l && typeof l.on === 'boolean' && vol !== null) {
        layers[id] = { on: l.on, volume: clamp(vol, 0, 1) };
        any = true;
      }
    }
    if (any) out.layers = layers;
  }
  return out;
}

export interface UrlState {
  settings: Partial<Settings>;
  /** Phrase to start from (share links capture the moment). */
  at: number | null;
}

export function parseUrl(search: string): UrlState {
  const p = new URLSearchParams(search);
  const out: Partial<Settings> = {};
  const seed = p.get('seed');
  if (isValidSeed(seed)) out.seed = seed;
  const key = p.get('key');
  if (key && isTonicId(key)) out.key = key;
  const mood = p.get('mood');
  if (isOneOf(MOODS, mood)) out.mood = mood;
  const tempo = num(p.get('tempo'));
  if (tempo !== null) out.tempo = clamp(Math.round(tempo), TEMPO_RANGE.min, TEMPO_RANGE.max);
  const busy = num(p.get('busy'));
  if (busy !== null) out.busyness = clamp(busy / 100, 0, 1);
  const preset = p.get('preset');
  if (isOneOf(PRESET_IDS, preset)) out.preset = preset;
  const inst = p.get('inst');
  if (isOneOf(MELODY_INSTRUMENTS, inst)) out.melodyInstrument = inst;
  const scene = p.get('scene');
  if (isOneOf(SCENE_IDS, scene)) out.scene = scene;
  const chords = p.get('chords');
  if (chords === 'block' || chords === 'broken') out.chordStyle = chords;
  const flag = (name: string) => {
    const v = p.get(name);
    return v === '1' ? true : v === '0' ? false : null;
  };
  const mod = flag('mod');
  if (mod !== null) out.autoModulate = mod;
  const strict = flag('strict');
  if (strict !== null) out.strict = strict;
  const quotes = flag('q');
  if (quotes !== null) out.quotes = quotes;
  const at = num(p.get('at'));
  return {
    settings: out,
    at: at !== null ? clamp(Math.floor(at), 0, MAX_START_CYCLE) : null,
  };
}

/** Everything that shapes the composition, so a link replays the same music. */
export function shareQuery(s: Settings, at: number | null): string {
  const p = new URLSearchParams();
  p.set('seed', s.seed);
  p.set('key', s.key);
  p.set('mood', s.mood);
  p.set('tempo', String(s.tempo));
  p.set('busy', String(Math.round(s.busyness * 100)));
  p.set('mod', s.autoModulate ? '1' : '0');
  if (s.strict) p.set('strict', '1');
  if (!s.quotes) p.set('q', '0');
  if (s.chordStyle !== 'block') p.set('chords', s.chordStyle);
  if (s.preset !== 'custom') p.set('preset', s.preset);
  p.set('inst', s.melodyInstrument);
  p.set('scene', s.scene);
  if (at !== null && at > 0) p.set('at', String(Math.min(at, MAX_START_CYCLE)));
  return p.toString();
}

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;
const STORAGE_KEY = 'endless-canon:settings';

export function loadStoredSettings(storage: KeyValueStore | null): Partial<Settings> {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    const parsed = raw ? sanitizeSettings(JSON.parse(raw)) : {};
    delete parsed.seed; // every visit starts a new piece unless a link says otherwise
    return parsed;
  } catch {
    return {};
  }
}

export function saveSettings(storage: KeyValueStore | null, s: Settings): void {
  try {
    const { seed: _seed, ...rest } = s;
    storage?.setItem(STORAGE_KEY, JSON.stringify(rest));
  } catch {
    // Ignore storage failures (private mode, quota).
  }
}

/** Defaults, then saved preferences, then the URL (a shared link wins). */
export function resolveInitialSettings(opts: {
  search: string;
  storage: KeyValueStore | null;
  newSeed: () => string;
}): { settings: Settings; at: number | null; fromLink: boolean } {
  const stored = loadStoredSettings(opts.storage);
  const url = parseUrl(opts.search);
  let settings: Settings = { ...cloneSettings(DEFAULT_SETTINGS), ...stored, seed: opts.newSeed() };
  const preset = url.settings.preset;
  if (preset && preset !== 'custom') settings = applyPreset(settings, preset);
  settings = { ...settings, ...url.settings };
  return { settings, at: url.at, fromLink: url.settings.seed !== undefined };
}

export function toComposeSettings(s: Settings): ComposeSettings {
  return {
    key: s.key,
    mood: s.mood,
    busyness: s.busyness,
    strict: s.strict,
    autoModulate: s.autoModulate,
    chordStyle: s.chordStyle,
    quotes: s.quotes,
  };
}

export function toAudioSettings(s: Settings): AudioSettings {
  return {
    masterVolume: s.volume,
    melodyVolume: s.melodyVolume,
    melodyInstrument: s.melodyInstrument,
    chordSound: s.chordSound,
    layers: cloneSettings(s).layers,
    mood: s.mood,
    lofi: s.lofi,
    scene: s.scene,
  };
}
