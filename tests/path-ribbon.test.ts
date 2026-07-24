import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ribbonGeometry } from '../src/path';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

describe('ribbonGeometry 水平平帶（問題1：箭頭不再繞管半隱）', () => {
  it('直線 run：頂點等高、帶寬正確、UV 按弧長/interval 縮放', () => {
    const curve = new THREE.CatmullRomCurve3([v(0, 5, 0), v(10, 5, 0), v(20, 5, 0)]);
    const geo = ribbonGeometry(curve, 16, 1.8, 5);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i), `y[${i}]`).toBeCloseTo(5, 5);
    for (let i = 0; i < pos.count; i += 2) {
      const dx = pos.getX(i) - pos.getX(i + 1);
      const dz = pos.getZ(i) - pos.getZ(i + 1);
      expect(Math.hypot(dx, dz), `width[${i}]`).toBeCloseTo(1.8, 4);
    }
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    expect(uv.getX(uv.count - 1)).toBeCloseTo(20 / 5, 1); // 末端 u≈總長/interval
    expect(uv.getY(0)).toBe(0); // v 橫跨帶寬 0→1
    expect(uv.getY(1)).toBe(1);
  });

  it('轉彎 run：所有頂點仍等高（up 恆為世界 +Y，無 Frenet 扭轉）', () => {
    const curve = new THREE.CatmullRomCurve3([v(0, 3, 0), v(10, 3, 0), v(10, 3, 10)]);
    const geo = ribbonGeometry(curve, 24, 1.8, 5);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) expect(pos.getY(i), `y[${i}]`).toBeCloseTo(3, 5);
  });
});
