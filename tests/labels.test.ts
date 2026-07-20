import { describe, it, expect } from 'vitest';
import { labelVisible } from '../src/labels';
import { THEME } from '../src/theme';

describe('labelVisible gate（nav 全隱；floor tag 看爆炸；landmark 看距離）', () => {
  it('nav 模式一律隱藏', () => {
    expect(labelVisible('floor-tag', 'nav', 1, 10)).toBe(false);
    expect(labelVisible('landmark', 'nav', 1, 10)).toBe(false);
  });

  it('floor tag 只在爆炸展開後顯示（門檻不含等於）', () => {
    expect(labelVisible('floor-tag', 'overview', 1, 10)).toBe(true);
    expect(labelVisible('floor-tag', 'overview', 0.3, 10)).toBe(false);
    expect(labelVisible('floor-tag', 'overview', THEME.labels.floorTagMinExplode, 10)).toBe(false);
  });

  it('landmark 依鏡頭距離進退（與爆炸係數無關）', () => {
    expect(labelVisible('landmark', 'overview', 0, THEME.labels.landmarkMaxDist - 1)).toBe(true);
    expect(labelVisible('landmark', 'preview', 1, THEME.labels.landmarkMaxDist + 1)).toBe(false);
  });
});
