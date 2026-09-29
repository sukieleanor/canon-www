import type { SceneId } from '../../types';
import { AuroraScene } from './aurora';
import { BlossomScene } from './blossom';
import { ForestScene } from './forest';
import { LakeScene } from './lake';
import { MountainScene } from './mountain';
import type { Scene, SceneContext } from './scene';

export function createScene(id: SceneId, ctx: SceneContext): Scene {
  switch (id) {
    case 'forest':
      return new ForestScene(ctx);
    case 'lake':
      return new LakeScene(ctx);
    case 'mountain':
      return new MountainScene(ctx);
    case 'blossom':
      return new BlossomScene(ctx);
    case 'aurora':
      return new AuroraScene(ctx);
    default:
      return new ForestScene(ctx);
  }
}
