import { ImageSource, Rectangle, Texture } from 'pixi.js';
import { makeRng } from './palettes';
import { drain, due, type Steps } from './slice';

/*
 * Procedural art. Everything is painted once with Canvas2D and uploaded as textures:
 *  - a shared atlas of small sprites (one texture source, so every particle field batches);
 *  - "strip" canvases for the parallax silhouettes, whose channels are packed for the strip shader
 *    (R = body shade, G = rim light, A = coverage).
 */

const TAU = Math.PI * 2;

export type FrameName =
  | 'glow'
  | 'glowSoft'
  | 'dot'
  | 'bokeh'
  | 'ring'
  | 'flare'
  | 'petalA'
  | 'petalB'
  | 'petalC'
  | 'leafMaple'
  | 'leafLong'
  | 'snow'
  | 'drop'
  | 'streak'
  | 'flowerDaisy'
  | 'flowerCosmos'
  | 'flowerBell'
  | 'stem'
  | 'birdUp'
  | 'birdDown'
  | 'lotus'
  | 'pad'
  | 'ray'
  | 'fog';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

export function makeCanvas(
  w: number,
  h: number,
): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2d canvas unavailable');
  return { canvas, g };
}

function radial(g: CanvasRenderingContext2D, w: number, h: number, stops: number[][]): void {
  const r = Math.min(w, h) / 2;
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, r);
  for (const [t, a] of stops) gr.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}

function petal(v: number): Draw {
  return (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.scale(w / 48, h / 48);
    g.beginPath();
    g.moveTo(0, 21);
    g.bezierCurveTo(-15 + v * 2, 12, -17 - v * 2, -12, -6, -20);
    g.quadraticCurveTo(0, -15 + v * 1.5, 6, -20);
    g.bezierCurveTo(17 + v * 2, -12, 15 - v * 2, 12, 0, 21);
    g.closePath();
    const gr = g.createLinearGradient(0, 21, 0, -20);
    gr.addColorStop(0, 'rgba(236,196,212,1)');
    gr.addColorStop(0.55, 'rgba(255,240,246,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0.96)');
    g.fillStyle = gr;
    g.fill();
    g.strokeStyle = 'rgba(190,110,145,0.3)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, 19);
    g.lineTo(0, -12);
    g.stroke();
  };
}

const leafMaple: Draw = (g, w, h) => {
  g.translate(w / 2, h / 2);
  g.scale(w / 48, h / 48);
  const right: number[][] = [
    [0, -22],
    [4, -13],
    [11, -18],
    [9, -7],
    [21, -7],
    [12, 1],
    [17, 10],
    [5, 8],
    [2, 20],
  ];
  g.beginPath();
  g.moveTo(right[0][0], right[0][1]);
  for (let i = 1; i < right.length; i++) g.lineTo(right[i][0], right[i][1]);
  for (let i = right.length - 1; i >= 1; i--) g.lineTo(-right[i][0], right[i][1]);
  g.closePath();
  const gr = g.createLinearGradient(0, -22, 0, 20);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(214,206,196,1)');
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = 'rgba(120,80,50,0.4)';
  g.lineWidth = 1.1;
  g.beginPath();
  g.moveTo(0, 22);
  g.lineTo(0, -16);
  g.moveTo(0, 6);
  g.lineTo(13, -3);
  g.moveTo(0, 6);
  g.lineTo(-13, -3);
  g.stroke();
};

const leafLong: Draw = (g, w, h) => {
  g.translate(w / 2, h / 2);
  g.scale(w / 48, h / 48);
  g.beginPath();
  g.moveTo(0, 22);
  g.quadraticCurveTo(-13, 2, 0, -22);
  g.quadraticCurveTo(13, 2, 0, 22);
  const gr = g.createLinearGradient(-10, 0, 10, 0);
  gr.addColorStop(0, 'rgba(214,214,204,1)');
  gr.addColorStop(1, 'rgba(255,255,250,1)');
  g.fillStyle = gr;
  g.fill();
  g.strokeStyle = 'rgba(90,110,60,0.4)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, 21);
  g.lineTo(0, -17);
  g.stroke();
};

function flowerDaisy(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.translate(w / 2, h / 2);
  const n = 13;
  for (let i = 0; i < n; i++) {
    g.save();
    g.rotate((i / n) * TAU);
    const gr = g.createLinearGradient(0, 0, 0, -w * 0.46);
    gr.addColorStop(0, 'rgba(226,214,226,1)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(0, -w * 0.27, w * 0.075, w * 0.2, 0, 0, TAU);
    g.fill();
    g.restore();
  }
  g.fillStyle = 'rgba(255,200,70,1)';
  g.beginPath();
  g.arc(0, 0, w * 0.11, 0, TAU);
  g.fill();
}

function flowerCosmos(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.translate(w / 2, h / 2);
  for (let i = 0; i < 6; i++) {
    g.save();
    g.rotate((i / 6) * TAU + 0.2);
    const gr = g.createLinearGradient(0, 0, 0, -w * 0.46);
    gr.addColorStop(0, 'rgba(230,206,222,1)');
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(-w * 0.2, -w * 0.12, -w * 0.18, -w * 0.4, -w * 0.06, -w * 0.45);
    g.lineTo(w * 0.0, -w * 0.4);
    g.lineTo(w * 0.06, -w * 0.45);
    g.bezierCurveTo(w * 0.18, -w * 0.4, w * 0.2, -w * 0.12, 0, 0);
    g.fill();
    g.restore();
  }
  g.fillStyle = 'rgba(255,190,60,1)';
  g.beginPath();
  g.arc(0, 0, w * 0.075, 0, TAU);
  g.fill();
}

function flowerBell(g: CanvasRenderingContext2D, w: number, h: number): void {
  g.translate(w / 2, h / 2);
  const cup = (dx: number, rot: number, alpha: number): void => {
    g.save();
    g.translate(dx, w * 0.12);
    g.rotate(rot);
    const gr = g.createLinearGradient(0, -w * 0.4, 0, w * 0.2);
    gr.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gr.addColorStop(1, `rgba(226,204,220,${alpha})`);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, w * 0.22);
    g.bezierCurveTo(-w * 0.3, w * 0.12, -w * 0.22, -w * 0.28, 0, -w * 0.42);
    g.bezierCurveTo(w * 0.22, -w * 0.28, w * 0.3, w * 0.12, 0, w * 0.22);
    g.fill();
    g.restore();
  };
  cup(-w * 0.13, -0.3, 0.95);
  cup(w * 0.13, 0.3, 0.95);
  cup(0, 0, 1);
}

function bird(up: boolean): Draw {
  return (g, w, h) => {
    g.translate(w / 2, h / 2);
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineCap = 'round';
    g.lineWidth = 2.6;
    const tipY = up ? -h * 0.34 : h * 0.3;
    const ctrlY = up ? -h * 0.42 : h * 0.02;
    g.beginPath();
    g.moveTo(-w * 0.44, tipY);
    g.quadraticCurveTo(-w * 0.2, ctrlY, 0, h * 0.06);
    g.quadraticCurveTo(w * 0.2, ctrlY, w * 0.44, tipY);
    g.stroke();
    g.beginPath();
    g.ellipse(0, h * 0.08, w * 0.07, h * 0.1, 0, 0, TAU);
    g.fill();
  };
}

const lotus: Draw = (g, w, h) => {
  g.translate(w / 2, h * 0.86);
  const petalAt = (ang: number, len: number, wid: number, shade: number): void => {
    g.save();
    g.rotate(ang);
    const gr = g.createLinearGradient(0, 0, 0, -len);
    gr.addColorStop(0, `rgba(${shade},${shade - 20},${shade - 8},1)`);
    gr.addColorStop(0.75, `rgba(255,${shade + 8 > 255 ? 255 : shade + 8},252,1)`);
    gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(-wid, -len * 0.5, 0, -len);
    g.quadraticCurveTo(wid, -len * 0.5, 0, 0);
    g.fill();
    g.restore();
  };
  for (const a of [-1.2, -0.85, -0.5, 0.5, 0.85, 1.2]) petalAt(a, h * 0.66, w * 0.13, 228);
  for (const a of [-0.62, -0.25, 0.25, 0.62]) petalAt(a, h * 0.78, w * 0.12, 240);
  petalAt(0, h * 0.84, w * 0.11, 250);
};

const pad: Draw = (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)');
  gr.addColorStop(0.8, 'rgba(210,225,205,0.95)');
  gr.addColorStop(1, 'rgba(180,200,175,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, TAU);
  g.fill();
};

const ray: Draw = (g, w, h) => {
  // putImageData ignores the transform, so paint a scratch canvas and blit it.
  const tmp = makeCanvas(w, h);
  const img = tmp.g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const v = y / (h - 1);
    const along = Math.min(1, v / 0.1) * (1 - Math.min(1, Math.max(0, (v - 0.35) / 0.65)));
    const fall = along * along * (3 - 2 * along);
    for (let x = 0; x < w; x++) {
      const u = (x / (w - 1)) * 2 - 1;
      const across = Math.exp(-u * u * 3.2);
      const a = across * fall * 0.9;
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  tmp.g.putImageData(img, 0, 0);
  g.drawImage(tmp.canvas, 0, 0);
};

const SPECS: Array<{ name: FrameName; w: number; h: number; draw: Draw }> = [
  {
    name: 'glow',
    w: 128,
    h: 128,
    draw: (g, w, h) =>
      radial(g, w, h, [
        [0, 1],
        [0.12, 0.8],
        [0.3, 0.42],
        [0.55, 0.14],
        [0.8, 0.03],
        [1, 0],
      ]),
  },
  {
    name: 'glowSoft',
    w: 128,
    h: 128,
    draw: (g, w, h) =>
      radial(g, w, h, [
        [0, 0.7],
        [0.3, 0.5],
        [0.6, 0.18],
        [0.85, 0.04],
        [1, 0],
      ]),
  },
  {
    name: 'dot',
    w: 32,
    h: 32,
    draw: (g, w, h) =>
      radial(g, w, h, [
        [0, 1],
        [0.45, 0.95],
        [0.75, 0.3],
        [1, 0],
      ]),
  },
  {
    name: 'bokeh',
    w: 96,
    h: 96,
    draw: (g, w, h) =>
      radial(g, w, h, [
        [0, 0.5],
        [0.78, 0.6],
        [0.9, 0.85],
        [0.97, 0.4],
        [1, 0],
      ]),
  },
  {
    name: 'ring',
    w: 128,
    h: 128,
    draw: (g, w, h) =>
      radial(g, w, h, [
        [0, 0],
        [0.62, 0],
        [0.8, 0.95],
        [0.9, 0.3],
        [1, 0],
      ]),
  },
  {
    name: 'flare',
    w: 128,
    h: 128,
    draw: (g, w, h) => {
      g.globalCompositeOperation = 'lighter';
      radial(g, w, h, [
        [0, 1],
        [0.1, 0.7],
        [0.28, 0.16],
        [0.5, 0],
      ]);
      g.translate(w / 2, h / 2);
      for (let k = 0; k < 4; k++) {
        g.save();
        g.rotate((k * Math.PI) / 2);
        const len = k % 2 ? w * 0.34 : w * 0.48;
        const gr = g.createLinearGradient(0, 0, len, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0.95)');
        gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(0, -1.6);
        g.lineTo(len, 0);
        g.lineTo(0, 1.6);
        g.fill();
        g.restore();
      }
    },
  },
  { name: 'petalA', w: 48, h: 48, draw: petal(0) },
  { name: 'petalB', w: 48, h: 48, draw: petal(2) },
  { name: 'petalC', w: 48, h: 48, draw: petal(-2) },
  { name: 'leafMaple', w: 48, h: 48, draw: leafMaple },
  { name: 'leafLong', w: 48, h: 48, draw: leafLong },
  {
    name: 'snow',
    w: 32,
    h: 32,
    draw: (g, w, h) =>
      radial(g, w, h, [
        [0, 1],
        [0.25, 0.9],
        [0.55, 0.32],
        [1, 0],
      ]),
  },
  {
    name: 'drop',
    w: 10,
    h: 72,
    draw: (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.6, 'rgba(255,255,255,0.4)');
      gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.lineCap = 'round';
      g.strokeStyle = gr;
      g.globalAlpha = 0.3;
      g.lineWidth = 6;
      g.beginPath();
      g.moveTo(w / 2, 4);
      g.lineTo(w / 2, h - 4);
      g.stroke();
      g.globalAlpha = 1;
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(w / 2, 3);
      g.lineTo(w / 2, h - 4);
      g.stroke();
    },
  },
  {
    name: 'streak',
    w: 256,
    h: 14,
    draw: (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.75, 'rgba(255,255,255,0.4)');
      gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(0, h / 2);
      g.lineTo(w - 8, h / 2 - 2.4);
      g.lineTo(w - 8, h / 2 + 2.4);
      g.fill();
      const hg = g.createRadialGradient(w - 8, h / 2, 0, w - 8, h / 2, 7);
      hg.addColorStop(0, 'rgba(255,255,255,1)');
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hg;
      g.fillRect(w - 16, 0, 16, h);
    },
  },
  { name: 'flowerDaisy', w: 80, h: 80, draw: flowerDaisy },
  { name: 'flowerCosmos', w: 80, h: 80, draw: flowerCosmos },
  { name: 'flowerBell', w: 80, h: 80, draw: flowerBell },
  {
    name: 'stem',
    w: 6,
    h: 96,
    draw: (g, w, h) => {
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(w / 2, 2);
      g.lineTo(w / 2, h - 2);
      g.stroke();
    },
  },
  { name: 'birdUp', w: 44, h: 26, draw: bird(true) },
  { name: 'birdDown', w: 44, h: 26, draw: bird(false) },
  { name: 'lotus', w: 128, h: 112, draw: lotus },
  { name: 'pad', w: 96, h: 32, draw: pad },
  { name: 'ray', w: 64, h: 256, draw: ray },
  {
    name: 'fog',
    w: 16,
    h: 128,
    draw: (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0)');
      gr.addColorStop(0.45, 'rgba(255,255,255,0.8)');
      gr.addColorStop(0.62, 'rgba(255,255,255,0.85)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    },
  },
];

export interface Atlas {
  /** Canvas the atlas was painted on (kept for context restores and debugging). */
  readonly canvas: HTMLCanvasElement;
  readonly texture: Texture;
  /** Tiling value noise for the shaders: R, G, B = octaves of 4, 8 and 16 cells across. */
  readonly noise: Texture;
  readonly frames: Record<FrameName, Texture>;
  destroy(): void;
}

const NOISE_SIZE = 256;
const NOISE_CELLS = [4, 8, 16];

/** Seamless smooth value noise, one octave per colour channel, so a shader gets an fbm in one fetch. */
function* noiseSteps(): Steps<Texture> {
  const n = NOISE_SIZE;
  const { canvas, g } = makeCanvas(n, n);
  const img = g.createImageData(n, n);
  const rnd = makeRng(4242);
  const lattices = NOISE_CELLS.map((cells) => {
    const a = new Float32Array(cells * cells);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return a;
  });
  for (let y = 0; y < n; y++) {
    for (let c = 0; c < NOISE_CELLS.length; c++) {
      const cells = NOISE_CELLS[c];
      const lat = lattices[c];
      const fy = (y / n) * cells;
      const y0 = Math.floor(fy);
      const ty = smoothstep(fy - y0);
      const r0 = y0 * cells;
      const r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells;
        const x0 = Math.floor(fx);
        const tx = smoothstep(fx - x0);
        const x1 = (x0 + 1) % cells;
        const top = lat[r0 + x0] + (lat[r0 + x1] - lat[r0 + x0]) * tx;
        const bot = lat[r1 + x0] + (lat[r1 + x1] - lat[r1 + x0]) * tx;
        img.data[(y * n + x) * 4 + c] = Math.round((top + (bot - top) * ty) * 255);
      }
    }
    for (let x = 0; x < n; x++) img.data[(y * n + x) * 4 + 3] = 255;
    if ((y & 15) === 15 && due()) yield;
  }
  g.putImageData(img, 0, 0);
  return new Texture({
    source: new ImageSource({ resource: canvas, scaleMode: 'linear', addressMode: 'repeat' }),
  });
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function* atlasSteps(): Steps<Atlas> {
  const PAD = 3;
  const W = 1024;
  const rects: Array<{ x: number; y: number }> = [];
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const s of SPECS) {
    if (x + s.w + PAD > W) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    rects.push({ x, y });
    x += s.w + PAD;
    rowH = Math.max(rowH, s.h);
  }
  const H = nextPow2(y + rowH + PAD);
  const { canvas, g } = makeCanvas(W, H);
  for (let i = 0; i < SPECS.length; i++) {
    const s = SPECS[i];
    g.save();
    g.translate(rects[i].x, rects[i].y);
    g.beginPath();
    g.rect(0, 0, s.w, s.h);
    g.clip();
    s.draw(g, s.w, s.h);
    g.restore();
    if (due()) yield;
  }
  const source = new ImageSource({ resource: canvas, scaleMode: 'linear' });
  const texture = new Texture({ source });
  const noise = yield* noiseSteps();
  const frames = {} as Record<FrameName, Texture>;
  SPECS.forEach((s, i) => {
    frames[s.name] = new Texture({
      source,
      frame: new Rectangle(rects[i].x, rects[i].y, s.w, s.h),
    });
  });
  return {
    canvas,
    texture,
    noise,
    frames,
    destroy() {
      for (const k of Object.keys(frames) as FrameName[]) frames[k].destroy(false);
      texture.destroy(true);
      freeTexture(noise);
      canvas.width = canvas.height = 0;
    },
  };
}

export const createAtlas = (): Atlas => drain(atlasSteps());

/** Edge darkening plus a whisper of centre scrim so white UI text stays legible. Standalone (clamped) texture. */
export function createVignette(): Texture {
  const { canvas, g } = makeCanvas(256, 256);
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(6,10,24,0.12)');
  gr.addColorStop(0.45, 'rgba(6,10,24,0.05)');
  gr.addColorStop(0.62, 'rgba(6,10,24,0.0)');
  gr.addColorStop(0.85, 'rgba(6,10,24,0.1)');
  gr.addColorStop(1, 'rgba(4,8,20,0.34)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  return new Texture({ source: new ImageSource({ resource: canvas, scaleMode: 'linear' }) });
}

/** Texture for a tiling strip: repeats horizontally, clamps vertically, mip-mapped for stable minification. */
export function stripTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({
    source: new ImageSource({
      resource: canvas,
      scaleMode: 'linear',
      mipmapFilter: 'linear',
      autoGenerateMipmaps: true,
      addressModeU: 'repeat',
      addressModeV: 'clamp-to-edge',
    }),
  });
}

/** Plain (non-tiling) texture for sprites painted per scene, e.g. the cherry tree. */
export function spriteTexture(canvas: HTMLCanvasElement): Texture {
  return new Texture({
    source: new ImageSource({
      resource: canvas,
      scaleMode: 'linear',
      mipmapFilter: 'linear',
      autoGenerateMipmaps: true,
    }),
  });
}

export function freeTexture(t: Texture | null | undefined): void {
  if (!t) return;
  const res = t.source.resource as HTMLCanvasElement | undefined;
  t.destroy(true);
  if (res && typeof res.width === 'number') res.width = res.height = 0;
}
