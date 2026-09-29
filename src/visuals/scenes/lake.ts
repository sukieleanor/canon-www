import { Container, type Sprite } from 'pixi.js';
import { cloudSteps, ridgeSteps, treeSteps } from '../art';
import type { NoteStimulus, Stimuli } from '../mapping';
import { VOICE_COLORS, clamp01, gradeInto, hex, lerp, mixInto, pack, type RGB } from '../palettes';
import { ParticleField } from '../pool';
import type { Steps } from '../slice';
import { Falling } from './falling';
import { TAU, envelope, rr, smooth, sprite } from './kit';
import { Scene, SkyQuad, Strip } from './scene';
import { WaterSurface } from './water';

const HORIZON = 0.58;
const SUN_X = 0.72;
const LILIES = 14;

const mix3 = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const SKY_DAY = { top: hex(0x4d719e), mid: hex(0xa7b2c9), low: hex(0xf7d0aa) };
const SKY_DUSK = { top: hex(0x1f2552), mid: hex(0x6c5083), low: hex(0xf39a7a) };
const HAZE_DAY = mix3(SKY_DAY.mid, SKY_DAY.low, 0.55);
const HAZE_DUSK = mix3(SKY_DUSK.mid, SKY_DUSK.low, 0.55);
const WATER_DAY = { deep: hex(0x123246), shallow: hex(0x4b6f80) };
const WATER_DUSK = { deep: hex(0x0c1a34), shallow: hex(0x3d3f66) };
const HAZE_TOP = [0.3, 0.2, 0.08];
const HAZE_FOOT = [0.78, 0.62, 0.42];

/** Lake reflections: a mirrored shore in a shader-driven water surface; every note drops a ripple. */
export class LakeScene extends Scene {
  private readonly skyLayer = new Container();
  private sky!: SkyQuad;
  private sunGlow!: Sprite;
  private readonly ridges: Strip[] = [];
  private mist!: Strip;
  private trees!: Strip;
  private water!: WaterSurface;
  private lilies!: ParticleField;
  private glints!: ParticleField;
  private falling!: Falling;
  private moteAcc = 0;
  private bloomNext = 0;
  private readonly c = new Float32Array(12);

  *build(): Steps {
    const { atlas } = this.ctx;
    const fr = atlas.frames;
    const sky = this.skyLayer;
    this.root.addChild(sky);

    this.sky = this.own(new SkyQuad(atlas.noise));
    sky.addChild(this.sky.mesh);
    this.compile(this.sky);
    this.sunGlow = sprite(fr.glow, true);
    sky.addChild(this.sunGlow);
    yield;

    const far = yield* this.strip(
      ridgeSteps(2048, 384, { seed: 41, base: 0.96, amp: 0.86, cells: 3, octaves: 6, ridged: 0.8, shade: [0.95, 0.7], facets: 0.45, light: 1 }),
    );
    const farStrip = this.own(new Strip(far));
    farStrip.setRim(1, 0.55);
    this.ridges.push(farStrip);
    sky.addChild(farStrip.mesh);
    this.compile(farStrip);
    yield;

    const hill = yield* this.strip(
      ridgeSteps(2048, 256, { seed: 53, base: 0.96, amp: 0.5, cells: 5, octaves: 5, ridged: 0.35, shade: [0.95, 0.7], facets: 0.3, light: 1 }),
    );
    const hillStrip = this.own(new Strip(hill));
    hillStrip.setRim(1, 0.5);
    this.ridges.push(hillStrip);
    sky.addChild(hillStrip.mesh);
    yield;

    const mistTex = yield* this.strip(
      cloudSteps(1024, 256, { seed: 8, count: 4, base: 0.55, spread: 0.3, size: 0.1, length: 0.6, puffs: 26, flat: 0.34 }),
    );
    this.mist = this.own(new Strip(mistTex));

    const shore = yield* this.strip(
      treeSteps(2048, 256, { seed: 61, count: 46, minH: 0.4, maxH: 0.85, base: 0.97, kind: 'mixed', shade: [0.6, 0.96], light: 1 }),
    );
    this.trees = this.own(new Strip(shore));
    this.trees.setRim(1, 0.5);
    sky.addChild(this.trees.mesh, this.mist.mesh);
    yield;

    this.water = this.own(new WaterSurface(sky, atlas));
    this.root.addChild(this.water.quad.mesh, this.water.view);
    this.compile(this.water.quad);
    yield;
    this.lilies = new ParticleField(atlas.texture, fr.pad, LILIES, 'normal', true);
    this.glints = new ParticleField(atlas.texture, fr.glow, 220, 'add');
    this.falling = new Falling(atlas, 100);
    this.root.addChild(this.lilies.container, this.glints.container, this.falling.field.container);
    for (let i = 0; i < 7; i++) this.placePad(i);
    yield;
  }

  private placePad(slot: number): void {
    const f = this.lilies;
    const i = f.spawn(this.ctx.atlas.frames.pad, 0x6f9a63);
    if (i < 0) return;
    f.kind[i] = 0;
    f.p0[i] = 0.06 + 0.88 * ((slot * 0.618 + 0.13) % 1);
    f.p1[i] = 0.5 + 0.34 * ((slot * 0.37 + 0.2) % 1);
    f.p2[i] = rr(0, TAU);
    f.p3[i] = 0.7 + 0.5 * ((slot * 0.51) % 1);
    f.life[i] = 1e9;
    f.alpha[i] = 0.9;
  }

  layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const hz = h * HORIZON;
    this.sky.layout(w, hz);
    const foot = 3;
    this.ridges[0].place(0, hz - h * 0.32, w, h * 0.32 + foot);
    this.ridges[1].place(0, hz - h * 0.18, w, h * 0.18 + foot);
    this.trees.place(0, hz - h * 0.14, w, h * 0.14 + foot);
    this.mist.place(0, hz - h * 0.12, w, h * 0.15);
    const sun = h * 1.5;
    this.sunGlow.width = sun;
    this.sunGlow.height = sun;
    this.water.layout(w, h, hz);
  }

  override get particleCount(): number {
    return this.glints.count + this.falling.count + this.lilies.count + this.water.ripples.count;
  }

  update(dt: number, s: Stimuli, live: boolean): void {
    const { w, h } = this;
    const hz = h * HORIZON;
    const g = s.grade;
    const t = s.time;
    const c = this.c;
    const du = s.dusk;

    // Sky: pale morning that slides into a violet-peach dusk during "rest".
    const sky = this.sky;
    mixInto(c, 0, SKY_DAY.top, SKY_DUSK.top, du);
    gradeInto(sky.top, 0, c[0], c[1], c[2], g, 0.8);
    mixInto(c, 0, SKY_DAY.mid, SKY_DUSK.mid, du);
    gradeInto(sky.mid, 0, c[0], c[1], c[2], g, 1);
    mixInto(c, 0, SKY_DAY.low, SKY_DUSK.low, du);
    gradeInto(sky.low, 0, c[0], c[1], c[2], g, 1);
    sky.stops[0] = 0.42;
    sky.stops[1] = 0.98;
    const sunY = lerp(0.78, 0.92, du);
    sky.sun[0] = SUN_X;
    sky.sun[1] = sunY;
    sky.sun[2] = 0.05 + 0.006 * s.chordPulse;
    sky.sun[3] = (0.75 + 0.2 * s.phrase + 0.1 * s.chordPulse) * clamp01(s.light + 0.1) * (1 - 0.3 * du);
    gradeInto(sky.sunColor, 0, 1, lerp(0.88, 0.64, du), lerp(0.66, 0.5, du), g, 0.6);
    sky.cloud[0] = 0.4 + 0.3 * s.mist;
    sky.cloud[1] = t;
    sky.cloud[2] = 2.2;
    gradeInto(sky.cloudLit, 0, 1, lerp(0.93, 0.7, du), lerp(0.88, 0.64, du), g, 0.8);
    gradeInto(sky.cloudShade, 0, 0.55, 0.6, 0.72, g, 0.8);

    gradeInto(c, 0, 1, 0.78, 0.55, g, 0.9);
    this.sunGlow.tint = pack(c[0], c[1], c[2]);
    this.sunGlow.alpha = (0.3 + 0.1 * s.phrase + 0.05 * s.chordPulse) * (1 - 0.3 * du);
    this.sunGlow.position.set(w * SUN_X, hz * sunY);

    // Shore layers fade into haze with distance.
    mixInto(c, 6, HAZE_DAY, HAZE_DUSK, du);
    gradeInto(c, 9, c[6], c[7], c[8], g, 0.9);
    const hz0 = c[9];
    const hz1 = c[10];
    const hz2 = c[11];
    const F = s.foliage;
    const sway = s.sway * (0.3 + 0.7 * s.wind);
    for (let i = 0; i < 3; i++) {
      const st = i < 2 ? this.ridges[i] : this.trees;
      if (i === 0) gradeInto(st.color, 0, 0.3, 0.38, 0.56, g, 0.7);
      else if (i === 1) gradeInto(st.color, 0, lerp(0.2, F[0] * 0.5, 0.55), lerp(0.32, F[1] * 0.5, 0.55), lerp(0.42, F[2] * 0.5, 0.55), g, 0.5);
      else gradeInto(st.color, 0, F[0] * 0.42, F[1] * 0.42, F[2] * 0.42, g, 0.4);
      gradeInto(st.light, 0, 1, 0.84, 0.62, g, 0.8);
      st.haze[0] = hz0;
      st.haze[1] = hz1;
      st.haze[2] = hz2;
      st.hazeAmt[0] = HAZE_TOP[i] * (0.8 + 0.4 * s.mist);
      st.hazeAmt[1] = HAZE_FOOT[i] * (0.8 + 0.3 * s.mist);
      st.move[0] = t * 0.0002 * (i + 1) * s.sway;
      st.move[2] = t;
      st.move[3] = i === 2 ? 0.0018 * sway : 0;
      st.wave[0] = 7;
      st.wave[1] = 0.8;
      st.wave[2] = i === 2 ? 0.0012 * s.bass * s.sway : 0;
      st.wave[3] = t * 3.4;
    }
    const m = this.mist;
    m.color[0] = hz0 * 1.02;
    m.color[1] = hz1;
    m.color[2] = hz2 * 0.98;
    gradeInto(m.light, 0, 1, 0.92, 0.78, g, 0.6);
    m.haze[0] = hz0;
    m.haze[1] = hz1;
    m.haze[2] = hz2;
    m.hazeAmt[0] = 0;
    m.hazeAmt[1] = 0;
    m.move[0] = t * 0.003 * s.sway;
    m.move[2] = t;
    m.mesh.alpha = clamp01(0.2 + 0.45 * s.mist) * 0.85;

    // Water: reflection of the shore, colours, glitter path and swell.
    const water = this.water;
    water.setDetail(s.detail);
    water.reflect(this.ctx.renderer);
    const wt = water.quad;
    mixInto(c, 0, WATER_DAY.deep, WATER_DUSK.deep, du);
    gradeInto(wt.deep, 0, c[0], c[1], c[2], g, 0.5);
    mixInto(c, 0, WATER_DAY.shallow, WATER_DUSK.shallow, du);
    gradeInto(wt.shallow, 0, c[0], c[1], c[2], g, 0.7);
    wt.sunCol[0] = sky.sunColor[0];
    wt.sunCol[1] = sky.sunColor[1];
    wt.sunCol[2] = sky.sunColor[2];
    wt.a[0] = t;
    wt.a[2] = clamp01(s.swell * 1.4) * s.sway + 0.15 * s.energy;
    wt.a[3] = s.wind * s.sway;
    wt.b[1] = 1;
    wt.b[2] = 0.03;
    wt.sun[0] = SUN_X;
    wt.sun[1] = (0.5 + 0.5 * s.sparkle) * clamp01(s.light) * (1 - 0.5 * du);
    wt.sun[3] = (0.4 + 0.3 * s.phrase) * (1 - 0.5 * du);
    water.tick(this.ctx.renderer, s, live, true);

    this.updateParticles(dt, s, live, w, h);
  }

  private updateParticles(dt: number, s: Stimuli, live: boolean, w: number, h: number): void {
    const t = s.time;
    const mdt = s.dt;
    const hz = h * HORIZON;
    const hw = h - hz;
    const g = s.grade;
    this.falling.update(dt, s, live, w, h, 0.7, 0.5);

    // Lily pads bob on the swell; lotus flowers open at phrase ends.
    const lil = this.lilies;
    const c = this.c;
    const bob = (0.6 + 2.2 * s.swell) * s.sway;
    for (let i = 0; i < lil.cap; i++) {
      if (!lil.alive[i]) continue;
      const depth = lil.p1[i];
      const persp = 0.3 + depth;
      lil.x[i] = lil.p0[i] * w + Math.sin(t * 0.3 + lil.p2[i]) * 3 * s.sway;
      lil.y[i] = hz + depth * hw + Math.sin(t * 1.1 + lil.p2[i]) * bob;
      if (lil.kind[i] === 0) {
        lil.size[i] = 0.1 * h * persp * lil.p3[i];
        lil.squash[i] = 0.52;
        lil.alpha[i] = 0.85;
        gradeInto(c, 3, 0.3, 0.5, 0.28, g, 0.35);
        lil.parts[i].tint = pack(c[3], c[4], c[5]);
      } else {
        lil.age[i] += mdt;
        const a = lil.age[i] / lil.life[i];
        if (a >= 1) {
          lil.kill(i);
          continue;
        }
        const open = smooth(lil.age[i] / 2.4);
        lil.size[i] = 0.11 * h * persp * (0.35 + 0.65 * open) * lil.p3[i];
        lil.squash[i] = 0.25 + 0.75 * open;
        lil.alpha[i] = envelope(a, 0.05, 0.16) * (0.4 + 0.6 * open);
        gradeInto(c, 3, 1, 0.82, 0.9, g, 0.5);
        lil.parts[i].tint = pack(c[3], c[4], c[5]);
      }
      lil.apply(i);
    }

    const gl = this.glints;
    gl.setLimit(gl.cap * s.capScale);
    if (live) {
      this.moteAcc += ((6 + 10 * s.sparkle) * s.capScale * dt) / 4;
      while (this.moteAcc >= 1) {
        this.moteAcc -= 1;
        const i = gl.spawn(this.ctx.atlas.frames.glow, 0xffe2b0);
        if (i < 0) break;
        gl.x[i] = rr(0, w);
        gl.y[i] = rr(0.3 * h, hz + hw * 0.5);
        gl.vx[i] = rr(-3, 3);
        gl.vy[i] = rr(-6, -1);
        gl.size[i] = rr(4, 9);
        gl.life[i] = rr(6, 11);
        gl.p0[i] = rr(0, TAU);
        gl.p1[i] = rr(0.3, 0.7);
        gl.kind[i] = 0;
      }
    }
    const push = (3 + 28 * s.wind) * (0.5 + 0.5 * s.motion);
    for (let i = 0; i < gl.cap; i++) {
      if (!gl.alive[i]) continue;
      gl.age[i] += mdt;
      const a = gl.age[i] / gl.life[i];
      if (a >= 1) {
        gl.kill(i);
        continue;
      }
      if (gl.kind[i] === 0) {
        gl.x[i] += (gl.vx[i] + push + Math.sin(t * 0.7 + gl.p0[i]) * 5) * mdt;
        gl.y[i] += gl.vy[i] * mdt;
        gl.alpha[i] = gl.p1[i] * envelope(a, 0.2, 0.35) * (0.7 + 0.3 * Math.sin(t * 1.2 + gl.p0[i]));
      } else {
        const pop = smooth(gl.age[i] / 0.14);
        gl.size[i] = gl.p2[i] * (0.5 + 0.5 * pop);
        gl.alpha[i] = gl.p1[i] * pop * (1 - smooth((a - 0.15) / 0.85));
      }
      gl.apply(i);
    }
  }

  override note(n: NoteStimulus, s: Stimuli): void {
    const { w, h } = this;
    const hz = h * HORIZON;
    const depth = 0.9 - 0.82 * n.pitch01;
    const base = VOICE_COLORS[n.voice];
    const c = this.c;
    gradeInto(c, 6, base[0], base[1], base[2], s.grade, 0.35);
    const orn = n.ornament ? 0.5 : 1;
    const life = (2.5 + Math.min(n.duration, 2) * 0.8) * (n.ornament ? 0.7 : 1);
    this.water.tryDrop(n.ornament ? 1.4 : 1, n.x01, depth, (0.5 + 0.6 * n.strength) * orn, 0.75 + 0.5 * n.strength, life, c[6] * 0.9, c[7] * 0.9, c[8] * 0.9);

    const gl = this.glints;
    const y = hz + depth * (h - hz);
    const size = (10 + 14 * n.strength) * (0.4 + depth) * orn;
    const i = gl.spawn(this.ctx.atlas.frames.glow, pack(c[6], c[7], c[8]));
    if (i >= 0) {
      gl.x[i] = n.x01 * w;
      gl.y[i] = y;
      gl.life[i] = 1.1;
      gl.p1[i] = (0.55 + 0.4 * n.strength) * orn;
      gl.p2[i] = size;
      gl.size[i] = size * 0.5;
      gl.kind[i] = 1;
    }
    if (n.voice === 2 && s.flash > 0 && !n.ornament) {
      const j = gl.spawn(this.ctx.atlas.frames.flare, pack(c[6], c[7], c[8]));
      if (j >= 0) {
        gl.x[j] = n.x01 * w;
        gl.y[j] = y;
        gl.life[j] = 0.9;
        gl.p1[j] = 0.6 * s.flash;
        gl.p2[j] = size * 2;
        gl.size[j] = size;
        gl.kind[j] = 1;
      }
    }
  }

  override phraseEnd(s: Stimuli): void {
    // One wide, slow ring and a new lotus.
    this.water.drop(rr(0.3, 0.7), 0.42, 0.75, 2.6, 5.5, 0.95, 0.85, 0.75);
    const lil = this.lilies;
    let i = lil.spawn(this.ctx.atlas.frames.lotus, 0xffffff);
    if (i < 0) {
      let oldest = -1;
      for (let k = 0; k < lil.cap; k++) {
        if (lil.alive[k] && lil.kind[k] === 1 && (oldest < 0 || lil.age[k] > lil.age[oldest])) oldest = k;
      }
      if (oldest < 0) return;
      lil.kill(oldest);
      i = lil.spawn(this.ctx.atlas.frames.lotus, 0xffffff);
      if (i < 0) return;
    }
    lil.kind[i] = 1;
    lil.setAnchor(i, 0.5, 0.86);
    this.bloomNext = (this.bloomNext + 1) % 5;
    lil.p0[i] = 0.1 + 0.8 * ((this.bloomNext * 0.41 + Math.random() * 0.3) % 1);
    lil.p1[i] = rr(0.45, 0.8);
    lil.p2[i] = rr(0, TAU);
    lil.p3[i] = rr(0.85, 1.15);
    lil.life[i] = s.reduced ? 40 : 32;
    lil.alpha[i] = 0;
  }
}
