import { Particle, ParticleContainer, Rectangle, type Texture } from 'pixi.js';

/**
 * Fixed-size particle pool backed by one ParticleContainer (a single draw call per field).
 * State lives in typed arrays and Particle objects are created once, so spawning and updating
 * never allocates. Scenes run their own update loops over the arrays and call `apply(i)`.
 */
export class ParticleField {
  readonly container: ParticleContainer;
  readonly cap: number;
  count = 0;
  readonly alive: Uint8Array;
  readonly kind: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly rot: Float32Array;
  readonly vrot: Float32Array;
  /** Longest side in CSS pixels. */
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  /** Vertical/horizontal scale ratio. */
  readonly squash: Float32Array;
  /** Horizontal scale multiplier (flutter flips). */
  readonly flip: Float32Array;
  readonly p0: Float32Array;
  readonly p1: Float32Array;
  readonly p2: Float32Array;
  readonly p3: Float32Array;
  readonly parts: Particle[];
  private readonly inv: Float32Array;
  private readonly free: Int32Array;
  private freeTop: number;
  private limit: number;

  constructor(
    atlas: Texture,
    initial: Texture,
    cap: number,
    blend: 'normal' | 'add',
    dynamicUvs = true,
  ) {
    this.cap = cap;
    this.limit = cap;
    this.alive = new Uint8Array(cap);
    this.kind = new Uint8Array(cap);
    const f = (): Float32Array => new Float32Array(cap);
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.age = f();
    this.life = f();
    this.rot = f();
    this.vrot = f();
    this.size = f();
    this.alpha = f();
    this.squash = f();
    this.flip = f();
    this.p0 = f();
    this.p1 = f();
    this.p2 = f();
    this.p3 = f();
    this.inv = f();
    this.free = new Int32Array(cap);
    this.freeTop = cap;
    this.parts = [];
    for (let i = 0; i < cap; i++) {
      this.free[i] = cap - 1 - i;
      this.parts.push(new Particle({ texture: initial, anchorX: 0.5, anchorY: 0.5, alpha: 0 }));
    }
    this.container = new ParticleContainer({
      texture: atlas,
      particles: this.parts,
      dynamicProperties: {
        position: true,
        rotation: true,
        vertex: true,
        uvs: dynamicUvs,
        color: true,
      },
      boundsArea: new Rectangle(-256, -256, 4608, 4608),
    });
    this.container.blendMode = blend === 'add' ? 'add' : 'normal';
  }

  /** Upper bound for live particles (quality tier / reduced motion); existing ones finish naturally. */
  setLimit(n: number): void {
    this.limit = Math.max(0, Math.min(this.cap, Math.floor(n)));
  }

  get room(): boolean {
    return this.count < this.limit && this.freeTop > 0;
  }

  /** Takes a free slot and resets it. Returns -1 when the pool is at its limit. */
  spawn(frame: Texture, tint = 0xffffff): number {
    if (this.count >= this.limit || this.freeTop === 0) return -1;
    const i = this.free[--this.freeTop];
    this.alive[i] = 1;
    this.count++;
    const p = this.parts[i];
    if (p.texture !== frame) p.texture = frame;
    p.tint = tint;
    p.anchorX = 0.5;
    p.anchorY = 0.5;
    this.inv[i] = 1 / frame.width;
    this.size[i] = frame.width;
    this.age[i] = 0;
    this.life[i] = 1;
    this.rot[i] = 0;
    this.vrot[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.alpha[i] = 1;
    this.squash[i] = 1;
    this.flip[i] = 1;
    this.kind[i] = 0;
    this.p0[i] = this.p1[i] = this.p2[i] = this.p3[i] = 0;
    return i;
  }

  kill(i: number): void {
    if (!this.alive[i]) return;
    this.alive[i] = 0;
    this.count--;
    this.parts[i].alpha = 0;
    this.free[this.freeTop++] = i;
  }

  clear(): void {
    for (let i = 0; i < this.cap; i++) this.kill(i);
  }

  setAnchor(i: number, ax: number, ay: number): void {
    const p = this.parts[i];
    p.anchorX = ax;
    p.anchorY = ay;
  }

  apply(i: number): void {
    const p = this.parts[i];
    const sc = this.size[i] * this.inv[i];
    p.x = this.x[i];
    p.y = this.y[i];
    p.scaleX = sc * this.flip[i];
    p.scaleY = sc * this.squash[i];
    p.rotation = this.rot[i];
    p.alpha = this.alpha[i];
  }

  destroy(): void {
    this.container.destroy();
    this.parts.length = 0;
  }
}
