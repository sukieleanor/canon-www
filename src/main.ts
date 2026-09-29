import '@fontsource/cormorant-garamond/latin-400.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import './styles/main.css';
import { startAudio } from './audio/context';
import { createAudioEngine } from './audio/engine';
import type { AudioEngine, AudioSettings, RecordingFormat } from './audio/types';
import { EventBus, type MusicEvents } from './events';
import { Composer } from './music/composer';
import { type Favorite, FavoritesStore, RewindBuffer } from './music/history';
import { randomSeed } from './music/random';
import { Scheduler } from './music/scheduler';
import { STAGES } from './music/stages';
import {
  applyPreset,
  cloneSettings,
  MOOD_TEMPO,
  parseUrl,
  PRESETS,
  resolveInitialSettings,
  saveSettings,
  type Settings,
  shareQuery,
  toAudioSettings,
  toComposeSettings,
} from './state/settings';
import {
  LAYER_IDS,
  type LayerId,
  type PartId,
  PRESET_IDS,
  type PresetId,
  SCENE_IDS,
  SCENE_INFO,
} from './types';
import { AppUi } from './ui/app';
import { bindShortcuts } from './ui/keyboard';
import type { VisualEngine } from './visuals/types';

const stageEl = document.getElementById('stage') as HTMLElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

function safeStorage(): Storage | null {
  try {
    const s = window.localStorage;
    s.setItem('endless-canon:probe', '1');
    s.removeItem('endless-canon:probe');
    return s;
  } catch {
    return null;
  }
}

const bus = new EventBus<MusicEvents>();
const storage = safeStorage();
const initial = resolveInitialSettings({ search: location.search, storage, newSeed: randomSeed });
let settings: Settings = initial.settings;
let startAt: number | null = initial.at;
let composer = new Composer(settings.seed, toComposeSettings(settings));
let audio: AudioEngine | null = null;
let scheduler: Scheduler | null = null;
let visuals: VisualEngine | null = null;
let starting = false;
let heardCycle: number | null = null;
let volumeBeforeMute: number | null = null;
let recording: { timer: number; endsAt: number } | null = null;
let recordingUrl: string | null = null;
let zen = false;
const favorites = new FavoritesStore(storage);
const rewind = new RewindBuffer();
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

const reducedMotion = () =>
  settings.reducedMotion === 'on' || (settings.reducedMotion === 'auto' && motionQuery.matches);

const isPartEnabled = (part: PartId) =>
  part === 'melody' || settings.layers[part as LayerId]?.on !== false;

const activeComposer = () => scheduler?.activeComposer ?? composer;

const ui = new AppUi(
  uiRoot,
  settings,
  {
    togglePlay: () => void togglePlay(),
    rewind: () => doRewind(),
    rewindTo: (cycle) => doRewind(cycle),
    favorite,
    share: () => void share(),
    change: (patch) => update(patch),
    layer: (id, patch) => {
      const layers = cloneSettings(settings).layers;
      layers[id] = { ...layers[id], ...patch };
      update({ layers });
    },
    preset: choosePreset,
    scene: (scene) => update({ scene }),
    newPiece,
    loadFavorite,
    removeFavorite: (id) => {
      favorites.remove(id);
      ui.setFavorites(favorites.list());
    },
    record: (minutes, format) => void startRecording(minutes, format),
    stopRecording: () => void stopRecording(),
    zen: setZen,
    fullscreen: toggleFullscreen,
  },
  initial.fromLink ? { seed: settings.seed, at: startAt } : null,
);
ui.setFavorites(favorites.list());
ui.setHistory([], null);
ui.setRecording({ available: false, recording: false });
ui.setChord(0, activeComposer().getCycle(0).chords[0].name);
stageEl.dataset.scene = settings.scene;
if (!document.fullscreenEnabled) document.body.classList.add('no-fullscreen');

// Visuals load lazily so the page paints immediately; the music never waits for them.
void import('./visuals/engine')
  .then(({ createVisualEngine }) =>
    createVisualEngine({
      container: stageEl,
      bus,
      scene: settings.scene,
      autoRotate: settings.autoRotate,
      reducedMotion: reducedMotion(),
    }),
  )
  .then((engine) => {
    visuals = engine;
    if (engine.scene !== settings.scene) engine.setScene(settings.scene);
  })
  .catch((err) => console.error('[visuals] failed to start', err));

motionQuery.addEventListener('change', () => visuals?.setReducedMotion(reducedMotion()));

bus.on('cycle', (e) => {
  heardCycle = e.cycle;
  rewind.record({ cycle: e.cycle, stage: e.stage, keyName: e.keyName, quote: e.quote });
  ui.setNowPlaying(e);
  ui.setHistory(rewind.list(), e.cycle);
});
bus.on('chordChange', (e) => ui.setChord(e.chordIndex, e.name));
bus.on('transport', ({ playing }) => {
  ui.setPlaying(playing);
  if ('mediaSession' in navigator)
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
});
bus.on('sceneChange', ({ scene }) => {
  stageEl.dataset.scene = scene;
  if (settings.scene === scene) return;
  settings = { ...cloneSettings(settings), scene };
  audio?.update({ scene });
  ui.setSettings(settings);
  persist();
});

// Share links may start deep into a piece: compose up to that phrase while the page is idle.
if (startAt) window.setTimeout(() => composer.getCycle(startAt ?? 0), 60);

// ---------------------------------------------------------------------------------------------
// Playback

async function togglePlay(): Promise<void> {
  if (scheduler?.isPlaying) {
    scheduler.pause();
    return;
  }
  if (scheduler) {
    scheduler.resume();
    return;
  }
  if (starting) return;
  starting = true;
  // Browsers only allow audio to start inside the click/key handler, so this runs synchronously.
  const unlocked = startAudio();
  ui.setLoading(0.03);
  try {
    await unlocked;
    audio = await createAudioEngine(toAudioSettings(settings));
    audio.onLoadProgress((p) => ui.setLoading(p));
    void audio.ready.then(() => ui.setLoading(null));
    scheduler = new Scheduler({ composer, audio, bus, isPartEnabled, tempo: settings.tempo });
    scheduler.start(startAt ?? (settings.layers.bass.on ? 0 : 1));
    startAt = null;
    ui.setRecording({ available: true, recording: false });
    setupMediaSession();
  } catch (err) {
    console.error('[audio] failed to start', err);
    audio?.dispose();
    audio = null;
    scheduler = null;
    ui.setLoading(null);
    ui.toast('Audio could not start — tap play to try again');
  } finally {
    starting = false;
  }
}

function doRewind(target?: number): void {
  if (!scheduler) {
    ui.toast('Press play first');
    return;
  }
  const from = scheduler.pendingCycle ?? heardCycle ?? scheduler.currentCycle;
  const entry =
    target !== undefined
      ? (rewind.list().find((s) => s.cycle === target) ?? null)
      : rewind.before(from);
  if (!entry) {
    ui.toast('Nothing to rewind to yet');
    return;
  }
  scheduler.jumpTo(entry.cycle);
  ui.toast(`Rewinding to phrase ${entry.cycle} · ${STAGES[entry.stage].name}`);
}

function newPiece(seed: string = randomSeed()): void {
  settings = { ...cloneSettings(settings), seed };
  composer = new Composer(seed, toComposeSettings(settings));
  rewind.clear();
  ui.setHistory([], null);
  history.replaceState(null, '', location.pathname);
  if (scheduler) scheduler.jumpTo(settings.layers.bass.on ? 0 : 1, composer);
  else startAt = null;
  ui.setSettings(settings);
  setupMediaSession();
  persist();
  ui.toast(`New piece · seed ${seed}`);
}

function loadFavorite(fav: Favorite): void {
  const parsed = parseUrl(`?${fav.query}`);
  let next: Settings = { ...cloneSettings(settings), ...parsed.settings };
  const preset = parsed.settings.preset;
  if (preset && preset !== 'custom') next = { ...applyPreset(next, preset), ...parsed.settings };
  const prev = settings;
  settings = next;
  composer = new Composer(next.seed, toComposeSettings(next));
  const at = parsed.at ?? 0;
  composer.getCycle(at);
  rewind.clear();
  if (scheduler) {
    scheduler.jumpTo(at, composer);
    scheduler.setTempo(next.tempo);
  } else {
    startAt = at;
  }
  applySideEffects(prev, next, false);
  ui.setSettings(settings);
  persist();
  ui.toast(`Playing “${fav.label}”`);
}

function favorite(): void {
  const cycle = heardCycle ?? startAt ?? 0;
  const summary = activeComposer().summary(cycle);
  favorites.add({
    seed: settings.seed,
    cycle,
    query: shareQuery(settings, cycle),
    label: `${SCENE_INFO[settings.scene].name} · ${summary.keyName} · ${STAGES[summary.stage].name}`,
  });
  ui.setFavorites(favorites.list());
  ui.toast('Saved to favourites ♥');
}

async function share(): Promise<void> {
  const at = heardCycle ?? startAt;
  const url = `${location.origin}${location.pathname}?${shareQuery(settings, at)}`;
  try {
    await navigator.clipboard.writeText(url);
    ui.toast('Link copied — it replays this exact moment');
  } catch {
    window.prompt('Copy this link to share the moment', url);
  }
}

// ---------------------------------------------------------------------------------------------
// Settings

const COMPOSE_KEYS = [
  'key',
  'mood',
  'busyness',
  'strict',
  'autoModulate',
  'chordStyle',
  'quotes',
] as const;

function matchingPreset(s: Settings): PresetId | 'custom' {
  const match = PRESET_IDS.find((id) => {
    const p = PRESETS[id];
    return (
      LAYER_IDS.every((l) => s.layers[l].on === p.layers[l]) &&
      s.melodyInstrument === p.melodyInstrument &&
      s.chordSound === p.chordSound &&
      s.chordStyle === p.chordStyle &&
      s.lofi === p.lofi
    );
  });
  return match ?? 'custom';
}

function audioDiff(prev: Settings, next: Settings): Partial<AudioSettings> {
  const out: Partial<AudioSettings> = {};
  if (prev.volume !== next.volume) out.masterVolume = next.volume;
  if (prev.melodyVolume !== next.melodyVolume) out.melodyVolume = next.melodyVolume;
  if (prev.melodyInstrument !== next.melodyInstrument) out.melodyInstrument = next.melodyInstrument;
  if (prev.chordSound !== next.chordSound) out.chordSound = next.chordSound;
  if (prev.lofi !== next.lofi) out.lofi = next.lofi;
  if (prev.mood !== next.mood) out.mood = next.mood;
  if (prev.scene !== next.scene) out.scene = next.scene;
  const layersChanged = LAYER_IDS.some(
    (id) =>
      prev.layers[id].on !== next.layers[id].on ||
      prev.layers[id].volume !== next.layers[id].volume,
  );
  if (layersChanged) out.layers = cloneSettings(next).layers;
  return out;
}

/** Pushes a settings change to the composer, scheduler, audio and visuals. */
function applySideEffects(prev: Settings, next: Settings, recompose = true): void {
  if (recompose && COMPOSE_KEYS.some((k) => prev[k] !== next[k])) {
    // Already-scheduled phrases stay as heard; the change shapes everything after them.
    activeComposer().updateSettings(
      toComposeSettings(next),
      scheduler ? scheduler.currentCycle : -1,
    );
  }
  if (prev.tempo !== next.tempo) scheduler?.setTempo(next.tempo);
  const patch = audioDiff(prev, next);
  if (audio && Object.keys(patch).length > 0) audio.update(patch);
  if (prev.scene !== next.scene) {
    stageEl.dataset.scene = next.scene;
    visuals?.setScene(next.scene);
  }
  if (prev.autoRotate !== next.autoRotate) visuals?.setAutoRotate(next.autoRotate);
  if (prev.reducedMotion !== next.reducedMotion) visuals?.setReducedMotion(reducedMotion());
}

function update(patch: Partial<Settings>): void {
  const prev = settings;
  const next: Settings = { ...cloneSettings(settings), ...patch };
  // Moods are presets: they also choose a fitting tempo.
  if (patch.mood && patch.mood !== prev.mood && patch.tempo === undefined)
    next.tempo = MOOD_TEMPO[patch.mood];
  if (!('preset' in patch)) next.preset = matchingPreset(next);
  settings = next;
  applySideEffects(prev, next);
  ui.setSettings(settings);
  persist();
}

function choosePreset(id: PresetId): void {
  const prev = settings;
  settings = applyPreset(settings, id);
  applySideEffects(prev, settings);
  ui.setSettings(settings);
  persist();
  ui.toast(`${PRESETS[id].label} — ${PRESETS[id].description.toLowerCase()}`);
}

let persistTimer = 0;
function persist(): void {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => saveSettings(storage, settings), 300);
}

// ---------------------------------------------------------------------------------------------
// Recording, zen, fullscreen, media session, keyboard

function formatBytes(bytes: number): string {
  return bytes > 1e6
    ? `${(bytes / 1e6).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

async function startRecording(minutes: number, format: RecordingFormat): Promise<void> {
  if (!audio) {
    ui.toast('Press play first');
    return;
  }
  try {
    await audio.startRecording(format);
    const endsAt = Date.now() + minutes * 60_000;
    recording = { timer: window.setTimeout(() => void stopRecording(), minutes * 60_000), endsAt };
    ui.setRecording({ available: true, recording: true, endsAt });
    if (scheduler && !scheduler.isPlaying) scheduler.resume();
  } catch (err) {
    console.error('[recording]', err);
    ui.toast('Recording is not supported in this browser');
  }
}

async function stopRecording(): Promise<void> {
  if (!audio || !recording) return;
  window.clearTimeout(recording.timer);
  recording = null;
  try {
    const result = await audio.stopRecording();
    if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    recordingUrl = URL.createObjectURL(result.blob);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    ui.setRecording({
      available: true,
      recording: false,
      result: {
        url: recordingUrl,
        filename: `endless-canon-${settings.seed}-${stamp}.${result.extension}`,
        sizeLabel: formatBytes(result.blob.size),
      },
    });
    ui.toast('Your recording is ready');
  } catch (err) {
    console.error('[recording]', err);
    ui.setRecording({ available: true, recording: false });
    ui.toast('Recording failed');
  }
}

function setZen(on: boolean): void {
  zen = on;
  ui.setZen(on);
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else
    void document.documentElement
      .requestFullscreen?.()
      .catch(() => ui.toast('Fullscreen is not available'));
}

function setupMediaSession(): void {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: 'Endless Canon',
    artist: 'After Pachelbel — composed live',
    album: `Seed ${settings.seed}`,
  });
  navigator.mediaSession.setActionHandler('play', () => scheduler?.resume());
  navigator.mediaSession.setActionHandler('pause', () => scheduler?.pause());
  navigator.mediaSession.setActionHandler('previoustrack', () => doRewind());
  navigator.mediaSession.setActionHandler('nexttrack', () => newPiece());
}

document.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  if (zen) {
    setZen(false);
    return;
  }
  if (!target.closest('.drawer, .popover, .bar')) ui.closePanels();
});

bindShortcuts({
  togglePlay: () => void togglePlay(),
  rewind: () => doRewind(),
  nextScene: () =>
    update({ scene: SCENE_IDS[(SCENE_IDS.indexOf(settings.scene) + 1) % SCENE_IDS.length] }),
  volume: (delta) => {
    const volume = Math.round(Math.min(1, Math.max(0, settings.volume + delta)) * 100) / 100;
    update({ volume });
    ui.toast(`Volume ${Math.round(volume * 100)}%`);
  },
  toggleMute: () => {
    if (volumeBeforeMute === null) {
      volumeBeforeMute = settings.volume;
      update({ volume: 0 });
      ui.toast('Muted');
    } else {
      update({ volume: volumeBeforeMute || 0.8 });
      volumeBeforeMute = null;
      ui.toast('Unmuted');
    }
  },
  toggleFullscreen,
  toggleZen: () => setZen(!zen),
  toggleSettings: () => ui.toggleSettings(),
  scene: (index) => update({ scene: SCENE_IDS[index] }),
  escape: () => {
    if (zen) setZen(false);
    else ui.closePanels();
  },
});

// ?debug shows frame rate, scheduling and memory, and exposes internals for automated checks.
if (new URLSearchParams(location.search).has('debug')) {
  const panel = document.createElement('pre');
  panel.className = 'debug';
  document.body.append(panel);
  window.setInterval(() => {
    const v = visuals?.stats();
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    panel.textContent = [
      `fps ${v ? v.fps.toFixed(0) : '–'} · ${v?.quality ?? '–'} · particles ${v?.particles ?? '–'}`,
      `phrase ${heardCycle ?? '–'} · scheduled ${scheduler?.currentCycle ?? '–'} · seed ${settings.seed}`,
      `heap ${memory ? `${Math.round(memory.usedJSHeapSize / 1048576)} MB` : 'n/a'}`,
    ].join('\n');
  }, 1000);
  Object.assign(window, {
    __canon: {
      bus,
      settings: () => settings,
      scheduler: () => scheduler,
      composer: activeComposer,
      visuals: () => visuals,
    },
  });
}
