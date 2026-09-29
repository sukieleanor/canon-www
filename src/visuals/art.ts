import { makeRng } from './palettes';
import { drain, due, type Steps } from './slice';
import { makeCanvas } from './textures';

/*
 * Procedural silhouettes and painted layers for the scenes. Everything is a generator that yields
 * when its time slice is spent (see slice.ts); the plain functions at the end of each section are
 * synchronous wrappers for debug pages. Strip canvases use R = body shade and A = coverage; the
 * strip shader derives the rim light from A, so no full-canvas compositing happens here.
 */

const TAU = Math.PI * 2;

const ch = (r: number, gch: number, a = 1): string =>
  `rgba(${Math.round(r * 255)},${Math.round(gch * 255)},0,${a})`;

let noiseCanvas: HTMLCanvasElement | null = null;
function* grainSteps(): Steps<HTMLCanvasElement> {
  if (noiseCanvas) return noiseCanvas;
  const { canvas, g } = makeCanvas(256, 256);
  const rnd = makeRng(7);
  const img = g.createImageData(256, 256);
  const base = new Float32Array(64 * 64);
  for (let i = 0; i < base.length; i++) base[i] = rnd();
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const fx = x / 4;
      const fy = y / 4;
      const x0 = Math.floor(fx) & 63;
      const y0 = Math.floor(fy) & 63;
      const x1 = (x0 + 1) & 63;
      const y1 = (y0 + 1) & 63;
      const tx = fx - Math.floor(fx);
      const ty = fy - Math.floor(fy);
      const a = base[y0 * 64 + x0] * (1 - tx) + base[y0 * 64 + x1] * tx;
      const b = base[y1 * 64 + x0] * (1 - tx) + base[y1 * 64 + x1] * tx;
      const v = (a * (1 - ty) + b * ty) * 0.6 + rnd() * 0.4;
      const i = (y * 256 + x) * 4;
      img.data[i] = Math.round(v * 255);
      img.data[i + 3] = 255;
    }
    if ((y & 31) === 31 && due()) yield;
  }
  g.putImageData(img, 0, 0);
  noiseCanvas = canvas;
  return canvas;
}

/** Adds a faint paper grain to the silhouettes, one column band per step. */
function* painterlySteps(g: CanvasRenderingContext2D, w: number, h: number, amount: number): Steps {
  const noise = yield* grainSteps();
  const pat = g.createPattern(noise, 'repeat');
  if (!pat) return;
  const band = 512;
  for (let x = 0; x < w; x += band) {
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = amount;
    g.fillStyle = pat;
    g.fillRect(x, 0, Math.min(band, w - x), h);
    g.restore();
    if (due()) yield;
  }
}

/** Seamless 1D fractal profile in 0..1. */
function profile(w: number, seed: number, cells: number, octaves: number, ridged: number) {
  const rnd = makeRng(seed);
  const out = new Float32Array(w);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const lat = new Float32Array(n + 1);
    for (let i = 0; i < n; i++) lat[i] = rnd();
    lat[n] = lat[0];
    for (let x = 0; x < w; x++) {
      const t = (x / w) * n;
      const i = Math.floor(t);
      const f = t - i;
      const s = f * f * (3 - 2 * f);
      let v = lat[i] * (1 - s) + lat[i + 1] * s;
      if (ridged > 0) v = v * (1 - ridged) + (1 - Math.abs(v * 2 - 1)) * ridged;
      out[x] += v * amp;
    }
    total += amp;
    amp *= 0.52;
  }
  for (let x = 0; x < w; x++) out[x] /= total;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ridges
// ---------------------------------------------------------------------------------------------

export interface RidgeOpts {
  seed: number;
  /** Lowest ridge line as a fraction of the height (0 = top). */
  base: number;
  amp: number;
  cells: number;
  octaves: number;
  ridged: number;
  /** Body shade at the crest and at the foot. */
  shade: [number, number];
  /** Slope shading strength 0..1. */
  facets: number;
  /** -1 lit from the left .. +1 lit from the right. */
  light: number;
}

export function* ridgeSteps(w: number, h: number, o: RidgeOpts): Steps<HTMLCanvasElement> {
  const { canvas, g } = makeCanvas(w, h);
  const prof = profile(w, o.seed, o.cells, o.octaves, o.ridged);
  const top = new Float32Array(w);
  let minTop = h;
  for (let x = 0; x < w; x++) {
    top[x] = (o.base - o.amp * prof[x]) * h;
    if (top[x] < minTop) minTop = top[x];
  }
  g.beginPath();
  g.moveTo(0, h);
  for (let x = 0; x < w; x += 2) g.lineTo(x, top[x]);
  g.lineTo(w, top[0]);
  g.lineTo(w, h);
  g.closePath();
  const bg = g.createLinearGradient(0, minTop, 0, h);
  bg.addColorStop(0, ch(o.shade[0], 0));
  bg.addColorStop(1, ch(o.shade[1], 0));
  g.fillStyle = bg;
  g.fill();
  yield;

  if (o.facets > 0) {
    // Slope shading: every column gets a gradient that starts at a slope-dependent shade at the
    // crest and dissolves into the body, so faces read as lit or in shadow without visible bands.
    const span = Math.max(6, Math.round(w / 70));
    const depth = Math.max(24, (h - minTop) * 0.5);
    for (let x = 0; x < w; x += 2) {
      const slope = Math.max(
        -1,
        Math.min(1, (top[(x + span) % w] - top[(x - span + w) % w]) / (span * 0.9)),
      );
      const shade = Math.max(0.1, Math.min(1, 0.6 + 0.62 * slope * o.light));
      const gr = g.createLinearGradient(0, top[x], 0, top[x] + depth);
      gr.addColorStop(0, ch(shade, 0, 0.85 * o.facets));
      gr.addColorStop(1, ch(shade, 0, 0));
      g.fillStyle = gr;
      g.fillRect(x, top[x], 2, depth);
      if (due()) yield;
    }
  }
  yield* painterlySteps(g, w, h, 0.1);
  return canvas;
}

export const ridgeCanvas = (w: number, h: number, o: RidgeOpts): HTMLCanvasElement =>
  drain(ridgeSteps(w, h, o));

// ---------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------

export interface TreeOpts {
  seed: number;
  count: number;
  minH: number;
  maxH: number;
  /** Where the trunks end, as a fraction of the height. */
  base: number;
  kind: 'pine' | 'mixed' | 'round';
  shade: [number, number];
  light: number;
}

function drawPine(
  g: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  height: number,
  width: number,
  rnd: () => number,
  o: TreeOpts,
): void {
  const tiers = 7 + Math.floor(rnd() * 4);
  const topY = baseY - height;
  const dark = Math.min(o.shade[0], o.shade[1]);
  const lit = Math.max(o.shade[0], o.shade[1]);
  g.fillStyle = ch(dark * 0.8, 0);
  g.fillRect(x - width * 0.025, baseY - height * 0.32, width * 0.05, height * 0.33);
  for (let k = 0; k < tiers; k++) {
    const yA = topY + height * (k / tiers) * 0.9;
    const yB = topY + height * Math.min(1, (k + 1.9) / tiers) * 0.95;
    const half = (width * (0.1 + 0.9 * ((k + 1) / tiers))) / 2;
    const dy = yB - yA;
    const gr = g.createLinearGradient(x - half, 0, x + half, 0);
    gr.addColorStop(0, ch(o.light > 0 ? dark : lit, 0));
    gr.addColorStop(1, ch(o.light > 0 ? lit : dark, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x, yA);
    for (let s = 1; s <= 4; s++) {
      const t = s / 4;
      g.lineTo(x - half * t * (0.92 + rnd() * 0.1), yA + dy * t * 0.84 + (rnd() - 0.5) * dy * 0.06);
    }
    g.lineTo(x - half * 1.04, yB);
    const zig = 6 + Math.floor(rnd() * 5);
    for (let z = 1; z <= zig; z++) {
      const px = x - half + (2 * half * z) / (zig + 1);
      g.lineTo(px, yB - (z % 2 ? 0 : dy * (0.1 + rnd() * 0.12)));
    }
    g.lineTo(x + half * 1.04, yB);
    for (let s = 4; s >= 1; s--) {
      const t = s / 4;
      g.lineTo(x + half * t * (0.92 + rnd() * 0.1), yA + dy * t * 0.84 + (rnd() - 0.5) * dy * 0.06);
    }
    g.closePath();
    g.fill();
  }
}

function drawRound(
  g: CanvasRenderingContext2D,
  x: number,
  baseY: number,
  height: number,
  width: number,
  rnd: () => number,
  o: TreeOpts,
): void {
  const dark = Math.min(o.shade[0], o.shade[1]);
  const lit = Math.max(o.shade[0], o.shade[1]);
  const trunkH = height * 0.44;
  g.fillStyle = ch(dark * 0.75, 0);
  g.beginPath();
  g.moveTo(x - width * 0.04, baseY);
  g.lineTo(x - width * 0.022, baseY - trunkH);
  g.lineTo(x + width * 0.022, baseY - trunkH);
  g.lineTo(x + width * 0.04, baseY);
  g.fill();
  const cy = baseY - height * 0.66;
  const R = Math.min(width * 0.5, height * 0.34);
  const lx = o.light > 0 ? 0.4 : -0.4;
  g.fillStyle = ch((dark + lit) * 0.5, 0);
  g.beginPath();
  g.ellipse(x, cy, R * 0.95, R * 0.72, 0, 0, TAU);
  g.fill();
  for (let i = 0; i < 30; i++) {
    const a = rnd() * TAU;
    const d = Math.sqrt(rnd()) * R * 0.72;
    const cx = x + Math.cos(a) * d * 1.2;
    const cyy = cy + Math.sin(a) * d * 0.85;
    const r = R * (0.15 + rnd() * 0.27);
    const gr = g.createRadialGradient(cx + r * lx, cyy - r * 0.4, r * 0.05, cx, cyy, r);
    gr.addColorStop(0, ch(lit, 0));
    gr.addColorStop(1, ch(dark * 1.05, 0));
    g.fillStyle = gr;
    g.beginPath();
    g.arc(cx, cyy, r, 0, TAU);
    g.fill();
  }
}

export function* treeSteps(w: number, h: number, o: TreeOpts): Steps<HTMLCanvasElement> {
  const { canvas, g } = makeCanvas(w, h);
  const rnd = makeRng(o.seed);
  const trees: Array<{ x: number; hgt: number; wid: number; pine: boolean }> = [];
  for (let i = 0; i < o.count; i++) {
    const hgt = h * (o.minH + rnd() * (o.maxH - o.minH));
    const pine = o.kind === 'pine' || (o.kind === 'mixed' && rnd() < 0.62);
    trees.push({
      x: ((i + rnd() * 0.9) / o.count) * w,
      hgt,
      wid: hgt * (pine ? 0.3 + rnd() * 0.1 : 0.62 + rnd() * 0.2),
      pine,
    });
  }
  trees.sort((a, b) => a.hgt - b.hgt);
  const baseY = o.base * h;
  for (const t of trees) {
    for (const dx of [-w, 0, w]) {
      const x = t.x + dx;
      if (x < -t.wid || x > w + t.wid) continue;
      const sub = makeRng(Math.floor(t.x * 7 + t.hgt * 13 + o.seed));
      if (t.pine) drawPine(g, x, baseY, t.hgt, t.wid, sub, o);
      else drawRound(g, x, baseY, t.hgt, t.wid, sub, o);
    }
    if (due()) yield;
  }
  g.fillStyle = ch(o.shade[0] * 0.85, 0);
  g.fillRect(0, baseY - 2, w, h - baseY + 2);
  yield* painterlySteps(g, w, h, 0.1);
  return canvas;
}

export const treeCanvas = (w: number, h: number, o: TreeOpts): HTMLCanvasElement =>
  drain(treeSteps(w, h, o));

// ---------------------------------------------------------------------------------------------
// Clouds, grass, foreground
// ---------------------------------------------------------------------------------------------

export interface CloudOpts {
  seed: number;
  count: number;
  /** Vertical centre of the banks as a fraction of the height. */
  base: number;
  spread: number;
  /** Puff radius as a fraction of the bank length. */
  size: number;
  /** Width of a bank as a fraction of the canvas width. */
  length: number;
  puffs: number;
  /** Vertical squash: <1 flatter. */
  flat: number;
}

export function* cloudSteps(w: number, h: number, o: CloudOpts): Steps<HTMLCanvasElement> {
  const { canvas, g } = makeCanvas(w, h);
  const rnd = makeRng(o.seed);
  const puffs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < o.count; i++) {
    const cx = rnd() * w;
    const cy = h * (o.base + (rnd() - 0.5) * o.spread);
    const len = w * o.length * (0.55 + rnd() * 0.8);
    for (let j = 0; j < o.puffs; j++) {
      const t = rnd();
      const edge = Math.sin(t * Math.PI);
      const rx = len * o.size * (0.5 + rnd()) * (0.45 + edge * 0.65);
      puffs.push([
        cx + (t - 0.5) * len,
        cy + (rnd() - 0.5) * h * 0.05 * o.flat - edge * h * 0.03 * rnd(),
        rx,
        rx * o.flat * (0.5 + rnd() * 0.45),
      ]);
    }
  }
  const draw = (x: number, y: number, rx: number, ry: number, hi: boolean): void => {
    for (const dx of [-w, 0, w]) {
      const px = x + dx;
      if (px < -rx || px > w + rx) continue;
      g.save();
      g.translate(px, y);
      g.scale(1, ry / rx);
      const gr = g.createRadialGradient(0, -rx * 0.25, rx * 0.05, 0, 0, rx);
      if (hi) {
        gr.addColorStop(0, ch(1, 1, 0.28));
        gr.addColorStop(1, ch(1, 0.6, 0));
      } else {
        gr.addColorStop(0, ch(1, 0, 0.5));
        gr.addColorStop(0.5, ch(0.78, 0, 0.3));
        gr.addColorStop(1, ch(0.55, 0, 0));
      }
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, rx, 0, TAU);
      g.fill();
      g.restore();
    }
  };
  for (const [x, y, rx, ry] of puffs) {
    draw(x, y, rx, ry, false);
    if (due()) yield;
  }
  g.globalCompositeOperation = 'source-atop';
  for (const [x, y, rx, ry] of puffs) {
    draw(x + rx * 0.15, y - ry * 0.4, rx * 0.65, ry * 0.5, true);
    if (due()) yield;
  }
  g.globalCompositeOperation = 'source-over';
  return canvas;
}

export const cloudCanvas = (w: number, h: number, o: CloudOpts): HTMLCanvasElement =>
  drain(cloudSteps(w, h, o));

export interface GrassOpts {
  seed: number;
  blades: number;
  minH: number;
  maxH: number;
  lean: number;
  shade: [number, number];
}

export function* grassSteps(w: number, h: number, o: GrassOpts): Steps<HTMLCanvasElement> {
  const { canvas, g } = makeCanvas(w, h);
  const rnd = makeRng(o.seed);
  const blades: Array<[number, number, number, number]> = [];
  for (let i = 0; i < o.blades; i++) {
    blades.push([
      rnd() * w,
      h * (o.minH + rnd() * (o.maxH - o.minH)),
      (rnd() - 0.5) * o.lean,
      1.6 + rnd() * 2.6,
    ]);
  }
  blades.sort((a, b) => a[1] - b[1]);
  for (const [x, hgt, lean, wid] of blades) {
    for (const dx of [-w, 0, w]) {
      const bx = x + dx;
      if (bx < -hgt || bx > w + hgt) continue;
      const tipX = bx + lean * hgt;
      const tipY = h - hgt;
      const gr = g.createLinearGradient(0, h, 0, tipY);
      gr.addColorStop(0, ch(o.shade[0], 0));
      gr.addColorStop(1, ch(o.shade[1], 0.15));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(bx - wid, h + 2);
      g.quadraticCurveTo(bx - wid * 0.4 + lean * hgt * 0.15, h - hgt * 0.55, tipX, tipY);
      g.quadraticCurveTo(bx + wid * 0.6 + lean * hgt * 0.15, h - hgt * 0.5, bx + wid, h + 2);
      g.closePath();
      g.fill();
    }
    if (due()) yield;
  }
  yield* painterlySteps(g, w, h, 0.08);
  return canvas;
}

export const grassCanvas = (w: number, h: number, o: GrassOpts): HTMLCanvasElement =>
  drain(grassSteps(w, h, o));

export interface TreeArt {
  branches: HTMLCanvasElement;
  blossomBack: HTMLCanvasElement;
  blossomFront: HTMLCanvasElement;
}

interface Limb {
  x: number;
  y: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  wid: number;
}

/** A spreading cherry tree: dark limbs plus two soft blossom layers (painted white, tinted in scene). */
export function* cherrySteps(size: number, seed: number): Steps<TreeArt> {
  const rnd = makeRng(seed);
  const b = makeCanvas(size, size);
  const back = makeCanvas(size, size);
  const front = makeCanvas(size, size);
  const tips: Array<[number, number, number]> = [];
  const limbs: Limb[] = [];
  // The random walk is cheap; painting is deferred so it can be sliced without changing the tree.
  const grow = (x: number, y: number, ang: number, len: number, wid: number, depth: number): void => {
    const bend = (rnd() - 0.5) * 0.5;
    const x1 = x + Math.cos(ang) * len;
    const y1 = y + Math.sin(ang) * len;
    const cx = x + Math.cos(ang + bend) * len * 0.55;
    const cy = y + Math.sin(ang + bend) * len * 0.55;
    limbs.push({ x, y, cx, cy, x1, y1, wid });
    if (depth >= 4 && (depth >= 6 || rnd() < 0.5)) tips.push([x1, y1, 0.5 + depth * 0.07]);
    if (depth >= 7) return;
    const kids = depth < 2 ? 3 : rnd() < 0.3 ? 3 : 2;
    for (let k = 0; k < kids; k++) {
      const spread = depth < 2 ? 0.55 + rnd() * 0.55 : 0.32 + rnd() * 0.5;
      const side = kids === 3 ? k - 1 : k === 0 ? -1 : 1;
      grow(
        x1,
        y1,
        ang + side * spread + (rnd() - 0.5) * 0.15,
        len * (0.68 + rnd() * 0.12),
        wid * 0.66,
        depth + 1,
      );
    }
  };
  grow(size * 0.5, size * 0.99, -Math.PI / 2 + (rnd() - 0.5) * 0.1, size * 0.2, size * 0.055, 0);

  b.g.lineCap = 'round';
  for (const l of limbs) {
    b.g.strokeStyle = 'rgb(58,44,52)';
    b.g.lineWidth = l.wid;
    b.g.beginPath();
    b.g.moveTo(l.x, l.y);
    b.g.quadraticCurveTo(l.cx, l.cy, l.x1, l.y1);
    b.g.stroke();
    b.g.strokeStyle = 'rgba(150,120,125,0.16)';
    b.g.lineWidth = Math.max(1, l.wid * 0.2);
    b.g.beginPath();
    b.g.moveTo(l.x + l.wid * 0.18, l.y);
    b.g.quadraticCurveTo(l.cx + l.wid * 0.18, l.cy, l.x1 + l.wid * 0.12, l.y1);
    b.g.stroke();
    if (due()) yield;
  }

  // Blossom is painted in greys and tinted per season: soft mid-tone clusters at the back, crisp
  // light flowers with a darker heart at the front, so branches show through the gaps.
  const k = size / 768;
  const blob = (g: CanvasRenderingContext2D, x: number, y: number, r: number, v: number): void => {
    const gr = g.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},0.85)`);
    gr.addColorStop(0.65, `rgba(${v - 14},${v - 14},${v - 14},0.5)`);
    gr.addColorStop(1, `rgba(${v - 30},${v - 30},${v - 30},0)`);
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
  };
  const flower = (g: CanvasRenderingContext2D, x: number, y: number, r: number, v: number): void => {
    g.fillStyle = `rgba(${v},${v},${v},0.94)`;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    if (r > 2) {
      g.fillStyle = `rgba(${v - 60},${v - 80},${v - 70},0.55)`;
      g.beginPath();
      g.arc(x + r * 0.12, y + r * 0.1, r * 0.32, 0, TAU);
      g.fill();
    }
  };
  for (const [x, y, wgt] of tips) {
    // Blossom sits in an umbrella crown; lower limbs stay bare.
    if (y > size * 0.66) continue;
    const clusters = 2 + Math.floor(rnd() * 3);
    for (let i = 0; i < clusters; i++) {
      const a = rnd() * TAU;
      const d = rnd() * size * 0.04 * wgt;
      const r = size * (0.008 + rnd() * 0.013) * (0.7 + wgt * 0.5);
      blob(back.g, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.8, r, 176 + Math.floor(rnd() * 46));
    }
    const flowers = 9 + Math.floor(rnd() * 8);
    for (let i = 0; i < flowers; i++) {
      const a = rnd() * TAU;
      const d = Math.sqrt(rnd()) * size * 0.05 * wgt;
      const up = 1 - (y + Math.sin(a) * d) / size;
      flower(
        front.g,
        x + Math.cos(a) * d,
        y + Math.sin(a) * d * 0.85,
        (1.4 + rnd() * 3) * k,
        Math.min(255, 232 + Math.floor(up * 16 + rnd() * 12)),
      );
    }
    if (due()) yield;
  }
  return { branches: b.canvas, blossomBack: back.canvas, blossomFront: front.canvas };
}

export const cherryTreeArt = (size: number, seed: number): TreeArt => drain(cherrySteps(size, seed));

/** A big dark foreground trunk with bark streaks; painted in greys and tinted per scene. */
export function trunkCanvas(w: number, h: number, seed: number): HTMLCanvasElement {
  const { canvas, g } = makeCanvas(w, h);
  const rnd = makeRng(seed);
  const gr = g.createLinearGradient(0, 0, w, 0);
  gr.addColorStop(0, 'rgb(70,64,62)');
  gr.addColorStop(0.55, 'rgb(150,138,128)');
  gr.addColorStop(1, 'rgb(95,88,84)');
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(w * 0.1, h);
  g.bezierCurveTo(w * 0.02, h * 0.95, w * 0.22, h * 0.9, w * 0.26, h * 0.78);
  g.lineTo(w * 0.28, 0);
  g.lineTo(w * 0.76, 0);
  g.lineTo(w * 0.78, h * 0.8);
  g.bezierCurveTo(w * 0.82, h * 0.9, w * 1.0, h * 0.94, w * 0.94, h);
  g.closePath();
  g.fill();
  g.lineCap = 'round';
  for (let i = 0; i < 46; i++) {
    const x = w * (0.27 + rnd() * 0.5);
    const y0 = rnd() * h;
    g.strokeStyle = `rgba(20,16,16,${0.12 + rnd() * 0.25})`;
    g.lineWidth = 1 + rnd() * 3;
    g.beginPath();
    g.moveTo(x, y0);
    g.lineTo(x + (rnd() - 0.5) * 8, y0 + 30 + rnd() * 120);
    g.stroke();
  }
  for (let i = 0; i < 9; i++) {
    g.fillStyle = `rgba(255,240,220,${0.05 + rnd() * 0.08})`;
    g.beginPath();
    g.ellipse(w * (0.5 + (rnd() - 0.2) * 0.3), rnd() * h, 4 + rnd() * 10, 30 + rnd() * 60, 0, 0, TAU);
    g.fill();
  }
  return canvas;
}
