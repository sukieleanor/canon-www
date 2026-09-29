import { Container, type Sprite, type Texture } from 'pixi.js';
import { ridgeSteps, treeSteps } from '../art';
import type { NoteStimulus, Stimuli } from '../mapping';
import { VOICE_COLORS, clamp01, gradeInto, hex, lerp, mixInto, pack, type RGB } from '../palettes';
import { ParticleField } from '../pool';
import { AURORA_FRAG } from '../shaders/aurora';
import type { Steps } from '../slice';
import { Falling } from './falling';
import { TAU, envelope, rr, smooth, sprite } from './kit';
import { Scene, ShaderQuad, SkyQuad, Strip } from './scene';
import { WaterSurface } from './water';

const HORIZON = 0.74;
const STARS = 340;
const SHOOTERS = 4;

const SKY_NIGHT = { top: hex(0x040917), mid: hex(0x0a1a35), low: hex(0x14435a) };
const SKY_TWILIGHT = { top: hex(0x0d1445), mid: hex(0x2c2a66), low: hex(0x85507a) };
/** Aurora ramps per season: bottom, middle, top colour. */
const RAMPS: readonly RGB[][] = [
  [hex(0x33ff6e), hex(0x18e0a4), hex(0x9a4cf5)],
  [hex(0x26f5a8), hex(0x1fb4ee), hex(0x6455f5)],
  [hex(0x9cff4d), hex(0x2fe86e), hex(0xf5458c)],
  [hex(0x38ffb8), hex(0x38bcff), hex(0x8c5cff)],
];
const STAR_TINTS = [0xdfe9ff, 0xfff2dc, 0xbcd4ff, 0xffffff];

class AuroraQuad extends ShaderQuad {
  readonly a: Float32Array;
  readonly b: Float32Array;
  readonly col0: Float32Array;
  readonly col1: Float32Array;
  readonly col2: Float32Array;

  constructor(noise: Texture) {
    const a = new Float32Array([0, 1.6, 0, 0]);
    const b = new Float32Array([0, 4, 0, 1]);
    const col0 = new Float32Array([0.3, 1, 0.55]);
    const col1 = new Float32Array([0.12, 0.85, 0.72]);
    const col2 = new Float32Array([0.6, 0.32, 0.95]);
    super(
      AURORA_FRAG,
      {
        uA: { value: a, type: 'vec4<f32>' },
        uB: { value: b, type: 'vec4<f32>' },
        uCol0: { value: col0, type: 'vec3<f32>' },
        uCol1: { value: col1, type: 'vec3<f32>' },
        uCol2: { value: col2, type: 'vec3<f32>' },
      },
      { uNoise: noise },
      true,
    );
    this.a = a;
    this.b = b;
    this.col0 = col0;
    this.col1 = col1;
    this.col2 = col2;
  }
}

/** Night sky: twinkling stars that flare with notes, bass-driven aurora curtains, shooting stars. */
export class AuroraScene extends Scene {
  private readonly skyLayer = new Container();
  private sky!: SkyQuad;
  private aurora!: AuroraQuad;
  private mountains!: Strip;
  private pines!: Strip;
  private farPines!: Strip;
  private water!: WaterSurface;
  private stars!: ParticleField;
  private flares!: ParticleField;
  private shooters!: ParticleField;
  private falling!: Falling;
  private readonly band: Sprite[] = [];
  private clock = 0;
  private shootIn = 14;
  private readonly c = new Float32Array(12);

  *build(): Steps {
    const { atlas } = this.ctx;
    const fr = atlas.frames;
    const sky = this.skyLayer;
    this.root.addChild(sky);

    this.sky = this.own(new SkyQuad(atlas.noise));
    sky.addChild(this.sky.mesh);
    this.compile(this.sky);
    for (let i = 0; i < 5; i++) {
      const b = sprite(fr.glowSoft, true);
      this.band.push(b);
      sky.addChild(b);
    }
    this.stars = new ParticleField(atlas.texture, fr.dot, STARS, 'add', true);
    sky.addChild(this.stars.container);
    for (let i = 0; i < STARS; i++) this.placeStar(i);
    yield;

    this.aurora = this.own(new AuroraQuad(atlas.noise));
    sky.addChild(this.aurora.mesh);
    this.compile(this.aurora);
    yield;
    this.flares = new ParticleField(atlas.texture, fr.flare, 90, 'add');
    this.shooters = new ParticleField(atlas.texture, fr.streak, SHOOTERS, 'add');
    sky.addChild(this.flares.container, this.shooters.container);
    yield;

    const mts = yield* this.strip(
      ridgeSteps(2048, 384, { seed: 77, base: 0.97, amp: 0.7, cells: 3, octaves: 6, ridged: 0.75, shade: [0.9, 0.55], facets: 0.4, light: -1 }),
    );
    this.mountains = this.own(new Strip(mts));
    this.mountains.setRim(-1, 0.7);
    sky.addChild(this.mountains.mesh);
    this.compile(this.mountains);
    yield;

    const fp = yield* this.strip(
      treeSteps(2048, 256, { seed: 85, count: 110, minH: 0.3, maxH: 0.8, base: 0.98, kind: 'pine', shade: [0.6, 0.9], light: -1 }),
    );
    this.farPines = this.own(new Strip(fp));
    this.farPines.setRim(-1, 0.45);
    sky.addChild(this.farPines.mesh);
    yield;

    const pn = yield* this.strip(
      treeSteps(2048, 384, { seed: 91, count: 34, minH: 0.4, maxH: 1, base: 0.985, kind: 'pine', shade: [0.55, 0.9], light: -1 }),
    );
    this.pines = this.own(new Strip(pn));
    this.pines.setRim(-1, 0.6);
    sky.addChild(this.pines.mesh);
    yield;

    this.water = this.own(new WaterSurface(sky, atlas));
    this.root.addChild(this.water.quad.mesh, this.water.view);
    this.compile(this.water.quad);
    yield;
    this.falling = new Falling(atlas, 90);
    this.root.addChild(this.falling.field.container);
    yield;
  }

  private placeStar(i: number): void {
    const f = this.stars;
    const k = f.spawn(this.ctx.atlas.frames.dot, STAR_TINTS[i % STAR_TINTS.length]);
    if (k < 0) return;
    const bright = i % 11 === 0;
    f.p0[k] = rr(0, TAU);
    f.p1[k] = bright ? rr(0.8, 1) : rr(0.3, 0.85);
    f.p2[k] = rr(0.6, 2.2);
    f.p3[k] = 0;
    f.vx[k] = bright ? rr(5, 8) : rr(2, 4.4);
    f.life[k] = 1e9;
    f.x[k] = rr(0, 1);
    f.y[k] = Math.sqrt(rr(0, 1)) * 0.96;
  }

  layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    const hz = h * HORIZON;
    this.sky.layout(w, hz);
    this.aurora.place(0, 0, w, hz);
    this.aurora.a[1] = w / hz;
    this.mountains.place(0, hz - h * 0.3, w, h * 0.3 + 3);
    this.farPines.place(0, hz - h * 0.085, w, h * 0.085 + 3);
    this.pines.place(0, hz - h * 0.2, w, h * 0.2 + 3);
    for (let i = 0; i < this.band.length; i++) {
      const b = this.band[i];
      const u = (i + 0.5) / this.band.length;
      b.position.set(w * (0.12 + 0.76 * u), hz * (0.72 - 0.55 * u));
      b.width = hz * 0.8;
      b.height = hz * 0.5;
      b.rotation = -0.6;
    }
    this.water.layout(w, h, hz, 2.1);
  }

  override get particleCount(): number {
    return this.stars.count + this.flares.count + this.shooters.count + this.falling.count + this.water.ripples.count;
  }

  update(dt: number, s: Stimuli, live: boolean): void {
    const { w, h } = this;
    const hz = h * HORIZON;
    const g = s.grade;
    const c = this.c;
    const du = s.dusk;
    this.clock += s.dt * (0.75 + 0.9 * s.wind);
    const T = this.clock;

    const sky = this.sky;
    mixInto(c, 0, SKY_NIGHT.top, SKY_TWILIGHT.top, du);
    gradeInto(sky.top, 0, c[0], c[1], c[2], g, 0.5);
    mixInto(c, 0, SKY_NIGHT.mid, SKY_TWILIGHT.mid, du);
    gradeInto(sky.mid, 0, c[0], c[1], c[2], g, 0.6);
    mixInto(c, 0, SKY_NIGHT.low, SKY_TWILIGHT.low, du);
    gradeInto(sky.low, 0, c[0], c[1], c[2], g, 0.7);
    sky.stops[0] = 0.55;
    sky.stops[1] = 1;
    sky.sun[3] = 0;
    sky.cloud[0] = 0;

    // Aurora colours: season ramp, warmed by the stage, nudged toward the chord colour.
    const W = s.season;
    const ramp = this.aurora;
    for (let ch = 0; ch < 3; ch++) {
      let c0 = 0;
      let c1 = 0;
      let c2 = 0;
      for (let i = 0; i < 4; i++) {
        c0 += W[i] * RAMPS[i][0][ch];
        c1 += W[i] * RAMPS[i][1][ch];
        c2 += W[i] * RAMPS[i][2][ch];
      }
      c[ch] = c0;
      c[3 + ch] = c1;
      c[6 + ch] = c2;
    }
    const warm = clamp01(s.warmth);
    c[0] = lerp(c[0], 0.85, warm * 0.35);
    c[2] = lerp(c[2], 0.3, warm * 0.2);
    c[6] = lerp(c[6], 0.98, warm * 0.4);
    c[8] = lerp(c[8], 0.6, warm * 0.35);
    gradeInto(ramp.col0, 0, c[0], c[1], c[2], g, 1.5);
    gradeInto(ramp.col1, 0, c[3], c[4], c[5], g, 1.2);
    gradeInto(ramp.col2, 0, c[6], c[7], c[8], g, 0.8);
    ramp.a[0] = T;
    ramp.a[2] = s.bass * s.sway;
    ramp.a[3] = s.energy;
    ramp.b[0] = s.phrase;
    ramp.b[1] = s.detail > 0.55 ? 4 : s.detail > 0.3 ? 3 : 2;
    ramp.b[2] = s.chordPulse;
    ramp.b[3] = (0.55 + 0.5 * s.light) * (1 - 0.35 * du) * (0.9 + 0.2 * s.season[3] - 0.15 * s.season[1]);

    // Ground: near-black silhouettes rim-lit by the aurora, paler with distance.
    mixInto(c, 3, ramp.col0, ramp.col1, 0.4);
    for (let i = 0; i < 3; i++) {
      const st = i === 0 ? this.mountains : i === 1 ? this.farPines : this.pines;
      if (i === 0) gradeInto(st.color, 0, 0.09, 0.13, 0.24, g, 0.4);
      else if (i === 1) gradeInto(st.color, 0, 0.035, 0.06, 0.1, g, 0.3);
      else gradeInto(st.color, 0, 0.012, 0.022, 0.04, g, 0.2);
      st.light[0] = c[3] * 0.5;
      st.light[1] = c[4] * 0.5;
      st.light[2] = c[5] * 0.5;
      st.haze[0] = sky.low[0];
      st.haze[1] = sky.low[1];
      st.haze[2] = sky.low[2];
      st.hazeAmt[0] = i === 0 ? 0.25 : i === 1 ? 0.12 : 0.03;
      st.hazeAmt[1] = i === 0 ? 0.78 : i === 1 ? 0.6 : 0.35;
      st.move[0] = 0;
      st.move[2] = T;
      st.move[3] = i > 0 ? 0.0014 * s.sway * (0.3 + 0.7 * s.wind) * i : 0;
      st.wave[0] = 7;
      st.wave[1] = 0.8;
      st.wave[2] = i > 0 ? 0.0008 * s.bass * s.sway * i : 0;
      st.wave[3] = T * 3;
    }

    // Milky way haze.
    const bandCol = 0.05 + 0.03 * (1 - du);
    for (let i = 0; i < this.band.length; i++) {
      const b = this.band[i];
      b.tint = pack(0.62, 0.7, 1);
      b.alpha = bandCol * (0.7 + 0.3 * Math.sin(i * 1.7 + T * 0.05));
    }

    // Pool: the mirrored sky is calm; the bass makes it breathe.
    const water = this.water;
    water.setDetail(s.detail);
    water.reflect(this.ctx.renderer);
    const wt = water.quad;
    gradeInto(wt.deep, 0, 0.012, 0.03, 0.06, g, 0.3);
    gradeInto(wt.shallow, 0, 0.03, 0.08, 0.13, g, 0.4);
    wt.sunCol[0] = ramp.col0[0];
    wt.sunCol[1] = ramp.col0[1];
    wt.sunCol[2] = ramp.col0[2];
    wt.a[0] = T;
    wt.a[2] = clamp01(s.swell * 1.2) * s.sway;
    wt.a[3] = 0.15 * s.wind * s.sway;
    wt.b[1] = 0.85;
    wt.b[2] = 0.03;
    wt.sun[0] = 0.5;
    wt.sun[1] = 0;
    wt.sun[3] = 0;
    water.tick(this.ctx.renderer, s, live, true);

    this.updateStars(s, live, w, hz);
    this.falling.update(dt, s, live, w, h, 0.5);
  }

  private updateStars(s: Stimuli, live: boolean, w: number, hz: number): void {
    const t = s.time;
    const mdt = s.dt;
    const st = this.stars;
    const tw = 0.3 * s.sway * (0.6 + 0.6 * s.sparkle);
    const bright = (0.85 + 0.2 * s.season[3] - 0.12 * s.season[1]) * (1 - 0.35 * s.dusk);
    const decay = Math.exp(-mdt / 0.9);
    for (let i = 0; i < STARS; i++) {
      const flare = st.p3[i];
      st.p3[i] = flare > 0.002 ? flare * decay : 0;
      const horizon = 1 - smooth((st.y[i] - 0.66) / 0.3) * 0.85;
      const twinkle = 1 - tw + tw * Math.sin(t * st.p2[i] + st.p0[i]);
      const part = st.parts[i];
      part.x = st.x[i] * w;
      part.y = st.y[i] * hz;
      part.scaleX = part.scaleY = (st.vx[i] * (1 + 1.4 * flare)) / 32;
      part.alpha = clamp01(st.p1[i] * twinkle * bright * horizon + 0.9 * flare);
    }

    const fl = this.flares;
    fl.setLimit(fl.cap * s.capScale);
    for (let i = 0; i < fl.cap; i++) {
      if (!fl.alive[i]) continue;
      fl.age[i] += mdt;
      const a = fl.age[i] / fl.life[i];
      if (a >= 1) {
        fl.kill(i);
        continue;
      }
      const pop = smooth(fl.age[i] / 0.12);
      fl.size[i] = fl.p2[i] * (0.4 + 0.6 * pop) * (1 + 0.25 * a);
      fl.alpha[i] = fl.p1[i] * pop * (1 - smooth((a - 0.1) / 0.9));
      fl.rot[i] = fl.p0[i] + a * 0.35;
      fl.apply(i);
    }

    if (live) {
      this.shootIn -= mdt * (1 + 1.5 * s.sparkle);
      if (this.shootIn <= 0) {
        this.shootIn = rr(24, 46);
        this.shoot(w, hz, 0.7);
      }
    }
    const sh = this.shooters;
    for (let i = 0; i < sh.cap; i++) {
      if (!sh.alive[i]) continue;
      sh.age[i] += mdt;
      const a = sh.age[i] / sh.life[i];
      if (a >= 1) {
        sh.kill(i);
        continue;
      }
      sh.x[i] += sh.vx[i] * mdt;
      sh.y[i] += sh.vy[i] * mdt;
      sh.alpha[i] = sh.p1[i] * envelope(a, 0.12, 0.6);
      sh.apply(i);
    }
  }

  private shoot(w: number, hz: number, strength: number): void {
    const sh = this.shooters;
    const i = sh.spawn(this.ctx.atlas.frames.streak, 0xdff4ff);
    if (i < 0) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const ang = rr(0.32, 0.62);
    const speed = rr(650, 950);
    sh.setAnchor(i, 0.94, 0.5);
    sh.x[i] = dir > 0 ? rr(0.05, 0.5) * w : rr(0.5, 0.95) * w;
    sh.y[i] = rr(0.06, 0.34) * hz;
    sh.vx[i] = Math.cos(ang) * speed * dir;
    sh.vy[i] = Math.sin(ang) * speed;
    sh.rot[i] = dir > 0 ? ang : Math.PI - ang;
    sh.size[i] = rr(220, 340);
    sh.squash[i] = 0.9;
    sh.life[i] = rr(0.9, 1.3);
    sh.p1[i] = strength;
  }

  override note(n: NoteStimulus, s: Stimuli): void {
    const { w, h } = this;
    const hz = h * HORIZON;
    const x = n.x01;
    const y = 0.9 - 0.82 * n.pitch01;
    const orn = n.ornament ? 0.5 : 1;
    // Light the nearest star, or the exact spot if none is close.
    const st = this.stars;
    let best = -1;
    let bd = 0.0034;
    for (let i = 0; i < STARS; i++) {
      const dx = (st.x[i] - x) * (w / hz);
      const dy = st.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    let px = x * w;
    let py = y * hz;
    if (best >= 0) {
      st.p3[best] = Math.min(1.4, st.p3[best] + (0.7 + 0.5 * n.strength) * orn);
      px = st.x[best] * w;
      py = st.y[best] * hz;
    }
    if (s.flash <= 0) return;
    const base = VOICE_COLORS[n.voice];
    const c = this.c;
    gradeInto(c, 9, base[0], base[1], base[2], s.grade, 0.3);
    const size = (22 + 34 * n.strength) * orn * (n.voice === 1 ? 1.15 : n.voice === 2 ? 0.85 : 1);
    const fl = this.flares;
    const i = fl.spawn(this.ctx.atlas.frames.flare, pack(c[9], c[10], c[11]));
    if (i < 0) return;
    fl.x[i] = px;
    fl.y[i] = py;
    fl.life[i] = 1.2 + Math.min(n.duration, 2) * 0.35;
    fl.p0[i] = rr(0, 0.6);
    fl.p1[i] = (0.55 + 0.4 * n.strength) * orn * s.flash;
    fl.p2[i] = size;
    fl.size[i] = size * 0.4;
  }

  override phraseEnd(s: Stimuli): void {
    if (s.flash > 0) this.shoot(this.w, this.h * HORIZON, 0.95);
  }
}
