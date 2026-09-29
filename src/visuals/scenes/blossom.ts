import { Container, type Sprite, type Texture } from 'pixi.js';
import { cherrySteps, cloudSteps, grassSteps, ridgeSteps, treeSteps } from '../art';
import type { NoteStimulus, Stimuli } from '../mapping';
import { clamp01, gradeInto, hex, lerp, mixInto, pack, type RGB } from '../palettes';
import { ParticleField } from '../pool';
import type { Steps } from '../slice';
import { spriteTexture } from '../textures';
import { Falling } from './falling';
import { TAU, envelope, rr, smooth, sprite } from './kit';
import { Scene, SkyQuad, Strip } from './scene';

const SUN_X = 0.82;
const SUN_Y = 0.2;
const PETALS = 320;
const SPARKS = 90;
const BOKEH = 9;
/** Screen fraction where fallen petals come to rest, far to near. */
const GROUND_FAR = 0.84;
const GROUND_NEAR = 0.985;

const SKY_DAY = { top: hex(0x86aeea), mid: hex(0xf0c8e0), low: hex(0xfde9de) };
const SKY_DUSK = { top: hex(0x262b66), mid: hex(0x87558f), low: hex(0xf0a08f) };
/** Canopy colours by season (spring, summer, autumn, winter): back layer, front layer, opacity. */
const CANOPY_BACK: readonly RGB[] = [hex(0xee7fa6), hex(0x86c46f), hex(0xe27a35), hex(0xb9c9e6)];
const CANOPY_FRONT: readonly RGB[] = [hex(0xffb6cf), hex(0xbfe69c), hex(0xffb35c), hex(0xeaf0ff)];
const CANOPY_ALPHA = [1, 0.9, 0.88, 0.3];
/** One petal colour per canon voice: rose, snow white, lavender. */
const PETAL_TINT: readonly RGB[] = [hex(0xffb3c8), hex(0xf8f4ff), hex(0xe0d0ff)];
const PETAL_FRAMES = ['petalA', 'petalB', 'petalC'] as const;

class CherryTree {
  readonly root = new Container();
  readonly branches: Sprite;
  readonly back: Sprite;
  readonly front: Sprite;
  private size = 1;

  constructor(branches: Texture, back: Texture, front: Texture) {
    this.branches = sprite(branches, false, 0.5, 0.99);
    this.back = sprite(back, false, 0.5, 0.99);
    this.front = sprite(front, false, 0.5, 0.99);
    this.root.addChild(this.branches, this.back, this.front);
  }

  /** Base of the trunk at (x, y); `size` is the canvas edge in pixels; `mirror` flips it. */
  place(x: number, y: number, size: number, mirror: boolean): void {
    this.size = size;
    this.root.position.set(x, y);
    this.root.scale.x = mirror ? -1 : 1;
    for (const s of [this.branches, this.back, this.front]) {
      s.width = size;
      s.height = size;
    }
  }

  get span(): number {
    return this.size;
  }
}

/** Cherry blossoms: a spreading tree whose petals fall with the melody, in a hazy spring orchard. */
export class BlossomScene extends Scene {
  private sky!: SkyQuad;
  private ground!: SkyQuad;
  private sunGlow!: Sprite;
  private groundGlow!: Sprite;
  private hills!: Strip;
  private orchard!: Strip;
  private mist!: Strip;
  private grassFar!: Strip;
  private grassNear!: Strip;
  private trees: CherryTree[] = [];
  private petals!: ParticleField;
  private sparks!: ParticleField;
  private bokeh!: ParticleField;
  private falling!: Falling;
  private gust = 0;
  private petalAcc = 0;
  private readonly c = new Float32Array(15);

  *build(): Steps {
    const { atlas } = this.ctx;
    const fr = atlas.frames;
    const root = this.root;

    this.sky = this.own(new SkyQuad(atlas.noise));
    root.addChild(this.sky.mesh);
    this.compile(this.sky);
    this.sunGlow = sprite(fr.glow, true);
    root.addChild(this.sunGlow);
    this.bokeh = new ParticleField(atlas.texture, fr.bokeh, BOKEH, 'add', false);
    root.addChild(this.bokeh.container);
    for (let i = 0; i < BOKEH; i++) this.spawnBokeh(true);
    yield;

    const hills = yield* this.strip(
      ridgeSteps(2048, 384, { seed: 203, base: 0.92, amp: 0.75, cells: 3, octaves: 5, ridged: 0.3, shade: [0.95, 0.72], facets: 0.35, light: 1 }),
    );
    this.hills = this.own(new Strip(hills));
    this.hills.setRim(1, 0.4);
    root.addChild(this.hills.mesh);
    this.compile(this.hills);
    yield;

    const orchard = yield* this.strip(
      treeSteps(2048, 320, { seed: 207, count: 34, minH: 0.42, maxH: 0.86, base: 0.97, kind: 'round', shade: [0.74, 1], light: 1 }),
    );
    this.orchard = this.own(new Strip(orchard));
    this.orchard.setRim(1, 0.5);
    root.addChild(this.orchard.mesh);
    yield;

    const mistTex = yield* this.strip(
      cloudSteps(1024, 256, { seed: 211, count: 4, base: 0.55, spread: 0.3, size: 0.1, length: 0.6, puffs: 26, flat: 0.34 }),
    );
    this.mist = this.own(new Strip(mistTex));
    root.addChild(this.mist.mesh);
    yield;

    this.ground = this.own(new SkyQuad(atlas.noise));
    root.addChild(this.ground.mesh);
    const grass = yield* this.strip(
      grassSteps(1024, 256, { seed: 221, blades: 520, minH: 0.3, maxH: 0.92, lean: 0.5, shade: [0.35, 1] }),
    );
    this.grassFar = this.own(new Strip(grass));
    this.grassFar.move[0] = 0.31;
    this.grassNear = this.own(new Strip(grass));
    root.addChild(this.grassFar.mesh);
    yield;

    const art = yield* cherrySteps(768, 4);
    const branches = this.keep(spriteTexture(art.branches));
    yield;
    const backTex = this.keep(spriteTexture(art.blossomBack));
    yield;
    const frontTex = this.keep(spriteTexture(art.blossomFront));
    this.upload(branches);
    yield;
    this.upload(backTex);
    yield;
    this.upload(frontTex);
    yield;
    for (let i = 0; i < 2; i++) {
      const tree = new CherryTree(branches, backTex, frontTex);
      this.trees.push(tree);
      root.addChild(tree.root);
    }
    this.groundGlow = sprite(fr.glow, true);
    root.addChild(this.groundGlow);
    root.addChild(this.grassNear.mesh);
    this.petals = new ParticleField(atlas.texture, fr.petalA, PETALS, 'normal');
    this.sparks = new ParticleField(atlas.texture, fr.glow, SPARKS, 'add');
    this.falling = new Falling(atlas, 110);
    root.addChild(this.petals.container, this.sparks.container, this.falling.field.container);
    yield;
  }

  layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.sky.layout(w, h);
    const sun = h * 1.7;
    this.sunGlow.position.set(w * SUN_X, h * SUN_Y);
    this.sunGlow.width = sun;
    this.sunGlow.height = sun;
    this.hills.place(0, h * 0.22, w, h * 0.66);
    this.orchard.place(0, h * 0.5, w, h * 0.38);
    this.mist.place(0, h * 0.72, w, h * 0.16);
    this.ground.layout(w, h * 0.15 + 1);
    this.ground.place(0, h * 0.85, w, h * 0.15 + 1);
    this.grassFar.place(0, h * 0.8, w, h * 0.19);
    this.grassNear.place(0, h * 0.91, w, h * 0.26);
    this.trees[0].place(w * 0.15, h * 1.04, h * 1.2, false);
    this.trees[1].place(w * 0.99, h * 1.04, h * 0.82, true);
    this.groundGlow.position.set(w * 0.5, h * 1.0);
    this.groundGlow.width = w * 1.3;
    this.groundGlow.height = h * 0.4;
  }

  override get particleCount(): number {
    return this.petals.count + this.sparks.count + this.falling.count + this.bokeh.count;
  }

  private spawnBokeh(anywhere: boolean): void {
    const f = this.bokeh;
    const i = f.spawn(this.ctx.atlas.frames.bokeh, 0xffdfe8);
    if (i < 0) return;
    f.x[i] = rr(0, this.w || 1200);
    f.y[i] = anywhere ? rr(0, (this.h || 800) * 0.8) : (this.h || 800) * 0.95;
    f.vx[i] = rr(-3, 4);
    f.vy[i] = rr(-5, -1);
    f.size[i] = rr(60, 170);
    f.life[i] = rr(26, 46);
    f.age[i] = anywhere ? rr(0, f.life[i]) : 0;
    f.p0[i] = rr(0, TAU);
    f.p1[i] = rr(0.02, 0.05);
  }

  update(dt: number, s: Stimuli, live: boolean): void {
    const { w, h } = this;
    const g = s.grade;
    const t = s.time;
    const c = this.c;
    const du = s.dusk;
    this.gust *= Math.exp(-s.dt / 2.4);

    // Sky: pale spring morning that turns violet-rose at dusk.
    const sky = this.sky;
    mixInto(c, 0, SKY_DAY.top, SKY_DUSK.top, du);
    gradeInto(sky.top, 0, c[0], c[1], c[2], g, 0.8);
    mixInto(c, 0, SKY_DAY.mid, SKY_DUSK.mid, du);
    gradeInto(sky.mid, 0, c[0], c[1], c[2], g, 1);
    mixInto(c, 0, SKY_DAY.low, SKY_DUSK.low, du);
    gradeInto(sky.low, 0, c[0], c[1], c[2], g, 1);
    sky.stops[0] = 0.4;
    sky.stops[1] = 0.86;
    sky.sun[0] = SUN_X;
    sky.sun[1] = lerp(SUN_Y, 0.4, du);
    sky.sun[2] = 0.05;
    sky.sun[3] = (0.36 + 0.16 * s.phrase + 0.08 * s.chordPulse) * clamp01(s.light) * (1 - 0.5 * du);
    gradeInto(sky.sunColor, 0, 1, lerp(0.9, 0.66, du), lerp(0.78, 0.6, du), g, 0.7);
    sky.cloud[0] = 0.28 + 0.18 * s.mist;
    sky.cloud[1] = t;
    sky.cloud[2] = 2.4;
    gradeInto(sky.cloudLit, 0, 1, lerp(0.92, 0.72, du), lerp(0.94, 0.7, du), g, 0.8);
    gradeInto(sky.cloudShade, 0, 0.78, 0.7, 0.82, g, 0.8);

    gradeInto(c, 0, 1, 0.82, 0.72, g, 0.9);
    this.sunGlow.tint = pack(c[0], c[1], c[2]);
    this.sunGlow.alpha = (0.2 + 0.1 * s.phrase + 0.05 * s.chordPulse) * (1 - 0.4 * du);
    this.sunGlow.position.y = h * lerp(SUN_Y, 0.4, du);

    // Distant hills and the pink orchard fade into the haze.
    mixInto(c, 6, SKY_DAY.low, SKY_DUSK.low, du);
    gradeInto(c, 9, c[6], c[7], c[8], g, 0.9);
    const W = s.season;
    let br = 0;
    let bg = 0;
    let bb = 0;
    let fr = 0;
    let fg = 0;
    let fb = 0;
    let alpha = 0;
    for (let i = 0; i < 4; i++) {
      br += W[i] * CANOPY_BACK[i][0];
      bg += W[i] * CANOPY_BACK[i][1];
      bb += W[i] * CANOPY_BACK[i][2];
      fr += W[i] * CANOPY_FRONT[i][0];
      fg += W[i] * CANOPY_FRONT[i][1];
      fb += W[i] * CANOPY_FRONT[i][2];
      alpha += W[i] * CANOPY_ALPHA[i];
    }
    const sway = s.sway * (0.3 + 0.7 * s.wind);
    const hillS = this.hills;
    gradeInto(hillS.color, 0, 0.72, 0.62, 0.8, g, 0.7);
    gradeInto(hillS.light, 0, 1, 0.86, 0.78, g, 0.8);
    hillS.haze[0] = c[9];
    hillS.haze[1] = c[10];
    hillS.haze[2] = c[11];
    hillS.hazeAmt[0] = 0.3;
    hillS.hazeAmt[1] = 0.75;
    hillS.move[0] = t * 0.0002 * s.sway;
    const orc = this.orchard;
    gradeInto(orc.color, 0, lerp(0.92, br, 0.5), lerp(0.7, bg, 0.5), lerp(0.8, bb, 0.5), g, 0.6);
    gradeInto(orc.light, 0, 1, 0.9, 0.86, g, 0.8);
    orc.haze[0] = c[9];
    orc.haze[1] = c[10];
    orc.haze[2] = c[11];
    orc.hazeAmt[0] = 0.28 * (0.8 + 0.4 * s.mist);
    orc.hazeAmt[1] = 0.62 * (0.8 + 0.4 * s.mist);
    orc.move[0] = 0.13 + t * 0.0003 * s.sway;
    orc.move[2] = t;
    orc.move[3] = 0.0014 * sway;
    orc.wave[0] = 6;
    orc.wave[1] = 0.7;
    orc.wave[2] = 0.0008 * s.bass * s.sway;
    orc.wave[3] = t * 3;
    const m = this.mist;
    m.color[0] = c[9];
    m.color[1] = c[10];
    m.color[2] = c[11];
    m.light[0] = 1;
    m.light[1] = 0.94;
    m.light[2] = 0.9;
    m.haze[0] = c[9];
    m.haze[1] = c[10];
    m.haze[2] = c[11];
    m.hazeAmt[0] = 1;
    m.hazeAmt[1] = 1;
    m.move[0] = t * 0.003 * s.sway;
    m.mesh.alpha = clamp01(0.14 + 0.3 * s.mist);

    // Meadow: greens follow the season; the near blades sway with the bass.
    const G = s.grass;
    const gnd = this.ground;
    gradeInto(gnd.top, 0, lerp(G[0], 0.96, 0.3), lerp(G[1], 0.82, 0.3), lerp(G[2], 0.8, 0.3), g, 0.5);
    gradeInto(gnd.mid, 0, G[0] * 0.86, G[1] * 0.9, G[2] * 0.8, g, 0.4);
    gradeInto(gnd.low, 0, G[0] * 0.66, G[1] * 0.74, G[2] * 0.66, g, 0.3);
    gnd.stops[0] = 0.3;
    gnd.stops[1] = 1;
    gnd.sun[3] = 0;
    gnd.cloud[0] = 0;
    for (let i = 0; i < 2; i++) {
      const gs = i === 0 ? this.grassFar : this.grassNear;
      const k = i === 0 ? 0.8 : 0.58;
      gradeInto(gs.color, 0, lerp(G[0] * k, 0.85 * k, 0.35), G[1] * k * 0.95, lerp(G[2] * k, 0.6 * k, 0.4), g, 0.4);
      gradeInto(gs.light, 0, 1, 0.94, 0.72, g, 0.7);
      gs.haze[0] = c[9];
      gs.haze[1] = c[10];
      gs.haze[2] = c[11];
      gs.hazeAmt[0] = i === 0 ? 0.42 : 0.08;
      gs.hazeAmt[1] = i === 0 ? 0.62 : 0.3;
      gs.move[0] = i === 0 ? 0.31 : 0;
      gs.move[2] = t;
      gs.move[3] = (i === 0 ? 0.0008 : 0.0022) * sway;
      gs.wave[0] = 9;
      gs.wave[1] = 1.1;
      gs.wave[2] = (i === 0 ? 0.001 : 0.0032) * s.bass * s.sway;
      gs.wave[3] = t * 3.6;
      gs.setRim(1, 0.35);
    }

    // Trees: blossom colours follow the season; the whole crown leans with the wind and the bass.
    for (let i = 0; i < this.trees.length; i++) {
      const tree = this.trees[i];
      const ph = i * 1.9;
      const lean = Math.sin(t * 0.55 + ph) * 0.009 * (0.3 + 0.7 * s.wind) + this.gust * 0.016 + s.swell * 0.006;
      tree.root.rotation = lean * s.sway * (i === 0 ? 1 : -1);
      tree.back.rotation = Math.sin(t * 0.9 + ph) * 0.006 * sway;
      tree.front.rotation = Math.sin(t * 1.2 + ph + 1.3) * 0.009 * sway;
      gradeInto(c, 12, 1, 1, 1, g, 0.2);
      tree.branches.tint = pack(c[12] * 0.95, c[13] * 0.95, c[14] * 0.95);
      gradeInto(c, 12, br, bg, bb, g, 0.22);
      tree.back.tint = pack(c[12], c[13], c[14]);
      tree.back.alpha = alpha * 0.95;
      gradeInto(c, 12, fr, fg, fb, g, 0.2);
      const glow = 1 + 0.12 * s.chordPulse + 0.06 * s.activity;
      tree.front.tint = pack(c[12] * glow, c[13] * glow, c[14] * glow);
      tree.front.alpha = clamp01(alpha * (0.9 + 0.1 * s.activity));
    }

    gradeInto(c, 12, 1, 0.78, 0.6, g, 0.9);
    this.groundGlow.tint = pack(c[12], c[13], c[14]);
    this.groundGlow.alpha = 0.04 + 0.16 * s.bass * s.sway + 0.03 * s.activity;

    this.updateParticles(dt, s, live, w, h);
  }

  private updateParticles(dt: number, s: Stimuli, live: boolean, w: number, h: number): void {
    const t = s.time;
    const mdt = s.dt;
    const fr = this.ctx.atlas.frames;
    this.falling.update(dt, s, live, w, h, 0.9, 0);
    const P = this.petals;
    P.setLimit(P.cap * s.capScale);
    this.sparks.setLimit(this.sparks.cap * s.capScale);
    this.bokeh.setLimit(this.bokeh.cap * s.capScale * 1.2);

    // Petals leave the crowns all the time; more with the wind and the busyness of the music.
    if (live) {
      const spring = s.season[0] + 0.5 * s.season[1] + 0.25 * s.season[2];
      this.petalAcc += (3 + 13 * s.energy + 6 * s.wind) * spring * s.capScale * dt;
      while (this.petalAcc >= 1) {
        this.petalAcc -= 1;
        this.spawnPetal(w, h, this.crownX(), rr(0.02, 0.5) * h, 0.7 + 0.3 * Math.random(), 0, 1);
      }
    }

    const push = (6 + 70 * s.wind + 110 * this.gust) * (0.4 + 0.6 * s.motion);
    for (let i = 0; i < P.cap; i++) {
      if (!P.alive[i]) continue;
      P.age[i] += mdt;
      const ph = P.p0[i];
      const landY = P.p3[i];
      if (P.kind[i] === 0) {
        if (P.age[i] > P.life[i] || P.x[i] > w * 1.2) {
          P.kill(i);
          continue;
        }
        const depth = clamp01((landY / h - GROUND_FAR) / (GROUND_NEAR - GROUND_FAR));
        const windK = 0.55 + 0.7 * depth;
        const fl = P.p1[i];
        P.x[i] += (P.vx[i] + push * windK + Math.sin(t * fl + ph) * P.p2[i]) * mdt;
        P.y[i] += (P.vy[i] + Math.cos(t * fl * 0.8 + ph) * P.p2[i] * 0.3) * mdt;
        P.rot[i] += P.vrot[i] * (0.6 + 0.4 * s.wind) * mdt;
        P.flip[i] = Math.cos(t * fl * 1.4 + ph);
        P.alpha[i] = P.squash[i] * envelope(P.age[i] / P.life[i], 0.03, 0.02);
        if (P.y[i] >= landY) {
          P.kind[i] = 1;
          P.p1[i] = P.age[i];
          P.life[i] = P.age[i] + rr(4, 9);
          P.flip[i] = 1;
          P.rot[i] = rr(-1.4, 1.4);
          P.vrot[i] = P.alpha[i];
        }
      } else {
        const a = (P.age[i] - P.p1[i]) / (P.life[i] - P.p1[i]);
        if (a >= 1) {
          P.kill(i);
          continue;
        }
        P.alpha[i] = P.vrot[i] * (1 - smooth((a - 0.35) / 0.65));
      }
      P.apply(i);
    }
    // The landed flag squashes the petal flat on the grass.
    for (let i = 0; i < P.cap; i++) if (P.alive[i] && P.kind[i] === 1) P.parts[i].scaleY = P.parts[i].scaleX * 0.36;

    const K = this.sparks;
    for (let i = 0; i < K.cap; i++) {
      if (!K.alive[i]) continue;
      K.age[i] += mdt;
      const a = K.age[i] / K.life[i];
      if (a >= 1) {
        K.kill(i);
        continue;
      }
      K.x[i] += (K.vx[i] + push * 0.35 + Math.sin(t * 1.3 + K.p0[i]) * 6) * mdt;
      K.y[i] += K.vy[i] * mdt;
      const pop = smooth(K.age[i] / 0.16);
      K.size[i] = K.p2[i] * (0.5 + 0.5 * pop);
      K.alpha[i] = K.p1[i] * pop * (1 - smooth((a - 0.25) / 0.75)) * (0.75 + 0.25 * Math.sin(t * 7 + K.p0[i]));
      K.apply(i);
    }

    const B = this.bokeh;
    for (let i = 0; i < B.cap; i++) {
      if (!B.alive[i]) continue;
      B.age[i] += mdt;
      const a = B.age[i] / B.life[i];
      if (a >= 1) {
        B.kill(i);
        if (live) this.spawnBokeh(false);
        continue;
      }
      B.x[i] += B.vx[i] * mdt;
      B.y[i] += B.vy[i] * mdt;
      B.alpha[i] = B.p1[i] * envelope(a, 0.2, 0.3) * (0.7 + 0.3 * s.light);
      B.apply(i);
    }
    void fr;
  }

  /** A spot under one of the crowns, mostly the big tree. */
  private crownX(): number {
    return (Math.random() < 0.72 ? rr(0.0, 0.42) : rr(0.8, 1.0)) * this.w;
  }

  /** One falling petal. `sz` scales its size, `voice` picks the colour, `bright` its opacity. */
  private spawnPetal(w: number, h: number, x: number, y: number, bright: number, voice: number, sz: number): number {
    const P = this.petals;
    const fr = this.ctx.atlas.frames;
    const tint = PETAL_TINT[voice];
    const landY = h * rr(GROUND_FAR, GROUND_NEAR);
    const i = P.spawn(fr[PETAL_FRAMES[(Math.random() * 3) | 0]], pack(tint[0], tint[1], tint[2]));
    if (i < 0) return -1;
    const depth = clamp01((landY / h - GROUND_FAR) / (GROUND_NEAR - GROUND_FAR));
    P.x[i] = x;
    P.y[i] = y;
    P.vx[i] = rr(-6, 10);
    P.vy[i] = lerp(22, 44, depth) * rr(0.85, 1.15);
    P.size[i] = lerp(7, 17, depth) * rr(0.8, 1.2) * sz;
    P.life[i] = ((landY - y) / P.vy[i]) * 1.6 + 6;
    P.rot[i] = rr(0, TAU);
    P.vrot[i] = rr(-1.3, 1.3);
    P.p0[i] = rr(0, TAU);
    P.p1[i] = rr(0.9, 2.1);
    P.p2[i] = rr(10, 26);
    P.p3[i] = landY;
    // squash doubles as the petal's opacity while it falls
    P.squash[i] = bright;
    P.alpha[i] = 0;
    P.kind[i] = 0;
    void w;
    return i;
  }

  override note(n: NoteStimulus, s: Stimuli): void {
    const { w, h } = this;
    // The note's pitch is the height it leaves the crown; the same pitch always drops from the same
    // spot, so the canon echoes trace the leader's petals.
    const x = w * (0.02 + 0.44 * n.x01);
    const y = h * (0.56 - 0.5 * n.pitch01);
    const orn = n.ornament ? 0.55 : 1;
    const v = n.voice;
    const i = this.spawnPetal(w, h, x, y, (0.75 + 0.25 * n.strength) * orn, v === 2 ? 1 : v, (1.3 + 0.9 * n.strength) * orn);
    if (i >= 0) {
      this.petals.vy[i] *= 0.7;
      this.petals.vx[i] += (v - 1) * 6;
    }
    if (s.flash <= 0) return;
    const K = this.sparks;
    const k = K.spawn(this.ctx.atlas.frames.glow, pack(PETAL_TINT[v][0], PETAL_TINT[v][1], PETAL_TINT[v][2]));
    if (k < 0) return;
    const size = (22 + 26 * n.strength) * orn;
    K.x[k] = x;
    K.y[k] = y;
    K.vx[k] = rr(-4, 4);
    K.vy[k] = rr(-10, -2);
    K.life[k] = 1.3 + Math.min(n.duration, 2) * 0.4;
    K.p0[k] = rr(0, TAU);
    K.p1[k] = (0.5 + 0.35 * n.strength) * orn * s.flash;
    K.p2[k] = size;
    K.size[k] = size * 0.4;
  }

  override phraseEnd(s: Stimuli): void {
    // A gust shakes the crowns: a burst of petals sweeps across the meadow.
    const { w, h } = this;
    this.gust = 1;
    const n = s.reduced ? 10 : 46;
    for (let k = 0; k < n; k++) {
      const i = this.spawnPetal(w, h, this.crownX(), rr(0.03, 0.5) * h, rr(0.7, 1), k % 3, rr(0.9, 1.5));
      if (i < 0) return;
      this.petals.vx[i] += rr(30, 90);
      this.petals.vy[i] *= rr(0.6, 1);
    }
  }
}
