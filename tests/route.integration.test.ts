import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, routeSteps } from '../src/nav';
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

describe('真實資料 demo 路徑（Phase 3：終點延伸至臺鐵第4月台）', () => {
  const demo = model.station.demo!;

  it('station.demo 為 B4 月台中段 → B2 第4月台候車點', () => {
    expect(demo).toEqual({ start: 'n-rp-003', end: 'n-tp-002' });
  });

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
