import type { StageId } from '../types';
import { VOICE_COUNT } from './constants';

/**
 * Canon entries: the ground bass plays alone first, then one voice enters per cycle (like the
 * original). The rest stage thins back to one or two voices, after which they re-enter one by one.
 */
export function nextVoiceCount(
  previous: number,
  cycle: number,
  stage: StageId,
  stageIndex: number,
): number {
  if (cycle <= 0) return 0;
  if (stage === 'rest') return stageIndex === 0 ? Math.max(1, Math.min(previous, 2)) : 1;
  return Math.min(VOICE_COUNT, previous + 1);
}

/** Voice v repeats the leader's phrase from v cycles earlier — the round. */
export function voiceAssignments(
  cycle: number,
  voices: number,
): { voice: number; phraseCycle: number }[] {
  const out: { voice: number; phraseCycle: number }[] = [];
  for (let v = 0; v < voices; v++) {
    const phraseCycle = cycle - v;
    if (phraseCycle >= 1) out.push({ voice: v, phraseCycle });
  }
  return out;
}
