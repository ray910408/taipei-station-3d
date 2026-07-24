import { describe, it, expect } from 'vitest';
import { declutter } from '../src/labels';

const box = (x: number, y: number, priority: number, w = 100, h = 20) => ({ x, y, w, h, priority });

describe('declutter 矩形貪婪去疊（QA2-3）', () => {
  it('相交者低 priority 被剔除', () => {
    expect(declutter([box(100, 100, 3), box(140, 108, 1)], 4)).toEqual([true, false]);
  });
  it('不相交者全保留（含 pad 邊界外）', () => {
    expect(declutter([box(100, 100, 3), box(100, 130, 1)], 4)).toEqual([true, true]);
  });
  it('pad 內視為相交：垂直距離 24 < h20+pad4', () => {
    expect(declutter([box(100, 100, 3), box(100, 123, 1)], 4)).toEqual([true, false]);
  });
  it('平手以 index 小者優先（決定性）', () => {
    expect(declutter([box(100, 100, 2), box(120, 100, 2)], 4)).toEqual([true, false]);
  });
  it('鏈狀：A 擋 B、B 不在後 C 仍與 A 比對', () => {
    // A(3) 保留；B(2) 與 A 相交剔除；C(1) 只與 A 相交才剔除——與被剔除的 B 相交不算
    expect(declutter([box(100, 100, 3), box(150, 100, 2), box(200, 100, 1)], 4))
      .toEqual([true, false, false]); // C 與 A 距離 100 < w100+pad → 仍相交 A，剔除
  });
});
