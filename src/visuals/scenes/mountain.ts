import type { Sprite } from 'pixi.js';
import { cloudSteps, ridgeSteps, treeSteps } from '../art';
import type { NoteStimulus, Stimuli } from '../mapping';
import { VOICE_COLORS, clamp01, gradeInto, hex, lerp, mixInto, pack, type RGB } from '../palettes';
import { ParticleField } from '../pool';
import type { Steps } from '../slice';
import { Falling } from './falling';
import { TAU, envelope, rr, smooth, sprite } from './kit';
import { Scene, SkyQuad, Strip } from './scene';

const SUN_X = 0.64;
const RAYS = 6;
const RAY_ANGLES = [Math.PI - 0.95, Math.PI - 0.5, Math.PI - 0.12, Math.PI + 0.22, Math.PI + 0.62, Math.PI + 1.05];
const STARS = 90;
const BIRDS = 9;

const SKY_DAY = { top: hex(0x3d4b8c), mid: hex(0xdc8a88), low: hex(0xffc47c) };
const SKY_DUSK = { top: hex(0x0f1240), mid: hex(0x4a2c72), low: hex(0xc95d7c) };
const RIDGE_BODY: readonly RGB[] = [hex(0xa58aae), hex(0x765f92), hex(0x51477c), hex(0x2f2c58)];
const RIDGE_HAZE_TOP = [0.32, 0.26, 0.2, 0.1];
const RIDGE_HAZE_FOOT = [0.78, 0.7, 0.6, 0.5];
const RIM_DAY = hex(0xffc27a);
const RIM_DUSK = hex(0xf07a7a);

/** Mountain sunset: alpenglow ridges in layered haze, drifting clouds, lights that rise to each note's pitch. */
export class MountainScene extends Scene {
  private sky!: SkyQuad;
  private sunGlow!: Sprite;
  private valleyGlow!: Sprite;
  private readonly rays: Sprite[] = [];
  private readonly clouds: Strip[] = [];
  private readonly ridges: Strip[] = [];
  private readonly mists: Strip[] = [];
  private pines!: Strip;
  private stars!: ParticleField;
  private lights!: ParticleField;
  private birds!: ParticleField;
  private falling!: Falling;
  private readonly c = new Float32Array(12);
  private birdsIn = 30;

  *build(): Steps {
    const { atlas } = this.ctx;
    const fr = atlas.frames;
    const root = this.root;

    this.sky = this.own(new SkyQuad(atlas.noise));
    root.addChild(this.sky.mesh);
    this.compile(this.sky);
    this.stars = new ParticleField(atlas.texture, fr.dot, STARS, 'add', true);
    root.addChild(this.stars.container);
    for (let i = 0; i < STARS; i++) {
      const k = this.stars.spawn(fr.dot, 0xdfe6ff);
      if (k < 0) break;
      this.stars.x[k] = rr(0, 1);
      this.stars.y[k] = Math.sqrt(rr(0, 1)) * 0.55;
      this.stars.p0[k] = rr(0, TAU);
      this.stars.p1[k] = rr(0.3, 0.9);
      this.stars.p2[k] = rr(0.7, 2);
      this.stars.vx[k] = rr(1.6, 3.8);
    }
    this.sunGlow = sprite(fr.glow, true);
    root.addChild(this.sunGlow);
    for (let i = 0; i < RAYS; i++) {
      const r = sprite(fr.ray, true, 0.5, 0);
      r.rotation = RAY_ANGLES[i];
      this.rays.push(r);
      root.addChild(r);
    }
    yield;

    const cloudA = yield* this.strip(
      cloudSteps(2048, 256, { seed: 14, count: 6, base: 0.5, spread: 0.55, size: 0.08, length: 0.55, puffs: 30, flat: 0.3 }),
    );
    const stA = this.own(new Strip(cloudA));
    this.clouds.push(stA);
    root.addChild(stA.mesh);
    this.compile(stA);
    yield;
    const cloudB = yield* this.strip(
      cloudSteps(2048, 256, { seed: 27, count: 5, base: 0.5, spread: 0.45, size: 0.09, length: 0.65, puffs: 30, flat: 0.28 }),
    );
    const stB = this.own(new Strip(cloudB));
    this.clouds.push(stB);
    root.addChild(stB.mesh);
    yield;

    const specs = [
      { seed: 101, h: 512, base: 0.95, amp: 0.92, cells: 3, octaves: 6, ridged: 0.92, rim: 0.95, facets: 0.85 },
      { seed: 113, h: 384, base: 0.95, amp: 0.6, cells: 4, octaves: 6, ridged: 0.7, rim: 0.85, facets: 0.6 },
      { seed: 127, h: 320, base: 0.96, amp: 0.42, cells: 5, octaves: 5, ridged: 0.4, rim: 0.7, facets: 0.4 },
      { seed: 139, h: 256, base: 0.97, amp: 0.3, cells: 6, octaves: 5, ridged: 0.2, rim: 0.6, facets: 0.3 },
    ];
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i];
      const tex = yield* this.strip(
        ridgeSteps(2048, sp.h, { seed: sp.seed, base: sp.base, amp: sp.amp, cells: sp.cells, octaves: sp.octaves, ridged: sp.ridged, shade: [1, 0.55], facets: sp.facets, light: 1 }),
      );
      const st = this.own(new Strip(tex));
      st.setRim(1, sp.rim);
      this.ridges.push(st);
      root.addChild(st.mesh);
      if (i === 0 || i === 2) {
        const m = this.own(new Strip(cloudA));
        m.move[0] = 0.21 + 0.3 * i;
        this.mists.push(m);
        root.addChild(m.mesh);
      }
      yield;
    }

    const pn = yield* this.strip(
      treeSteps(2048, 256, { seed: 151, count: 70, minH: 0.35, maxH: 0.95, base: 0.985, kind: 'pine', shade: [0.55, 0.9], light: 1 }),
    );
    this.pines = this.own(new Strip(pn));
    this.pines.setRim(1, 0.7);
    root.addChild(this.pines.mesh);
    yield;

    this.valleyGlow = sprite(fr.glow, true);
    root.addChild(this.valleyGlow);
    this.lights = new ParticleField(atlas.texture, fr.glow, 200, 'add');
    this.birds = new ParticleField(atlas.texture, fr.birdUp, BIRDS, 'normal');
    this.falling = new Falling(atlas, 100);
    root.addChild(this.lights.container, this.birds.container, this.falling.field.container);
    yield;
  }

  layout(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.sky.layout(w, h);
    const sunY = 0.6;
    this.sunGlow.position.set(w * SUN_X, h * sunY);
    this.sunGlow.width = h * 2.1;
    this.sunGlow.height = h * 2.1;
    for (const r of this.rays) {
      r.position.set(w * SUN_X, h * sunY);
      r.height = h * 1.5;
    }
    this.clouds[0].place(0, h * 0.02, w, h * 0.34);
    this.clouds[1].place(0, h * 0.24, w, h * 0.34);
    this.ridges[0].place(0, h * 0.2, w, h * 0.6);
    this.ridges[1].place(0, h * 0.36, w, h * 0.52);
    this.ridges[2].place(0, h * 0.52, w, h * 0.42);
    this.ridges[3].place(0, h * 0.68, w, h * 0.34);
    this.pines.place(0, h * 0.74, w, h * 0.3);
    this.mists[0].place(0, h * 0.5, w, h * 0.22);
    this.mists[1].place(0, h * 0.68, w, h * 0.22);
    this.valleyGlow.position.set(w * 0.5, h * 1.0);
    this.valleyGlow.width = w * 1.4;
    this.valleyGlow.height = h * 0.5;
  }

  override get particleCount(): number {
    return this.lights.count + this.birds.count + this.falling.count + STARS;
  }

  update(dt: number, s: Stimuli, live: boolean): void {
    const { w, h } = this;
    const g = s.grade;
    const t = s.time;
    const c = this.c;
    const du = s.dusk;
    const sunY = lerp(0.6, 0.7, du);

    // Sky: golden-hour gradient that deepens into twilight during "rest".
    const sky = this.sky;
    mixInto(c, 0, SKY_DAY.top, SKY_DUSK.top, du);
    gradeInto(sky.top, 0, c[0], c[1], c[2], g, 1);
    mixInto(c, 0, SKY_DAY.mid, SKY_DUSK.mid, du);
    gradeInto(sky.mid, 0, c[0], c[1], c[2], g, 1.4);
    mixInto(c, 0, SKY_DAY.low, SKY_DUSK.low, du);
    gradeInto(sky.low, 0, c[0], c[1], c[2], g, 1.3);
    sky.stops[0] = 0.42;
    sky.stops[1] = 0.78;
    sky.sun[0] = SUN_X;
    sky.sun[1] = sunY;
    sky.sun[2] = 0.055 + 0.006 * s.chordPulse;
    sky.sun[3] = (0.8 + 0.25 * s.phrase + 0.15 * s.bass) * clamp01(s.light + 0.15) * (1 - 0.35 * du);
    gradeInto(sky.sunColor, 0, 1, lerp(0.84, 0.6, du), lerp(0.58, 0.42, du), g, 0.8);
    sky.cloud[0] = 0.35 + 0.25 * s.mist;
    sky.cloud[1] = t * 1.6;
    sky.cloud[2] = 2.6;
    gradeInto(sky.cloudLit, 0, 1, lerp(0.8, 0.55, du), lerp(0.6, 0.5, du), g, 1);
    gradeInto(sky.cloudShade, 0, 0.62, 0.42, 0.6, g, 1);

    gradeInto(c, 0, 1, 0.7, 0.42, g, 1.1);
    this.sunGlow.tint = pack(c[0], c[1], c[2]);
    this.sunGlow.alpha = (0.38 + 0.12 * s.phrase + 0.1 * s.bass) * (1 - 0.35 * du);
    this.sunGlow.position.set(w * SUN_X, h * sunY);

    const rayA = 0.09 * (0.6 + 0.5 * s.light) * (1 + 0.9 * s.phrase) * (1 - 0.7 * du) * (1 - 0.5 * s.mist);
    for (let i = 0; i < RAYS; i++) {
      const r = this.rays[i];
      r.position.set(w * SUN_X, h * sunY);
      r.tint = pack(c[0], c[1], c[2]);
      r.alpha = rayA * (0.55 + 0.45 * Math.sin(t * 0.25 + i * 1.9));
      r.rotation = RAY_ANGLES[i] + Math.sin(t * 0.1 + i) * 0.02 * s.sway;
      r.width = h * (0.1 + 0.05 * (i % 3));
    }

    // Dusk stars.
    const stars = this.stars;
    const starA = clamp01(du * 1.1 - 0.1) * 0.8;
    for (let i = 0; i < STARS; i++) {
      const p = stars.parts[i];
      p.x = stars.x[i] * w;
      p.y = stars.y[i] * h;
      p.scaleX = p.scaleY = stars.vx[i] / 32;
      p.alpha = starA * stars.p1[i] * (0.7 + 0.3 * s.sway * Math.sin(t * stars.p2[i] + stars.p0[i]));
    }

    // Clouds drift at two speeds; their tops catch the low sun.
    for (let i = 0; i < 2; i++) {
      const st = this.clouds[i];
      gradeInto(st.color, 0, lerp(0.7, 0.45, du), lerp(0.5, 0.36, du), lerp(0.66, 0.58, du), g, 1);
      gradeInto(st.light, 0, 1, lerp(0.78, 0.55, du), lerp(0.5, 0.45, du), g, 1);
      st.haze[0] = sky.mid[0];
      st.haze[1] = sky.mid[1];
      st.haze[2] = sky.mid[2];
      st.hazeAmt[0] = 0.15;
      st.hazeAmt[1] = 0.45;
      st.move[0] = t * (0.0022 + 0.0035 * i) * (0.5 + s.wind);
      st.move[2] = t;
      st.mesh.alpha = clamp01(0.55 + 0.3 * s.mist + 0.1 * i);
    }

    // Ridges: hazier and pinker with distance; the far snow caps take the sun's colour.
    mixInto(c, 3, RIM_DAY, RIM_DUSK, du);
    const F = s.foliage;
    const snow = s.snow;
    const bassRim = 1 + 0.5 * s.bass * s.sway;
    for (let i = 0; i < 4; i++) {
      const st = this.ridges[i];
      const b = RIDGE_BODY[i];
      let r = b[0];
      let gc = b[1];
      let bl = b[2];
      if (i === 0) {
        r = lerp(r, 0.9, 0.4 * snow);
        gc = lerp(gc, 0.88, 0.4 * snow);
        bl = lerp(bl, 0.98, 0.4 * snow);
      } else if (i === 3) {
        r = lerp(r, F[0] * 0.3, 0.5);
        gc = lerp(gc, F[1] * 0.3, 0.5);
        bl = lerp(bl, F[2] * 0.3, 0.5);
      }
      gradeInto(st.color, 0, r, gc, bl, g, 0.9 - 0.15 * i);
      st.light[0] = c[3] * bassRim;
      st.light[1] = c[4] * bassRim;
      st.light[2] = c[5] * bassRim;
      gradeInto(st.haze, 0, lerp(0.95, 0.5, du) , lerp(0.6, 0.32, du), lerp(0.5, 0.5, du), g, 1.2);
      st.hazeAmt[0] = RIDGE_HAZE_TOP[i] * (0.7 + 0.6 * s.mist);
      st.hazeAmt[1] = RIDGE_HAZE_FOOT[i] * (0.8 + 0.4 * s.mist);
      st.move[0] = 0;
      st.move[2] = t;
      st.move[3] = 0;
      st.wave[2] = 0;
    }
    const pn = this.pines;
    gradeInto(pn.color, 0, 0.09, 0.09, 0.18, g, 0.4);
    pn.light[0] = c[3] * 0.6;
    pn.light[1] = c[4] * 0.6;
    pn.light[2] = c[5] * 0.6;
    pn.haze[0] = this.ridges[3].haze[0];
    pn.haze[1] = this.ridges[3].haze[1];
    pn.haze[2] = this.ridges[3].haze[2];
    pn.hazeAmt[0] = 0.05;
    pn.hazeAmt[1] = 0.4;
    pn.move[2] = t;
    pn.move[3] = 0.0016 * s.sway * (0.3 + 0.7 * s.wind);
    pn.wave[0] = 7;
    pn.wave[1] = 0.8;
    pn.wave[2] = 0.0012 * s.bass * s.sway;
    pn.wave[3] = t * 3;

    // Valley mist between ridges.
    for (let i = 0; i < 2; i++) {
      const m = this.mists[i];
      gradeInto(m.color, 0, 1, lerp(0.72, 0.5, du), lerp(0.68, 0.6, du), g, 1.1);
      gradeInto(m.light, 0, 1, lerp(0.85, 0.6, du), lerp(0.7, 0.55, du), g, 1);
      m.haze[0] = m.color[0];
      m.haze[1] = m.color[1];
      m.haze[2] = m.color[2];
      m.hazeAmt[0] = 0;
      m.hazeAmt[1] = 0;
      m.move[0] = (0.21 + 0.3 * i) + t * 0.0025 * (i + 1) * s.sway;
      m.move[2] = t;
      m.mesh.alpha = clamp01(0.3 + 0.5 * s.mist) * 0.75;
    }

    gradeInto(c, 6, 1, 0.55, 0.3, g, 1);
    this.valleyGlow.tint = pack(c[6], c[7], c[8]);
    this.valleyGlow.alpha = 0.06 + 0.22 * s.bass * s.sway + 0.05 * s.activity;

    this.updateParticles(dt, s, live, w, h);
  }

  private updateParticles(dt: number, s: Stimuli, live: boolean, w: number, h: number): void {
    const t = s.time;
    const mdt = s.dt;
    this.falling.update(dt, s, live, w, h, 0.6, 0.4);

    const L = this.lights;
    L.setLimit(L.cap * s.capScale);
    for (let i = 0; i < L.cap; i++) {
      if (!L.alive[i]) continue;
      L.age[i] += mdt;
      const a = L.age[i] / L.life[i];
      if (a >= 1) {
        L.kill(i);
        continue;
      }
      const rise = smooth(L.age[i] / 1.0);
      const sway = Math.sin(t * 0.9 + L.p2[i]) * 6 * s.sway;
      L.x[i] += L.vx[i] * mdt;
      L.y[i] = lerp(L.p0[i], L.p1[i], 1 - (1 - rise) * (1 - rise)) - (a > 0.3 ? (a - 0.3) * 12 : 0);
      const twinkle = 0.85 + 0.15 * Math.sin(t * 5 + L.p2[i]);
      if (L.kind[i] === 0) {
        L.size[i] = L.p3[i] * (0.6 + 0.4 * rise) * twinkle;
        L.alpha[i] = envelope(a, 0.08, 0.5) * 0.95;
      } else {
        L.size[i] = L.p3[i] * (0.7 + 0.5 * rise);
        L.alpha[i] = envelope(a, 0.1, 0.55) * 0.42;
      }
      const px = L.x[i];
      L.x[i] = px + sway * mdt;
      L.apply(i);
    }

    if (live) {
      this.birdsIn -= mdt;
      if (this.birdsIn <= 0) {
        this.birdsIn = rr(40, 70);
        this.flock(w, h, 5);
      }
    }
    const B = this.birds;
    const fr = this.ctx.atlas.frames;
    for (let i = 0; i < B.cap; i++) {
      if (!B.alive[i]) continue;
      B.age[i] += mdt;
      const a = B.age[i] / B.life[i];
      if (a >= 1) {
        B.kill(i);
        continue;
      }
      const phase = B.p0[i];
      B.x[i] += B.vx[i] * mdt;
      B.y[i] = B.p1[i] + Math.sin(t * 0.7 + phase) * 5 + a * B.vy[i] * B.life[i];
      const flap = Math.sin(t * B.p2[i] + phase) > 0.15;
      B.parts[i].texture = flap ? fr.birdUp : fr.birdDown;
      B.alpha[i] = envelope(a, 0.05, 0.08) * 0.85;
      B.apply(i);
    }
  }

  private flock(w: number, h: number, count: number): void {
    const B = this.birds;
    if (B.count > 0) return;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const y0 = h * rr(0.16, 0.36);
    const speed = rr(52, 76) * dir;
    const life = (w * 1.3) / Math.abs(speed);
    const size = h * rr(0.026, 0.036);
    for (let k = 0; k < count && k < BIRDS; k++) {
      const i = B.spawn(this.ctx.atlas.frames.birdUp, 0x2b2140);
      if (i < 0) return;
      const row = Math.ceil(k / 2) * (k % 2 ? 1 : -1);
      B.x[i] = (dir > 0 ? -0.08 * w : 1.08 * w) - dir * Math.abs(row) * size * 1.5;
      B.p1[i] = y0 + Math.abs(row) * size * 0.9;
      B.vx[i] = speed * rr(0.96, 1.04);
      B.vy[i] = -h * 0.02 / life;
      B.life[i] = life;
      B.size[i] = size * (0.85 + 0.3 * Math.random());
      B.p0[i] = rr(0, TAU);
      B.p2[i] = rr(6.5, 8.5);
      B.flip[i] = 1;
    }
  }

  override note(n: NoteStimulus, s: Stimuli): void {
    const { w, h } = this;
    const L = this.lights;
    const base = VOICE_COLORS[n.voice];
    const c = this.c;
    gradeInto(c, 9, base[0], base[1], base[2], s.grade, 0.25);
    const tint = pack(c[9] * 1.05, c[10] * 1.05, c[11] * 1.05);
    const orn = n.ornament ? 0.55 : 1;
    const yT = h * (0.86 - 0.74 * n.pitch01);
    const y0 = Math.min(h * 0.97, yT + h * rr(0.1, 0.2));
    const x = n.x01 * w + rr(-8, 8);
    const size = (10 + 12 * n.strength) * orn * (n.voice === 1 ? 1.2 : n.voice === 2 ? 0.85 : 1);
    const life = (2.2 + Math.min(n.duration, 2.5) * 1.0) * (n.ornament ? 0.6 : 1);
    const core = L.spawn(this.ctx.atlas.frames.glow, tint);
    if (core >= 0) {
      L.x[core] = x;
      L.y[core] = y0;
      L.vx[core] = rr(-3, 3) + (n.voice - 1) * 3;
      L.life[core] = life;
      L.p0[core] = y0;
      L.p1[core] = yT;
      L.p2[core] = rr(0, TAU);
      L.p3[core] = size;
      L.size[core] = size * 0.6;
      L.kind[core] = 0;
    }
    const halo = L.spawn(this.ctx.atlas.frames.glowSoft, tint);
    if (halo >= 0) {
      L.x[halo] = x;
      L.y[halo] = y0;
      L.vx[halo] = core >= 0 ? L.vx[core] : 0;
      L.life[halo] = life * 1.1;
      L.p0[halo] = y0;
      L.p1[halo] = yT;
      L.p2[halo] = L.p2[core >= 0 ? core : halo];
      L.p3[halo] = size * 3.4;
      L.size[halo] = size * 2;
      L.kind[halo] = 1;
    }
  }

  override phraseEnd(s: Stimuli): void {
    if (s.flash > 0 || s.reduced) this.flock(this.w, this.h, s.reduced ? 3 : 7);
  }
}
