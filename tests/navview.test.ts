import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  makeTween, tweenAt, chaseAim, aimPastVertical, swapFactors, applyFloorFade, setShellVisible,
  planStepPath,
} from '../src/navview';
import { THEME } from '../src/theme';

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const R = (x: number, y: number, z: number) => ({ pos: v(x, y, z), residual: true });
const N = (x: number, y: number, z: number) => ({ pos: v(x, y, z), residual: false });

describe('planStepPath 每步路徑規劃（終審 I-1，typed waypoint）', () => {
  it('同邊、無既有路徑 → 只有殘距點', () => {
    expect(planStepPath([], [], R(1, 0, 0))).toEqual([R(1, 0, 0)]);
  });
  it('同邊、殘距尾端 → 替換最後目標，保留前段（stale queue 修復）', () => {
    expect(planStepPath([N(1, 0, 0), R(1, 0, 0.5)], [], R(1, 0, 1.2)))
      .toEqual([N(1, 0, 0), R(1, 0, 1.2)]);
  });
  it('同邊、節點尾端 → 附加不替換（round 3 轉角反例）', () => {
    expect(planStepPath([R(0.8, 0, 0), N(1, 0, 0)], [], R(1, 0, 0.7)))
      .toEqual([R(0.8, 0, 0), N(1, 0, 0), R(1, 0, 0.7)]);
  });
  it('手動推進後的單節點尾端 → 附加不替換（round 4 失配交錯，型別隨資料走後直接成立）', () => {
    expect(planStepPath([N(1, 0, 0)], [], R(1, 0, 0.7)))
      .toEqual([N(1, 0, 0), R(1, 0, 0.7)]);
  });
  it('跨節點 → 舊目標全保留＋新節點（型別=節點）＋殘距點', () => {
    expect(planStepPath([R(0.8, 0, 0)], [v(1, 0, 0), v(1, 0, 2)], R(1, 0.5, 2)))
      .toEqual([R(0.8, 0, 0), N(1, 0, 0), N(1, 0, 2), R(1, 0.5, 2)]);
  });
  it('final 與最後節點重合 → 去重', () => {
    expect(planStepPath([], [v(1, 0, 0)], N(1, 0, 0))).toEqual([N(1, 0, 0)]);
  });
});

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

describe('chaseAim（終審 I-1）', () => {
  const B = new THREE.Vector3(1, 0, 0);
  const C = new THREE.Vector3(2, 0, 0);
  const tw = makeTween(new THREE.Vector3(), B, 0);
  it('tween 進行中鎖定 tween 終點（轉角不預瞄下下節點）', () => {
    expect(chaseAim({ tween: tw, atEnd: false, vertical: false, nextPos: C })).toBe(tw.to);
  });
  it('最後一段：atEnd 但 tween 未完仍 chase', () => {
    expect(chaseAim({ tween: tw, atEnd: true, vertical: false, nextPos: B })).toBe(tw.to);
  });
  it('無 tween：atEnd/垂直段前 null、否則下一節點', () => {
    expect(chaseAim({ tween: null, atEnd: true, vertical: false, nextPos: C })).toBeNull();
    expect(chaseAim({ tween: null, atEnd: false, vertical: true, nextPos: C })).toBeNull();
    expect(chaseAim({ tween: null, atEnd: false, vertical: false, nextPos: C })).toBe(C);
  });
});

describe('aimPastVertical（垂直段瞄出梯方向；QA0723-1/4）', () => {
  const M = v(0, 0, 0);
  it('第一個節點就有水平位移 → 回傳它', () => {
    const p = v(3, 0, 4);
    expect(aimPastVertical(M, [p, v(5, 0, 5)])).toBe(p);
  });
  it('第一個垂直堆疊（同 xz、異 y）、第二個有位移 → 回傳第二個', () => {
    const p = v(0, 8, 0.5);
    expect(aimPastVertical(M, [v(0, 4, 0), p])).toBe(p);
  });
  it('全部垂直堆疊 → null；空陣列 → null', () => {
    expect(aimPastVertical(M, [v(0, 4, 0), v(0, 8, 0)])).toBeNull();
    expect(aimPastVertical(M, [])).toBeNull();
  });
  it('位移恰在 ε 邊界內（dx=0.005，dx²=2.5e-5≤1e-4）視為堆疊 → null', () => {
    expect(aimPastVertical(M, [v(0.005, 2, 0)])).toBeNull();
  });
});

describe('setShellVisible（nav 效能：隱藏外殼立面）', () => {
  it('只切 kind=shell 的 mesh，其他不動', () => {
    const g = new THREE.Group();
    const floor = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    shell.userData.kind = 'shell';
    const slab = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
    slab.userData.kind = 'slab';
    floor.add(shell, slab);
    g.add(floor);
    setShellVisible(g, false);
    expect(shell.visible).toBe(false);
    expect(slab.visible).toBe(true);
    setShellVisible(g, true);
    expect(shell.visible).toBe(true);
  });
});
