import { describe, it, expect } from 'vitest';
import { fitSimilarity, localToPx, pxPerM, pxToLocal } from '../src/tracer/transform';
import type { CalibrationControlPoint } from '../src/types';

const cp = (px: [number, number], local: [number, number]): CalibrationControlPoint => ({ px, local });

describe('fitSimilarity / pxToLocal / localToPx', () => {
  it('軸對齊：100px=10m、影像向下為南', () => {
    const t = fitSimilarity([cp([100, 200], [0, 0]), cp([300, 200], [20, 0])]);
    expect(pxToLocal(t, [100, 200])).toEqual([0, 0]);
    expect(pxToLocal(t, [300, 200])).toEqual([20, 0]);
    const p = pxToLocal(t, [100, 300]);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(-10, 9); // 影像往下 100px = local 往南 10m
    expect(pxPerM(t)).toBeCloseTo(10, 9);
  });

  it('旋轉 90°：影像向下對應 local 東、影像向右對應 local 北', () => {
    const t = fitSimilarity([cp([0, 0], [0, 0]), cp([0, 100], [10, 0])]);
    const p = pxToLocal(t, [100, 0]);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(10, 9);
  });

  it('roundtrip：localToPx ∘ pxToLocal ≈ 恆等，控制點精確命中', () => {
    const t = fitSimilarity([cp([50, 80], [-3.2, 7.5]), cp([400, 300], [55.4, -20.1])]);
    for (const px of [[0, 0], [123.4, 567.8], [999, 1]] as [number, number][]) {
      const back = localToPx(t, pxToLocal(t, px));
      expect(back[0]).toBeCloseTo(px[0], 6);
      expect(back[1]).toBeCloseTo(px[1], 6);
    }
    expect(pxToLocal(t, [400, 300])[0]).toBeCloseTo(55.4, 9);
    expect(pxToLocal(t, [400, 300])[1]).toBeCloseTo(-20.1, 9);
  });

  it('退化控制點拋錯', () => {
    expect(() => fitSimilarity([cp([5, 5], [0, 0]), cp([5, 5], [10, 0])])).toThrow();
    expect(() => fitSimilarity([cp([0, 0], [3, 3]), cp([100, 0], [3, 3])])).toThrow();
  });
});
