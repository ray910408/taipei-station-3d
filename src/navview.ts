import * as THREE from 'three';
import { THEME } from './theme';

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
