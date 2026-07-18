import { describe, it, expect } from 'vitest';
import { fitView, localToScreen, screenToLocal, zoomAt } from '../src/tracer/view';

describe('view transform', () => {
  const v = { zoom: 2, panX: 100, panY: 50 };

  it('local↔screen roundtrip、y 軸翻轉', () => {
    expect(localToScreen(v, [0, 0])).toEqual([100, 50]);
    expect(localToScreen(v, [10, 5])).toEqual([120, 40]); // y 北 → 螢幕上方
    const back = screenToLocal(v, localToScreen(v, [-3.5, 7.25]));
    expect(back[0]).toBeCloseTo(-3.5, 9);
    expect(back[1]).toBeCloseTo(7.25, 9);
  });

  it('zoomAt 保持游標下的 local 點不動', () => {
    const cursor: [number, number] = [140, 30];
    const before = screenToLocal(v, cursor);
    const zoomed = zoomAt(v, cursor, 1.5);
    const after = screenToLocal(zoomed, cursor);
    expect(zoomed.zoom).toBeCloseTo(3, 9);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it('fitView 讓範圍置中且完整可見', () => {
    const fitted = fitView(800, 600, [-100, -50], [100, 50]);
    const tl = localToScreen(fitted, [-100, 50]);
    const br = localToScreen(fitted, [100, -50]);
    expect(tl[0]).toBeGreaterThanOrEqual(0);
    expect(tl[1]).toBeGreaterThanOrEqual(0);
    expect(br[0]).toBeLessThanOrEqual(800);
    expect(br[1]).toBeLessThanOrEqual(600);
    const c = localToScreen(fitted, [0, 0]);
    expect(c[0]).toBeCloseTo(400, 6);
    expect(c[1]).toBeCloseTo(300, 6);
  });
});
