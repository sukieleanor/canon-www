import { EventBus, type MusicEvents } from '../src/events';
import { SCENE_IDS, SCENE_INFO, SEASONS, STAGE_IDS, type SceneId, type Season, type StageId } from '../src/types';
import { createVisualEngine, setVisualsTrace } from '../src/visuals/engine';
import {
  cherryTreeArt,
  cloudCanvas,
  grassCanvas,
  ridgeCanvas,
  treeCanvas,
  trunkCanvas,
} from '../src/visuals/art';
import { createAtlas, makeCanvas } from '../src/visuals/textures';
import type { VisualEngine } from '../src/visuals/types';

/*
 * Visuals harness: drives the engine with a synthetic Canon (88 BPM, D A Bm F#m G D G A) so the
 * scenes can be judged without audio. URL params: scene, season, stage, auto=1, reduced=1,
 * panel=0, ui=1, bpm, paused=1. Keys: 1-6 scenes, a auto-rotate, r reduced, space play/pause,
 * s season, t stage, h panel, u UI mock.
 */

const params = new URLSearchParams(location.search);
const bus = new EventBus<MusicEvents>();

/** Main-thread tasks over 50 ms (the audio look-ahead is 0.3 s, so these matter). */
const longTasks: Array<{ at: number; ms: number }> = [];
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) longTasks.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
  }).observe({ entryTypes: ['longtask'] });
} catch {
  // long-task timing is Chromium only
}

/** ?gldebug=1 logs the source of any shader program that fails to link. */
if (params.get('gldebug') === '1') {
  const proto = WebGL2RenderingContext.prototype;
  const link = proto.linkProgram;
  proto.linkProgram = function (this: WebGL2RenderingContext, program: WebGLProgram): void {
    link.call(this, program);
    if (this.getProgramParameter(program, this.LINK_STATUS)) return;
    const srcs = (this.getAttachedShaders(program) ?? []).map((sh) => this.getShaderSource(sh) ?? '');
    console.error(`[gldebug] link failed: ${this.getProgramInfoLog(program)}`);
    for (const src of srcs) console.error(`[gldebug] ${src.slice(0, 900).replace(/\n/g, ' | ')}`);
  };
}

const CHORDS = [
  { roman: 'I', name: 'D', pc: 2, bass: 38, minor: false },
  { roman: 'V', name: 'A', pc: 9, bass: 45, minor: false },
  { roman: 'vi', name: 'Bm', pc: 11, bass: 47, minor: true },
  { roman: 'iii', name: 'F♯m', pc: 6, bass: 42, minor: true },
  { roman: 'IV', name: 'G', pc: 7, bass: 43, minor: false },
  { roman: 'I', name: 'D', pc: 2, bass: 38, minor: false },
  { roman: 'IV', name: 'G', pc: 7, bass: 43, minor: false },
  { roman: 'V', name: 'A', pc: 9, bass: 45, minor: false },
];
const D_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const LOW = 62;
const HIGH = 86;
const STAGE_INTENSITY: Record<StageId, number> = {
  calm: 0.2,
  flowing: 0.45,
  lively: 0.8,
  playful: 0.7,
  ornamented: 0.6,
  rest: 0.1,
};
const KEYS: Array<{ tonic: string; pc: number; season: Season }> = [
  { tonic: 'D', pc: 2, season: 'spring' },
  { tonic: 'A', pc: 9, season: 'summer' },
  { tonic: 'G', pc: 7, season: 'autumn' },
  { tonic: 'E', pc: 4, season: 'winter' },
];

interface Note {
  beat: number;
  midi: number;
  dur: number;
  vel: number;
  orn: boolean;
}

class Conductor {
  bpm = Number(params.get('bpm')) || 88;
  playing = params.get('paused') !== '1';
  autoStage = true;
  autoSeason = true;
  silent = false;
  stage: StageId = (params.get('stage') as StageId) || 'calm';
  season: Season = (params.get('season') as Season) || 'spring';
  chord = 0;
  cycle = 0;
  private beat = 0;
  private planned = -1;
  private queue: Array<{ at: number; run: () => void }> = [];
  private phrases = new Map<number, Note[]>();
  private deg = 7;
  private last = performance.now();
  private stageIndex = Math.max(0, STAGE_IDS.indexOf(this.stage));
  private keyIndex = Math.max(0, KEYS.findIndex((k) => k.season === this.season));

  start(): void {
    bus.emit('transport', { playing: this.playing });
    window.setInterval(() => this.pump(), 15);
  }

  setPlaying(on: boolean): void {
    this.playing = on;
    bus.emit('transport', { playing: on });
  }

  forceStage(stage: StageId): void {
    this.autoStage = false;
    this.emitStage(stage);
  }

  forceSeason(season: Season): void {
    this.autoSeason = false;
    this.emitKey(season, false);
  }

  private get beatSec(): number {
    return 60 / this.bpm;
  }

  private emitStage(stage: StageId): void {
    const previous = this.stage === stage && this.planned < 0 ? null : this.stage;
    this.stage = stage;
    bus.emit('stageChange', {
      stage,
      previous,
      intensity: STAGE_INTENSITY[stage],
      cycle: this.cycle,
      time: 0,
    });
  }

  private emitKey(season: Season, initial: boolean): void {
    this.season = season;
    const k = KEYS.find((x) => x.season === season) ?? KEYS[0];
    bus.emit('keyChange', {
      tonic: k.tonic,
      tonicPc: k.pc,
      mode: 'major',
      season,
      cycle: this.cycle,
      initial,
      time: 0,
    });
  }

  private voicesFor(stage: StageId): number {
    return stage === 'calm' || stage === 'rest' ? 1 : stage === 'flowing' ? 2 : 3;
  }

  private plan(cycle: number): void {
    const b0 = cycle * 16;
    const at = (beat: number, run: () => void): void => {
      this.queue.push({ at: b0 + beat, run });
    };
    if (cycle === 0) {
      at(0, () => {
        this.emitKey(this.season, true);
        this.emitStage(this.stage);
      });
    } else if (cycle % 3 === 0 && this.autoStage) {
      at(0, () => {
        this.stageIndex = (this.stageIndex + 1) % STAGE_IDS.length;
        this.emitStage(STAGE_IDS[this.stageIndex]);
      });
    }
    if (cycle > 0 && cycle % 5 === 0 && this.autoSeason) {
      at(0, () => {
        this.keyIndex = (this.keyIndex + 1) % KEYS.length;
        this.emitKey(KEYS[this.keyIndex].season, false);
      });
    }
    const stage = this.stage;
    at(0.001, () => {
      this.cycle = cycle;
      bus.emit('cycle', {
        cycle,
        stage: this.stage,
        voices: this.voicesFor(this.stage),
        keyName: 'D major',
        mode: 'major',
        quote: cycle % 4 === 3,
        duration: 16 * this.beatSec,
        time: 0,
      });
    });
    for (let k = 0; k < 8; k++) {
      const chord = CHORDS[k];
      at(k * 2, () => {
        this.chord = k;
        bus.emit('chordChange', {
          chordIndex: k,
          roman: chord.roman,
          name: chord.name,
          rootPc: chord.pc,
          minor: chord.minor,
          cycle,
          duration: 2 * this.beatSec,
          time: 0,
        });
        bus.emit('bassNote', {
          midi: chord.bass,
          velocity: 0.8,
          duration: 1.8 * this.beatSec,
          chordIndex: k,
          time: 0,
        });
      });
    }
    for (let b = 0; b < 16; b++) {
      at(b, () =>
        bus.emit('beat', { beat: b, cycle, downbeat: b % 4 === 0, time: 0 }),
      );
    }
    at(15.85, () => bus.emit('phraseEnd', { cycle, time: 0 }));

    // Melody: the leader wanders stepwise; echo voices replay earlier phrases (the canon).
    const lead = this.compose(stage);
    this.phrases.set(cycle, lead);
    this.phrases.delete(cycle - 4);
    const voices = this.voicesFor(stage);
    for (let v = 0; v < voices; v++) {
      const notes = v === 0 ? lead : this.phrases.get(cycle - v);
      if (!notes) continue;
      for (const n of notes) {
        at(n.beat, () => {
          if (this.silent) return;
          bus.emit('noteOn', {
            voice: v,
            midi: n.midi,
            pitch01: Math.max(0, Math.min(1, (n.midi - LOW) / (HIGH - LOW))),
            velocity: n.vel * (v === 0 ? 1 : 0.8),
            duration: n.dur * this.beatSec,
            ornament: n.orn,
            cycle,
            time: 0,
          });
        });
      }
    }
  }

  private compose(stage: StageId): Note[] {
    const notes: Note[] = [];
    let beat = 0;
    const midiOf = (deg: number): number => {
      const oct = Math.floor(deg / 7);
      return 62 + oct * 12 + D_MAJOR[((deg % 7) + 7) % 7];
    };
    const step = (leap: boolean): void => {
      const r = Math.random();
      let d = r < 0.34 ? -1 : r < 0.68 ? 1 : r < 0.8 ? -2 : r < 0.92 ? 2 : leap ? (Math.random() < 0.5 ? -4 : 4) : 0;
      if (this.deg + d < 0 || this.deg + d > 14) d = -d;
      this.deg += d;
    };
    while (beat < 16) {
      let dur = 1;
      let orn = false;
      switch (stage) {
        case 'calm':
          dur = Math.random() < 0.55 ? 2 : 1;
          break;
        case 'flowing':
          dur = 0.5;
          break;
        case 'lively':
          dur = 0.25;
          break;
        case 'playful':
          dur = [0.25, 0.5, 0.75, 1, 0.25][Math.floor(Math.random() * 5)];
          break;
        case 'ornamented':
          dur = 0.5;
          orn = Math.random() < 0.25;
          break;
        case 'rest':
          dur = 2;
          break;
      }
      step(stage === 'playful');
      const vel = 0.5 + Math.random() * 0.4;
      if (orn) {
        for (let k = 0; k < 3; k++) {
          notes.push({ beat: beat + k * 0.125, midi: midiOf(this.deg + (k % 2)), dur: 0.12, vel: vel * 0.7, orn: true });
        }
        beat += 0.5;
        continue;
      }
      notes.push({ beat, midi: midiOf(this.deg), dur, vel, orn: false });
      beat += dur;
    }
    return notes;
  }

  private pump(): void {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (!this.playing) return;
    this.beat += dt / this.beatSec;
    const cyc = Math.floor(this.beat / 16);
    while (this.planned < cyc + 0) {
      this.planned++;
      this.plan(this.planned);
    }
    this.queue.sort((a, b) => a.at - b.at);
    while (this.queue.length && this.queue[0].at <= this.beat) this.queue.shift()?.run();
  }
}

const conductor = new Conductor();
const container = document.getElementById('stage') as HTMLElement;
const panel = document.getElementById('panel') as HTMLElement;
const mock = document.getElementById('mock') as HTMLElement;

let engine: VisualEngine;
let reduced = params.get('reduced') === '1';
let auto = params.get('auto') === '1';

function btn(label: string, on: () => void, id?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  if (id) b.dataset.id = id;
  b.addEventListener('click', on);
  return b;
}

function row(label: string, ...items: HTMLElement[]): HTMLElement {
  const r = document.createElement('div');
  r.className = 'row';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  r.append(l, ...items);
  panel.appendChild(r);
  return r;
}

function mark(group: string, id: string): void {
  panel.querySelectorAll<HTMLButtonElement>(`button[data-g="${group}"]`).forEach((b) => {
    b.classList.toggle('on', b.dataset.id === id);
  });
}

function groupBtn(group: string, id: string, label: string, on: () => void): HTMLButtonElement {
  const b = btn(label, on, id);
  b.dataset.g = group;
  return b;
}

function toggleBtn(label: string, get: () => boolean, set: (v: boolean) => void): HTMLButtonElement {
  const b = btn(label, () => {
    set(!get());
    b.classList.toggle('on', get());
  });
  b.classList.toggle('on', get());
  return b;
}

/** Art review: paints the procedural textures the way the strip shader reads them. */
function debugTextures(kind: string): void {
  const wrap = document.createElement('div');
  wrap.id = 'debug';
  document.body.appendChild(wrap);
  const add = (c: HTMLCanvasElement): void => {
    wrap.appendChild(c);
  };
  const preview = (src: HTMLCanvasElement, body: number[], light: number[]): HTMLCanvasElement => {
    const { canvas, g } = makeCanvas(src.width, src.height);
    const bg = g.createLinearGradient(0, 0, 0, src.height);
    bg.addColorStop(0, '#5f88b0');
    bg.addColorStop(1, '#f2c898');
    g.fillStyle = bg;
    g.fillRect(0, 0, src.width, src.height);
    const sg = src.getContext('2d');
    if (!sg) return canvas;
    const img = sg.getImageData(0, 0, src.width, src.height);
    const out = g.getImageData(0, 0, src.width, src.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3] / 255;
      const r = img.data[i] / 255;
      const gg = img.data[i + 1] / 255;
      for (let k = 0; k < 3; k++) {
        const col = Math.min(1, body[k] * r + light[k] * gg) * 255;
        out.data[i + k] = out.data[i + k] * (1 - a) + col * a;
      }
    }
    g.putImageData(out, 0, 0);
    return canvas;
  };
  if (kind === 'atlas') {
    const atlas = createAtlas();
    add(atlas.canvas);
    return;
  }
  const body = [0.25, 0.38, 0.32];
  const light = [1, 0.85, 0.6];
  add(preview(ridgeCanvas(1024, 256, { seed: 3, base: 0.92, amp: 0.85, cells: 4, octaves: 6, ridged: 0.85, shade: [0.95, 0.55], facets: 0.8, light: 1 }), body, light));
  add(preview(treeCanvas(1024, 256, { seed: 11, count: 30, minH: 0.42, maxH: 0.85, base: 0.96, kind: 'mixed', shade: [0.6, 0.96], light: 1 }), body, light));
  add(preview(cloudCanvas(1024, 256, { seed: 5, count: 3, base: 0.5, spread: 0.5, size: 0.09, length: 0.7, puffs: 30, flat: 0.3 }), [0.85, 0.75, 0.8], [1, 0.9, 0.8]));
  add(preview(grassCanvas(1024, 256, { seed: 9, blades: 500, minH: 0.3, maxH: 0.9, lean: 0.5, shade: [0.35, 1] }), [0.3, 0.5, 0.25], [1, 0.95, 0.7]));
  const art = cherryTreeArt(768, 4);
  add(preview(art.branches, [1, 1, 1], [0, 0, 0]));
  add(art.blossomBack);
  add(art.blossomFront);
  add(trunkCanvas(128, 512, 3));
}

async function main(): Promise<void> {
  const dbg = params.get('debug');
  if (dbg) {
    debugTextures(dbg);
    return;
  }
  if (params.get('trace') === '1') {
    // ?trace=1 → window.__trace: per-stage count/total/max (ms) and the slices over 8 ms.
    const stages: Record<string, { n: number; total: number; max: number }> = {};
    const slow: Array<[string, number, number]> = [];
    setVisualsTrace((label, ms) => {
      const st = (stages[label] ??= { n: 0, total: 0, max: 0 });
      st.n++;
      st.total += ms;
      st.max = Math.max(st.max, ms);
      if (ms >= 8) slow.push([label, Math.round(ms), Math.round(performance.now())]);
    });
    (window as unknown as Record<string, unknown>).__trace = { stages, slow };
  }
  const scene = (SCENE_IDS as readonly string[]).includes(params.get('scene') ?? '')
    ? (params.get('scene') as SceneId)
    : SCENE_IDS[0];
  engine = await createVisualEngine({ container, bus, scene, autoRotate: auto, reducedMotion: reduced });
  (window as unknown as Record<string, unknown>).__visuals = { engine, bus, conductor, longTasks };

  row(
    'scene',
    ...SCENE_IDS.map((id, i) =>
      groupBtn('scene', id, `${i + 1} ${SCENE_INFO[id].name}`, () => engine.setScene(id)),
    ),
  );
  row(
    'toggles',
    toggleBtn('auto-rotate', () => auto, (v) => {
      auto = v;
      engine.setAutoRotate(v);
    }),
    toggleBtn('reduced motion', () => reduced, (v) => {
      reduced = v;
      engine.setReducedMotion(v);
    }),
    toggleBtn('playing', () => conductor.playing, (v) => conductor.setPlaying(v)),
    toggleBtn('UI mock', () => mock.classList.contains('show'), (v) => mock.classList.toggle('show', v)),
    toggleBtn('notes', () => !conductor.silent, (v) => (conductor.silent = !v)),
  );
  row('stage', ...STAGE_IDS.map((id) => groupBtn('stage', id, id, () => { conductor.forceStage(id); mark('stage', id); })));
  row('season', ...SEASONS.map((id) => groupBtn('season', id, id, () => { conductor.forceSeason(id); mark('season', id); })));
  const stats = document.createElement('div');
  stats.id = 'stats';
  panel.appendChild(stats);
  mark('scene', engine.scene);
  mark('stage', conductor.stage);
  mark('season', conductor.season);

  bus.on('sceneChange', (e) => mark('scene', e.scene));
  bus.on('stageChange', (e) => mark('stage', e.stage));
  bus.on('keyChange', (e) => mark('season', e.season));
  window.setInterval(() => {
    const st = engine.stats();
    const worst = longTasks.reduce((m, t) => Math.max(m, t.ms), 0);
    stats.textContent = `${engine.scene} · ${st.fps} fps · quality ${st.quality} · ${st.particles} particles · long tasks ${longTasks.length} (max ${worst} ms) · chord ${CHORDS[conductor.chord].name} · ${conductor.stage} · ${conductor.season}`;
  }, 400);

  if (params.get('panel') === '0') panel.style.display = 'none';
  if (params.get('ui') === '1') mock.classList.add('show');
  conductor.start();

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= SCENE_IDS.length) engine.setScene(SCENE_IDS[n - 1]);
    else if (e.key === 'a') panel.querySelectorAll<HTMLButtonElement>('button')[SCENE_IDS.length]?.click();
    else if (e.key === 'r') panel.querySelectorAll<HTMLButtonElement>('button')[SCENE_IDS.length + 1]?.click();
    else if (e.key === ' ') {
      e.preventDefault();
      panel.querySelectorAll<HTMLButtonElement>('button')[SCENE_IDS.length + 2]?.click();
    } else if (e.key === 's') conductor.forceSeason(SEASONS[(SEASONS.indexOf(conductor.season) + 1) % 4]);
    else if (e.key === 't') conductor.forceStage(STAGE_IDS[(STAGE_IDS.indexOf(conductor.stage) + 1) % 6]);
    else if (e.key === 'h') panel.style.display = panel.style.display === 'none' ? '' : 'none';
    else if (e.key === 'u') mock.classList.toggle('show');
  });
}

void main();
