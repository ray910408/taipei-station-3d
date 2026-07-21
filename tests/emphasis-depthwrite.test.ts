import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import { setFloorEmphasis } from '../src/follow';
import { applyFloorFade } from '../src/navview';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(stationDoc, {
  'floors/tra-concourse-b1.json': b1,
  'floors/tra-platform-b2.json': b2,
  'floors/mrt-r-concourse-b3.json': b3,
  'floors/mrt-r-platform-b4.json': b4,
}, connectorsDoc);

/** 指定樓層內第一個符合 kind 的材質（slab 取 cap slot 0）。 */
function matOf(group: THREE.Group, floorId: string, kind: string): THREE.Material {
  const floor = group.getObjectByName(floorId)!;
  let found: THREE.Material | null = null;
  floor.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!found && mesh.isMesh && o.userData.kind === kind) {
      found = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    }
  });
  if (!found) throw new Error(`找不到 ${floorId}/${kind}`);
  return found;
}

function edgeMat(group: THREE.Group, floorId: string): THREE.Material {
  const floor = group.getObjectByName(floorId)!;
  let found: THREE.Material | null = null;
  floor.traverse((o) => {
    if (!found && o.userData.kind === 'edges') found = (o as THREE.LineSegments).material as THREE.Material;
  });
  if (!found) throw new Error(`找不到 ${floorId}/edges`);
  return found;
}

describe('調暗樓層 depthWrite（終審 Important 防護）', () => {
  it('emphasis 調暗層 depthWrite=false，還原恢復快照（描邊不漂移）', () => {
    const group = buildStationGroup(model);
    const slab = matOf(group, 'tra-concourse-b1', 'slab');
    const shell = matOf(group, 'tra-concourse-b1', 'shell');
    const edges = edgeMat(group, 'tra-concourse-b1');
    expect(slab.depthWrite).toBe(true);
    expect(shell.depthWrite).toBe(false);
    expect(edges.depthWrite).toBe(true); // LineBasicMaterial 原生預設

    setFloorEmphasis(group, 'tra-platform-b2'); // b1 被調暗
    expect(matOf(group, 'tra-concourse-b1', 'slab').depthWrite).toBe(false);
    expect(edgeMat(group, 'tra-concourse-b1').depthWrite).toBe(false);
    expect(matOf(group, 'tra-concourse-b1', 'shell').depthWrite).toBe(false);

    setFloorEmphasis(group, null);
    expect(matOf(group, 'tra-concourse-b1', 'slab').depthWrite).toBe(true);
    expect(edgeMat(group, 'tra-concourse-b1').depthWrite).toBe(true); // 快照還原、不漂移
    expect(matOf(group, 'tra-concourse-b1', 'shell').depthWrite).toBe(false);
  });

  it('fade 疊在 emphasis 上：快照分層、還原鏈一致', () => {
    const group = buildStationGroup(model);
    setFloorEmphasis(group, 'tra-platform-b2'); // b1 dim
    const floor = group.getObjectByName('tra-concourse-b1')!;
    applyFloorFade(floor, 1 / 0.15); // 換層 crossfade 起點：視覺補回全亮
    // 保守策略：fade 期間沿 emphasis 快照（false）——短暫全亮不寫深度可接受
    expect(matOf(group, 'tra-concourse-b1', 'slab').depthWrite).toBe(false);
    applyFloorFade(floor, null); // 收 fade → 回 emphasis 態
    expect(matOf(group, 'tra-concourse-b1', 'slab').depthWrite).toBe(false);
    setFloorEmphasis(group, null); // 收 emphasis → 回基準
    expect(matOf(group, 'tra-concourse-b1', 'slab').depthWrite).toBe(true);
  });
});
