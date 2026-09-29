import { describe, expect, it } from 'vitest';
import { STAGE_IDS, type StageId } from '../src/types';
import { composer } from './helpers';

function stageRuns(
  seed: string,
  cycles: number,
  busyness = 0.5,
): { stage: StageId; length: number }[] {
  const c = composer(seed, { busyness });
  const runs: { stage: StageId; length: number }[] = [];
  for (let n = 0; n < cycles; n++) {
    const stage = c.summary(n).stage;
    const last = runs[runs.length - 1];
    if (last && last.stage === stage) last.length++;
    else runs.push({ stage, length: 1 });
  }
  return runs;
}

describe('variation stages (plan §4.2)', () => {
  it('starts calm, lasts 2–6 cycles per stage and visits every stage', () => {
    for (let s = 0; s < 10; s++) {
      const runs = stageRuns(`stages-${s}`, 240);
      expect(runs[0].stage).toBe('calm');
      for (const run of runs.slice(0, -1)) {
        expect(run.length).toBeGreaterThanOrEqual(2);
        expect(run.length).toBeLessThanOrEqual(6);
      }
      expect(new Set(runs.map((r) => r.stage))).toEqual(new Set(STAGE_IDS));
    }
  });

  it('busyness tilts the music towards lively stages', () => {
    const share = (busyness: number) => {
      let lively = 0;
      let total = 0;
      for (let s = 0; s < 12; s++) {
        for (const run of stageRuns(`busy-${s}`, 150, busyness)) {
          total += run.length;
          if (run.stage === 'lively' || run.stage === 'playful') lively += run.length;
        }
      }
      return lively / total;
    };
    expect(share(0.95)).toBeGreaterThan(share(0.05) + 0.1);
  });
});
