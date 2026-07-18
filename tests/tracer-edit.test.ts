import { describe, it, expect } from 'vitest';
import type { FloorDoc } from '../src/types';
import { ringArea } from '../src/tracer/geom';
import {
  addArea, addGate, addNavNode, addSlabHole, deleteNavNode, deleteVertex, insertVertex,
  moveVertex, nextNodeId, replaceGeom, segIndexNear,
} from '../src/tracer/edit';

const doc = (): FloorDoc => structuredClone({
  schema: 'floor@1', id: 'hall-b1',
  slab: { outline: [[0, 0], [20, 0], [20, 10], [0, 10]], source: 's', confidence: 2 },
  areas: [{ id: 'a-ha-paid', kind: 'paid', system: 'test', polygon: [[1, 1], [9, 1], [9, 9], [1, 9]], source: 's', confidence: 2 }],
  nav: {
    nodes: [{ id: 'n-ha-001', xy: [3, 3], area: 'a-ha-paid' }, { id: 'n-ha-002', xy: [8, 8], area: 'a-ha-paid' }],
    edges: [{ from: 'n-ha-001', to: 'n-ha-002', kind: 'walk' }],
  },
} as unknown as FloorDoc);

const P = { source: 'img-1', confidence: 3 };

describe('新增元素', () => {
  it('addArea：cw 輸入轉 ccw、round 0.1、provenance 蓋 traced', () => {
    const d = doc();
    addArea(d, 'a-ha-hall', 'unpaid', 'test', [[10, 9.96], [18, 10], [18, 2], [10, 2]], P);
    const a = d.areas!.find((x) => x.id === 'a-ha-hall')!;
    expect(ringArea(a.polygon)).toBeGreaterThan(0);
    expect(a.polygon.some((p) => p[1] === 10)).toBe(true); // 9.96 → 10
    expect(a.status).toBe('traced');
    expect(a.source).toBe('img-1');
    expect(a.confidence).toBe(3);
  });

  it('addArea：id 重複或格式錯拋錯', () => {
    expect(() => addArea(doc(), 'a-ha-paid', 'paid', 'test', [[0, 0], [1, 0], [1, 1]], P)).toThrow('已存在');
    expect(() => addArea(doc(), 'Bad_ID', 'paid', 'test', [[0, 0], [1, 0], [1, 1]], P)).toThrow('格式');
  });

  it('addGate：connects 檢查與恰 2 點', () => {
    const d = doc();
    expect(() => addGate(d, 'g-ha-x', 'test', 'both', true, ['a-ha-paid', 'nope'], [[1, 1], [2, 2]], P)).toThrow('不存在');
    expect(() => addGate(d, 'g-ha-x', 'test', 'both', true, ['a-ha-paid', 'a-ha-paid'], [[1, 1]], P)).toThrow('2 點');
    addGate(d, 'g-ha-x', 'test', 'in', false, ['a-ha-paid', 'a-ha-paid'], [[2, 8], [4, 8]], P);
    expect(d.gates![0].direction).toBe('in');
  });

  it('addSlabHole：ccw 輸入轉 cw', () => {
    const d = doc();
    addSlabHole(d, [[12, 2], [15, 2], [15, 5], [12, 5]]);
    expect(ringArea(d.slab.holes![0])).toBeLessThan(0);
  });
});

describe('幾何編修', () => {
  it('replaceGeom：換幾何並蓋 provenance', () => {
    const d = doc();
    replaceGeom(d, { kind: 'area', id: 'a-ha-paid' }, [[1, 1], [8, 1], [8, 8], [1, 8]], P);
    const a = d.areas![0];
    expect(a.polygon.length).toBe(4);
    expect(a.status).toBe('traced');
    expect(a.source).toBe('img-1');
  });

  it('moveVertex：round；nav-node 移動重判 area', () => {
    const d = doc();
    moveVertex(d, { ref: { kind: 'area', id: 'a-ha-paid' }, vi: 0 }, [1.26, 1.24]);
    expect(d.areas![0].polygon[0]).toEqual([1.3, 1.2]);
    moveVertex(d, { ref: { kind: 'nav-node', id: 'n-ha-001' }, vi: 0 }, [15, 5]); // area 外
    const n = d.nav!.nodes[0];
    expect(n.xy).toEqual([15, 5]);
    expect(n.area).toBeUndefined();
  });

  it('insertVertex / deleteVertex / segIndexNear', () => {
    const d = doc();
    const ref = { kind: 'area', id: 'a-ha-paid' } as const;
    expect(segIndexNear(d.areas![0].polygon, [5, 1], true)).toBe(0);
    expect(segIndexNear(d.areas![0].polygon, [1, 5], true)).toBe(3); // 尾→首段
    expect(insertVertex(d, ref, 0, [5, 1])).toBe(true);
    expect(d.areas![0].polygon[1]).toEqual([5, 1]);
    expect(deleteVertex(d, { ref, vi: 1 })).toBe(true);
    expect(deleteVertex(d, { ref: { kind: 'gate', id: 'nope' }, vi: 0 })).toBe(false);
    const tri = doc();
    tri.areas![0].polygon = [[0, 0], [4, 0], [4, 4]];
    expect(deleteVertex(tri, { ref, vi: 0 })).toBe(false); // 守最少 3 點
  });
});

describe('nav node', () => {
  it('nextNodeId 接續補零；addNavNode 自動 id 與 area', () => {
    const d = doc();
    expect(nextNodeId(d, 'ha')).toBe('n-ha-003');
    const n = addNavNode(d, 'ha', [2.04, 2]);
    expect(n.id).toBe('n-ha-003');
    expect(n.xy).toEqual([2, 2]);
    expect(n.area).toBe('a-ha-paid');
    const outside = addNavNode(d, 'ha', [19, 9]);
    expect(outside.id).toBe('n-ha-004');
    expect(outside.area).toBeUndefined();
  });

  it('deleteNavNode：被 edge 引用拒絕，否則刪除', () => {
    const d = doc();
    expect(deleteNavNode(d, 'n-ha-001').ok).toBe(false);
    addNavNode(d, 'ha', [2, 2]);
    expect(deleteNavNode(d, 'n-ha-003').ok).toBe(true);
    expect(d.nav!.nodes.length).toBe(2);
  });
});
