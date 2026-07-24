import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, routeSteps } from '../src/nav';
import { toWorld } from '../src/builder';
import { startNavSession, type NavSessionDeps } from '../src/nav-session';
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
const nodeWorld = (id: string): THREE.Vector3 => {
  const n = graph.nodes.get(id)!;
  return toWorld(n.xy, n.z); // 測試以 explodeFactor=0（實高）運算
};

/** 事件腳本共用起手式：建 R 路線的會話。deps 可覆寫（reducedMotion/pdrSim/stepLength）。 */
function makeSession(startId: string, endId: string,
    over: Partial<NavSessionDeps> = {}, t0 = 1000) {
  const edges = findPath(graph, startId, endId)!;
  const session = startNavSession({
    model, graph, edges, nodeWorld,
    aspect: () => 16 / 9,
    stepLength: () => 0.7,
    reducedMotion: false,
    pdrSim: false,
    ...over,
  }, t0);
  return { edges, session };
}

describe('建構與初始狀態', () => {
  it('空路線建構即 throw（沿 startFollow 行為）', () => {
    expect(() => startNavSession({
      model, graph, edges: [], nodeWorld,
      aspect: () => 16 / 9, stepLength: () => 0.7, reducedMotion: false, pdrSim: false,
    }, 0)).toThrow('空路線無法導航');
  });

  it('initial：nav 文案＋emphasis＋梯前 transition（R1 首段電扶梯）', () => {
    const { edges, session } = makeSession('n-pl-001', 'n-ha-002');
    const o = session.initial;
    expect(o.emphasisFloor).toBe('plat-b2');
    expect(o.nav).toMatchObject({
      next: `下一步：${routeSteps(model, graph, edges)[0]}`,
      progress: '進度 1/3',
      arrived: false,
      transition: '搭電扶梯上行，前往「B1 測試大廳」',
    });
    expect(o.speech).toBeUndefined(); // 入場不播報
    expect(session.frame(1000).markerPos.distanceTo(nodeWorld('n-pl-001'))).toBeLessThan(1e-6);
  });
});

describe('手動推進/退回', () => {
  it('advanceRequested：游標前進、文案/語音/進度更新', () => {
    const { edges, session } = makeSession('n-pl-001', 'n-ha-002');
    const o = session.handle({ type: 'advanceRequested' }, 2000);
    expect(o.emphasisFloor).toBe('hall-b1');
    expect(o.nav).toMatchObject({
      next: `下一步：${routeSteps(model, graph, edges.slice(1))[0]}`,
      progress: '進度 2/3',
      arrived: false,
      transition: null, // 過梯後下一段是 gate，非垂直段
    });
    expect(o.speech).toBe(o.nav!.next);
  });

  it('推進到底：arrived 文案與語音、remain 清空', () => {
    const { session } = makeSession('n-pl-001', 'n-ha-002');
    session.handle({ type: 'advanceRequested' }, 2000);
    const o = session.handle({ type: 'advanceRequested' }, 3000);
    expect(o.nav).toMatchObject({
      next: '已抵達目的地', remain: '', progress: '進度 3/3', arrived: true,
    });
    expect(o.speech).toBe('已抵達目的地');
    // 越界推進夾住（advance clamp）
    const o2 = session.handle({ type: 'advanceRequested' }, 4000);
    expect(o2.nav!.progress).toBe('進度 3/3');
  });

  it('backRequested：退回、不播語音', () => {
    const { session } = makeSession('n-pl-001', 'n-ha-002');
    session.handle({ type: 'advanceRequested' }, 2000);
    const o = session.handle({ type: 'backRequested' }, 3000);
    expect(o.nav!.progress).toBe('進度 1/3');
    expect(o.speech).toBeUndefined();
    // 到底夾住
    const o2 = session.handle({ type: 'backRequested' }, 4000);
    expect(o2.nav!.progress).toBe('進度 1/3');
  });
});

describe('滑行佇列（glide queue）', () => {
  it('advanceRequested 產生等速滑行：中途在兩節點之間、足時後到位', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002'); // R3: walk 3m → elevator
    session.handle({ type: 'advanceRequested' }, 1000);
    const mid = session.frame(1500).markerPos; // 3m/3(m/s)=1000ms，夾 600ms 下限 → 取 1000ms
    expect(mid.distanceTo(nodeWorld('n-ha-001'))).toBeGreaterThan(0.1);
    expect(mid.distanceTo(nodeWorld('n-ha-003'))).toBeGreaterThan(0.1);
    const done = session.frame(12000).markerPos;
    expect(done.distanceTo(nodeWorld('n-ha-003'))).toBeLessThan(1e-6);
  });

  it('滑行中再推進＝快轉：新滑行自前段終點出發，無斜切', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002');
    session.handle({ type: 'advanceRequested' }, 1000);
    session.handle({ type: 'advanceRequested' }, 1100); // 前段未完
    const p = session.frame(1150).markerPos; // 新段 50ms/2500ms——仍貼近 n-ha-003
    expect(p.distanceTo(nodeWorld('n-ha-003'))).toBeLessThan(1.0);
  });

  it('backRequested 取消滑行：frame 立即回節點位置', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002');
    session.handle({ type: 'advanceRequested' }, 1000);
    session.handle({ type: 'backRequested' }, 1100);
    expect(session.frame(1101).markerPos.distanceTo(nodeWorld('n-ha-001'))).toBeLessThan(1e-6);
  });

  it('reducedMotion：免滑行直接到位', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002', { reducedMotion: true });
    session.handle({ type: 'advanceRequested' }, 1000);
    expect(session.frame(1001).markerPos.distanceTo(nodeWorld('n-ha-003'))).toBeLessThan(1e-6);
  });
});
