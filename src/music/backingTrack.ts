import { DRUM, type ChordStyle, type PartId, type StageId } from '../types';
import { TICKS_PER_CHORD } from './constants';
import type { ChordInstance } from './progression';
import type { Rng } from './random';
import type { ScoreNote } from './score';
import { mod } from './theory';

export interface BackingRequest {
  chords: readonly ChordInstance[];
  stage: StageId;
  chordStyle: ChordStyle;
  rng: Rng;
}

/** 0 = sparse, 1 = moving, 2 = busy — how much the accompaniment subdivides. */
const DENSITY: Record<StageId, number> = {
  calm: 0,
  rest: 0,
  flowing: 1,
  ornamented: 1,
  lively: 2,
  playful: 2,
};

function note(
  part: PartId,
  tick: number,
  dur: number,
  gate: number,
  midi: number,
  velocity: number,
  chord: number,
): ScoreNote {
  return {
    part,
    voice: 0,
    tick,
    dur,
    gate,
    midi,
    velocity: Math.min(1, Math.max(0.05, velocity)),
    orn: false,
    chord,
  };
}

/** Bass, chords, pad, pizzicato and lo-fi beat for one cycle (all layers; muting is the mixer's job). */
export function generateBacking(req: BackingRequest): ScoreNote[] {
  const out: ScoreNote[] = [];
  const { rng } = req;
  const density = DENSITY[req.stage];
  const jitter = () => rng.range(-0.025, 0.025);

  req.chords.forEach((ch, i) => {
    const t0 = i * TICKS_PER_CHORD;

    // Ground bass: the eight-note line, one half note per chord, always.
    out.push(
      note('bass', t0, TICKS_PER_CHORD, 0.94, ch.bassMidi, (i === 0 ? 0.68 : 0.6) + jitter(), i),
    );

    // Chords: harpsichord-style block strikes (slightly rolled) or broken arpeggios.
    if (req.chordStyle === 'block') {
      const strikes: [number, number, number][] =
        density === 0
          ? [[0, 96, 0.44]]
          : density === 1
            ? [
                [0, 48, 0.44],
                [48, 48, 0.34],
              ]
            : [
                [0, 48, 0.46],
                [48, 24, 0.32],
                [72, 24, 0.36],
              ];
      for (const [off, dur, vel] of strikes) {
        ch.voicing.forEach((midi, j) => {
          const roll = off === 0 ? j * 2 : 0;
          out.push(
            note(
              'chords',
              t0 + off + roll,
              dur - roll,
              density === 2 ? 0.7 : 0.95,
              midi,
              vel + jitter(),
              i,
            ),
          );
        });
      }
    } else {
      const order =
        density === 0 ? [0, 2] : density === 1 ? [0, 1, 2, 1] : [0, 2, 1, 2, 0, 2, 1, 2];
      const step = TICKS_PER_CHORD / order.length;
      order.forEach((k, j) => {
        out.push(
          note(
            'chords',
            t0 + j * step,
            step,
            1,
            ch.voicing[k],
            (j === 0 ? 0.42 : 0.34) + jitter(),
            i,
          ),
        );
      });
    }

    // Pad: one sustained, slightly overlapping chord per window.
    for (const midi of ch.pad) {
      out.push(
        note(
          'pad',
          t0,
          TICKS_PER_CHORD,
          1.05,
          midi,
          (req.stage === 'rest' ? 0.4 : 0.36) + jitter(),
          i,
        ),
      );
    }

    // Pizzicato: a light pulse on root, fifth and octave.
    const root = 48 + mod(ch.rootPc - 48, 12);
    const fifth = root + 7;
    const octave = root + 12;
    const pattern: [number, number, number][] =
      density === 0
        ? [
            [0, root, 0.52],
            [48, fifth, 0.42],
          ]
        : req.stage === 'playful'
          ? [
              [0, root, 0.55],
              [36, fifth, 0.42],
              [48, octave, 0.48],
              [84, fifth, 0.4],
            ]
          : [
              [0, root, 0.55],
              [24, fifth, 0.4],
              [48, octave, 0.48],
              [72, fifth, 0.4],
            ];
    for (const [off, midi, vel] of pattern)
      out.push(note('pizz', t0 + off, 18, 0.6, midi, vel + jitter(), i));
    if (req.stage === 'lively' && rng.chance(0.35)) {
      out.push(note('pizz', t0 + 84, 12, 0.6, octave, 0.36 + jitter(), i));
    }
  });

  // Lo-fi beat, one pattern per 4/4 bar (two chords).
  for (let bar = 0; bar < 4; bar++) {
    const t0 = bar * 2 * TICKS_PER_CHORD;
    const chord = bar * 2;
    const hit = (off: number, drum: number, vel: number) =>
      out.push(note('beat', t0 + off, 24, 1, drum, vel + jitter(), chord + (off >= 96 ? 1 : 0)));
    if (req.stage === 'rest') {
      hit(0, DRUM.kick, 0.45);
      for (const off of [0, 48, 96, 144]) hit(off, DRUM.closedHat, 0.17);
      continue;
    }
    if (density === 0) {
      hit(0, DRUM.kick, 0.5);
      hit(96, DRUM.rim, 0.34);
      for (const off of [0, 48, 96, 144]) hit(off, DRUM.closedHat, 0.2);
      continue;
    }
    hit(0, DRUM.kick, 0.56);
    hit(120, DRUM.kick, 0.44);
    hit(48, DRUM.snare, 0.42);
    hit(144, DRUM.snare, 0.46);
    for (let off = 0; off < 192; off += 24) {
      const offbeat = off % 48 !== 0;
      if (bar % 2 === 1 && off === 168 && rng.chance(0.5)) hit(off + 6, DRUM.openHat, 0.2);
      else hit(off + (offbeat ? 6 : 0), DRUM.closedHat, offbeat ? 0.15 : 0.22);
    }
    if (bar === 3 && rng.chance(0.5)) hit(168, DRUM.kick, 0.34);
  }
  return out;
}
