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

describe('真實資料 demo 路徑', () => {
  const demo = model.station.demo!;

  it('station.demo 已設定為 B4 月台中段 → B3 臺鐵轉乘閘門內', () => {
    expect(demo).toEqual({ start: 'n-rp-003', end: 'n-rc-006' });
  });

  it('一般路徑存在：電扶梯上樓、出捷運閘門、進臺鐵轉乘閘門', () => {
    const path = findPath(graph, demo.start, demo.end);
    expect(path).not.toBeNull();
    expect(path!.some((e) => e.kind === 'escalator')).toBe(true);
    expect(path!.filter((e) => e.kind === 'gate').length).toBeGreaterThanOrEqual(2);
    expect(path![path!.length - 1].to).toBe('n-rc-006');
  });

  it('無障礙路徑存在且全程 accessible（電梯 + 無障礙閘門）', () => {
    const path = findPath(graph, demo.start, demo.end, { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.kind === 'elevator')).toBe(true);
  });

  it('B4 → B1 臺鐵付費區（次要路線）可達', () => {
    const path = findPath(graph, 'n-rp-003', 'n-tc-003');
    expect(path).not.toBeNull();
  });

  it('文字步驟數量合理且首步為步行', () => {
    const steps = routeSteps(model, graph, findPath(graph, demo.start, demo.end)!);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0]).toMatch(/^步行約 \d+ 公尺$/);
  });
});
