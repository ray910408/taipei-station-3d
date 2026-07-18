import { describe, it, expect } from 'vitest';
import type { FloorDoc } from '../src/types';
import {
  allRefs, ensureWinding, findArea, getRing, hitGeom, hitVertex, pointInRing, ringArea, roundPt, setRing,
} from '../src/tracer/geom';

const LAYERS = { areas: true, units: true, walls: true, gates: true, pois: true, nav: true };

const doc = (): FloorDoc => structuredClone({
  schema: 'floor@1', id: 'hall-b1',
  slab: {
    outline: [[0, 0], [20, 0], [20, 10], [0, 10]],
    holes: [[[5, 5], [5, 7], [7, 7], [7, 5]]],
    source: 's', confidence: 3,
  },
  areas: [{ id: 'a-ha-paid', kind: 'paid', system: 'test', polygon: [[1, 1], [9, 1], [9, 9], [1, 9]], source: 's', confidence: 3 }],
  walls: [{ id: 'w-ha-1', polyline: [[0, 5], [10, 5]], height: 3, source: 's', confidence: 3 }],
  gates: [{ id: 'g-ha-1', kind: 'faregate', system: 'test', direction: 'both', accessible: true, line: [[12, 1], [12, 3]], connects: ['a-ha-paid', 'a-ha-paid'], source: 's', confidence: 3 }],
  pois: [{ id: 'p-ha-1', kind: 'info', position: [15, 5], source: 's', confidence: 3 }],
  nav: { nodes: [{ id: 'n-ha-001', xy: [3, 3] }], edges: [] },
} as unknown as FloorDoc);

describe('geom 基礎', () => {
  it('ringArea 符號＝繞向；ensureWinding 正規化', () => {
    const ccw: [number, number][] = [[0, 0], [4, 0], [4, 4]];
    expect(ringArea(ccw)).toBeGreaterThan(0);
    expect(ensureWinding([...ccw].reverse(), 'ccw')).toEqual(ccw);
    expect(ringArea(ensureWinding(ccw, 'cw'))).toBeLessThan(0);
  });

  it('pointInRing / roundPt', () => {
    expect(pointInRing([2, 2], [[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(true);
    expect(pointInRing([5, 5], [[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(false);
    expect(roundPt([1.234, -5.678])).toEqual([1.2, -5.7]);
  });
});

describe('getRing / setRing', () => {
  it('各類 ref 取得座標序列', () => {
    const d = doc();
    expect(getRing(d, { kind: 'slab-outline' })!.length).toBe(4);
    expect(getRing(d, { kind: 'slab-hole', index: 0 })!.length).toBe(4);
    expect(getRing(d, { kind: 'area', id: 'a-ha-paid' })!.length).toBe(4);
    expect(getRing(d, { kind: 'wall', id: 'w-ha-1' })!.length).toBe(2);
    expect(getRing(d, { kind: 'gate', id: 'g-ha-1' })!.length).toBe(2);
    expect(getRing(d, { kind: 'poi', id: 'p-ha-1' })).toEqual([[15, 5]]);
    expect(getRing(d, { kind: 'nav-node', id: 'n-ha-001' })).toEqual([[3, 3]]);
    expect(getRing(d, { kind: 'area', id: 'nope' })).toBeNull();
  });

  it('setRing：round、繞向正規化、點數守衛', () => {
    const d = doc();
    setRing(d, { kind: 'area', id: 'a-ha-paid' }, [[1, 9.04], [9, 9], [9, 1], [1, 1]]); // cw 輸入
    expect(ringArea(d.areas![0].polygon)).toBeGreaterThan(0); // 已轉 ccw
    expect(d.areas![0].polygon.some((p) => p[0] === 1 && p[1] === 9)).toBe(true); // 9.04 → 9
    setRing(d, { kind: 'slab-hole', index: 0 }, [[5, 5], [7, 5], [7, 7], [5, 7]]); // ccw 輸入
    expect(ringArea(d.slab.holes![0])).toBeLessThan(0); // 已轉 cw
    expect(() => setRing(d, { kind: 'area', id: 'a-ha-paid' }, [[0, 0], [1, 1]])).toThrow();
    expect(() => setRing(d, { kind: 'gate', id: 'g-ha-1' }, [[0, 0], [1, 1], [2, 2]])).toThrow();
    setRing(d, { kind: 'poi', id: 'p-ha-1' }, [[15.55, 5]]);
    expect(d.pois![0].position).toEqual([15.6, 5]);
  });
});

describe('hit-testing', () => {
  it('hitVertex：容差內取最近，容差外 null', () => {
    const d = doc();
    const refs = allRefs(d, LAYERS);
    expect(hitVertex(d, refs, [3.1, 3.1], 0.5)?.ref).toEqual({ kind: 'nav-node', id: 'n-ha-001' });
    expect(hitVertex(d, refs, [3.1, 3.1], 0.05)).toBeNull();
    expect(hitVertex(d, refs, [0.1, 0.1], 0.3)?.ref).toEqual({ kind: 'slab-outline' });
  });

  it('hitGeom：上層優先；關圖層可選到下層', () => {
    const d = doc();
    expect(hitGeom(d, allRefs(d, LAYERS), [2, 5], 0.2)).toEqual({ kind: 'wall', id: 'w-ha-1' }); // wall 蓋在 area 上
    expect(hitGeom(d, allRefs(d, LAYERS), [12, 2], 0.3)).toEqual({ kind: 'gate', id: 'g-ha-1' });
    expect(hitGeom(d, allRefs(d, LAYERS), [5.5, 5.5], 0.2)).toEqual({ kind: 'area', id: 'a-ha-paid' });
    const noAreas = allRefs(d, { ...LAYERS, areas: false, walls: false });
    expect(hitGeom(d, noAreas, [5.5, 5.5], 0.2)).toEqual({ kind: 'slab-hole', index: 0 });
    expect(hitGeom(d, allRefs(d, LAYERS), [15, 5], 0.3)).toEqual({ kind: 'poi', id: 'p-ha-1' });
    expect(hitGeom(d, allRefs(d, LAYERS), [19.9, 0.1], 0.3)).toEqual({ kind: 'slab-outline' }); // slab 只吃邊線
    expect(hitGeom(d, allRefs(d, LAYERS), [15, 8], 0.2)).toBeNull(); // slab 內部空白不選 slab
  });

  it('findArea', () => {
    const d = doc();
    expect(findArea(d, [2, 2])).toBe('a-ha-paid');
    expect(findArea(d, [15, 5])).toBeUndefined();
  });
});
