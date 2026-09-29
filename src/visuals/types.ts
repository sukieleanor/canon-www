import type { MusicBus } from '../events';
import type { SceneId } from '../types';

export interface VisualEngineOptions {
  /** Element the canvas fills (the full-viewport #stage). */
  container: HTMLElement;
  bus: MusicBus;
  scene: SceneId;
  autoRotate: boolean;
  reducedMotion: boolean;
}

export interface VisualStats {
  fps: number;
  quality: 'high' | 'medium' | 'low';
  particles: number;
}

export interface VisualEngine {
  readonly scene: SceneId;
  /** Cross-fades to another scene and emits `sceneChange` on the bus. */
  setScene(scene: SceneId): void;
  setAutoRotate(on: boolean): void;
  setReducedMotion(on: boolean): void;
  stats(): VisualStats;
  destroy(): void;
}
