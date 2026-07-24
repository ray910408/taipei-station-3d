import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPositionMarker, headingYaw, lerpYaw } from '../src/follow';

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
  it('所有 mesh 的所有材質：depthTest/depthWrite 關、renderOrder ≥ 10', () => {
    const g = buildPositionMarker();
    let checked = 0;
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      expect(mesh.renderOrder).toBeGreaterThanOrEqual(10);
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) {
        expect((m as THREE.Material).depthTest).toBe(false);
        expect((m as THREE.Material).depthWrite).toBe(false);
        checked++;
      }
    });
    expect(checked).toBeGreaterThanOrEqual(3); // 箭頭雙材質＋圓環
  });
});
