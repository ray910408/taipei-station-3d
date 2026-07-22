import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import { THEME } from '../src/theme';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);
const group = buildStationGroup(model);

function findByKind(kind: string): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  group.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh && o.userData.kind === kind) found = o as THREE.Mesh;
  });
  if (!found) throw new Error(`找不到 kind=${kind}`);
  return found;
}

describe('材質響應（去塑膠 T2）', () => {
  it('不透明材質 roughness 讀 THEME.materials.roughness', () => {
    const slab = findByKind('slab');
    const [cap] = slab.material as THREE.MeshStandardMaterial[];
    expect(cap.roughness).toBe(THEME.materials.roughness);
    expect(THEME.materials.roughness).toBeLessThan(1);
  });

  it('半透明材質 depthWrite=false、不透明維持 true', () => {
    // shell 自 Task 3（程序化周界牆帶）起改為 opaque massHeight 牆帶，不再半透明——
    // 改用仍為半透明的 elevator connector 驗證同一 mat() 分支。
    const elevator = findByKind('connector-elevator');
    const m = elevator.material as THREE.MeshStandardMaterial;
    expect(m.transparent).toBe(true);
    expect(m.depthWrite).toBe(false);
    const slab = findByKind('slab');
    const [cap] = slab.material as THREE.MeshStandardMaterial[];
    expect(cap.depthWrite).toBe(true);
  });
});
