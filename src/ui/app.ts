import type { RecordingFormat } from '../audio/types';
import type { Favorite } from '../music/history';
import type { PhraseSummary } from '../music/score';
import { STAGES } from '../music/stages';
import { TONIC_IDS, tonicLabel, tonicPcOf } from '../music/theory';
import { PRESETS, type ReducedMotionPref, type Settings, TEMPO_RANGE } from '../state/settings';
import {
  LAYER_IDS,
  MELODY_INSTRUMENTS,
  MOODS,
  PRESET_IDS,
  SCENE_IDS,
  SCENE_INFO,
  type ChordSoundId,
  type ChordStyle,
  type LayerId,
  type MelodyInstrumentId,
  type Mood,
  type PresetId,
  type SceneId,
  type StageId,
} from '../types';
import { clearChildren, h } from './dom';
import { icon, type IconName } from './icons';
import { SHORTCUTS } from './keyboard';

export interface UiCallbacks {
  togglePlay(): void;
  rewind(): void;
  rewindTo(cycle: number): void;
  favorite(): void;
  share(): void;
  change(patch: Partial<Settings>): void;
  layer(id: LayerId, patch: { on?: boolean; volume?: number }): void;
  preset(id: PresetId): void;
  scene(id: SceneId): void;
  newPiece(seed?: string): void;
  loadFavorite(fav: Favorite): void;
  removeFavorite(id: string): void;
  record(minutes: number, format: RecordingFormat): void;
  stopRecording(): void;
  zen(on: boolean): void;
  fullscreen(): void;
}

export interface NowPlaying {
  cycle: number;
  stage: StageId;
  keyName: string;
  voices: number;
  quote: boolean;
}

export interface RecordingView {
  available: boolean;
  recording: boolean;
  endsAt?: number;
  result?: { url: string; filename: string; sizeLabel: string } | null;
}

const LAYER_LABELS: Record<LayerId, { name: string; hint: string }> = {
  bass: { name: 'Ground bass', hint: 'Cello & contrabass' },
  chords: { name: 'Chords', hint: 'Harpsichord or soft piano' },
  pad: { name: 'String pad', hint: 'Warm sustained strings' },
  pizz: { name: 'Pizzicato', hint: 'Plucked pulse' },
  beat: { name: 'Lo-fi beat', hint: 'Soft drums' },
  ambience: { name: 'Nature ambience', hint: 'Follows the scene' },
};

const INSTRUMENT_LABELS: Record<MelodyInstrumentId, string> = {
  strings: 'Strings',
  piano: 'Piano',
  harp: 'Harp',
  flute: 'Flute',
  musicbox: 'Music box',
};

const MOOD_LABELS: Record<Mood, string> = {
  bright: 'Bright',
  wistful: 'Wistful',
  dreamy: 'Dreamy',
};
const MOOD_HINTS: Record<Mood, string> = {
  bright: 'Major key',
  wistful: 'Minor key',
  dreamy: 'Slower, with more reverb',
};

/** Painted swatches for the scene picker. */
const SCENE_SWATCH: Record<SceneId, string> = {
  forest: 'linear-gradient(165deg, #f8dcae 0%, #c8b98a 35%, #6f8f6c 62%, #2c4436 100%)',
  lake: 'linear-gradient(180deg, #a9c8e8 0%, #ecd4c2 44%, #5d7c9b 52%, #273c55 100%)',
  mountain: 'linear-gradient(180deg, #f9b981 0%, #d57a86 40%, #5b4470 72%, #231b32 100%)',
  blossom: 'linear-gradient(170deg, #fde7ee 0%, #f6bccd 48%, #c08aa8 78%, #6f5a78 100%)',
  aurora: 'linear-gradient(180deg, #050c18 0%, #0d3242 40%, #33c79a 58%, #0a1526 100%)',
  rain: 'linear-gradient(180deg, #98a8b6 0%, #7a8e9c 45%, #5b7a64 70%, #34503c 100%)',
};

interface SliderRefs {
  input: HTMLInputElement;
  output: HTMLOutputElement;
  format: (value: number) => string;
}

function iconButton(
  name: IconName,
  label: string,
  onClick: () => void,
  extra: Record<string, string> = {},
): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: 'btn', 'aria-label': label, title: label, onClick, ...extra },
    icon(name),
  );
}

function busyLabel(v: number): string {
  return v < 0.34 ? 'Calm' : v < 0.67 ? 'Balanced' : 'Lively';
}

export class AppUi {
  private readonly cb: UiCallbacks;
  private started = false;
  private playing = false;
  private drawerOpen = false;
  private scenesOpen = false;
  private toastTimer = 0;
  private recordTimer = 0;

  private readonly intro: HTMLElement;
  private readonly bigPlay: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly chordEl: HTMLElement;
  private readonly dots: HTMLElement[] = [];
  private readonly metaEl: HTMLElement;
  private readonly quoteEl: HTMLElement;
  private readonly loadingEl: HTMLElement;
  private readonly drawer: HTMLElement;
  private readonly settingsBtn: HTMLButtonElement;
  private readonly sceneBtn: HTMLButtonElement;
  private readonly scenePopover: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly historyEl: HTMLElement;
  private readonly favoritesEl: HTMLElement;
  private readonly recordBtn: HTMLButtonElement;
  private readonly recordStatus: HTMLElement;
  private readonly recordResult: HTMLElement;
  private readonly seedInput: HTMLInputElement;
  private readonly sliders: Partial<Record<string, SliderRefs>> = {};
  private readonly switches: Partial<Record<string, HTMLButtonElement>> = {};
  private readonly segments: Partial<Record<string, Map<string, HTMLButtonElement>>> = {};
  private readonly selects: Partial<Record<string, HTMLSelectElement>> = {};
  private readonly sceneCards: HTMLButtonElement[] = [];
  private recordMinutes = 2;
  private recordFormat: RecordingFormat = 'wav';

  constructor(
    root: HTMLElement,
    settings: Settings,
    cb: UiCallbacks,
    shared: { seed: string; at: number | null } | null,
  ) {
    this.cb = cb;

    // Landing
    this.bigPlay = h(
      'button',
      { type: 'button', class: 'play-big', 'aria-label': 'Play', onClick: () => cb.togglePlay() },
      icon('play'),
    );
    this.intro = h(
      'section',
      { class: 'intro', 'aria-labelledby': 'intro-title' },
      h(
        'div',
        { class: 'intro__card' },
        h('p', { class: 'intro__eyebrow' }, 'A never-ending canon'),
        h('h1', { class: 'intro__title', id: 'intro-title' }, 'Endless Canon'),
        h(
          'p',
          { class: 'intro__subtitle' },
          'A melody inspired by Pachelbel’s Canon in D, composed live and never the same twice — with calm nature scenes that listen along.',
        ),
        this.bigPlay,
        h(
          'p',
          { class: 'intro__hint' },
          shared
            ? `Shared piece · seed ${shared.seed}${shared.at ? ` · from phrase ${shared.at}` : ''}`
            : 'Headphones recommended · press Space to play',
        ),
      ),
    );

    // Control bar
    this.playBtn = iconButton('play', 'Play', () => cb.togglePlay(), { class: 'btn btn--primary' });
    this.chordEl = h('span', { class: 'now__chord', 'aria-label': 'Current chord' }, 'D');
    const dotsEl = h('span', { class: 'now__dots', 'aria-hidden': 'true' });
    for (let i = 0; i < 8; i++) {
      const dot = h('span', { class: 'now__dot' });
      this.dots.push(dot);
      dotsEl.append(dot);
    }
    this.metaEl = h('span', { class: 'now__meta' }, 'Press play to begin');
    this.quoteEl = h('span', { class: 'now__quote', hidden: true }, '♪ a nod to Pachelbel');
    this.loadingEl = h('div', {
      class: 'bar__loading',
      role: 'progressbar',
      'aria-label': 'Loading instruments',
      hidden: true,
    });
    this.sceneBtn = iconButton('scene', 'Scenes', () => this.toggleScenes(), {
      'aria-expanded': 'false',
    });
    this.settingsBtn = iconButton('sliders', 'Settings', () => this.toggleSettings(), {
      'aria-expanded': 'false',
      'aria-controls': 'settings',
    });
    const bar = h(
      'nav',
      { class: 'bar', 'aria-label': 'Player' },
      this.loadingEl,
      h(
        'div',
        { class: 'bar__group' },
        this.playBtn,
        iconButton('rewind', 'Rewind to the previous phrase (←)', () => cb.rewind()),
        iconButton('heart', 'Save to favourites', () => cb.favorite()),
        iconButton('link', 'Copy a share link', () => cb.share()),
      ),
      h(
        'div',
        { class: 'now' },
        h('div', { class: 'now__row' }, this.chordEl, dotsEl),
        h('div', { class: 'now__row' }, this.metaEl, this.quoteEl),
      ),
      h(
        'div',
        { class: 'bar__group bar__group--end' },
        this.sceneBtn,
        this.settingsBtn,
        iconButton('zen', 'Zen mode (Z)', () => cb.zen(true)),
        iconButton('fullscreen', 'Fullscreen (F)', () => cb.fullscreen(), {
          class: 'btn btn--fullscreen',
        }),
      ),
    );

    // Scene popover
    this.scenePopover = h(
      'div',
      { class: 'popover', role: 'dialog', 'aria-label': 'Scenes', hidden: true },
      this.sceneGrid('compact'),
      this.switchRow(
        'autoRotatePopover',
        'Auto-rotate scenes',
        'Drift to a new scene every few minutes',
        (on) => cb.change({ autoRotate: on }),
      ),
    );

    // Settings drawer
    this.seedInput = h('input', {
      class: 'field__input',
      type: 'text',
      inputmode: 'numeric',
      maxlength: 32,
      pattern: '[A-Za-z0-9_-]+',
      'aria-label': 'Seed',
    });
    this.historyEl = h('div', { class: 'chips', role: 'list' });
    this.favoritesEl = h('ul', { class: 'favs' });
    this.recordBtn = h(
      'button',
      { type: 'button', class: 'pill pill--record', onClick: () => this.onRecordClick() },
      icon('record'),
      h('span', {}, 'Record'),
    );
    this.recordStatus = h('span', { class: 'hint', 'aria-live': 'polite' }, 'Press play first');
    this.recordResult = h('div', { class: 'record__result' });
    this.drawer = h(
      'aside',
      { class: 'drawer', id: 'settings', 'aria-label': 'Settings', hidden: true },
      h(
        'header',
        { class: 'drawer__head' },
        h('h2', {}, 'Settings'),
        iconButton('close', 'Close settings', () => this.toggleSettings(false)),
      ),
      this.musicSection(),
      this.backingSection(),
      this.scenesSection(),
      this.sessionSection(),
      this.shortcutsSection(),
      this.aboutSection(),
    );

    this.toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    const zenHint = h(
      'div',
      { class: 'zen-hint', 'aria-hidden': 'true' },
      'Zen mode · tap or press Z to show controls',
    );

    root.append(this.intro, bar, this.scenePopover, this.drawer, this.toastEl, zenHint);
    this.setSettings(settings);
  }

  // -------------------------------------------------------------------------------------------
  // Public updates

  setPlaying(playing: boolean): void {
    this.playing = playing;
    if (playing && !this.started) {
      this.started = true;
      this.intro.classList.add('intro--gone');
      window.setTimeout(() => this.intro.setAttribute('hidden', ''), 900);
    }
    document.body.classList.toggle('is-playing', playing);
    const label = playing ? 'Pause' : 'Play';
    this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play'));
    this.playBtn.setAttribute('aria-label', `${label} (Space)`);
    this.playBtn.title = `${label} (Space)`;
    if (!playing && this.started) this.metaEl.dataset.paused = 'true';
    else delete this.metaEl.dataset.paused;
  }

  setLoading(progress: number | null): void {
    if (progress === null || progress >= 1) {
      this.loadingEl.setAttribute('hidden', '');
      return;
    }
    this.loadingEl.removeAttribute('hidden');
    this.loadingEl.style.setProperty('--progress', String(Math.max(0.04, progress)));
    this.loadingEl.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  }

  setNowPlaying(info: NowPlaying): void {
    const stage = STAGES[info.stage].name;
    const voices =
      info.voices === 0 ? 'ground bass' : `${info.voices} voice${info.voices > 1 ? 's' : ''}`;
    this.metaEl.textContent = `${info.keyName} · ${stage} · phrase ${info.cycle} · ${voices}`;
    this.quoteEl.toggleAttribute('hidden', !info.quote);
  }

  setChord(index: number, name: string): void {
    this.chordEl.textContent = name;
    this.dots.forEach((dot, i) => dot.classList.toggle('is-on', i === index));
  }

  setSettings(s: Settings): void {
    this.setSlider('tempo', s.tempo);
    this.setSlider('busyness', s.busyness);
    this.setSlider('volume', s.volume);
    this.setSlider('melodyVolume', s.melodyVolume);
    for (const id of LAYER_IDS) {
      this.setSlider(`layer-${id}`, s.layers[id].volume);
      this.setSwitch(`layer-${id}`, s.layers[id].on);
    }
    this.setSelect('key', s.key);
    this.setSelect('instrument', s.melodyInstrument);
    this.setSegment('mood', s.mood);
    this.setSegment('preset', s.preset);
    this.setSegment('chordStyle', s.chordStyle);
    this.setSegment('chordSound', s.chordSound);
    this.setSegment('reducedMotion', s.reducedMotion);
    this.setSwitch('autoModulate', s.autoModulate);
    this.setSwitch('strict', s.strict);
    this.setSwitch('quotes', s.quotes);
    this.setSwitch('lofi', s.lofi);
    this.setSwitch('autoRotate', s.autoRotate);
    this.setSwitch('autoRotatePopover', s.autoRotate);
    for (const card of this.sceneCards) {
      const on = card.dataset.scene === s.scene;
      card.classList.toggle('is-on', on);
      card.setAttribute('aria-pressed', String(on));
    }
    if (document.activeElement !== this.seedInput) this.seedInput.value = s.seed;
  }

  setHistory(items: readonly PhraseSummary[], current: number | null): void {
    clearChildren(this.historyEl);
    if (items.length === 0) {
      this.historyEl.append(h('span', { class: 'hint' }, 'Phrases you hear appear here.'));
      return;
    }
    for (const item of items) {
      const chip = h(
        'button',
        {
          type: 'button',
          class: `chip${item.cycle === current ? ' is-on' : ''}`,
          role: 'listitem',
          title: `${item.keyName} · ${STAGES[item.stage].feel}`,
          onClick: () => this.cb.rewindTo(item.cycle),
        },
        h('span', { class: 'chip__num' }, String(item.cycle)),
        STAGES[item.stage].name,
        item.quote ? ' ♪' : '',
      );
      this.historyEl.append(chip);
    }
  }

  setFavorites(list: readonly Favorite[]): void {
    clearChildren(this.favoritesEl);
    if (list.length === 0) {
      this.favoritesEl.append(
        h('li', { class: 'hint' }, 'Tap ♡ in the player to keep a moment you love.'),
      );
      return;
    }
    for (const fav of list) {
      const when = new Date(fav.savedAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      });
      this.favoritesEl.append(
        h(
          'li',
          { class: 'fav' },
          h(
            'button',
            { type: 'button', class: 'fav__load', onClick: () => this.cb.loadFavorite(fav) },
            h('span', { class: 'fav__label' }, fav.label),
            h('span', { class: 'fav__meta' }, `seed ${fav.seed} · phrase ${fav.cycle} · ${when}`),
          ),
          h(
            'button',
            {
              type: 'button',
              class: 'btn btn--small',
              'aria-label': `Remove ${fav.label}`,
              title: 'Remove',
              onClick: () => this.cb.removeFavorite(fav.id),
            },
            icon('trash'),
          ),
        ),
      );
    }
  }

  setRecording(view: RecordingView): void {
    window.clearInterval(this.recordTimer);
    this.recordBtn.disabled = !view.available;
    this.recordBtn.classList.toggle('is-recording', view.recording);
    this.recordBtn.replaceChildren(
      icon(view.recording ? 'stop' : 'record'),
      h('span', {}, view.recording ? 'Stop' : 'Record'),
    );
    if (view.recording && view.endsAt) {
      const tick = () => {
        const left = Math.max(0, Math.round(((view.endsAt ?? 0) - Date.now()) / 1000));
        this.recordStatus.textContent = `Recording… ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left`;
      };
      tick();
      this.recordTimer = window.setInterval(tick, 1000);
    } else {
      this.recordStatus.textContent = view.available
        ? 'Captures exactly what you hear'
        : 'Press play first';
    }
    clearChildren(this.recordResult);
    if (view.result) {
      this.recordResult.append(
        h(
          'a',
          { class: 'pill', href: view.result.url, download: view.result.filename },
          icon('download'),
          h('span', {}, `Download ${view.result.sizeLabel}`),
        ),
      );
    }
  }

  toast(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = message;
    this.toastEl.classList.add('is-on');
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('is-on'), 2800);
  }

  toggleSettings(open = !this.drawerOpen): void {
    this.drawerOpen = open;
    if (open) this.toggleScenes(false);
    this.drawer.toggleAttribute('hidden', !open);
    requestAnimationFrame(() => this.drawer.classList.toggle('is-open', open));
    this.settingsBtn.setAttribute('aria-expanded', String(open));
    if (open) (this.drawer.querySelector('button, input, select') as HTMLElement | null)?.focus();
    else if (this.drawer.contains(document.activeElement)) this.settingsBtn.focus();
  }

  toggleScenes(open = !this.scenesOpen): void {
    this.scenesOpen = open;
    if (open && this.drawerOpen) this.toggleSettings(false);
    this.scenePopover.toggleAttribute('hidden', !open);
    this.sceneBtn.setAttribute('aria-expanded', String(open));
  }

  /** Closes whatever is open; returns true if something was closed. */
  closePanels(): boolean {
    const any = this.drawerOpen || this.scenesOpen;
    if (this.drawerOpen) this.toggleSettings(false);
    if (this.scenesOpen) this.toggleScenes(false);
    return any;
  }

  setZen(on: boolean): void {
    if (on) this.closePanels();
    document.body.classList.toggle('zen', on);
  }

  // -------------------------------------------------------------------------------------------
  // Sections

  private musicSection(): HTMLElement {
    const keySelect = h(
      'select',
      {
        class: 'field__input',
        onChange: (e: Event) =>
          this.cb.change({ key: (e.target as HTMLSelectElement).value as Settings['key'] }),
      },
      ...TONIC_IDS.map((id) => h('option', { value: id }, tonicLabel(tonicPcOf(id)))),
    );
    this.selects.key = keySelect;
    const instrument = h(
      'select',
      {
        class: 'field__input',
        onChange: (e: Event) =>
          this.cb.change({
            melodyInstrument: (e.target as HTMLSelectElement).value as MelodyInstrumentId,
          }),
      },
      ...MELODY_INSTRUMENTS.map((id) => h('option', { value: id }, INSTRUMENT_LABELS[id])),
    );
    this.selects.instrument = instrument;
    return this.section(
      'Music',
      this.slider(
        'tempo',
        'Tempo',
        TEMPO_RANGE.min,
        TEMPO_RANGE.max,
        1,
        (v) => `${v} BPM`,
        (v) => this.cb.change({ tempo: v }),
      ),
      this.slider('busyness', 'Busyness', 0, 1, 0.01, busyLabel, (v) =>
        this.cb.change({ busyness: v }),
      ),
      this.slider(
        'volume',
        'Volume',
        0,
        1,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => this.cb.change({ volume: v }),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Mood'),
        this.segmented(
          'mood',
          MOODS.map((m) => [m, MOOD_LABELS[m], MOOD_HINTS[m]]),
          (v) => this.cb.change({ mood: v as Mood }),
        ),
      ),
      h(
        'div',
        { class: 'field-grid' },
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Key'), keySelect),
        h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Melody'), instrument),
      ),
      this.switchRow(
        'autoModulate',
        'Drift to related keys',
        'Every ~5 minutes, like seasons turning (D → A → G)',
        (on) => this.cb.change({ autoModulate: on }),
      ),
      this.switchRow(
        'strict',
        'Strict counterpoint',
        'Keep the voices free of parallel fifths and octaves',
        (on) => this.cb.change({ strict: on }),
      ),
      this.switchRow(
        'quotes',
        'Nods to Pachelbel',
        'Now and then, echo the famous descending line',
        (on) => this.cb.change({ quotes: on }),
      ),
    );
  }

  private backingSection(): HTMLElement {
    const presets = this.segmented(
      'preset',
      PRESET_IDS.map((id) => [id, PRESETS[id].label, PRESETS[id].description]),
      (v) => this.cb.preset(v as PresetId),
      'segmented segmented--grid',
    );
    const layers = LAYER_IDS.map((id) =>
      h(
        'div',
        { class: 'layer' },
        this.switchButton(`layer-${id}`, `${LAYER_LABELS[id].name} on/off`, (on) =>
          this.cb.layer(id, { on }),
        ),
        h(
          'div',
          { class: 'layer__text' },
          h('span', {}, LAYER_LABELS[id].name),
          h('span', { class: 'hint' }, LAYER_LABELS[id].hint),
        ),
        this.rangeOnly(`layer-${id}`, `${LAYER_LABELS[id].name} volume`, (v) =>
          this.cb.layer(id, { volume: v }),
        ),
      ),
    );
    return this.section(
      'Backing track',
      presets,
      this.slider(
        'melodyVolume',
        'Melody',
        0,
        1,
        0.01,
        (v) => `${Math.round(v * 100)}%`,
        (v) => this.cb.change({ melodyVolume: v }),
      ),
      h('div', { class: 'layers' }, ...layers),
      h(
        'div',
        { class: 'field-grid' },
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field__label' }, 'Chords'),
          this.segmented(
            'chordStyle',
            [
              ['block', 'Block'],
              ['broken', 'Broken'],
            ],
            (v) => this.cb.change({ chordStyle: v as ChordStyle }),
          ),
        ),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'field__label' }, 'Chord sound'),
          this.segmented(
            'chordSound',
            [
              ['harpsichord', 'Harpsichord'],
              ['piano', 'Piano'],
            ],
            (v) => this.cb.change({ chordSound: v as ChordSoundId }),
          ),
        ),
      ),
      this.switchRow('lofi', 'Lo-fi texture', 'Warm tape tone and vinyl crackle', (on) =>
        this.cb.change({ lofi: on }),
      ),
    );
  }

  private scenesSection(): HTMLElement {
    return this.section(
      'Scenes',
      this.sceneGrid('full'),
      this.switchRow(
        'autoRotate',
        'Auto-rotate scenes',
        'Drift to a new scene every few minutes',
        (on) => this.cb.change({ autoRotate: on }),
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Reduced motion'),
        this.segmented(
          'reducedMotion',
          [
            ['auto', 'System'],
            ['on', 'On'],
            ['off', 'Off'],
          ],
          (v) => this.cb.change({ reducedMotion: v as ReducedMotionPref }),
        ),
      ),
    );
  }

  private sessionSection(): HTMLElement {
    const minutes = h(
      'select',
      {
        class: 'field__input',
        'aria-label': 'Recording length',
        onChange: (e: Event) =>
          (this.recordMinutes = Number((e.target as HTMLSelectElement).value)),
      },
      ...[1, 2, 3, 4, 5].map((m) =>
        h('option', { value: m, selected: m === this.recordMinutes }, `${m} min`),
      ),
    );
    const format = this.segmented(
      'recordFormat',
      [
        ['wav', 'WAV', 'Lossless'],
        ['compressed', 'Compressed', 'Smaller file (Opus/AAC)'],
      ],
      (v) => {
        this.recordFormat = v as RecordingFormat;
        this.setSegment('recordFormat', v);
      },
    );
    this.setSegment('recordFormat', this.recordFormat);
    const seedForm = h(
      'form',
      {
        class: 'seed',
        onSubmit: (e: Event) => {
          e.preventDefault();
          const value = this.seedInput.value.trim();
          if (/^[\w-]{1,32}$/.test(value)) this.cb.newPiece(value);
          else this.toast('Seeds use letters, digits, - and _');
        },
      },
      this.seedInput,
      h('button', { type: 'submit', class: 'pill' }, 'Play seed'),
      h(
        'button',
        { type: 'button', class: 'pill', onClick: () => this.cb.newPiece() },
        icon('sparkle'),
        h('span', {}, 'New piece'),
      ),
    );
    return this.section(
      'Session',
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Seed — same seed, same music'),
        seedForm,
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Rewind — the last ten phrases'),
        this.historyEl,
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Favourites'),
        this.favoritesEl,
      ),
      h(
        'div',
        { class: 'field' },
        h('span', { class: 'field__label' }, 'Record'),
        h('div', { class: 'record' }, minutes, format, this.recordBtn),
        this.recordStatus,
        this.recordResult,
      ),
    );
  }

  private shortcutsSection(): HTMLElement {
    return this.section(
      'Keyboard',
      h(
        'dl',
        { class: 'keys' },
        ...SHORTCUTS.flatMap(([key, what]) => [h('dt', {}, h('kbd', {}, key)), h('dd', {}, what)]),
      ),
    );
  }

  private aboutSection(): HTMLElement {
    return this.section(
      'About',
      h(
        'p',
        { class: 'hint' },
        'The chord loop, ground bass and round are Pachelbel’s (public domain); every melody is generated live from your seed. Instrument samples: Salamander Grand Piano (CC BY 3.0) and VSCO 2 Community Edition (CC0). ',
        h('a', { href: 'samples/CREDITS.md', target: '_blank', rel: 'noopener' }, 'Full credits'),
        '.',
      ),
    );
  }

  // -------------------------------------------------------------------------------------------
  // Building blocks

  private section(title: string, ...children: HTMLElement[]): HTMLElement {
    return h('section', { class: 'panel' }, h('h3', { class: 'panel__title' }, title), ...children);
  }

  private sceneGrid(variant: 'compact' | 'full'): HTMLElement {
    return h(
      'div',
      { class: `scenes scenes--${variant}` },
      ...SCENE_IDS.map((id, i) => {
        const card = h(
          'button',
          {
            type: 'button',
            class: 'scene-card',
            'data-scene': id,
            'aria-pressed': 'false',
            title: `${SCENE_INFO[id].blurb} (${i + 1})`,
            onClick: () => this.cb.scene(id),
          },
          h('span', { class: 'scene-card__swatch', style: `background:${SCENE_SWATCH[id]}` }),
          h('span', { class: 'scene-card__name' }, SCENE_INFO[id].name),
        );
        this.sceneCards.push(card);
        return card;
      }),
    );
  }

  private slider(
    key: string,
    label: string,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    onInput: (v: number) => void,
  ): HTMLElement {
    const id = `ctl-${key}`;
    const input = h('input', { id, class: 'range', type: 'range', min, max, step });
    const output = h('output', { class: 'field__value', for: id });
    input.addEventListener('input', () => {
      const v = Number(input.value);
      output.textContent = format(v);
      onInput(v);
    });
    this.sliders[key] = { input, output, format };
    return h(
      'div',
      { class: 'field' },
      h(
        'div',
        { class: 'field__row' },
        h('label', { class: 'field__label', for: id }, label),
        output,
      ),
      input,
    );
  }

  private rangeOnly(key: string, label: string, onInput: (v: number) => void): HTMLInputElement {
    const input = h('input', {
      class: 'range range--small',
      type: 'range',
      min: 0,
      max: 1,
      step: 0.01,
      'aria-label': label,
    });
    input.addEventListener('input', () => onInput(Number(input.value)));
    this.sliders[key] = { input, output: h('output'), format: String };
    return input;
  }

  private switchButton(
    key: string,
    label: string,
    onChange: (on: boolean) => void,
  ): HTMLButtonElement {
    const btn = h('button', {
      type: 'button',
      class: 'switch',
      role: 'switch',
      'aria-checked': 'false',
      'aria-label': label,
    });
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(on));
      onChange(on);
    });
    this.switches[key] = btn;
    return btn;
  }

  private switchRow(
    key: string,
    label: string,
    hint: string,
    onChange: (on: boolean) => void,
  ): HTMLElement {
    return h(
      'div',
      { class: 'switch-row' },
      h(
        'div',
        { class: 'switch-row__text' },
        h('span', {}, label),
        h('span', { class: 'hint' }, hint),
      ),
      this.switchButton(key, label, onChange),
    );
  }

  private segmented(
    key: string,
    options: ([string, string] | [string, string, string])[],
    onPick: (value: string) => void,
    className = 'segmented',
  ): HTMLElement {
    const map = new Map<string, HTMLButtonElement>();
    const group = h('div', { class: className, role: 'group' });
    for (const [value, label, hint] of options) {
      const btn = h(
        'button',
        {
          type: 'button',
          class: 'segmented__btn',
          'aria-pressed': 'false',
          title: hint,
          onClick: () => onPick(value),
        },
        label,
      );
      map.set(value, btn);
      group.append(btn);
    }
    this.segments[key] = map;
    return group;
  }

  private setSlider(key: string, value: number): void {
    const s = this.sliders[key];
    if (!s) return;
    if (document.activeElement !== s.input) s.input.value = String(value);
    s.output.textContent = s.format(value);
  }

  private setSwitch(key: string, on: boolean): void {
    this.switches[key]?.setAttribute('aria-checked', String(on));
  }

  private setSegment(key: string, value: string): void {
    this.segments[key]?.forEach((btn, v) => btn.setAttribute('aria-pressed', String(v === value)));
  }

  private setSelect(key: string, value: string): void {
    const select = this.selects[key];
    if (select) select.value = value;
  }

  private onRecordClick(): void {
    if (this.recordBtn.classList.contains('is-recording')) this.cb.stopRecording();
    else this.cb.record(this.recordMinutes, this.recordFormat);
  }

  isPlaying(): boolean {
    return this.playing;
  }
}
