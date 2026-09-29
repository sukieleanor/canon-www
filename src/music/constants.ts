/** Musical time grid shared by the composer, scheduler and tests. */
export const TICKS_PER_BEAT = 48;
export const BEATS_PER_CHORD = 2;
export const CHORDS_PER_CYCLE = 8;
export const TICKS_PER_CHORD = TICKS_PER_BEAT * BEATS_PER_CHORD;
export const BEATS_PER_CYCLE = BEATS_PER_CHORD * CHORDS_PER_CYCLE;
export const TICKS_PER_CYCLE = TICKS_PER_CHORD * CHORDS_PER_CYCLE;

/** Absolute melody range (D4–D6) shared by every key, so modulations never jump register. */
export const MELODY_LOW_MIDI = 62;
export const MELODY_HIGH_MIDI = 86;

export const VOICE_COUNT = 3;

/** Cycles between automatic key changes (about five minutes at the default tempo). */
export const MODULATION_PERIOD = 28;

/** Share links may fast-forward at most this many phrases. */
export const MAX_START_CYCLE = 2000;
