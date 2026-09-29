import {
  Container,
  Particle,
  ParticleContainer,
  RenderTexture,
  Sprite,
  Ticker,
  WebGLRenderer,
  type Texture,
  type WebGLOptions,
} from 'pixi.js';
import type { SceneId } from '../types';
import { SceneDirector } from './director';
import { createFallbackEngine } from './fallback';
import { MusicMapper, type MapperSink, type NoteStimulus, type Stimuli } from './mapping';
import { QualityGovernor, TIERS } from './quality';
import { createScene } from './scenes';
import type { Scene, SceneContext } from './scenes/scene';
import { beginSlice, mark, setTrace, type Steps } from './slice';
import { atlasSteps, createVignette, freeTexture, type Atlas } from './textures';
import type { VisualEngine, VisualEngineOptions, VisualStats } from './types';

const CROSSFADE_SECONDS = 3;
const FIRST_FADE_SECONDS = 1.4;
/** Build time per frame while a scene is on screen (keeps the animation smooth) and while nothing is. */
const SWITCH_BUDGET_MS = 5;
const BOOT_BUDGET_MS = 12;
const MAX_LAYERS = 3;

export const setVisualsTrace = setTrace;

interface Layer {
  id: SceneId;
  scene: Scene;
  alpha: number;
  fade: number;
}

/** Heavy work (the atlas and a scene's art) that is spread over frames instead of blocking one. */
interface Job {
  id: SceneId;
  label: string;
  steps: Steps;
  scene: Scene | null;
  done: boolean;
  /** Show the scene as soon as it is built (false while auto-rotate warms up the next one). */
  commit: boolean;
  first: boolean;
}

function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

class PixiEngine implements VisualEngine, MapperSink {
  private readonly opts: VisualEngineOptions;
  private readonly onFatal: (why: string) => void;
  // Driven directly (no Application): it would probe WebGL with a throwaway context first.
  private readonly renderer = new WebGLRenderer();
  private readonly ticker = new Ticker();
  private readonly root = new Container();
  private readonly stage = new Container();
  private readonly layers: Layer[] = [];
  private job: Job | null = null;
  private atlas: Atlas | null = null;
  private vignette: Sprite | null = null;
  private vignetteTexture: Texture | null = null;
  private mapper!: MusicMapper;
  private director!: SceneDirector;
  private readonly governor = new QualityGovernor();
  private observer: ResizeObserver | null = null;
  private w = 1;
  private h = 1;
  private resolution = 1;
  private resizeQueued = false;
  private destroyed = false;
  private failures = 0;
  private accum = 0;
  private frameNo = 0;
  private renderEvery = 1;
  private rawEma = 16.7;
  private lostAt = 0;
  private readonly cleanups: Array<() => void> = [];

  private constructor(opts: VisualEngineOptions, onFatal: (why: string) => void) {
    this.opts = opts;
    this.onFatal = onFatal;
  }

  static async create(opts: VisualEngineOptions, onFatal: (why: string) => void): Promise<PixiEngine> {
    const engine = new PixiEngine(opts, onFatal);
    try {
      await engine.init();
    } catch (err) {
      engine.destroy();
      throw err;
    }
    return engine;
  }

  get scene(): SceneId {
    return this.director.scene;
  }

  private measure(): void {
    const el = this.opts.container;
    this.w = Math.max(1, Math.round(el.clientWidth || window.innerWidth || 1));
    this.h = Math.max(1, Math.round(el.clientHeight || window.innerHeight || 1));
  }

  private targetResolution(): number {
    return Math.max(0.75, Math.min(window.devicePixelRatio || 1, TIERS[this.governor.tier].maxResolution));
  }

  private get gl(): WebGLRenderer {
    return this.renderer;
  }

  private async init(): Promise<void> {
    const { renderer, ticker, root, opts } = this;
    this.measure();
    this.resolution = this.targetResolution();
    const options: Partial<WebGLOptions> & { accessibilityOptions?: object } = {
      width: this.w,
      height: this.h,
      resolution: this.resolution,
      autoDensity: true,
      antialias: true,
      backgroundColor: 0x101827,
      eventFeatures: { move: false, globalMove: false, click: false, wheel: false },
      accessibilityOptions: {
        enabledByDefault: false,
        activateOnTab: false,
        deactivateOnMouseMove: false,
      },
    };
    const tInit = performance.now();
    await renderer.init(options);
    mark('init:renderer', tInit);
    if (this.destroyed) return;
    const tSetup = performance.now();
    if (renderer.name !== 'webgl') throw new Error(`unexpected renderer ${renderer.name}`);
    const canvas = renderer.canvas;
    canvas.style.position = 'absolute';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    opts.container.appendChild(canvas);

    const onLost = (e: Event): void => {
      e.preventDefault();
      this.lostAt = performance.now();
    };
    const onRestored = (): void => {
      this.lostAt = 0;
    };
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    this.cleanups.push(() => {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
    });

    root.addChild(this.stage);
    this.mapper = new MusicMapper(opts.bus, this, opts.reducedMotion);
    this.director = new SceneDirector(opts.bus, opts.scene, opts.autoRotate, (id) =>
      this.transitionTo(id),
    );
    // Paint the background once; everything else is built in slices by the frame loop.
    const tPaint = performance.now();
    renderer.render({ container: root });
    mark('init:firstRender', tPaint);
    this.job = {
      id: this.director.scene,
      label: 'boot',
      steps: this.bootSteps(),
      scene: null,
      done: false,
      commit: true,
      first: true,
    };

    const onVisibility = (): void => {
      if (this.destroyed) return;
      if (document.hidden) ticker.stop();
      else {
        this.governor.reset();
        this.accum = 0;
        ticker.start();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => document.removeEventListener('visibilitychange', onVisibility));

    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.queueResize());
      this.observer.observe(opts.container);
    }
    const onWindow = (): void => this.queueResize();
    window.addEventListener('resize', onWindow);
    this.cleanups.push(() => window.removeEventListener('resize', onWindow));

    // Rendering runs from our own tick so it can skip frames on very high refresh rates.
    ticker.add(this.tick, this);
    if (!document.hidden) ticker.start();
    mark('init:setup', tSetup);
  }

  /** Atlas, shared shaders, vignette, then the first scene: each part in its own slices. */
  private *bootSteps(): Steps {
    const job = this.job as Job;
    job.label = 'boot:atlas';
    const atlas = yield* atlasSteps();
    this.atlas = atlas;
    this.gl.texture.initSource(atlas.texture.source);
    yield;

    job.label = 'boot:shaders';
    yield* this.warmShared(atlas);

    job.label = 'boot:vignette';
    this.vignetteTexture = createVignette();
    const vignette = new Sprite(this.vignetteTexture);
    vignette.eventMode = 'none';
    vignette.width = this.w;
    vignette.height = this.h;
    this.gl.texture.initSource(vignette.texture.source);
    this.root.addChild(vignette);
    this.vignette = vignette;
    yield;

    // Honour a setScene() that arrived while the atlas was being painted.
    const id = this.director.scene;
    job.id = id;
    job.label = id;
    const scene = createScene(id, this.sceneContext());
    job.scene = scene;
    yield* scene.build();
    scene.layout(this.w, this.h);
  }

  /** Compiles the sprite-batch and particle programs off-screen, one per slice. */
  private *warmShared(atlas: Atlas): Steps {
    const gl = this.gl;
    const rt = RenderTexture.create({ width: 4, height: 4, resolution: 1 });
    const dot = atlas.frames.dot;
    const target = { target: rt, clear: true, clearColor: [0, 0, 0, 0] };
    const sprite = new Sprite(dot);
    gl.render({ container: sprite, ...target });
    sprite.destroy();
    yield;
    const container = new ParticleContainer({
      texture: atlas.texture,
      particles: [new Particle({ texture: dot })],
      dynamicProperties: { position: true, rotation: true, vertex: true, uvs: true, color: true },
    });
    gl.render({ container, ...target });
    container.destroy({ children: true });
    rt.destroy(true);
    yield;
  }

  private sceneContext(): SceneContext {
    return { renderer: this.renderer, atlas: this.atlas as Atlas };
  }

  // MapperSink: one-shot triggers go to the scene the listener chose.
  note(n: NoteStimulus): void {
    this.top?.scene.note(n, this.mapper.s);
  }
  bass(strength: number): void {
    this.top?.scene.bass(strength, this.mapper.s);
  }
  phraseEnd(): void {
    this.top?.scene.phraseEnd(this.mapper.s);
  }

  private get top(): Layer | undefined {
    return this.layers[this.layers.length - 1];
  }

  setScene(scene: SceneId): void {
    if (!this.destroyed) this.director.setScene(scene);
  }

  setAutoRotate(on: boolean): void {
    this.director.setAutoRotate(on);
    if (!on && this.job && !this.job.commit && !this.job.first) this.cancelJob();
  }

  setReducedMotion(on: boolean): void {
    this.mapper.setReduced(on);
  }

  stats(): VisualStats {
    let particles = 0;
    for (const l of this.layers) particles += l.scene.particleCount;
    return { fps: Math.round(this.governor.fps), quality: this.governor.tier, particles };
  }

  private transitionTo(id: SceneId): void {
    if (this.destroyed) return;
    const job = this.job;
    // While booting, the first scene is picked from the director when its turn comes; afterwards
    // `finishJob` compares it with what was built.
    if (job?.first) return;
    if (job && job.id === id) {
      job.commit = true;
      return;
    }
    this.cancelJob();
    if (this.top?.id === id) return;
    this.job = this.newJob(id, true);
  }

  private newJob(id: SceneId, commit: boolean): Job {
    const scene = createScene(id, this.sceneContext());
    return { id, label: id, steps: scene.build(), scene, done: false, commit, first: false };
  }

  private cancelJob(): void {
    this.job?.scene?.destroy();
    this.job = null;
  }

  /** Runs build slices until this frame's budget is spent. */
  private stepJob(): void {
    if (!this.job) {
      // Warm up the scene auto-rotate is about to show, so the switch itself is instant.
      const up = this.director.upcoming;
      if (up && up !== this.top?.id && this.atlas) this.job = this.newJob(up, false);
    }
    const job = this.job;
    if (!job) return;
    if (!job.done) {
      const budget = this.layers.length ? SWITCH_BUDGET_MS : BOOT_BUDGET_MS;
      const t0 = performance.now();
      try {
        while (!job.done && performance.now() - t0 < budget) {
          beginSlice();
          const t1 = performance.now();
          const r = job.steps.next();
          mark(job.label, t1);
          if (r.done) {
            if (job.scene && !job.first) job.scene.layout(this.w, this.h);
            job.done = true;
          }
        }
      } catch (err) {
        console.error(`[visuals] building ${job.label} failed`, err);
        if (job.first) {
          setTimeout(() => this.onFatal('scene build failed'), 0);
          this.job = null;
        } else {
          this.cancelJob();
        }
        return;
      }
    }
    if (job.done && job.commit && job.scene) {
      this.job = null;
      this.pushLayer(job.id, job.scene, job.first ? FIRST_FADE_SECONDS : CROSSFADE_SECONDS);
      if (job.first && this.director.scene !== job.id) this.transitionTo(this.director.scene);
    }
  }

  private pushLayer(id: SceneId, scene: Scene, fade: number): void {
    while (this.layers.length >= MAX_LAYERS) {
      const covered = this.layers.shift();
      const next = this.layers[0];
      if (next) {
        next.alpha = 1;
        next.scene.root.alpha = 1;
      }
      covered?.scene.destroy();
    }
    scene.root.alpha = 0;
    this.stage.addChild(scene.root);
    this.layers.push({ id, scene, alpha: 0, fade });
  }

  private queueResize(): void {
    if (this.resizeQueued || this.destroyed) return;
    this.resizeQueued = true;
    requestAnimationFrame(() => {
      this.resizeQueued = false;
      if (!this.destroyed) this.resize(false);
    });
  }

  private resize(force: boolean): void {
    const pw = this.w;
    const ph = this.h;
    const pr = this.resolution;
    this.measure();
    this.resolution = this.targetResolution();
    if (!force && pw === this.w && ph === this.h && pr === this.resolution) return;
    this.renderer.resize(this.w, this.h, this.resolution);
    if (this.vignette) {
      this.vignette.width = this.w;
      this.vignette.height = this.h;
    }
    for (const l of this.layers) {
      l.scene.layout(this.w, this.h);
      l.scene.qualityChanged();
    }
    if (this.job?.done) this.job.scene?.layout(this.w, this.h);
    this.governor.reset(2);
  }

  private readonly tick = (ticker: Ticker): void => {
    if (this.destroyed) return;
    const elapsed = ticker.elapsedMS;
    try {
      if (this.lostAt && performance.now() - this.lostAt > 5000) {
        this.lostAt = 0;
        setTimeout(() => this.onFatal('WebGL context lost'), 0);
        return;
      }
      if (elapsed > 0 && elapsed < 1000) this.rawEma += (elapsed - this.rawEma) * 0.03;
      this.renderEvery = this.rawEma < 9.3 ? 2 : 1;
      this.accum += Math.min(elapsed / 1000, 0.066);
      if (++this.frameNo % this.renderEvery !== 0) return;
      const dt = this.accum;
      this.accum = 0;

      // Frames stretched by scene construction say nothing about the device's speed.
      let changed = false;
      if (this.job) this.governor.reset(2);
      else changed = this.governor.frame(elapsed * this.renderEvery);
      const tier = TIERS[this.governor.tier];
      const s = this.mapper.s;
      s.capScale = tier.particles * (s.reduced ? 0.3 : 1);
      s.detail = tier.detail;
      if (changed) this.resize(true);

      this.mapper.update(dt);
      this.stepJob();
      if (this.layers.length === 0) return;
      this.updateLayers(dt, s);
      const t0 = performance.now();
      this.renderer.render({ container: this.root });
      mark('render', t0);
    } catch (err) {
      if (++this.failures <= 3) console.error('[visuals] frame failed', err);
      if (this.failures > 30) setTimeout(() => this.onFatal('repeated frame errors'), 0);
    }
  };

  private updateLayers(dt: number, s: Stimuli): void {
    const n = this.layers.length;
    const top = this.layers[n - 1];
    if (top.alpha < 1) {
      top.alpha = Math.min(1, top.alpha + dt / top.fade);
      top.scene.root.alpha = ease(top.alpha);
      if (top.alpha >= 1) {
        while (this.layers.length > 1) this.layers.shift()?.scene.destroy();
      }
    }
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].scene.update(dt, s, i === this.layers.length - 1);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.mapper?.destroy();
    this.director?.destroy();
    this.observer?.disconnect();
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.cancelJob();
    for (const l of this.layers) l.scene.destroy();
    this.layers.length = 0;
    try {
      this.ticker.remove(this.tick, this);
      this.ticker.destroy();
      this.root.destroy({ children: true });
      this.renderer.destroy({ removeView: true, releaseGlobalResources: true });
    } catch {
      // init may have failed before the renderer existed
    }
    freeTexture(this.vignetteTexture);
    this.atlas?.destroy();
  }
}

/**
 * Creates the visuals. Never throws: without WebGL (or if it dies later) the returned engine is a
 * CSS-gradient fallback that still follows the music, so playback is never affected. The first
 * scene is painted in slices after this resolves, so it fades in a moment later.
 */
export async function createVisualEngine(opts: VisualEngineOptions): Promise<VisualEngine> {
  let autoRotate = opts.autoRotate;
  let reduced = opts.reducedMotion;
  let current: VisualEngine;
  try {
    current = await PixiEngine.create(opts, (why) => {
      console.warn(`[visuals] ${why}: switching to the CSS fallback`);
      const snapshot: VisualEngineOptions = {
        ...opts,
        scene: current.scene,
        autoRotate,
        reducedMotion: reduced,
      };
      current.destroy();
      current = createFallbackEngine(snapshot);
    });
  } catch (err) {
    console.warn('[visuals] WebGL renderer unavailable, using the CSS gradient fallback.', err);
    return createFallbackEngine(opts);
  }
  return {
    get scene() {
      return current.scene;
    },
    setScene: (scene) => current.setScene(scene),
    setAutoRotate: (on) => {
      autoRotate = on;
      current.setAutoRotate(on);
    },
    setReducedMotion: (on) => {
      reduced = on;
      current.setReducedMotion(on);
    },
    stats: () => current.stats(),
    destroy: () => current.destroy(),
  };
}
