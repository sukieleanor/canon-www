/** Shared domain types used by the music engine, audio, visuals and UI. */

export const SCENE_IDS = ['forest', 'lake', 'mountain', 'blossom', 'aurora', 'rain'] as const;
export type SceneId = (typeof SCENE_IDS)[number];

export const SCENE_INFO: Record<SceneId, { name: string; blurb: string }> = {
  forest: { name: 'Forest at dawn', blurb: 'Light rays, floating pollen, swaying trees' },
  lake: { name: 'Lake reflections', blurb: 'Ripples appear with each note' },
  mountain: { name: 'Mountain sunset', blurb: 'Clouds drift, colours shift with the chords' },
  blossom: { name: 'Cherry blossoms', blurb: 'Petals fall in rhythm' },
  aurora: { name: 'Night sky & aurora', blurb: 'Stars twinkle with notes, aurora waves with the bass' },
  rain: { name: 'Rainy meadow', blurb: 'Raindrops are notes, flowers bloom on phrase endings' },
};

export const STAGE_IDS = ['calm', 'flowing', 'lively', 'playful', 'ornamented', 'rest'] as const;
export type StageId = (typeof STAGE_IDS)[number];

export type Mode = 'major' | 'minor';

export const MOODS = ['bright', 'wistful', 'dreamy'] as const;
export type Mood = (typeof MOODS)[number];

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];

/** Parts produced by the composer. Part 'beat' uses General MIDI drum numbers (see DRUM). */
export type PartId = 'melody' | 'bass' | 'chords' | 'pad' | 'pizz' | 'beat';

/** Backing-track layers the listener can toggle and mix. */
export const LAYER_IDS = ['bass', 'chords', 'pad', 'pizz', 'beat', 'ambience'] as const;
export type LayerId = (typeof LAYER_IDS)[number];

export const MELODY_INSTRUMENTS = ['strings', 'piano', 'harp', 'flute', 'musicbox'] as const;
export type MelodyInstrumentId = (typeof MELODY_INSTRUMENTS)[number];

export type ChordSoundId = 'harpsichord' | 'piano';
export type ChordStyle = 'block' | 'broken';

export const PRESET_IDS = ['melody', 'quartet', 'orchestra', 'lofi'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

/** General MIDI drum numbers used by the lo-fi beat layer. */
export const DRUM = { kick: 36, rim: 37, snare: 38, closedHat: 42, openHat: 46 } as const;
