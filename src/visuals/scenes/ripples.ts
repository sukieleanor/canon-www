import { Matrix, RenderTexture, type Renderer } from 'pixi.js';
import type { Stimuli } from '../mapping';
import { pack } from '../palettes';
import { ParticleField } from '../pool';
import type { Atlas } from '../textures';
import { envelope, rr, smooth } from './kit';

const MAX = 44;

/**
 * Rings spreading over a water plane. Each ripple is three ring sprites: a glowing one that is
 * shown, and a crest (red) and trough (green) that are drawn only into a small texture, which the
 * water shader reads as a height field to bend the reflection. Any number of ripples costs the same.
 */
export class RippleField {
  /** Glowing rings; add this container to the scene above the water. */
  readonly view: ParticleField;
  readonly texture: RenderTexture;
  private readonly height: ParticleField;
  private readonly matrix = new Matrix();
  private readonly ids = new Int32Array(MAX * 3).fill(-1);
  private readonly x = new Float32Array(MAX);
  private readonly y = new Float32Array(MAX);
  private readonly radius = new Float32Array(MAX);
  private readonly squash = new Float32Array(MAX);
  private readonly age = new Float32Array(MAX);
  private readonly life = new Float32Array(MAX);
  private readonly str = new Float32Array(MAX);
  private readonly live = new Uint8Array(MAX);
  private readonly atlas: Atlas;
  private next = 0;
  private tokens = 3;
  private ambient = 2;
  private active = 0;
  private stale = false;
  private scale = 0.34;
  private w = 1;
  private top = 0;
  private hgt = 1;

  constructor(atlas: Atlas) {
    this.atlas = atlas;
    this.view = new ParticleField(atlas.texture, atlas.frames.ring, MAX, 'add', false);
    this.height = new ParticleField(atlas.texture, atlas.frames.ring, MAX * 2, 'add', false);
    this.texture = RenderTexture.create({ width: 256, height: 128, resolution: 1, dynamic: true });
  }

  get count(): number {
    return this.active;
  }

  /** The water occupies (0, top) to (w, top + height) in scene pixels. */
  layout(w: number, top: number, height: number): void {
    this.w = w;
    this.top = top;
    this.hgt = height;
    this.resize();
  }

  /** Height-field resolution follows the quality tier (0.26 .. 0.4 of the screen). */
  setDetail(detail: number): void {
    const k = 0.26 + 0.14 * detail;
    if (Math.abs(k - this.scale) <= 0.05) return;
    this.scale = k;
    this.resize();
  }

  /** 1 / texture size, for the shader's finite differences. */
  get texelX(): number {
    return 1 / this.texture.width;
  }
  get texelY(): number {
    return 1 / this.texture.height;
  }

  private resize(): void {
    const rw = Math.max(16, Math.round(this.w * this.scale));
    const rh = Math.max(16, Math.round(this.hgt * this.scale));
    this.texture.resize(rw, rh, 1);
    this.matrix.set(rw / this.w, 0, 0, rh / this.hgt, 0, (-this.top * rh) / this.hgt);
    this.stale = true;
  }

  /**
   * Drops a ring at (x, y) scene pixels. `radius` is the final ring radius in pixels, `squash` the
   * height/width ratio the perspective gives it. Returns false when the note budget is spent.
   */
  drop(
    x: number,
    y: number,
    strength: number,
    radius: number,
    squash: number,
    life: number,
    r: number,
    g: number,
    b: number,
    budgeted: number,
  ): boolean {
    if (budgeted > 0) {
      if (this.tokens < 1) return false;
      this.tokens -= budgeted;
    }
    let slot = -1;
    for (let k = 0; k < MAX; k++) {
      const i = (this.next + k) % MAX;
      if (!this.live[i]) {
        slot = i;
        break;
      }
    }
    if (slot < 0) {
      slot = this.next;
      this.release(slot);
    }
    this.next = (slot + 1) % MAX;
    const o = slot * 3;
    const ring = this.view.spawn(this.atlas.frames.ring, pack(r, g, b));
    const crest = this.height.spawn(this.atlas.frames.ring, 0xff0000);
    const trough = this.height.spawn(this.atlas.frames.ring, 0x00ff00);
    if (ring < 0 || crest < 0 || trough < 0) {
      for (const i of [ring, crest, trough]) {
        if (i >= 0) (i === ring ? this.view : this.height).kill(i);
      }
      return false;
    }
    this.ids[o] = ring;
    this.ids[o + 1] = crest;
    this.ids[o + 2] = trough;
    this.x[slot] = x;
    this.y[slot] = y;
    this.radius[slot] = radius;
    this.squash[slot] = squash;
    this.age[slot] = 0;
    this.life[slot] = life;
    this.str[slot] = strength;
    this.live[slot] = 1;
    this.active++;
    return true;
  }

  private release(slot: number): void {
    if (!this.live[slot]) return;
    const o = slot * 3;
    this.view.kill(this.ids[o]);
    this.height.kill(this.ids[o + 1]);
    this.height.kill(this.ids[o + 2]);
    this.live[slot] = 0;
    this.active--;
  }

  /** Occasionally stirs the water on its own so it is alive before and between notes. */
  update(s: Stimuli, live: boolean, ambient: boolean, renderer: Renderer): void {
    const mdt = s.dt;
    this.tokens = Math.min(5, this.tokens + s.realDt * 6);
    this.view.setLimit(MAX * s.capScale);
    if (live && ambient) {
      this.ambient -= mdt;
      if (this.ambient <= 0) {
        this.ambient = rr(2.2, 4.2);
        const d = rr(0.2, 0.85);
        this.drop(
          rr(0.1, 0.9) * this.w,
          this.top + d * this.hgt,
          0.3,
          this.w * (0.02 + 0.05 * d),
          0.14 + 0.36 * d,
          rr(2.6, 3.6),
          0.55,
          0.7,
          0.8,
          0,
        );
      }
    }
    const v = this.view;
    const hf = this.height;
    for (let slot = 0; slot < MAX; slot++) {
      if (!this.live[slot]) continue;
      this.age[slot] += mdt;
      const a = this.age[slot] / this.life[slot];
      if (a >= 1) {
        this.release(slot);
        continue;
      }
      const o = slot * 3;
      const grow = 1 - (1 - a) * (1 - a);
      const size = (this.radius[slot] * 2.5 * (0.08 + 0.92 * grow)) | 0 || 1;
      const fade = envelope(a, 0.04, 0.7) * this.str[slot];
      const ring = this.ids[o];
      v.x[ring] = this.x[slot];
      v.y[ring] = this.y[slot];
      v.size[ring] = size;
      v.squash[ring] = this.squash[slot];
      v.alpha[ring] = fade * 0.55;
      v.apply(ring);
      const crest = this.ids[o + 1];
      hf.x[crest] = this.x[slot];
      hf.y[crest] = this.y[slot];
      hf.size[crest] = size;
      hf.squash[crest] = this.squash[slot];
      hf.alpha[crest] = smooth(fade * 1.4);
      hf.apply(crest);
      const trough = this.ids[o + 2];
      hf.x[trough] = this.x[slot];
      hf.y[trough] = this.y[slot];
      hf.size[trough] = size * 0.8;
      hf.squash[trough] = this.squash[slot];
      hf.alpha[trough] = smooth(fade * 1.4);
      hf.apply(trough);
    }
    if (this.active > 0 || this.stale) {
      renderer.render({
        container: hf.container,
        target: this.texture,
        clear: true,
        clearColor: [0, 0, 0, 0],
        transform: this.matrix,
      });
      this.stale = this.active > 0;
    }
  }

  destroy(): void {
    this.view.destroy();
    this.height.destroy();
    this.texture.destroy(true);
  }
}
