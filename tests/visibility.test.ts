import { describe, it, expect } from 'vitest';
import { pointInPolygon, segmentClear } from '../src/visibility';
import type { Vec2 } from '../src/types';

const square: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const ell: Vec2[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]; // L 形（凹）
const box: Vec2[] = [[4, 4], [6, 4], [6, 6], [4, 6]];

describe('pointInPolygon', () => {
  it('方形內/外', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });
  it('凹多邊形缺角為外', () => {
    expect(pointInPolygon([8, 8], ell)).toBe(false);
    expect(pointInPolygon([2, 8], ell)).toBe(true);
  });
});

describe('segmentClear', () => {
  it('空曠方形內對角線可走', () => {
    expect(segmentClear([1, 1], [9, 9], square, [])).toBe(true);
  });
  it('穿過 unit 障礙被擋', () => {
    expect(segmentClear([1, 1], [9, 9], square, [box])).toBe(false);
  });
  it('凹多邊形：線段離開 polygon 被擋', () => {
    expect(segmentClear([8, 2], [2, 8], ell, [])).toBe(false);
  });
  it('凹多邊形：沿臂內直線可走', () => {
    expect(segmentClear([2, 2], [2, 9], ell, [])).toBe(true);
  });
  it('零長度線段回 false', () => {
    expect(segmentClear([1, 1], [1, 1], square, [])).toBe(false);
  });
});
