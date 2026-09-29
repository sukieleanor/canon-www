import {
  Container,
  Mesh,
  MeshGeometry,
  Shader,
  UniformGroup,
  type GlProgram,
  type Renderer,
  type Texture,
  type WebGLRenderer,
} from 'pixi.js';
import type { NoteStimulus, Stimuli } from '../mapping';
import { QUAD_VERT } from '../shaders/common';
import { SKY_FRAG } from '../shaders/sky';
import { STRIP_FRAG } from '../shaders/strip';
import { mark, type Steps } from '../slice';
import { freeTexture, stripTexture, type Atlas } from '../textures';

export interface SceneContext {
  renderer: Renderer;
  atlas: Atlas;
}

/**
 * A scene is a self-contained painting that reads the shared stimuli every frame. Heavy assets are
 * built by `build()` one step per `yield`, so the engine can spread them over frames.
 */
export abstract class Scene {
  readonly root = new Container();
  protected w = 1;
  protected h = 1;
  protected readonly ctx: SceneContext;
  /** Textures owned by the scene; freed with it. */
  protected readonly textures: Texture[] = [];
  private readonly cleanups: Array<() => void> = [];

  constructor(ctx: SceneContext) {
    this.ctx = ctx;
  }

  abstract build(): Generator<void, void, void>;
  abstract layout(w: number, h: number): void;
  /** `live` is false while the scene is fading out: keep animating but stop spawning. */
  abstract update(dt: number, s: Stimuli, live: boolean): void;

  note(_n: NoteStimulus, _s: Stimuli): void {}
  bass(_strength: number, _s: Stimuli): void {}
  phraseEnd(_s: Stimuli): void {}

  get particleCount(): number {
    return 0;
  }

  /** Called when the render resolution or quality tier changed. */
  qualityChanged(): void {}

  protected onDestroy(fn: () => void): void {
    this.cleanups.push(fn);
  }

  /** Registers a shader quad or surface so destroy() frees its geometry and shader too. */
  protected own<T extends { destroy(): void }>(item: T): T {
    this.cleanups.push(() => item.destroy());
    return item;
  }

  /** Registers a texture the scene frees on destroy. */
  protected keep(texture: Texture): Texture {
    this.textures.push(texture);
    return texture;
  }

  /** Uploads textures to the GPU now, so it does not land in the first frame that shows them. */
  protected upload(...textures: Texture[]): void {
    const gl = this.ctx.renderer as WebGLRenderer;
    for (const t of textures) {
      const t0 = performance.now();
      gl.texture.initSource(t.source);
      mark(`upload ${t.width}x${t.height}`, t0);
    }
  }

  /** Compiles shader programs now (a driver call that can take tens of milliseconds). */
  protected compile(...quads: ShaderQuad[]): void {
    const gl = this.ctx.renderer as WebGLRenderer;
    for (const q of quads) {
      const t0 = performance.now();
      gl.shader._getProgramData(q.program);
      mark(`compile ${q.constructor.name}`, t0);
    }
  }

  /** Paints a strip canvas in slices, wraps it in a tiling texture and uploads it in its own slice. */
  protected *strip(canvas: Steps<HTMLCanvasElement>): Steps<Texture> {
    const tex = this.keep(stripTexture(yield* canvas));
    yield;
    this.upload(tex);
    yield;
    return tex;
  }

  destroy(): void {
    this.root.destroy({ children: true });
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    this.textures.forEach(freeTexture);
    this.textures.length = 0;
  }
}

type UniformDef = { value: number | Float32Array | number[]; type: string; size?: number };
export type Uniforms = Record<string, any>;

/** A custom-GLSL quad. Geometry is a unit square; `place()` scales the mesh to pixels. */
export class ShaderQuad {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  protected readonly u: Uniforms;
  private readonly geometry: MeshGeometry;
  private readonly shader: Shader;

  constructor(
    fragment: string,
    uniforms: Record<string, UniformDef>,
    textures: Record<string, Texture> = {},
    additive = false,
  ) {
    this.geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    const group = new UniformGroup(uniforms as ConstructorParameters<typeof UniformGroup>[0]);
    const resources: Record<string, unknown> = { u: group };
    for (const k of Object.keys(textures)) resources[k] = textures[k].source;
    this.shader = Shader.from({
      gl: { vertex: QUAD_VERT, fragment, preferredFragmentPrecision: 'highp' },
      resources,
    });
    this.u = group.uniforms as Uniforms;
    this.mesh = new Mesh({ geometry: this.geometry, shader: this.shader });
    if (additive) this.mesh.blendMode = 'add';
  }

  get program(): GlProgram {
    return this.shader.glProgram as GlProgram;
  }

  place(x: number, y: number, w: number, h: number): void {
    this.mesh.position.set(x, y);
    this.mesh.scale.set(w, h);
  }

  /** Swaps a sampler resource, e.g. a re-created render texture. */
  setTexture(name: string, texture: Texture): void {
    (this.shader.resources as Record<string, unknown>)[name] = texture.source;
  }

  destroy(): void {
    this.mesh.destroy();
    this.geometry.destroy();
    this.shader.destroy();
  }
}

const f3 = (a: number, b: number, c: number): Float32Array => new Float32Array([a, b, c]);
const f4 = (a: number, b: number, c: number, d: number): Float32Array =>
  new Float32Array([a, b, c, d]);

export class SkyQuad extends ShaderQuad {
  readonly top: Float32Array;
  readonly mid: Float32Array;
  readonly low: Float32Array;
  /** Mid and low gradient stops as fractions of the height. */
  readonly stops: Float32Array;
  /** Sun/moon: x, y (0..1 of the screen), disc radius (fraction of height), glow intensity. */
  readonly sun: Float32Array;
  readonly sunColor: Float32Array;
  /** Cloud amount, time, scale, high-detail flag. */
  readonly cloud: Float32Array;
  readonly cloudLit: Float32Array;
  readonly cloudShade: Float32Array;

  constructor(noise: Texture) {
    const top = f3(0.2, 0.3, 0.5);
    const mid = f3(0.6, 0.6, 0.7);
    const low = f3(0.9, 0.8, 0.6);
    const stops = new Float32Array([0.45, 0.85]);
    const sun = f4(0.7, 0.5, 0.04, 0);
    const sunColor = f3(1, 0.9, 0.7);
    const cloud = f4(0, 0, 3, 1);
    const cloudLit = f3(1, 0.95, 0.9);
    const cloudShade = f3(0.5, 0.55, 0.65);
    super(SKY_FRAG, {
      uTop: { value: top, type: 'vec3<f32>' },
      uMid: { value: mid, type: 'vec3<f32>' },
      uLow: { value: low, type: 'vec3<f32>' },
      uStops: { value: stops, type: 'vec2<f32>' },
      uSun: { value: sun, type: 'vec4<f32>' },
      uSunCol: { value: sunColor, type: 'vec3<f32>' },
      uCloud: { value: cloud, type: 'vec4<f32>' },
      uCloudLit: { value: cloudLit, type: 'vec3<f32>' },
      uCloudShade: { value: cloudShade, type: 'vec3<f32>' },
      uAspect: { value: 1.6, type: 'f32' },
      },
      { uNoise: noise },
    );
    this.top = top;
    this.mid = mid;
    this.low = low;
    this.stops = stops;
    this.sun = sun;
    this.sunColor = sunColor;
    this.cloud = cloud;
    this.cloudLit = cloudLit;
    this.cloudShade = cloudShade;
  }

  layout(w: number, h: number): void {
    this.place(0, 0, w, h);
    this.u.uAspect = w / h;
  }
}

/** Tiling silhouette layer (see STRIP_FRAG). Keeps the texture's aspect and repeats it across the width. */
export class Strip extends ShaderQuad {
  readonly color: Float32Array;
  readonly light: Float32Array;
  readonly haze: Float32Array;
  /** Haze at the top and at the foot of the layer. */
  readonly hazeAmt: Float32Array;
  /** scroll, repeat, time, sway amplitude (texture widths). */
  readonly move: Float32Array;
  /** wave frequency, wave speed, bass amplitude, bass phase. */
  readonly wave: Float32Array;
  /** Rim light: uv offset to the neighbour that decides the edge, strength. */
  private readonly rimU: Float32Array;
  private readonly aspect: number;
  private readonly texW: number;
  private readonly texH: number;

  constructor(texture: Texture, additive = false) {
    const color = f3(0.3, 0.4, 0.4);
    const light = f3(1, 0.9, 0.7);
    const haze = f3(0.8, 0.8, 0.85);
    const hazeAmt = f4(0, 0.5, 0, 0);
    const move = f4(0, 1, 0, 0);
    const wave = f4(8, 1, 0, 0);
    const rimU = f4(0, 0, 0, 0);
    super(
      STRIP_FRAG,
      {
        uBody: { value: color, type: 'vec3<f32>' },
        uLight: { value: light, type: 'vec3<f32>' },
        uHaze: { value: haze, type: 'vec3<f32>' },
        uHazeAmt: { value: hazeAmt, type: 'vec4<f32>' },
        uMove: { value: move, type: 'vec4<f32>' },
        uWave: { value: wave, type: 'vec4<f32>' },
        uRim: { value: rimU, type: 'vec4<f32>' },
      },
      { uTex: texture },
      additive,
    );
    this.color = color;
    this.light = light;
    this.haze = haze;
    this.hazeAmt = hazeAmt;
    this.move = move;
    this.wave = wave;
    this.rimU = rimU;
    this.texW = texture.width;
    this.texH = texture.height;
    this.aspect = texture.width / texture.height;
  }

  /** Lights the edges that face `light` (-1 left .. +1 right, and always up) with `strength` 0..1. */
  setRim(light: number, strength: number): void {
    const kx = Math.max(2, this.texH * 0.006);
    const ky = Math.max(1.5, this.texH * 0.004);
    this.rimU[0] = (light * kx) / this.texW;
    this.rimU[1] = -ky / this.texH;
    this.rimU[2] = strength;
  }

  override place(x: number, y: number, w: number, h: number): void {
    super.place(x, y, w, h);
    this.move[1] = w / (h * this.aspect);
  }
}
