import * as THREE from 'three';
import { THEME } from './theme';
import type { Mode } from './mode';

/** nav 單樓層制（盤問 Q1/Q3）：nav 只看當前樓層；其他模式全可見。 */
export function floorVisible(mode: Mode, floorId: string, currentFloor: string | null): boolean {
  return mode !== 'nav' || currentFloor === null || floorId === currentFloor;
}

/** 佈 visibility 到樓層 groups；connectors 屬跨層量體，nav 中一律隱藏（指引由 banner 承載）。 */
export function applyFloorVisibility(
  stationGroup: THREE.Group, mode: Mode, currentFloor: string | null,
): void {
  for (const child of stationGroup.children) {
    child.visible = child.name === 'connectors'
      ? mode !== 'nav'
      : floorVisible(mode, child.name, currentFloor);
  }
}

/** marker 等速滑行（盤問 Q5）：時長 = 距離/速度，夾在 [segMinMs, segMaxMs]。 */
export interface Tween { from: THREE.Vector3; to: THREE.Vector3; t0: number; ms: number }

export function makeTween(from: THREE.Vector3, to: THREE.Vector3, t0: number): Tween {
  const ms = THREE.MathUtils.clamp(
    (from.distanceTo(to) / THEME.nav.markerSpeed) * 1000, THEME.nav.segMinMs, THEME.nav.segMaxMs);
  return { from: from.clone(), to: to.clone(), t0, ms };
}

export function tweenAt(tw: Tween, now: number): { pos: THREE.Vector3; done: boolean } {
  const t = Math.min(1, (now - tw.t0) / tw.ms);
  return { pos: tw.from.clone().lerp(tw.to, t), done: t >= 1 };
}
