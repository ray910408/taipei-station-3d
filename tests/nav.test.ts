import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, routeSteps } from '../src/nav';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);
const graph = buildGraph(model);

describe('buildGraph', () => {
  it('節點含樓層與高程', () => {
    expect(graph.nodes.get('n-pl-001')).toMatchObject({ floor: 'plat-b2', z: -9 });
    expect(graph.nodes.get('n-ha-001')).toMatchObject({ floor: 'hall-b1', z: -4 });
  });

  it('單向 gate edge 不產生反向', () => {
    const back = (graph.adj.get('n-ha-002') ?? []).filter((e) => e.to === 'n-ha-001');
    expect(back).toEqual([]);
  });

  it('direction:up 的電扶梯只有低→高', () => {
    const up = (graph.adj.get('n-pl-001') ?? []).find((e) => e.kind === 'escalator');
    expect(up?.to).toBe('n-ha-001');
    const down = (graph.adj.get('n-ha-001') ?? []).find((e) => e.kind === 'escalator');
    expect(down).toBeUndefined();
  });
});

describe('findPath', () => {
  it('一般模式走電扶梯 + 單向閘門', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.kind)).toEqual(['escalator', 'gate']);
    expect(path![1].gate).toBe('g-ha-out');
  });

  it('無障礙模式改走電梯 + 無障礙閘門', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002', { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.kind === 'elevator')).toBe(true);
    expect(path!.some((e) => e.gate === 'g-ha-acc')).toBe(true);
  });

  it('無路可達回傳 null', () => {
    const path = findPath(graph, 'n-ha-002', 'n-pl-001', { accessibleOnly: true });
    // 反向：ha-002 →(walk) ha-004 →(acc gate) ha-003 →(電梯 both) pl-002 →(walk) pl-001，其實可達
    expect(path).not.toBeNull();
    // 真正不可達：從 unpaid 回 paid 只有 acc gate（both）可走；把起點設為孤立節點測 null
    expect(findPath(graph, 'n-ha-002', 'n-zz-none')).toBeNull();
  });
});

describe('routeSteps', () => {
  it('一般路徑步驟文字', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002')!;
    expect(routeSteps(model, graph, path)).toEqual([
      '搭電扶梯上至「測試大廳」',
      '通過測試系統閘門',
    ]);
  });

  it('無障礙路徑步驟文字（含步行合併）', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002', { accessibleOnly: true })!;
    expect(routeSteps(model, graph, path)).toEqual([
      '步行約 5 公尺',
      '搭電梯至「測試大廳」',
      '通過測試系統閘門',
      '步行約 3 公尺',
    ]);
  });
});
