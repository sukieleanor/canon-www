import type { Sprite } from 'pixi.js';
import { cloudSteps, treeSteps, trunkCanvas } from '../art';
import type { NoteStimulus, Stimuli } from '../mapping';
import { VOICE_COLORS, clamp01, gradeInto, lerp, pack } from '../palettes';
import { ParticleField } from '../pool';
import type { Steps } from '../slice';
import { spriteTexture } from '../textures';
import { TAU, envelope, rr, smooth, sprite } from './kit';
import { Scene, SkyQuad, Strip } from './scene';

const SUN_X = 0.76;
const SUN_Y = 0.27;
const RAYS = 7;

/** Forest at dawn: light shafts, drifting pollen, layered swaying trees in mist. */
export class ForestScene extends Scene {
  private sky!: SkyQuad;
  private sunGlow!: Sprite;
  private groundGlow!: Sprite;
  private readonly trees: Strip[] = [];
  private readonly fogs: Strip[] = [];
  private readonly rays: Sprite[] = [];
  private readonly rayRot = new Float32Array(RAYS);
  private readonly rayGain = new Float32Array(RAYS);
  private readonly rayPhase = new Float32Array(RAYS);
  private trunkL!: Sprite;
  private trunkR!: Sprite;
  private motes!: ParticleField;
  private fall!: ParticleField;
  private bokeh!: ParticleField;
  private acc = { mote: 0, snow: 0, leaf: 0 };
  private readonly c = new Float32Array(12);

  *build(): Steps {
    const { atlas } = this.ctx;
    const fr = atlas.frames;
    const root = this.root;

    this.sky = this.own(new SkyQuad(atlas.noise));
    root.addChild(this.sky.mesh);
    this.compile(this.sky);
    this.sunGlow = sprite(fr.glow, true);
    root.addChild(this.sunGlow);
    yield;

    const far = yield* this.strip(
      treeSteps(2048, 512, { seed: 11, count: 52, minH: 0.42, maxH: 0.82, base: 0.96, kind: 'mixed', shade: [0.6, 0.96], light: 1 }),
    );
    const farStrip = this.own(new Strip(far));
    farStrip.setRim(1, 0.55);
    this.trees.push(farStrip);
    root.addChild(farStrip.mesh);
    this.compile(farStrip);
    yield;

    const mist = yield* this.strip(
      cloudSteps(1024, 256, { seed: 5, count: 4, base: 0.55, spread: 0.3, size: 0.1, length: 0.6, puffs: 26, flat: 0.34 }),
    );
    const fogA = this.own(new Strip(mist));
    this.fogs.push(fogA);
    root.addChild(fogA.mesh);

    const mid = yield* this.strip(
      treeSteps(2048, 512, { seed: 23, count: 30, minH: 0.5, maxH: 0.95, base: 0.97, kind: 'mixed', shade: [0.5, 0.92], light: 1 }),
    );
    const midStrip = this.own(new Strip(mid));
    midStrip.setRim(1, 0.7);
    this.trees.push(midStrip);
    root.addChild(midStrip.mesh);
    yield;

    for (let i = 0; i < RAYS; i++) {
      const r = sprite(fr.ray, true, 0.5, 0);
      this.rays.push(r);
      this.rayRot[i] = 0.02 + (i / (RAYS - 1)) * 1.1 + rr(-0.05, 0.05);
      this.rayGain[i] = rr(0.55, 1);
      this.rayPhase[i] = rr(0, TAU);
      root.addChild(r);
    }
    const fogB = this.own(new Strip(mist));
    fogB.move[0] = 0.37;
    this.fogs.push(fogB);
    root.addChild(fogB.mesh);

    const near = yield* this.strip(
      treeSteps(1024, 512, { seed: 37, count: 8, minH: 0.66, maxH: 0.99, base: 0.98, kind: 'pine', shade: [0.42, 0.85], light: 1 }),
    );
    const nearStrip = this.own(new Strip(near));
    nearStrip.setRim(1, 0.8);
    this.trees.push(nearStrip);
    root.addChild(nearStrip.mesh);
    yield;

    this.groundGlow = sprite(fr.glow, true);
    root.addChild(this.groundGlow);
    this.motes = new ParticleField(atlas.texture, fr.glow, 300, 'add');
    this.fall = new ParticleField(atlas.texture, fr.snow, 120, 'normal');
    root.addChild(this.motes.container, this.fall.container);
    const trunk = this.keep(spriteTexture(trunkCanvas(128, 512, 3)));
    this.upload(trunk);
    this.trunkL = sprite(trunk, false, 0.5, 1);
    this.trunkR = sprite(trunk, false, 0.5, 1);
    root.addChild(this.trunkL, this.trunkR);
    this.bokeh = new ParticleField(atlas.texture, fr.bokeh, 14, 'add', false);
    root.addChild(this.bokeh.container);
    for (let i = 0; i < this.bokeh.cap; i++) this.spawnBokeh(true);
    yield;
  }

  layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.sky.layout(w, h);
    this.trees[0].place(0, h * 0.3, w, h * 0.5);
    this.trees[1].place(0, h * 0.24, w, h * 0.66);
    this.trees[2].place(0, h * 0.06, w, h * 0.96);
    this.fogs[0].place(0, h * 0.42, w, h * 0.4);
    this.fogs[1].place(0, h * 0.55, w, h * 0.42);
    const sun = h * 1.9;
    this.sunGlow.position.set(w * SUN_X, h * SUN_Y);
    this.sunGlow.width = sun;
    this.sunGlow.height = sun;
    for (const r of this.rays) {
      r.position.set(w * SUN_X, h * SUN_Y);
      r.height = h * 1.35;
    }
    this.groundGlow.position.set(w * 0.5, h * 1.02);
    this.groundGlow.width = w * 1.3;
    this.groundGlow.height = h * 0.4;
    const th = h * 1.12;
    this.trunkL.height = th;
    this.trunkL.width = th * 0.25;
    this.trunkL.position.set(w * 0.0, h * 1.03);
    this.trunkR.height = th * 0.92;
    this.trunkR.width = -th * 0.92 * 0.25;
    this.trunkR.position.set(w * 1.01, h * 1.03);
  }

  override get particleCount(): number {
    return this.motes.count + this.fall.count + this.bokeh.count;
  }

  private spawnBokeh(anywhere: boolean): void {
    const f = this.bokeh;
    const i = f.spawn(this.ctx.atlas.frames.bokeh, 0xffe2b0);
    if (i < 0) return;
    f.x[i] = rr(0, this.w || 1200);
    f.y[i] = anywhere ? rr(0, this.h || 800) : (this.h || 800) * 1.1;
    f.vx[i] = rr(-3, 3);
    f.vy[i] = rr(-6, -2);
    f.size[i] = rr(70, 190);
    f.life[i] = rr(24, 44);
    f.age[i] = anywhere ? rr(0, f.life[i]) : 0;
    f.p0[i] = rr(0, TAU);
    f.p1[i] = rr(0.035, 0.09);
  }

  update(dt: number, s: Stimuli, live: boolean): void {
    const { w, h } = this;
    const g = s.grade;
    const t = s.time;
    const c = this.c;
    const swayK = s.sway * (0.3 + 0.7 * s.wind);
    const bassK = s.bass * s.sway;

    // Sky: dawn gradient, sun above the far treeline.
    const sky = this.sky;
    gradeInto(sky.top, 0, 0.17, 0.29, 0.43, g, 0.8);
    gradeInto(sky.mid, 0, 0.76, 0.57, 0.55, g, 1);
    gradeInto(sky.low, 0, 0.98, 0.78, 0.5, g, 1);
    sky.stops[0] = 0.32;
    sky.stops[1] = 0.6;
    sky.sun[0] = SUN_X;
    sky.sun[1] = SUN_Y;
    sky.sun[2] = 0.032 + 0.004 * s.chordPulse;
    sky.sun[3] = (0.85 + 0.25 * s.phrase + 0.1 * s.chordPulse) * clamp01(s.light + 0.1) * (1 - 0.45 * s.dusk);
    gradeInto(sky.sunColor, 0, 1, 0.86, 0.62, g, 0.7);
    sky.cloud[0] = 0;

    const glow = this.sunGlow;
    gradeInto(c, 0, 1, 0.8, 0.55, g, 0.9);
    glow.tint = pack(c[0], c[1], c[2]);
    glow.alpha = (0.3 + 0.12 * s.phrase + 0.06 * s.chordPulse) * (1 - 0.5 * s.dusk);

    // Trees: colour follows the season, depth adds haze.
    gradeInto(c, 0, sky.low[0], sky.low[1], sky.low[2], g, 0);
    const hz0 = c[0];
    const hz1 = c[1];
    const hz2 = c[2];
    const dark = [0.66, 0.44, 0.22];
    const roleK = [0.75, 0.5, 0.3];
    const hazeBottom = [0.8, 0.55, 0.32];
    const sway = [0.0012, 0.0024, 0.0052];
    const F = s.foliage;
    for (let i = 0; i < 3; i++) {
      const st = this.trees[i];
      gradeInto(st.color, 0, F[0] * dark[i], F[1] * dark[i], F[2] * dark[i], g, roleK[i]);
      if (i === 0) {
        st.color[0] = lerp(st.color[0], hz0, 0.5);
        st.color[1] = lerp(st.color[1], hz1, 0.5);
        st.color[2] = lerp(st.color[2], hz2, 0.5);
      }
      gradeInto(st.light, 0, 1, 0.84, 0.58, g, 0.8);
      st.haze[0] = hz0;
      st.haze[1] = hz1;
      st.haze[2] = hz2;
      st.hazeAmt[0] = 0;
      st.hazeAmt[1] = hazeBottom[i] * (0.65 + 0.55 * s.mist);
      st.move[0] = t * 0.0006 * (i + 1) * s.sway;
      st.move[2] = t;
      st.move[3] = sway[i] * swayK;
      st.wave[0] = 6 + 2.5 * i;
      st.wave[1] = 0.7 + 0.18 * i;
      st.wave[2] = sway[i] * 2.4 * bassK;
      st.wave[3] = t * 3.4;
    }

    // Mist bands between the layers.
    for (let i = 0; i < 2; i++) {
      const f = this.fogs[i];
      gradeInto(f.color, 0, sky.low[0] * 1.02, sky.low[1] * 1.0, sky.low[2] * 0.98, g, 0.2);
      gradeInto(f.light, 0, 1, 0.92, 0.75, g, 0.6);
      f.haze[0] = f.color[0];
      f.haze[1] = f.color[1];
      f.haze[2] = f.color[2];
      f.hazeAmt[0] = 0;
      f.hazeAmt[1] = 0;
      f.move[0] = 0.37 * i + t * 0.0035 * (1 + i) * s.sway;
      f.move[2] = t;
      f.mesh.alpha = clamp01((0.16 + 0.42 * s.mist) * (1 - 0.15 * i)) * 0.9;
    }

    // Light shafts breathe slowly and swell at each phrase end.
    gradeInto(c, 3, 1, 0.86, 0.6, g, 0.9);
    const rayTint = pack(c[3], c[4], c[5]);
    const rayBase = 0.15 * (0.55 + 0.6 * s.light) * (1 + 1.5 * s.phrase + 0.25 * s.chordPulse) * (1 - 0.6 * s.dusk);
    for (let i = 0; i < RAYS; i++) {
      const r = this.rays[i];
      const breathe = 0.55 + 0.45 * Math.sin(t * 0.32 + this.rayPhase[i]);
      r.tint = rayTint;
      r.alpha = rayBase * this.rayGain[i] * breathe;
      r.rotation = this.rayRot[i] + Math.sin(t * 0.11 + this.rayPhase[i]) * 0.018 * s.sway;
      r.width = h * (0.06 + 0.1 * this.rayGain[i]) * (1 + 0.25 * s.phrase);
    }

    gradeInto(c, 6, 1, 0.7, 0.4, g, 0.8);
    this.groundGlow.tint = pack(c[6], c[7], c[8]);
    this.groundGlow.alpha = 0.05 + 0.2 * bassK + 0.04 * s.activity;

    gradeInto(c, 9, 0.07, 0.1, 0.09, g, 0.25);
    const trunkTint = pack(c[9] * 1.4, c[10] * 1.4, c[11] * 1.4);
    this.trunkL.tint = trunkTint;
    this.trunkR.tint = trunkTint;
    this.trunkL.rotation = Math.sin(t * 0.5) * 0.004 * swayK;
    this.trunkR.rotation = Math.sin(t * 0.43 + 1) * 0.004 * swayK;

    this.updateParticles(dt, s, live, w, h);
  }

  private updateParticles(dt: number, s: Stimuli, live: boolean, w: number, h: number): void {
    const t = s.time;
    const mdt = s.dt;
    const g = s.grade;
    const fr = this.ctx.atlas.frames;
    const motes = this.motes;
    const fall = this.fall;
    motes.setLimit(motes.cap * s.capScale);
    fall.setLimit(fall.cap * s.capScale);
    this.bokeh.setLimit(this.bokeh.cap * s.capScale * 1.2);

    if (live) {
      // Ambient pollen; winter turns it into snow, autumn adds falling leaves.
      const snow = s.snow;
      const calmMotes = (16 + 44 * (0.35 + 0.65 * s.energy)) * s.capScale * (1 - 0.85 * snow);
      this.acc.mote += (calmMotes / 8) * dt;
      while (this.acc.mote >= 1) {
        this.acc.mote -= 1;
        this.spawnPollen(s, w, h);
      }
      this.acc.snow += snow * (18 + 46 * s.energy) * s.capScale * dt / 8;
      while (this.acc.snow >= 1) {
        this.acc.snow -= 1;
        const i = fall.spawn(fr.snow, 0xf2f6ff);
        if (i < 0) break;
        fall.x[i] = rr(-0.05 * w, 1.05 * w);
        fall.y[i] = -12;
        fall.vx[i] = rr(-6, 6);
        fall.vy[i] = rr(26, 52);
        fall.size[i] = rr(4, 10);
        fall.life[i] = h / fall.vy[i] + 1;
        fall.p0[i] = rr(0, TAU);
        fall.p1[i] = rr(0.4, 1.1);
        fall.p2[i] = rr(0.5, 0.95);
        fall.kind[i] = 0;
      }
      this.acc.leaf += s.autumn * (2 + 7 * s.wind) * s.capScale * dt;
      while (this.acc.leaf >= 1) {
        this.acc.leaf -= 1;
        const i = fall.spawn(Math.random() < 0.6 ? fr.leafMaple : fr.leafLong, 0xd9722a);
        if (i < 0) break;
        fall.x[i] = rr(0, 1.1 * w);
        fall.y[i] = rr(-0.1 * h, 0.3 * h);
        fall.vx[i] = rr(-10, 12);
        fall.vy[i] = rr(24, 48);
        fall.size[i] = rr(12, 22);
        fall.life[i] = h / fall.vy[i] + 1;
        fall.p0[i] = rr(0, TAU);
        fall.p1[i] = rr(0.8, 1.8);
        fall.p2[i] = 0.95;
        fall.rot[i] = rr(0, TAU);
        fall.vrot[i] = rr(-1.2, 1.2);
        fall.kind[i] = 1;
        const hue = Math.random();
        fall.parts[i].tint = pack(lerp(0.85, 0.72, hue), lerp(0.42, 0.26, hue), lerp(0.14, 0.1, hue));
      }
    }

    const push = (5 + 50 * s.wind) * (0.5 + 0.5 * s.motion);
    for (let i = 0; i < motes.cap; i++) {
      if (!motes.alive[i]) continue;
      motes.age[i] += mdt;
      const a = motes.age[i] / motes.life[i];
      if (a >= 1) {
        motes.kill(i);
        continue;
      }
      const ph = motes.p0[i];
      const k = motes.kind[i];
      motes.x[i] += (motes.vx[i] + push * (k === 0 ? 1 : 0.35) + Math.sin(t * 0.8 + ph) * 7) * mdt;
      motes.y[i] += (motes.vy[i] + Math.cos(t * 0.6 + ph * 1.7) * 4) * mdt;
      if (k === 0) {
        motes.alpha[i] = motes.p1[i] * envelope(a, 0.15, 0.4) * (0.7 + 0.3 * Math.sin(t * motes.p2[i] + ph));
      } else {
        const pop = smooth(motes.age[i] / 0.22);
        motes.size[i] = motes.p2[i] * (0.65 + 0.35 * pop) * (k === 2 ? 1 + 0.5 * a : 1);
        motes.alpha[i] = motes.p1[i] * pop * (1 - smooth((a - 0.35) / 0.65)) * (k === 2 ? 0.4 : 1);
      }
      motes.apply(i);
    }

    for (let i = 0; i < fall.cap; i++) {
      if (!fall.alive[i]) continue;
      fall.age[i] += mdt;
      const a = fall.age[i] / fall.life[i];
      if (a >= 1 || fall.y[i] > h + 20) {
        fall.kill(i);
        continue;
      }
      const ph = fall.p0[i];
      fall.x[i] += (fall.vx[i] + push * 0.7 + Math.sin(t * fall.p1[i] + ph) * 12) * mdt;
      fall.y[i] += fall.vy[i] * mdt;
      if (fall.kind[i] === 1) {
        fall.rot[i] += fall.vrot[i] * mdt;
        fall.flip[i] = Math.cos(t * 1.7 + ph);
      }
      fall.alpha[i] = fall.p2[i] * envelope(a, 0.06, 0.15);
      fall.apply(i);
    }

    const bk = this.bokeh;
    for (let i = 0; i < bk.cap; i++) {
      if (!bk.alive[i]) continue;
      bk.age[i] += mdt;
      const a = bk.age[i] / bk.life[i];
      if (a >= 1) {
        bk.kill(i);
        if (live) this.spawnBokeh(false);
        continue;
      }
      bk.x[i] += bk.vx[i] * mdt;
      bk.y[i] += bk.vy[i] * mdt;
      bk.alpha[i] = bk.p1[i] * envelope(a, 0.2, 0.3) * (0.6 + 0.6 * g.gain[0]) * (0.75 + 0.25 * s.activity);
      bk.apply(i);
    }
  }

  private spawnPollen(s: Stimuli, w: number, h: number): void {
    const f = this.motes;
    const glint = Math.random() < s.sparkle * 0.25;
    const i = f.spawn(this.ctx.atlas.frames.glow, glint ? 0xfff2c8 : 0xffd992);
    if (i < 0) return;
    f.x[i] = rr(-0.02 * w, 1.02 * w);
    f.y[i] = rr(0.22 * h, 0.9 * h);
    f.vx[i] = rr(-3, 3);
    f.vy[i] = rr(-11, -3);
    f.size[i] = glint ? rr(9, 15) : rr(4, 10);
    f.life[i] = rr(6, 11);
    f.p0[i] = rr(0, TAU);
    f.p1[i] = glint ? rr(0.7, 1) : rr(0.35, 0.8);
    f.p2[i] = rr(0.6, 1.6);
    f.kind[i] = 0;
  }

  override note(n: NoteStimulus, s: Stimuli): void {
    const { w, h } = this;
    const f = this.motes;
    const g = s.grade;
    const y = h * (0.8 - 0.68 * n.pitch01);
    const x = n.x01 * w;
    const v = n.voice;
    const base = VOICE_COLORS[v];
    const c = this.c;
    gradeInto(c, 0, base[0], base[1], base[2], g, 0.35);
    const tint = pack(c[0] * 1.05, c[1] * 1.05, c[2] * 1.05);
    const orn = n.ornament ? 0.55 : 1;
    const size = (14 + 16 * n.strength) * orn * (v === 1 ? 1.2 : v === 2 ? 0.85 : 1);
    const life = (2.4 + Math.min(n.duration, 2.5) * 1.1) * (n.ornament ? 0.6 : 1);
    const core = f.spawn(this.ctx.atlas.frames.glow, tint);
    if (core >= 0) {
      f.x[core] = x + rr(-5, 5);
      f.y[core] = y;
      f.vx[core] = rr(-4, 4) + (v - 1) * 5;
      f.vy[core] = -(7 + 9 * n.strength) * (v === 1 ? 0.6 : 1);
      f.life[core] = life;
      f.p0[core] = rr(0, TAU);
      f.p1[core] = clamp01(0.55 + 0.45 * n.strength) * orn;
      f.p2[core] = size;
      f.size[core] = size * 0.65;
      f.kind[core] = 1;
    }
    const halo = f.spawn(this.ctx.atlas.frames.glowSoft, tint);
    if (halo >= 0) {
      f.x[halo] = x;
      f.y[halo] = y;
      f.vx[halo] = f.vx[core >= 0 ? core : halo];
      f.vy[halo] = f.vy[core >= 0 ? core : halo] * 0.8;
      f.life[halo] = life * 1.2;
      f.p0[halo] = rr(0, TAU);
      f.p1[halo] = 0.5 * orn * (0.6 + 0.4 * n.strength);
      f.p2[halo] = size * 3.2;
      f.size[halo] = size * 2;
      f.kind[halo] = 2;
    }
    if (v === 2 && s.flash > 0 && !n.ornament) {
      const sp = f.spawn(this.ctx.atlas.frames.flare, tint);
      if (sp >= 0) {
        f.x[sp] = x;
        f.y[sp] = y;
        f.life[sp] = 0.9;
        f.p1[sp] = 0.7 * s.flash;
        f.p2[sp] = size * 1.7;
        f.size[sp] = size;
        f.kind[sp] = 1;
      }
    }
  }

  override phraseEnd(s: Stimuli): void {
    // The sunbeam swell itself is driven by `s.phrase`; add a shower of bright motes along the rays.
    const { w, h } = this;
    const n = s.reduced ? 3 : 12;
    for (let k = 0; k < n; k++) {
      const f = this.motes;
      const i = f.spawn(this.ctx.atlas.frames.glow, 0xfff0c4);
      if (i < 0) return;
      const a = this.rayRot[k % RAYS];
      const len = h * rr(0.15, 1.05);
      f.x[i] = w * SUN_X - Math.sin(a) * len + rr(-12, 12);
      f.y[i] = h * SUN_Y + Math.cos(a) * len;
      f.vx[i] = rr(-4, 4);
      f.vy[i] = rr(-9, -3);
      f.life[i] = rr(3.5, 6);
      f.p0[i] = rr(0, TAU);
      f.p1[i] = rr(0.6, 0.95);
      f.p2[i] = rr(0.6, 1.2);
      f.size[i] = rr(7, 13);
      f.kind[i] = 0;
    }
  }
}
