import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeTween, tweenAt, swapFactors, applyFloorFade } from '../src/navview';
import { THEME } from '../src/theme';

describe('marker tween（等速滑行）', () => {
  it('時長 = 距離/速度，夾在 [segMinMs, segMaxMs]', () => {
    const one = makeTween(new THREE.Vector3(), new THREE.Vector3(THEME.nav.markerSpeed, 0, 0), 0);
    expect(one.ms).toBe(1000);
    expect(makeTween(new THREE.Vector3(), new THREE.Vector3(0.01, 0, 0), 0).ms).toBe(THEME.nav.segMinMs);
    expect(makeTween(new THREE.Vector3(), new THREE.Vector3(999, 0, 0), 0).ms).toBe(THEME.nav.segMaxMs);
  });
  it('線性插值、逾時停在終點', () => {
    const tw = makeTween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(THEME.nav.markerSpeed, 0, 0), 0);
    expect(tweenAt(tw, 500).pos.x).toBeCloseTo(THEME.nav.markerSpeed / 2, 5);
    expect(tweenAt(tw, 500).done).toBe(false);
    const end = tweenAt(tw, 2000);
    expect(end.pos.x).toBeCloseTo(THEME.nav.markerSpeed, 5);
    expect(end.done).toBe(true);
  });
});

describe('swapFactors（換層柔和過渡）', () => {
  it('from 由 1/dim 線性到 1、to 由 dim 線性到 1、結束 done', () => {
    const sw = { fromFloor: 'a', toFloor: 'b', t0: 0 };
    const r0 = swapFactors(sw, 0, 0.2, 1000);
    expect(r0.fromFactor).toBeCloseTo(5, 5);
    expect(r0.toFactor).toBeCloseTo(0.2, 5);
    expect(r0.done).toBe(false);
    const r5 = swapFactors(sw, 500, 0.2, 1000);
    expect(r5.fromFactor).toBeCloseTo(3, 5);
    expect(r5.toFactor).toBeCloseTo(0.6, 5);
    const r1 = swapFactors(sw, 1000, 0.2, 1000);
    expect(r1.fromFactor).toBeCloseTo(1, 5);
    expect(r1.toFactor).toBeCloseTo(1, 5);
    expect(r1.done).toBe(true);
  });
});

describe('applyFloorFade', () => {
  it('數值一律套用（含 >1 補償、上限 1）→ null 還原快照；共用 material 先 clone 不洩漏', () => {
    const shared = new THREE.MeshStandardMaterial({ opacity: 0.8, transparent: false });
    const fa = new THREE.Group();
    const ma = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared);
    fa.add(ma);
    const mb = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared); // 不在 fa 內
    applyFloorFade(fa, 0.5);
    expect((ma.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.4, 5);
    expect((ma.material as THREE.MeshStandardMaterial).transparent).toBe(true);
    expect((mb.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
    applyFloorFade(fa, 2); // >1＝from 側補償；min(1, 0.8×2) 夾在 1
    expect((ma.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(1, 5);
    applyFloorFade(fa, null);
    expect((ma.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
    expect((ma.material as THREE.MeshStandardMaterial).transparent).toBe(false);
    expect(ma.userData.fadeBase).toBeUndefined();
  });
});
