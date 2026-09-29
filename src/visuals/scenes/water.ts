import { Matrix, RenderTexture, type Container, type Renderer, type Texture } from 'pixi.js';
import type { Stimuli } from '../mapping';
import { WATER_FRAG } from '../shaders/water';
import type { Atlas } from '../textures';
import { RippleField } from './ripples';
import { ShaderQuad } from './scene';

export class WaterQuad extends ShaderQuad {
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly texel: Float32Array;
  readonly deep: Float32Array;
  readonly shallow: Float32Array;
  readonly sunCol: Float32Array;
  readonly sun: Float32Array;

  constructor(sky: Texture, ripple: Texture, noise: Texture) {
    const a = new Float32Array([0, 1.8, 0, 0]);
    const b = new Float32Array([1, 1, 0.03, 0]);
    const texel = new Float32Array([1 / 256, 1 / 128]);
    const deep = new Float32Array([0.07, 0.2, 0.28]);
    const shallow = new Float32Array([0.3, 0.45, 0.52]);
    const sunCol = new Float32Array([1, 0.85, 0.62]);
    const sun = new Float32Array([0.7, 0.6, 0.06, 0.5]);
    super(
      WATER_FRAG,
      {
        uA: { value: a, type: 'vec4<f32>' },
        uB: { value: b, type: 'vec4<f32>' },
        uTexel: { value: texel, type: 'vec2<f32>' },
        uDeep: { value: deep, type: 'vec3<f32>' },
        uShallow: { value: shallow, type: 'vec3<f32>' },
        uSunCol: { value: sunCol, type: 'vec3<f32>' },
        uSun: { value: sun, type: 'vec4<f32>' },
      },
      { uSky: sky, uRipple: ripple, uNoise: noise },
    );
    this.a = a;
    this.b = b;
    this.texel = texel;
    this.deep = deep;
    this.shallow = shallow;
    this.sunCol = sunCol;
    this.sun = sun;
  }
}

/**
 * A reflective pool below a horizon line: renders `source` (everything above the shore) into a
 * small texture each frame, mirrors it through the water shader and owns the ripples.
 */
export class WaterSurface {
  readonly quad: WaterQuad;
  readonly ripples: RippleField;
  private readonly rt: RenderTexture;
  private readonly source: Container;
  private readonly matrix = new Matrix();
  private scale = 0.5;
  private w = 1;
  private hz = 1;
  private hw = 1;

  constructor(source: Container, atlas: Atlas) {
    this.source = source;
    this.rt = RenderTexture.create({ width: 512, height: 256, resolution: 1, dynamic: true });
    this.ripples = new RippleField(atlas);
    this.quad = new WaterQuad(this.rt, this.ripples.texture, atlas.noise);
  }

  /** Glowing ring sprites: add above the water quad. */
  get view(): Container {
    return this.ripples.view.container;
  }

  /** `reach` > 1 squeezes more of the sky into the pool (a low viewing angle). */
  layout(w: number, h: number, hz: number, reach = 1): void {
    this.w = w;
    this.hz = hz;
    this.hw = h - hz;
    this.quad.place(0, hz, w, this.hw);
    this.quad.a[1] = w / this.hw;
    this.quad.b[0] = (this.hw / hz) * reach;
    this.ripples.layout(w, hz, this.hw);
    this.resizeRT();
  }

  /** Reflection resolution: 0.3 (low tier) .. 0.52 (high) of the screen size. */
  setDetail(detail: number): void {
    const k = 0.3 + 0.22 * detail;
    if (Math.abs(k - this.scale) > 0.06) {
      this.scale = k;
      this.resizeRT();
    }
    this.ripples.setDetail(detail);
  }

  private resizeRT(): void {
    const rw = Math.max(16, Math.round(this.w * this.scale));
    const rh = Math.max(16, Math.round(this.hz * this.scale));
    this.rt.resize(rw, rh, 1);
    this.matrix.set(rw / this.w, 0, 0, rh / this.hz, 0, 0);
  }

  reflect(renderer: Renderer): void {
    renderer.render({
      container: this.source,
      target: this.rt,
      clear: true,
      clearColor: [0, 0, 0, 1],
      transform: this.matrix,
    });
  }

  /** Ages the ripples and refreshes their height field. */
  tick(renderer: Renderer, s: Stimuli, live: boolean, ambient: boolean): void {
    this.ripples.update(s, live, ambient, renderer);
    this.quad.texel[0] = this.ripples.texelX;
    this.quad.texel[1] = this.ripples.texelY;
  }

  /** Ring for a note: (x01, depth) place it on the pool; bursts of fast notes share a budget. */
  tryDrop(
    cost: number,
    x01: number,
    depth: number,
    strength: number,
    size: number,
    life: number,
    cr: number,
    cg: number,
    cb: number,
  ): boolean {
    return this.ripples.drop(
      x01 * this.w,
      this.hz + depth * this.hw,
      strength,
      this.w * (0.018 + 0.05 * depth) * size,
      0.14 + 0.36 * depth,
      life,
      cr,
      cg,
      cb,
      cost,
    );
  }

  drop(
    x01: number,
    depth: number,
    strength: number,
    size: number,
    life: number,
    cr: number,
    cg: number,
    cb: number,
  ): void {
    this.tryDrop(0, x01, depth, strength, size, life, cr, cg, cb);
  }

  destroy(): void {
    this.quad.destroy();
    this.ripples.destroy();
    this.rt.destroy(true);
  }
}
