import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraGoal { pos: THREE.Vector3; target: THREE.Vector3 }

export const CHASE_BACK = 22; // chase cam 後方水平距離（公尺）
export const CHASE_UP = 16;   // chase cam 高度

const FIT_MARGIN = 1.3;
const MIN_RADIUS = 12; // 兩點很近（如單一豎井）時仍拉出能看清兩層的距離

/** 目標相機狀態；每幀 tick() damped lerp 逼近，到位自動釋放（回使用者控制）。 */
export class CameraRig {
  goal: CameraGoal | null = null;
  private k = 0.08;
  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls) {}
  tick(): void {
    if (!this.goal) return;
    this.camera.position.lerp(this.goal.pos, this.k);
    this.controls.target.lerp(this.goal.target, this.k);
    if (this.camera.position.distanceTo(this.goal.pos) < 0.5 &&
        this.controls.target.distanceTo(this.goal.target) < 0.5) this.goal = null;
  }
  cancel(): void { this.goal = null; }
}

/** 對點集做 bounding-sphere fit：固定斜俯視方向框住全部點。 */
export function frameGoal(pts: THREE.Vector3[], aspect: number, fovDeg = 55): CameraGoal {
  const sphere = new THREE.Box3().setFromPoints(pts).getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, MIN_RADIUS);
  const vFov = THREE.MathUtils.degToRad(fovDeg);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const dist = (r * FIT_MARGIN) / Math.tan(Math.min(vFov, hFov) / 2);
  const dir = new THREE.Vector3(0.47, 0.46, 0.76).normalize(); // 與初始視角同側的斜俯視
  return { pos: sphere.center.clone().addScaledVector(dir, dist), target: sphere.center.clone() };
}

/** heading-up 跟隨：相機在 marker 後上方、朝前進方向（盤問 Q5）。 */
export function chaseGoal(markerPos: THREE.Vector3, nextPos: THREE.Vector3): CameraGoal {
  const fwd = nextPos.clone().sub(markerPos);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  else fwd.normalize();
  return {
    pos: markerPos.clone().addScaledVector(fwd, -CHASE_BACK).add(new THREE.Vector3(0, CHASE_UP, 0)),
    target: markerPos.clone().addScaledVector(fwd, 8),
  };
}
