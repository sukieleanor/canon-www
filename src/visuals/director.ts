import type { MusicBus } from '../events';
import { SCENE_IDS, type SceneId } from '../types';

/** Auto-rotate advances after this many phrases (one `cycle` event per phrase). */
export const PHRASES_PER_SCENE = 12;

/**
 * Owns which scene is selected and the auto-rotate clock. Shared by the WebGL engine and the CSS
 * fallback so both switch scenes identically and emit `sceneChange` the same way.
 */
export class SceneDirector {
  private current: SceneId;
  private auto: boolean;
  private playing = false;
  private phrases = 0;
  private lastCycle = -1;
  private readonly bus: MusicBus;
  private readonly onSwitch: (scene: SceneId) => void;
  private readonly offs: Array<() => void> = [];

  constructor(
    bus: MusicBus,
    initial: SceneId,
    autoRotate: boolean,
    onSwitch: (scene: SceneId) => void,
  ) {
    this.bus = bus;
    this.current = initial;
    this.auto = autoRotate;
    this.onSwitch = onSwitch;
    this.offs.push(
      bus.on('transport', (e) => {
        this.playing = !!e.playing;
      }),
      bus.on('cycle', (e) => this.onCycle(e.cycle)),
    );
  }

  get scene(): SceneId {
    return this.current;
  }

  /** Scene auto-rotate will show next, once it is close enough to be worth warming up. */
  get upcoming(): SceneId | null {
    if (!this.auto || !this.playing || this.phrases < PHRASES_PER_SCENE - 2) return null;
    return this.next();
  }

  setScene(scene: SceneId): void {
    this.switchTo(scene, false);
  }

  setAutoRotate(on: boolean): void {
    if (on && !this.auto) this.phrases = 0;
    this.auto = on;
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  private next(): SceneId {
    const i = SCENE_IDS.indexOf(this.current);
    return SCENE_IDS[(i + 1) % SCENE_IDS.length];
  }

  private onCycle(cycle: number): void {
    if (cycle === this.lastCycle) return;
    this.lastCycle = cycle;
    if (!this.auto || !this.playing) return;
    if (++this.phrases >= PHRASES_PER_SCENE) this.switchTo(this.next(), true);
  }

  private switchTo(scene: SceneId, auto: boolean): void {
    if (scene === this.current || !SCENE_IDS.includes(scene)) return;
    this.current = scene;
    this.phrases = 0;
    this.onSwitch(scene);
    this.bus.emit('sceneChange', { scene, auto });
  }
}
