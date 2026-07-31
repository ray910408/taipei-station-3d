import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, routeSteps, listLandmarks, sameEndpointMessage } from '../src/nav';
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

  it('垂直邊 cost 含轉乘懲罰、length 為幾何長（cost/length 拆分）', () => {
    const esc = (graph.adj.get('n-pl-001') ?? []).find((e) => e.kind === 'escalator')!;
    expect(esc.cost).toBeCloseTo(5 + 20, 6);
    expect(esc.length).toBeCloseTo(5, 6);
    const elv = (graph.adj.get('n-pl-002') ?? []).find((e) => e.kind === 'elevator')!;
    expect(elv.cost).toBeCloseTo(Math.hypot(5, 3, 5) + 40, 6);
    expect(elv.length).toBeCloseTo(Math.hypot(5, 3, 5), 6);
  });
});

describe('findPath', () => {
  it('起訖同點回傳空陣列（非 null）——main.ts 防呆依賴此契約', () => {
    expect(findPath(graph, 'n-pl-001', 'n-pl-001')).toEqual([]);
  });

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
      '搭電梯上至「測試大廳」',
      '通過測試系統閘門',
      '步行約 3 公尺',
    ]);
  });
});

describe('nav node name / listLandmarks', () => {
  it('buildGraph 保留節點中文名', () => {
    expect(graph.nodes.get('n-ha-002')?.name).toBe('測試出口');
    expect(graph.nodes.get('n-pl-001')?.name).toBeUndefined();
  });

  it('listLandmarks 僅列具名節點，依樓層順序', () => {
    const lm = listLandmarks(model);
    expect(lm).toHaveLength(1);
    expect(lm[0]).toMatchObject({ floor: 'hall-b1', id: 'n-ha-002', label: '測試出口' });
    expect(lm[0].floorLabel).toContain('測試大廳');
  });
});

describe('sameEndpointMessage', () => {
  it('同點回訊息、異點回 null', () => {
    expect(sameEndpointMessage('a', 'a')).toBe('起點與終點相同，請選擇不同地標');
    expect(sameEndpointMessage('a', 'b')).toBeNull();
  });
});

describe('routeSteps 縫合邊', () => {
  const seamStation = {
    schema: 'station@1', id: 'seam-station', name: { zh: '縫合測試站' },
    frame: { units: 'm', origin_note: 't', axis_note: 't' },
    systems: { test: { name: { zh: '測試系統' }, color: '#888888' } },
    floors: [
      { id: 'rc-b3', short: 'rc', file: 'floors/rc-b3.json', name: { zh: '紅線大廳層' },
        labels: { complex: 'B3' }, elevation: -9, height: 3, estimated: true },
      { id: 'bp-b3', short: 'bp', file: 'floors/bp-b3.json', name: { zh: '板南線月台層' },
        labels: { complex: 'BL3' }, elevation: -9, height: 3, estimated: true },
    ],
  };
  const rcFloor = {
    schema: 'floor@1', id: 'rc-b3',
    slab: { outline: [[-10, -5], [10, -5], [10, 5], [-10, 5]], source: 's', confidence: 5 },
    nav: { nodes: [{ id: 'n-rc-001', xy: [0, 0], name: { zh: '紅廳' } }], edges: [] },
  };
  const bpFloor = {
    schema: 'floor@1', id: 'bp-b3',
    slab: { outline: [[10, -5], [30, -5], [30, 5], [10, 5]], source: 's', confidence: 5 },
    nav: {
      nodes: [
        { id: 'n-bp-001', xy: [20, 0], name: { zh: '板月台' } },
        { id: 'n-bp-002', xy: [25, 0] },
      ],
      edges: [
        { from: 'n-bp-001', to: 'n-rc-001', kind: 'walk' },   // 縫合邊（新檔持縫）
        { from: 'n-bp-001', to: 'n-bp-002', kind: 'walk' },
      ],
    },
  };
  const m = assembleModel(
    seamStation as any,
    { 'floors/rc-b3.json': rcFloor as any, 'floors/bp-b3.json': bpFloor as any },
    { schema: 'connectors@1', connectors: [] } as any,
  );
  const g = buildGraph(m);

  it('過縫切步驟邊界並唸目的樓層', () => {
    const path = findPath(g, 'n-rc-001', 'n-bp-002')!;
    expect(routeSteps(m, g, path)).toEqual([
      '步行約 20 公尺',
      '進入「板南線月台層」',
      '步行約 5 公尺',
    ]);
  });

  it('反向過縫唸另一層；縫合邊長度累進界前的步行段', () => {
    // 規則：過縫邊自身長度先累進 walk、再 flush、再唸進入——
    // bp-002→bp-001 5m（同層）＋ bp-001→rc-001 20m（縫合邊）＝ 25m 一次 flush
    const back = findPath(g, 'n-bp-002', 'n-rc-001')!;
    expect(routeSteps(m, g, back)).toEqual([
      '步行約 25 公尺',
      '進入「紅線大廳層」',
    ]);
  });
});
