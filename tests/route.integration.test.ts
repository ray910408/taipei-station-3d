import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, listLandmarks, routeFloors, routeSteps, type GraphEdge, type NavGraph } from '../src/nav';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import bc from '../data/floors/mrt-bl-concourse-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import bp from '../data/floors/mrt-bl-platform-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(stationDoc, {
  'floors/tra-concourse-b1.json': tc,
  'floors/tra-platform-b2.json': tp,
  'floors/mrt-bl-concourse-b2.json': bc,
  'floors/mrt-r-concourse-b3.json': rc,
  'floors/mrt-bl-platform-b3.json': bp,
  'floors/mrt-r-platform-b4.json': rp,
}, connectorsDoc);
const graph = buildGraph(model);

describe('真實資料 demo 路徑（Phase 3：終點延伸至臺鐵第4月台）', () => {
  const demo = { start: 'n-rp-003', end: 'n-tp-002' };

  it('一般路徑存在：出捷運閘門、進臺鐵轉乘閘門、經 rctp 轉乘設施上月台', () => {
    const path = findPath(graph, demo.start, demo.end);
    expect(path).not.toBeNull();
    expect(path!.filter((e) => e.kind === 'gate').length).toBeGreaterThanOrEqual(2);
    expect(path!.some((e) => e.connector?.includes('rctp'))).toBe(true);
    expect(path![path!.length - 1].to).toBe('n-tp-002');
  });

  it('無障礙路徑全程 accessible：電梯上月台、走無障礙轉乘閘門', () => {
    const path = findPath(graph, demo.start, demo.end, { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.connector === 'c-elv-rctp-1')).toBe(true);
    expect(path!.some((e) => e.gate === 'g-rc-tra-acc')).toBe(true);
  });

  it('第3月台亦可達（無障礙）', () => {
    const path = findPath(graph, demo.start, 'n-tp-004', { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.some((e) => e.connector === 'c-elv-rctp-2')).toBe(true);
  });

  it('B4 → B1 臺鐵付費區（次要路線）仍可達，含無障礙（島內經寬閘門節點）', () => {
    expect(findPath(graph, 'n-rp-003', 'n-tc-003')).not.toBeNull();
    const acc = findPath(graph, 'n-rp-003', 'n-tc-003', { accessibleOnly: true });
    expect(acc).not.toBeNull();
    expect(acc!.every((e) => e.accessible)).toBe(true);
  });

  it('文字步驟含搭電梯上至月台層、末步為步行', () => {
    const steps = routeSteps(model, graph, findPath(graph, demo.start, demo.end, { accessibleOnly: true })!);
    expect(steps.some((s) => s.includes('搭電梯上至「臺鐵/高鐵月台層」'))).toBe(true);
    expect(steps[steps.length - 1]).toMatch(/^步行約 \d+ 公尺$/);
  });
});

describe('B1 東剪票口出站閘門（QA ISSUE-004）', () => {
  it('付費島→東剪票口外走出站閘門（單一 gate 邊）', () => {
    const path = findPath(graph, 'n-tc-003', 'n-tc-002')!;
    expect(path.map((e) => e.kind)).toEqual(['gate']);
    expect(path[0].gate).toBe('g-tc-tra-out-e');
  });
});

describe('B1↔B2 直達梯群（QA ISSUE-003）', () => {
  it('B1 東剪票口外→第4月台不再繞 B3', () => {
    const path = findPath(graph, 'n-tc-002', 'n-tp-002')!;
    const floors = path.map((e) => graph.nodes.get(e.to)!.floor);
    expect(floors).not.toContain('mrt-r-concourse-b3');
    expect(path.some((e) => e.connector?.includes('tptc'))).toBe(true);
  });

  it('無障礙：B1 付費島→第3月台走 B1 電梯，全程 accessible', () => {
    const path = findPath(graph, 'n-tc-003', 'n-tp-004', { accessibleOnly: true })!;
    expect(path.every((e) => e.accessible)).toBe(true);
    expect(path.some((e) => e.connector === 'c-elv-tptc-2')).toBe(true);
  });
});

describe('板南線轉乘驗收（spec 2026-07-30 三判準；上上下拓撲）', () => {
  const lm = listLandmarks(model);
  const idOf = (label: string) => {
    const hit = lm.find((l) => l.label === label);
    if (!hit) throw new Error(`地標不存在：${label}`);
    return hit.id;
  };
  // 圖手術：複製 adj 後剔除指定連通器的邊，驗證「另一條真實路徑存在」
  const without = (pred: (e: GraphEdge) => boolean): NavGraph => ({
    nodes: graph.nodes,
    adj: new Map([...graph.adj].map(([k, es]) => [k, es.filter((e) => !pred(e))])),
  });

  it('判準1：紅線月台→板南線月台全程不出閘門，行經板南線大廳（上上下）', () => {
    const path = findPath(graph, 'n-rp-002', idOf('板南線月台（往南港展覽館）'))!;
    expect(path).not.toBeNull();
    expect(path.every((e) => e.kind !== 'gate')).toBe(true);
    expect(routeFloors(graph, path)).toEqual([
      'mrt-r-platform-b4',
      'mrt-r-concourse-b3',
      'mrt-bl-concourse-b2',
      'mrt-bl-platform-b3',
    ]);
  });

  it('判準2a：臺鐵月台→板南線月台，封 B1 連通道仍可達（B3 轉乘閘門路徑存在）', () => {
    const g2 = without((e) => (e.connector ?? '').includes('bctc'));
    const path = findPath(g2, 'n-tp-001', idOf('板南線月台（往頂埔）'))!;
    expect(path).not.toBeNull();
    expect(path.some((e) => e.kind === 'gate')).toBe(true);
    expect(routeFloors(g2, path)).toContain('mrt-r-concourse-b3');
  });

  it('判準2b：封紅線大廳↔板南線大廳垂直鏈，仍可經 B1→bc 進閘可達', () => {
    const g2 = without((e) => /rcbc|rpbc/.test(e.connector ?? ''));
    const path = findPath(g2, 'n-tp-001', idOf('板南線月台（往頂埔）'))!;
    expect(path).not.toBeNull();
    expect(path.some((e) => e.kind === 'gate')).toBe(true);        // 必經 bc 閘門
    expect(path.some((e) => (e.gate ?? '').startsWith('g-bc-link-'))).toBe(true);
    const floors = routeFloors(g2, path);
    expect(floors).toContain('tra-concourse-b1');                  // 走 B1 連通道
    expect(floors).toContain('mrt-bl-concourse-b2');
  });

  it('判準3：紅線月台起點有純電梯無障礙路徑', () => {
    const path = findPath(graph, 'n-rp-002', idOf('板南線月台（往南港展覽館）'), { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.every((e) => e.kind !== 'escalator' && e.kind !== 'stair')).toBe(true);
  });

  it('判準3a：封 B3 垂直鏈（rcbc|rpbc），無障礙必走 B1 鏈', () => {
    const g2 = without((e) => /rcbc|rpbc/.test(e.connector ?? ''));
    const path = findPath(g2, 'n-tp-001', idOf('板南線月台（往頂埔）'), { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.connector === 'c-elv-bctc-1')).toBe(true);
    expect(path!.some((e) => (e.gate ?? '').startsWith('g-bc-link-'))).toBe(true);
    expect(path!.some((e) => e.connector === 'c-elv-bpbc-1')).toBe(true);
  });

  it('判準3b：封 B1 鏈（bctc），無障礙必走 B3 鏈', () => {
    const g2 = without((e) => (e.connector ?? '').includes('bctc'));
    const path = findPath(g2, 'n-tp-001', idOf('板南線月台（往頂埔）'), { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.connector === 'c-elv-rpbc-1')).toBe(true);
    expect(path!.some((e) => e.connector === 'c-elv-bpbc-1')).toBe(true);
  });
});
