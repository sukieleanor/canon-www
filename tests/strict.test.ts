import { describe, expect, it } from 'vitest';
import { composer, countParallels } from './helpers';

describe('strict mode', () => {
  it('avoids parallel fifths and octaves between canon voices', () => {
    let loose = 0;
    let strict = 0;
    for (let s = 0; s < 8; s++) {
      const a = composer(`parallels-${s}`, { strict: false });
      const b = composer(`parallels-${s}`, { strict: true });
      for (let n = 3; n < 50; n++) {
        loose += countParallels(a.getCycle(n));
        strict += countParallels(b.getCycle(n));
      }
    }
    expect(loose).toBeGreaterThan(0);
    expect(strict).toBeLessThan(loose * 0.1);
  });
});
