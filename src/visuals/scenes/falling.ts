import type { Stimuli } from '../mapping';
import { lerp, pack } from '../palettes';
import { ParticleField } from '../pool';
import type { Atlas } from '../textures';
import { TAU, envelope, rr } from './kit';

/** Seasonal weather shared by the scenes: snow in winter, leaves in autumn, a few petals in spring. */
export class Falling {
  readonly field: ParticleField;
  private readonly atlas: Atlas;
  private accSnow = 0;
  private accLeaf = 0;
  private accPetal = 0;

  constructor(atlas: Atlas, cap: number) {
    this.atlas = atlas;
    this.field = new ParticleField(atlas.texture, atlas.frames.snow, cap, 'normal');
  }

  get count(): number {
    return this.field.count;
  }

  /** `density` scales every kind; `petals` adds spring blossom (0 = none). */
  update(dt: number, s: Stimuli, live: boolean, w: number, h: number, density: number, petals = 0): void {
    const f = this.field;
    const fr = this.atlas.frames;
    f.setLimit(f.cap * s.capScale);
    if (live) {
      this.accSnow += (s.snow * (16 + 40 * s.energy) * density * s.capScale * dt) / 8;
      while (this.accSnow >= 1) {
        this.accSnow -= 1;
        const i = f.spawn(fr.snow, 0xf2f6ff);
        if (i < 0) break;
        f.x[i] = rr(-0.05 * w, 1.05 * w);
        f.y[i] = -12;
        f.vx[i] = rr(-6, 6);
        f.vy[i] = rr(26, 52);
        f.size[i] = rr(4, 10);
        f.life[i] = h / f.vy[i] + 1;
        f.p0[i] = rr(0, TAU);
        f.p1[i] = rr(0.4, 1.1);
        f.p2[i] = rr(0.5, 0.95);
        f.kind[i] = 0;
      }
      this.accLeaf += s.autumn * (1.6 + 5 * s.wind) * density * s.capScale * dt;
      while (this.accLeaf >= 1) {
        this.accLeaf -= 1;
        const i = f.spawn(Math.random() < 0.6 ? fr.leafMaple : fr.leafLong, 0xd9722a);
        if (i < 0) break;
        f.x[i] = rr(0, 1.1 * w);
        f.y[i] = rr(-0.1 * h, 0.2 * h);
        f.vx[i] = rr(-10, 12);
        f.vy[i] = rr(24, 48);
        f.size[i] = rr(12, 20);
        f.life[i] = h / f.vy[i] + 1;
        f.p0[i] = rr(0, TAU);
        f.p1[i] = rr(0.8, 1.8);
        f.p2[i] = 0.95;
        f.rot[i] = rr(0, TAU);
        f.vrot[i] = rr(-1.2, 1.2);
        f.kind[i] = 1;
        const hue = Math.random();
        f.parts[i].tint = pack(lerp(0.85, 0.72, hue), lerp(0.42, 0.26, hue), lerp(0.14, 0.1, hue));
      }
      this.accPetal += petals * s.season[0] * (1.5 + 5 * s.wind) * density * s.capScale * dt;
      while (this.accPetal >= 1) {
        this.accPetal -= 1;
        const i = f.spawn(Math.random() < 0.5 ? fr.petalA : fr.petalB, 0xffdbe6);
        if (i < 0) break;
        f.x[i] = rr(-0.1 * w, 1.0 * w);
        f.y[i] = rr(-0.1 * h, 0.1 * h);
        f.vx[i] = rr(6, 20);
        f.vy[i] = rr(20, 38);
        f.size[i] = rr(9, 14);
        f.life[i] = h / f.vy[i] + 1;
        f.p0[i] = rr(0, TAU);
        f.p1[i] = rr(0.8, 1.6);
        f.p2[i] = 0.9;
        f.rot[i] = rr(0, TAU);
        f.vrot[i] = rr(-1.4, 1.4);
        f.kind[i] = 1;
      }
    }

    const t = s.time;
    const mdt = s.dt;
    const push = (5 + 50 * s.wind) * (0.5 + 0.5 * s.motion);
    for (let i = 0; i < f.cap; i++) {
      if (!f.alive[i]) continue;
      f.age[i] += mdt;
      const a = f.age[i] / f.life[i];
      if (a >= 1 || f.y[i] > h + 20) {
        f.kill(i);
        continue;
      }
      const ph = f.p0[i];
      f.x[i] += (f.vx[i] + push * 0.7 + Math.sin(t * f.p1[i] + ph) * 12) * mdt;
      f.y[i] += f.vy[i] * mdt;
      if (f.kind[i] === 1) {
        f.rot[i] += f.vrot[i] * mdt;
        f.flip[i] = Math.cos(t * 1.7 + ph);
      }
      f.alpha[i] = f.p2[i] * envelope(a, 0.06, 0.15);
      f.apply(i);
    }
  }

  destroy(): void {
    this.field.destroy();
  }
}
