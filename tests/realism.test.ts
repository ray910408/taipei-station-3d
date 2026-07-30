import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildConnectorsGroup, buildStationGroup } from '../src/builder';
import type { StationModel } from '../src/types';

// 與 connectors.test.ts 同構的最小 fixture：a(0m) ↔ b(-8m)，行進向 +x（run 8m）
function fixture(kind: 'escalator' | 'stair'): StationModel {
  return {
    station: { schema: 'station@1', id: 't', name: { zh: 't' },
      frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
      floors: [
        { id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: 0, height: 4, estimated: true },
        { id: 'b', short: 'b', file: '', name: { zh: 'b' }, labels: {}, elevation: -8, height: 4, estimated: true },
      ] },
    floors: new Map([
      ['a', { schema: 'floor@1', id: 'a', slab: { outline: [[0, 0], [1, 0], [1, 1]], source: 's', confidence: 2 },
        nav: { nodes: [{ id: 'n-aa-1', xy: [10, 10] }, { id: 'n-aa-2', xy: [20, 10] }], edges: [{ from: 'n-aa-1', to: 'n-aa-2', kind: 'walk' }] } }],
      ['b', { schema: 'floor@1', id: 'b', slab: { outline: [[0, 0], [1, 0], [1, 1]], source: 's', confidence: 2 },
        nav: { nodes: [{ id: 'n-bb-1', xy: [10, 10] }], edges: [] } }],
    ]),
    connectors: [{ id: `c-${kind}-ab-1`, kind, system: 't', direction: 'up', accessible: true,
      levels: [{ floor: 'a', node: 'n-aa-1' }, { floor: 'b', node: 'n-bb-1' }], source: 's', confidence: 2 }],
  } as unknown as StationModel;
}

function runMesh(kind: 'escalator' | 'stair', detail = true): THREE.Mesh {
  return buildConnectorsGroup(fixture(kind), () => 0, detail)
    .children.find((o) => (o as THREE.Mesh).userData.kind === `connector-${kind}`) as THREE.Mesh;
}

describe('樓梯/手扶梯寫實幾何（runGeometry）', () => {
  it('樓梯＝合併踏步幾何（非單一 box），且 bbox 縱跨全落差', () => {
    const m = runMesh('stair');
    expect(m.geometry.type).not.toBe('BoxGeometry');
    // rise 8m / 階高 0.16 ≈ 50 階＋斜封板，遠多於單一 box 的 24 頂點
    expect(m.geometry.attributes.position.count).toBeGreaterThan(500);
    const bb = new THREE.Box3().setFromObject(m);
    expect(bb.getSize(new THREE.Vector3()).y).toBeGreaterThanOrEqual(8);
  });

  it('手扶梯比樓梯窄（1.2 vs 1.4），且側裙帶頂高於樓梯頂', () => {
    const esc = new THREE.Box3().setFromObject(runMesh('escalator'));
    const stair = new THREE.Box3().setFromObject(runMesh('stair'));
    // 行進向 +x → 寬度落在 z 軸
    expect(esc.getSize(new THREE.Vector3()).z).toBeCloseTo(1.2, 5);
    expect(stair.getSize(new THREE.Vector3()).z).toBeCloseTo(1.4, 5);
    expect(esc.max.y).toBeGreaterThan(stair.max.y);
  });

  it('detail=false（爆炸動畫幀）退回單一斜板 box', () => {
    expect(runMesh('stair', false).geometry.type).toBe('BoxGeometry');
  });

  it('mesh.position 仍為位移後中點（builder.test 契約的細節幾何版）', () => {
    const m = runMesh('stair');
    // lo=(10,-8,-10)、hi=n-aa-1 沿 +x 位移 run 8 → (18,0,-10)；中點 (14,-4,-10)
    expect(m.position.x).toBeCloseTo(14, 5);
    expect(m.position.y).toBeCloseTo(-4, 5);
    expect(m.position.z).toBeCloseTo(-10, 5);
  });
});

describe('軌道鋼軌與閘門櫃體', () => {
  const model = {
    station: { schema: 'station@1', id: 't', name: { zh: 't' },
      frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
      floors: [
        { id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: 0, height: 4, estimated: true },
      ] },
    floors: new Map([
      ['a', { schema: 'floor@1', id: 'a', slab: { outline: [[0, 0], [50, 0], [50, 10], [0, 10]], source: 's', confidence: 2 },
        areas: [
          { kind: 'track', system: 't', polygon: [[0, 0], [40, 0], [40, 4], [0, 4]], source: 's', confidence: 2 },
          // 月台緊貼軌道北側（共邊 y=4）——警戒帶應沿該邊內縮生成
          { kind: 'platform', system: 't', polygon: [[0, 4], [40, 4], [40, 10], [0, 10]], source: 's', confidence: 2 },
        ],
        gates: [{ id: 'g1', line: [[10, 10], [10, 12]], accessible: false, source: 's', confidence: 2 }] }],
    ]),
    connectors: [],
  } as unknown as StationModel;
  const floorGroup = buildStationGroup(model).children.find((c) => c.name === 'a') as THREE.Group;

  it('軌道溝內鋪出兩根標準軌距鋼軌（全層合併單 mesh）', () => {
    const rails = floorGroup.children.filter((c) => c.userData.kind === 'rail');
    expect(rails.length).toBe(1);
    const bb = new THREE.Box3().setFromObject(rails[0]);
    const size = bb.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(40, 5); // 沿軌道溝長軸
    expect(size.z).toBeCloseTo(1.435 + 2 * 0.07, 5); // 軌距量的是內側面，外緣寬＝軌距＋兩倍軌寬
    expect(bb.max.y).toBeLessThan(0); // 沉在軌道溝內，低於樓板面
  });

  it('鄰軌道的月台長邊生出內縮警戒帶；不鄰軌道的邊沒有', () => {
    const strips = floorGroup.children.filter((c) => c.userData.kind === 'platform-edge');
    expect(strips.length).toBe(1);
    const bb = new THREE.Box3().setFromObject(strips[0]);
    const size = bb.getSize(new THREE.Vector3());
    expect(size.x).toBeCloseTo(40, 5); // 僅共邊那條，另外三邊不生
    expect(size.z).toBeCloseTo(0.4, 5);
    // 共邊 y=4，內縮 0.45 往月台側（+y）→ world z = -(4+0.45)
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(-4.45, 5);
  });

  it('月台邊與軌道邊共線但區間零重疊——不生警戒帶', () => {
    const noOverlapModel = {
      station: { schema: 'station@1', id: 't', name: { zh: 't' },
        frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
        floors: [
          { id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: 0, height: 4, estimated: true },
        ] },
      floors: new Map([
        ['a', { schema: 'floor@1', id: 'a', slab: { outline: [[0, 0], [90, 0], [90, 10], [0, 10]], source: 's', confidence: 2 },
          areas: [
            { kind: 'track', system: 't', polygon: [[0, 0], [40, 0], [40, 4], [0, 4]], source: 's', confidence: 2 },
            // 與軌道支撐線共線（y=4），但 x 區間 [50,90] 對 [0,40] 零重疊
            { kind: 'platform', system: 't', polygon: [[50, 4], [90, 4], [90, 10], [50, 10]], source: 's', confidence: 2 },
          ] }],
      ]),
      connectors: [],
    } as unknown as StationModel;
    const g = buildStationGroup(noOverlapModel).children.find((c) => c.name === 'a') as THREE.Group;
    expect(g.children.filter((c) => c.userData.kind === 'platform-edge').length).toBe(0);
  });

  it('月台邊與軌道邊部分重疊——警戒帶僅鋪重疊段', () => {
    const partialOverlapModel = {
      station: { schema: 'station@1', id: 't', name: { zh: 't' },
        frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
        floors: [
          { id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: 0, height: 4, estimated: true },
        ] },
      floors: new Map([
        ['a', { schema: 'floor@1', id: 'a', slab: { outline: [[0, 0], [70, 0], [70, 10], [0, 10]], source: 's', confidence: 2 },
          areas: [
            { kind: 'track', system: 't', polygon: [[0, 0], [40, 0], [40, 4], [0, 4]], source: 's', confidence: 2 },
            // 月台 x∈[30,70] 與軌道 x∈[0,40] 只有 [30,40] 重疊
            { kind: 'platform', system: 't', polygon: [[30, 4], [70, 4], [70, 10], [30, 10]], source: 's', confidence: 2 },
          ] }],
      ]),
      connectors: [],
    } as unknown as StationModel;
    const g = buildStationGroup(partialOverlapModel).children.find((c) => c.name === 'a') as THREE.Group;
    const strips = g.children.filter((c) => c.userData.kind === 'platform-edge');
    expect(strips.length).toBe(1);
    const bb = new THREE.Box3().setFromObject(strips[0]);
    expect(bb.min.x).toBeCloseTo(30, 5);
    expect(bb.max.x).toBeCloseTo(40, 5);
    expect((bb.min.z + bb.max.z) / 2).toBeCloseTo(-4.45, 5);
  });

  it('閘門柱＝沿通行向拉長的櫃體，且對齊閘門線朝向', () => {
    const posts = floorGroup.children.filter((c) =>
      c.userData.kind === 'gate' && (c as THREE.Mesh).geometry.type === 'BoxGeometry'
      && ((c as THREE.Mesh).geometry as THREE.BoxGeometry).parameters.depth > 1);
    expect(posts.length).toBe(2);
    // 閘門線沿 data +y → world -z；yaw = atan2(2, 0) = π/2
    for (const p of posts) expect(Math.abs(p.rotation.y)).toBeCloseTo(Math.PI / 2, 5);
  });
});
