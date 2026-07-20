import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { frameGoal, chaseGoal, CHASE_BACK, CHASE_UP } from '../src/camera';

describe('frameGoal', () => {
  it('target=點集中心、距離=半徑*1.3/tan(fov/2)（含最小半徑 12）', () => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
    const g = frameGoal(pts, 1, 55);
    expect(g.target.x).toBeCloseTo(5, 5);
    // r=5 < 最小 12 → 用 12
    const expected = (12 * 1.3) / Math.tan(THREE.MathUtils.degToRad(55) / 2);
    expect(g.pos.distanceTo(g.target)).toBeCloseTo(expected, 3);
  });
  it('寬 aspect 用垂直 fov、窄 aspect 用水平 fov（取較小者）', () => {
    const pts = [new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)];
    expect(frameGoal(pts, 0.5, 55).pos.distanceTo(new THREE.Vector3(0, 0, 0)))
      .toBeGreaterThan(frameGoal(pts, 2, 55).pos.distanceTo(new THREE.Vector3(0, 0, 0)));
  });
});

describe('chaseGoal', () => {
  it('相機在 marker 後上方、注視前方 8m', () => {
    const g = chaseGoal(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
    expect(g.pos.x).toBeCloseTo(-CHASE_BACK, 5);
    expect(g.pos.y).toBeCloseTo(CHASE_UP, 5);
    expect(g.target.x).toBeCloseTo(8, 5);
  });
  it('下一點與 marker 重合時朝 -z 保底', () => {
    const g = chaseGoal(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, 3));
    expect(g.pos.z).toBeCloseTo(3 + CHASE_BACK, 5);
  });
});
