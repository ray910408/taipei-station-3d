import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(stationDoc, {
  'floors/tra-concourse-b1.json': tc,
  'floors/tra-platform-b2.json': tp,
  'floors/mrt-r-concourse-b3.json': rc,
  'floors/mrt-r-platform-b4.json': rp,
}, connectorsDoc);
const graph = buildGraph(model);
const hasEdge = (a: string, b: string) =>
  (graph.adj.get(a) ?? []).some((e) => e.to === b);

describe('自動視線邊（同 area、不穿障礙）', () => {
  it('rc-014 ↔ rc-008 直線邊存在（V 字繞路根治，直線 15.7m vs 舊 50.7m）', () => {
    expect(hasEdge('n-rc-014', 'n-rc-008')).toBe(true);
    expect(hasEdge('n-rc-008', 'n-rc-014')).toBe(true);
  });

  it('無障礙路線 B3 段走直線：rc-014 下一站即 rc-008', () => {
    const path = findPath(graph, 'n-rp-001', 'n-tp-002', { accessibleOnly: true })!;
    const ids = [path[0].from, ...path.map((e) => e.to)];
    const i = ids.indexOf('n-rc-014');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ids[i + 1]).toBe('n-rc-008');
  });

  it('B4 直線穿越樓梯開口被擋：rp-001 ↛ rp-006（維持繞行 rp-003）', () => {
    expect(hasEdge('n-rp-001', 'n-rp-006')).toBe(false);
  });

  it('跨 area 不自動補邊：rc-005（非付費）↛ rc-008（付費）', () => {
    expect(hasEdge('n-rc-005', 'n-rc-008')).toBe(false);
  });

  it('自動邊為 walk 且 cost=length（無懲罰）', () => {
    const e = (graph.adj.get('n-rc-014') ?? []).find((x) => x.to === 'n-rc-008')!;
    expect(e.kind).toBe('walk');
    expect(e.cost).toBeCloseTo(e.length, 6);
    expect(e.length).toBeLessThan(17);
  });
});
