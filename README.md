# Endless Canon

A website that composes a never-ending, always-changing melody inspired by **Pachelbel's Canon in D**,
paired with calm, generative nature visuals. Every listen is new, but it always _feels_ like the
Canon.

- **Canon DNA, always** — the eight-chord loop (I V vi iii IV I IV V) over Pachelbel's walking ground
  bass (D A B F♯ G D G A), and a real round: three voices, each repeating the leader's phrase one and
  two cycles later, entering one by one like the original.
- **New melodies, never copied** — every phrase is generated live from a seed under Baroque
  voice-leading rules, and checked so it never reproduces one of Pachelbel's phrases. Now and then it
  nods to the famous descending line — varied, so it's a nod, not a copy.
- **Endless variation** — six stages (calm → flowing → lively → playful → ornamented → rest), each
  lasting 2–6 cycles, remixed forever; a _Busyness_ slider tilts the balance.
- **Keys, moods and seasons** — any of 12 keys; _Bright_ (major), _Wistful_ (the minor loop
  i v VI III iv i iv V) and _Dreamy_ (slower, more reverb); optional drift to related keys
  (D → A → G) every ~5 minutes through pivot chords, which also turns the visual seasons.
- **Optional backing track** — ground bass (cello), chords (harpsichord or soft piano, block or
  broken), string pad, pizzicato, a soft lo-fi beat with vinyl crackle, and nature ambience that
  follows the scene. Presets: _Melody only_, _Classic quartet_, _Full orchestra_, _Lo-fi_.
- **Six nature scenes** — forest at dawn, lake reflections, mountain sunset, cherry blossoms, night
  sky & aurora, rainy meadow — that react to notes, chords, bass, busyness, stages (time of day and
  weather) and key changes (seasons).
- **Made for listening** — share links that replay the exact moment, _Rewind_ through the last ten
  phrases, favourites, recording to WAV or a compressed file, zen mode, fullscreen, keyboard shortcuts,
  reduced motion and a volume limiter.

## Getting started

Requires Node 22+ and pnpm 10.

```sh
pnpm install
pnpm dev          # http://localhost:5173
pnpm test         # music-engine test suite (vitest)
pnpm build        # type-check + production build into dist/
pnpm preview      # serve the production build
```

Development harnesses (served by `pnpm dev`, not part of the production build):

- `/dev/visuals.html` — drives the visual engine with a synthetic musical event stream, with scene,
  season and stage controls.
- `/dev/audio.html` — plays each instrument, layer and ambience bed, and exercises recording.

Add `?debug` to the app URL for a frame-rate / scheduling / memory overlay.

## Using it

Press **Play** (browsers only allow audio after a click or key press). The bar at the bottom shows the
current chord and its place in the eight-chord loop, the key, stage and phrase number.

| Key   | Action                                         |
| ----- | ---------------------------------------------- |
| Space | Play / pause                                   |
| ←     | Rewind to the previous phrase (up to ten back) |
| →     | Next scene                                     |
| 1 – 6 | Pick a scene                                   |
| ↑ / ↓ | Volume                                         |
| M     | Mute                                           |
| S     | Settings                                       |
| Z     | Zen mode (hides every control)                 |
| F     | Fullscreen                                     |
| Esc   | Close panels / leave zen                       |

### Seeds and share links

A piece is fully determined by its **seed** and the composition settings, so the same link always
plays the same music. _Share_ copies a link that also records the phrase you are hearing (`at=`), so
the listener starts at that exact moment. Supported query parameters:

| Parameter | Meaning                                                            |
| --------- | ------------------------------------------------------------------ |
| `seed`    | Seed (letters, digits, `-`, `_`)                                   |
| `at`      | Phrase to start from                                               |
| `key`     | Tonic: `C Db D Eb E F F# G Ab A Bb B`                              |
| `mood`    | `bright`, `wistful` or `dreamy`                                    |
| `tempo`   | Beats per minute (56–132; one chord lasts two beats)               |
| `busy`    | Busyness 0–100                                                     |
| `mod`     | Drift to related keys: `1` / `0`                                   |
| `strict`  | `1` = strict counterpoint (no parallel fifths or octaves)          |
| `q`       | `0` = no nods to Pachelbel's line                                  |
| `chords`  | `broken` for arpeggiated chords                                    |
| `preset`  | `melody`, `quartet`, `orchestra` or `lofi`                         |
| `inst`    | Melody instrument: `strings`, `piano`, `harp`, `flute`, `musicbox` |
| `scene`   | `forest`, `lake`, `mountain`, `blossom`, `aurora` or `rain`        |

## How it works

```
src/
├── main.ts               app controller: settings ↔ composer ↔ scheduler ↔ audio ↔ visuals ↔ UI
├── events.ts             typed event bus (noteOn, chordChange, bassNote, stageChange, keyChange, …)
├── types.ts              shared domain types
├── state/settings.ts     defaults, presets, share-link and localStorage (de)serialisation
├── music/                pure TypeScript, no audio — fully unit-tested
│   ├── theory.ts         scales, degrees ↔ MIDI, key spelling
│   ├── progression.ts    the Canon loop, ground bass, voicings, modulation pivots
│   ├── stages.ts         the six variation stages and their stage machine
│   ├── melodyGenerator.ts motif → skeleton → figuration → ornaments
│   ├── rules.ts          the melody rules, shared by the generator and the tests
│   ├── canonVoices.ts    round entries, rest-stage thinning
│   ├── backingTrack.ts   bass, chords, pad, pizzicato, lo-fi beat
│   ├── pachelbel.ts      famous lines to quote and original phrases to avoid
│   ├── composer.ts       deterministic cycle-by-cycle composition with a bounded cache
│   ├── history.ts        rewind buffer and favourites
│   └── scheduler.ts      Tone.js Transport playback, events via Tone.Draw
├── audio/                Tone.js instruments (samplers + synth fallbacks), mixer, ambience, lo-fi, recorder
├── visuals/              PixiJS engine, scenes, music→visual mapping, palettes, GLSL shaders
└── ui/                   player bar, settings drawer, scene picker, keyboard shortcuts
```

The music engine only emits events; visuals and UI just listen, so the two stay independent.

**Time grid.** One chord lasts two beats and the loop of eight chords is one _cycle_ (16 beats) — one
phrase. At the default 88 BPM a cycle takes about 11 seconds.

**Composing a phrase.** Each cycle the composer:

1. picks a motif — a rhythm cell and a melodic figure (steps, neighbour notes, arpeggios, turns,
   runs, leaps…) — plus a development plan (strict sequence like Pachelbel's variations, AABB, ABAB,
   AAAB, with inversions, retrogrades and small mutations);
2. chooses a **skeleton** of chord tones for the eight strong beats with a small dynamic program that
   favours smooth, contour-shaped lines and ends on the dominant;
3. fills each chord with the motif by solving a constrained search over (previous note, note) states,
   so weak beats are chord, passing or neighbour tones, leaps turn back by step and the line lands
   smoothly on the next strong beat — in strict mode it also avoids parallel fifths and octaves against
   the two echo voices;
4. adds ornaments (trills, turns, mordents, grace notes — and cadential trills) and phrase-shaped
   dynamics.

The echo voices replay earlier phrases, transposed through modulations. The ground bass never changes.

**Endless and replayable.** Randomness comes from per-cycle streams (`hash(seed, purpose, cycle)`
seeding a small PRNG), so a cycle depends only on the seed, the settings and the previous cycle. Share
links fast-forward to their phrase (≈0.6 ms per phrase), settings changes shape only phrases not yet
heard, and the composer keeps a bounded window of cycles, so memory stays flat over hours.

## Quality checks (plan §11)

| Check                       | How it is covered                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Does it sound like Canon?   | Manual listening test — loop, ground bass and round are Pachelbel's; the first phrase often nods to his line.                       |
| Is it distinct?             | `tests/distinctness.test.ts`: thousands of generated phrases never match the original's phrases.                                    |
| Endurance                   | `tests/endurance.test.ts` composes 1,500 cycles (≈4.5 h) with bounded memory; playback runs on Transport ticks, so it cannot drift. |
| Rule tests                  | `tests/melody.test.ts`: strong beats are chord tones, weak beats resolve, leaps step back, D4–D6 range, stable endings.             |
| Canon, stages, strict mode  | `tests/canon.test.ts`, `tests/stages.test.ts`, `tests/strict.test.ts`                                                               |
| Determinism and share links | `tests/determinism.test.ts`, `tests/settings.test.ts`                                                                               |
| Performance                 | Audio uses a `playback` latency hint and 0.3 s look-ahead; heavy visual work is time-sliced; adaptive visual quality.               |
| Accessibility               | Reduced motion (system or manual), full keyboard control, labelled controls, limiter on the master bus.                             |

## Deployment

The build is a static site with relative asset paths, so `dist/` works on any static host or sub-path.

- **GitHub Pages** — `.github/workflows/deploy.yml` builds and publishes on every push to `main`.
  Enable it once under _Settings → Pages → Build and deployment → Source: GitHub Actions_.
- **Netlify / Vercel** — build command `pnpm build`, output directory `dist`.

`.github/workflows/ci.yml` runs formatting, type-checking, the test suite and a build on every pull
request.

## Plan status

| #   | Milestone                    | Status                                                                     |
| --- | ---------------------------- | -------------------------------------------------------------------------- |
| 1   | Setup + theory module        | Done — keys, scales, Roman-numeral loop in any key, tests                  |
| 2   | Ground bass + chords forever | Done                                                                       |
| 3   | Melody generator             | Done — rule-based, motif development, ornaments                            |
| 4   | Canon voices + stages        | Done — round entries, six stages, rest thinning, strict mode, quotes       |
| 5   | Backing track controls       | Done — six layers, presets, mixer, lo-fi texture                           |
| 6   | First visual scene (lake)    | Done                                                                       |
| 7   | More scenes + transitions    | Done — six scenes, cross-fades, auto-rotate                                |
| 8   | UI polish                    | Done — sliders, key/mood, zen, fullscreen, mobile layout, shortcuts        |
| 9   | Extras                       | Done — rewind, seeds/share links, favourites, recording (WAV / compressed) |
| 10  | Testing, performance, deploy | Tests and CI done; GitHub Pages workflow ready (needs Pages enabled once)  |

Stretch ideas from the plan (an AI melody model, live sheet music, hum-a-motif, local-time
day/night, other progressions) are not implemented. MP3 export is offered as WAV or the browser's
compressed format (Opus/AAC) instead, to avoid shipping an MP3 encoder.

## Credits

- Johann Pachelbel's _Canon in D_ is in the public domain. Reference phrases were cross-checked
  against the Mutopia Project edition (Jim Paterson, CC BY 3.0).
- Instrument samples: Salamander Grand Piano (Alexander Holm, CC BY 3.0), VSCO 2 Community Edition
  (Versilian Studios, CC0) and FluidR3 GM (CC BY 3.0) — details in
  [`public/samples/CREDITS.md`](public/samples/CREDITS.md); `scripts/samples/fetch-samples.mjs`
  rebuilds the set.
- Typeface: Cormorant Garamond (SIL Open Font License) via Fontsource.
- Built with [Tone.js](https://tonejs.github.io/), [PixiJS](https://pixijs.com/) and
  [Vite](https://vite.dev/).
