import { describe, it, expect } from 'vitest';
import { compassAngle } from '../src/compass';

describe('compassAngle（指北針 CSS 旋轉角，世界北＝-z）', () => {
  it('四基準方位：北0、東-90、南±180、西90', () => {
    expect(compassAngle(0, -1)).toBeCloseTo(0, 6);
    expect(compassAngle(1, 0)).toBeCloseTo(-90, 6);
    // 南：-fwdX=-0（IEEE 負零）→ atan2 回 -π → -180；與 +180 同一旋轉，取絕對值驗
    expect(Math.abs(compassAngle(0, 1))).toBeCloseTo(180, 6);
    expect(compassAngle(-1, 0)).toBeCloseTo(90, 6);
  });
  it('非軸向：東北向 fwd=(1,-1) → -45°', () => {
    expect(compassAngle(1, -1)).toBeCloseTo(-45, 6);
  });
});
