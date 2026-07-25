import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPositionMarker, headingYaw, lerpYaw } from '../src/follow';
import { THEME } from '../src/theme';

describe('headingYaw 前後幀差分（問題3：箭頭指向前進方向）', () => {
  it('沿 +X 移動 → yaw=π/2；沿 +Z → yaw=0', () => {
    expect(headingYaw(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0))).toBeCloseTo(Math.PI / 2, 5);
    expect(headingYaw(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 2))).toBeCloseTo(0, 5);
  });
  it('水平位移 < 1mm → null（保持原朝向）', () => {
    expect(headingYaw(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.0005, 0, 0))).toBeNull();
  });
  it('y 位移不影響（只看水平分量）', () => {
    expect(headingYaw(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 5, 1))).toBeCloseTo(0, 5);
  });
});

describe('lerpYaw wrap-aware 平滑', () => {
  it('跨 ±π 走最短弧：3 → -3 往正向繞', () => {
    expect(lerpYaw(3, -3, 0.5)).toBeGreaterThan(3);
  });
  it('k=1 直接到位（reduced-motion）', () => {
    expect(lerpYaw(0, Math.PI / 2, 1)).toBeCloseTo(Math.PI / 2, 5);
  });
});

describe('buildPositionMarker 箭頭型指標（問題4：不被路線擋）', () => {
  it('所有 mesh 的所有材質：depthTest/depthWrite 關、transparent 開；本體 renderOrder ≥ 10', () => {
    const g = buildPositionMarker();
    let checked = 0;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (mesh.name !== 'marker-shadow') expect(mesh.renderOrder).toBeGreaterThanOrEqual(10);
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        expect((m as THREE.Material).depthTest).toBe(false);
        expect((m as THREE.Material).depthWrite).toBe(false);
        // 全員 transparent＝同在 transparent pass，renderOrder 才是唯一畫序（陰影在本體之下的前提）
        expect((m as THREE.Material).transparent).toBe(true);
        checked++;
      }
    });
    expect(checked).toBeGreaterThanOrEqual(4); // 箭頭雙材質＋圓環＋陰影盤
  });

  it('接觸陰影盤：貼路線平面、renderOrder 低於本體——影在下、本體在上', () => {
    const g = buildPositionMarker();
    const shadow = g.getObjectByName('marker-shadow') as THREE.Mesh;
    expect(shadow?.isMesh).toBe(true);
    expect(shadow.position.y).toBeLessThan(0.1); // 貼平面（懸浮線索來自與本體的分離）
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === 'marker-shadow') return;
      expect(shadow.renderOrder).toBeLessThan(mesh.renderOrder);
    });
  });

  it('QA2-1 修訂：本體 mesh 最低點 ≥ markerLift——明顯懸浮於路線平面之上，非貼齊', () => {
    expect(THEME.route.markerLift).toBeGreaterThan(0);
    const g = buildPositionMarker();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || mesh.name === 'marker-shadow') return; // 陰影盤刻意貼平面
      mesh.geometry.computeBoundingBox();
      const bb = mesh.geometry.boundingBox!;
      // rotation.x=π/2 後 local z → world -y：world 最低點 = position.y - bb.max.z（旋轉者）或 position.y + bb.min.y
      const rotated = Math.abs(mesh.rotation.x) > 1e-6;
      const worldMinY = rotated ? mesh.position.y - bb.max.z : mesh.position.y + bb.min.y;
      expect(worldMinY).toBeGreaterThanOrEqual(THEME.route.markerLift);
    });
  });
});
