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

  it('landmark preview 一律隱藏（讓位給路線——Phase 4 舊債 2）', () => {
    expect(labelVisible('landmark', 'preview', 1, 10)).toBe(false);
  });

  it('tier 0 landmark 在 overview 常駐（不受距離限制）', () => {
    expect(labelVisible('landmark', 'overview', 1, THEME.labels.landmarkMaxDist + 999, 0)).toBe(true);
  });
  it('未標 tier 的 landmark 仍看距離（L1）', () => {
    expect(labelVisible('landmark', 'overview', 1, THEME.labels.landmarkMaxDist + 1)).toBe(false);
    expect(labelVisible('landmark', 'overview', 1, THEME.labels.landmarkMaxDist - 1)).toBe(true);
  });
  it('tier 0 landmark 在 preview 仍隱藏（讓位給路線）', () => {
    expect(labelVisible('landmark', 'preview', 1, 10, 0)).toBe(false);
  });
});
