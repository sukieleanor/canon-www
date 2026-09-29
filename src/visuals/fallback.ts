import type { MusicBus } from '../events';
import { SCENE_IDS, SEASONS, type SceneId, type Season } from '../types';
import { SceneDirector } from './director';
import { CHORD_MOODS, STAGE_LOOKS } from './palettes';
import type { VisualEngine, VisualEngineOptions, VisualStats } from './types';

/*
 * Graceful fallback for browsers without WebGL: an animated CSS gradient that follows the scene
 * picker, auto-rotate, chord colours, stage light and season, so the music keeps a living backdrop.
 */

interface Look {
  top: string;
  mid: string;
  low: string;
  glow: string;
  at: string;
}

const LOOKS: Record<SceneId, Look> = {
  forest: { top: '#28455a', mid: '#b98a72', low: '#f0c185', glow: 'rgba(255,214,150,0.55)', at: '72% 56%' },
  lake: { top: '#476f96', mid: '#9db9c9', low: '#eddcc6', glow: 'rgba(255,236,200,0.5)', at: '62% 52%' },
  mountain: { top: '#1d2048', mid: '#9c4468', low: '#f0a05a', glow: 'rgba(255,190,110,0.6)', at: '30% 60%' },
  blossom: { top: '#7889bd', mid: '#dcb3cf', low: '#f9dfd3', glow: 'rgba(255,240,235,0.5)', at: '76% 30%' },
  aurora: { top: '#040919', mid: '#0a1d3a', low: '#12464a', glow: 'rgba(90,255,190,0.35)', at: '45% 40%' },
  rain: { top: '#48586a', mid: '#8799a3', low: '#c2cdc9', glow: 'rgba(220,235,235,0.35)', at: '50% 45%' },
};

const SEASON_FILTER: Record<Season, string> = {
  spring: 'hue-rotate(0deg) saturate(1.05)',
  summer: 'hue-rotate(-6deg) saturate(1.12)',
  autumn: 'hue-rotate(-16deg) saturate(1.12)',
  winter: 'hue-rotate(12deg) saturate(0.7)',
};

const STYLE_ID = 'ec-fallback-style';
const CSS = `
.ec-fb{position:absolute;inset:0;overflow:hidden;pointer-events:none;background:#101827}
.ec-fb-layer{position:absolute;inset:0;opacity:0;transition:opacity 3s ease-in-out;will-change:opacity}
.ec-fb-layer.on{opacity:1}
.ec-fb-drift{position:absolute;inset:-12%;animation:ec-fb-drift 52s ease-in-out infinite alternate;will-change:transform}
.ec-fb.calm .ec-fb-drift,.ec-fb.calm .ec-fb-wash{animation:none}
.ec-fb-wash{position:absolute;inset:0;mix-blend-mode:soft-light;transition:background-color 1s ease,opacity 1s ease}
.ec-fb-vig{position:absolute;inset:0;background:radial-gradient(120% 100% at 50% 45%,transparent 55%,rgba(4,8,20,.5) 100%)}
.ec-fb-grade{position:absolute;inset:0;transition:filter 5s ease}
@keyframes ec-fb-drift{from{transform:translate3d(-3%,-2%,0) scale(1.02)}to{transform:translate3d(3%,2%,0) scale(1.1)}}
`;

function paint(el: HTMLElement, look: Look): void {
  el.style.background =
    `radial-gradient(60% 46% at ${look.at}, ${look.glow}, transparent 72%),` +
    `linear-gradient(180deg, ${look.top} 0%, ${look.mid} 55%, ${look.low} 100%)`;
}

function css(rgb: ArrayLike<number>): string {
  return `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
}

export function createFallbackEngine(opts: VisualEngineOptions): VisualEngine {
  const bus: MusicBus = opts.bus;
  const doc = opts.container.ownerDocument;
  let reduced = opts.reducedMotion;

  let style = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
  const ownsStyle = !style;
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
  }

  const root = doc.createElement('div');
  root.className = 'ec-fb';
  const grade = doc.createElement('div');
  grade.className = 'ec-fb-grade';
  const layers: HTMLElement[] = [];
  for (let i = 0; i < 2; i++) {
    const layer = doc.createElement('div');
    layer.className = 'ec-fb-layer';
    const drift = doc.createElement('div');
    drift.className = 'ec-fb-drift';
    layer.appendChild(drift);
    grade.appendChild(layer);
    layers.push(layer);
  }
  const wash = doc.createElement('div');
  wash.className = 'ec-fb-wash';
  const vig = doc.createElement('div');
  vig.className = 'ec-fb-vig';
  root.append(grade, wash, vig);
  opts.container.appendChild(root);

  let front = 0;
  const show = (scene: SceneId, instant: boolean): void => {
    const next = instant ? front : 1 - front;
    const layer = layers[next];
    paint(layer.firstElementChild as HTMLElement, LOOKS[scene]);
    if (instant) {
      layer.style.transition = 'none';
      layer.classList.add('on');
      void layer.offsetWidth;
      layer.style.transition = '';
      return;
    }
    layer.classList.add('on');
    layers[front].classList.remove('on');
    front = next;
  };
  const setCalm = (): void => {
    root.classList.toggle('calm', reduced);
    const t = reduced ? '3s' : '1s';
    wash.style.transitionDuration = `${t},${t}`;
  };
  setCalm();
  show(opts.scene, true);

  const director = new SceneDirector(bus, opts.scene, opts.autoRotate, (scene) => show(scene, false));

  const offs = [
    bus.on('chordChange', (e) => {
      const mood = CHORD_MOODS[((e.chordIndex % 8) + 8) % 8];
      wash.style.backgroundColor = css(mood.tint);
      wash.style.opacity = String(Math.min(0.9, mood.amt * (e.minor ? 1.7 : 2.1)));
    }),
    bus.on('stageChange', (e) => {
      const look = STAGE_LOOKS[e.stage] ?? STAGE_LOOKS.calm;
      grade.dataset.stage = e.stage;
      grade.style.filter = `brightness(${look.light}) saturate(${1 - look.dusk * 0.15})`;
    }),
    bus.on('keyChange', (e) => {
      if (SEASONS.includes(e.season)) root.style.filter = SEASON_FILTER[e.season];
    }),
  ];

  let destroyed = false;
  return {
    get scene() {
      return director.scene;
    },
    setScene(scene) {
      if (!destroyed) director.setScene(scene);
    },
    setAutoRotate(on) {
      director.setAutoRotate(on);
    },
    setReducedMotion(on) {
      reduced = on;
      setCalm();
    },
    stats(): VisualStats {
      return { fps: 0, quality: 'low', particles: 0 };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) off();
      director.destroy();
      root.remove();
      if (ownsStyle) style?.remove();
    },
  };
}

export const FALLBACK_SCENES = SCENE_IDS;
