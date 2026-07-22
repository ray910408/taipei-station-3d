import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildFloorEdges } from '../src/builder';

describe('buildFloorEdges：slab 外框＋area 邊界合併亮線', () => {
  it('回傳單一 LineSegments，含 slab 與 area 的邊', () => {
    const slab = { outline: [[0, 0], [10, 0], [10, 10], [0, 10]] as [number, number][] };
    const areas = [{ polygon: [[2, 2], [6, 2], [6, 6], [2, 6]] as [number, number][] }];
    const line = buildFloorEdges(slab, areas, -8);
    expect(line).toBeInstanceOf(THREE.LineSegments);
    expect(line!.userData.kind).toBe('edges');
    // 薄 extrude 的 EdgesGeometry 保留完整箱體 12 邊（上4＋下4＋豎4，均為真實 90° 夾角）：
    // slab（矩形箱 12 邊）＋ area（矩形箱 12 邊）＝ 24 邊 × 2 端點 = 48（實測鎖定，非佔位）
    expect(line!.geometry.getAttribute('position').count).toBe(48);
  });

  it('有 slab 即回傳非 null', () => {
    expect(buildFloorEdges({ outline: [[0, 0], [1, 0], [1, 1]] }, [], 0)).not.toBeNull();
  });
});
