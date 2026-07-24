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

describe('相機意圖（QA0723 事件腳本）', () => {
  it('QA0723-1/2/3：入場梯前全景框 connector 兩端；接管→null；回正→恢復', () => {
    const { session } = makeSession('n-pl-001', 'n-ha-002'); // R1 首段電扶梯
    const g = session.frame(1000).cameraGoal;
    expect(g).not.toBeNull(); // 入場即有 goal——不卡死（QA0723-1）
    // 全景框景 target＝兩端中點：pl001(-5,-9,0)、ha001(-5,-4,0) → (-5,-6.5,0)（QA0723-3）
    expect(g!.target.x).toBeCloseTo(-5, 5);
    expect(g!.target.y).toBeCloseTo(-6.5, 5);
    expect(g!.target.z).toBeCloseTo(0, 5);
    session.handle({ type: 'userCameraGrab' }, 1100);
    expect(session.frame(1101).cameraGoal).toBeNull(); // 使用者接管
    session.handle({ type: 'recenterRequested' }, 1200);
    expect(session.frame(1201).cameraGoal).not.toBeNull(); // 回正恢復——不卡死（QA0723-2）
  });

  it('QA0723-4：垂直堆疊搭乘中改瞄出梯方向，不跳北', () => {
    const { session } = makeSession('n-pl-001', 'n-ha-002');
    session.handle({ type: 'advanceRequested' }, 1000); // 搭電扶梯（兩端同 xz）
    const d = session.frame(1100); // 滑行中
    const g = d.cameraGoal!;
    expect(g).not.toBeNull();
    // 出梯方向朝 n-ha-002（+x）：target 在 marker 前方 +x，不是預設北向（-z）
    expect(g.target.x - d.markerPos.x).toBeCloseTo(8, 3);
    expect(Math.abs(g.target.z - d.markerPos.z)).toBeLessThan(1e-3);
  });

  it('水平段 chase：goal 朝下一節點', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002'); // R3 首段 walk（水平）
    const d = session.frame(1000);
    const g = d.cameraGoal!;
    expect(g).not.toBeNull(); // 非垂直段、非 atEnd → chase
    // n-ha-003 在 -z 方向：target.z < marker.z
    expect(g.target.z).toBeLessThan(d.markerPos.z);
  });

  it('抵達後拉：框最後兩節點（reducedMotion 立即路徑）', () => {
    const { session } = makeSession('n-pl-001', 'n-ha-002', { reducedMotion: true });
    session.handle({ type: 'advanceRequested' }, 1000);
    session.handle({ type: 'advanceRequested' }, 2000);
    const g = session.frame(2001).cameraGoal!;
    // 末兩節點 ha001(-5,-4,0)、ha002(2,-4,0) → 中點 (-1.5,-4,0)
    expect(g.target.x).toBeCloseTo(-1.5, 5);
    expect(g.target.y).toBeCloseTo(-4, 5);
  });
});

describe('換層 crossfade', () => {
  it('跨層推進啟動 900ms crossfade，完成後清空', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002'); // R3
    session.handle({ type: 'advanceRequested' }, 1000); // → ha003（同層，無 swap）
    expect(session.frame(1001).floorFades).toEqual([]);
    session.handle({ type: 'advanceRequested' }, 5000);  // → pl002（B1→B2）
    const fades = session.frame(5450).floorFades; // t=0.5
    expect(fades).toHaveLength(2);
    expect(fades[0].floor).toBe('hall-b1');
    expect(fades[0].factor).toBeGreaterThan(1); // from 側起始 1/dim 補償
    expect(fades[1].floor).toBe('plat-b2');
    expect(fades[1].factor).toBeGreaterThan(0);
    expect(fades[1].factor).toBeLessThan(1);
    expect(session.frame(5901).floorFades).toEqual([]); // 完成即清（掉出清單→adapter 還原）
  });

  it('連續換層：前一場未完先收尾（fadeRestore），新場重起', () => {
    const { session } = makeSession('n-ha-001', 'n-pl-002');
    session.handle({ type: 'advanceRequested' }, 1000);
    session.handle({ type: 'advanceRequested' }, 5000); // swap hall→plat 開跑
    const o = session.handle({ type: 'backRequested' }, 5100); // 未完即折返：plat→hall
    expect(o.fadeRestore).toEqual(['hall-b1', 'plat-b2']); // 舊場兩層先還原
    expect(o.emphasisFloor).toBe('hall-b1');
    const fades = session.frame(5101).floorFades;
    expect(fades[0].floor).toBe('plat-b2'); // 新場 from＝plat
    expect(fades[1].floor).toBe('hall-b1');
  });
});
