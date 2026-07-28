import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEME } from './theme';

export interface CameraGoal { pos: THREE.Vector3; target: THREE.Vector3 }

export const CHASE_BACK = THEME.nav.chaseBack; // chase cam 後方水平距離（公尺）
export const CHASE_UP = THEME.nav.chaseUp;     // chase cam 高度；back/up ≈ 27° 俯角

const FIT_MARGIN = 1.3;
const MIN_RADIUS = 12; // 兩點很近（如單一豎井）時仍拉出能看清兩層的距離
// topInset 上限：inset→1 時可用半角→0、dist→∞。矮視窗配高卡片時夾住，寧可讓一點點遮擋。
const MAX_TOP_INSET = 0.45;

/** 目標相機狀態；每幀 tick() damped lerp 逼近，到位自動釋放（回使用者控制）。 */
export class CameraRig {
  goal: CameraGoal | null = null;
  constructor(
    private camera: THREE.PerspectiveCamera,
    private controls: OrbitControls,
    private k = 0.08, // reduced-motion 時傳 1＝直接到位
  ) {}
  tick(): void {
    if (!this.goal) return;
    this.camera.position.lerp(this.goal.pos, this.k);
    this.controls.target.lerp(this.goal.target, this.k);
    if (this.camera.position.distanceTo(this.goal.pos) < 0.5 &&
        this.controls.target.distanceTo(this.goal.target) < 0.5) this.goal = null;
  }
  cancel(): void { this.goal = null; }
}

/** 對點集做 bounding-sphere fit：固定斜俯視方向框住全部點。
 *
 *  topInset＝畫面頂部被固定 UI 卡片佔掉的高度比例（0～1）。>0 時內容不再對齊畫面中心，
 *  而是壓進卡片下方那條可見帶的中央——垂直可用半角依比例縮小（相機退遠以維持框景），
 *  注視點再上移，讓內容在螢幕上等量下移。
 *
 *  存在理由（QA ISSUE-009）：梯前全景框的是 connector 兩端，marker 只在其中一端，
 *  必然偏離畫面中心半個高差。往下的梯 marker 落在中心上方，正好是導航橫幅的位置，
 *  不讓位就整個被蓋掉——而 marker 是使用者的自身位置指示。
 */
export function frameGoal(pts: THREE.Vector3[], aspect: number, fovDeg = 55, topInset = 0): CameraGoal {
  const sphere = new THREE.Box3().setFromPoints(pts).getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, MIN_RADIUS);
  const vFov = THREE.MathUtils.degToRad(fovDeg);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const inset = Math.min(Math.max(topInset, 0), MAX_TOP_INSET);
  const halfV = Math.atan(Math.tan(vFov / 2) * (1 - inset)); // 可見帶只剩 (1-inset) 高
  const dist = (r * FIT_MARGIN) / Math.tan(Math.min(halfV, hFov / 2));
  const dir = new THREE.Vector3(0.47, 0.46, 0.76).normalize(); // 與初始視角同側的斜俯視
  if (inset === 0) {
    return { pos: sphere.center.clone().addScaledVector(dir, dist), target: sphere.center.clone() };
  }
  // 內容要落在可見帶中央＝比畫面中心低 inset/2（佔畫面高）。畫面高在該距離的世界尺度
  // ＝2·dist·tan(vFov/2)，故注視點沿「螢幕上方」移 inset·dist·tan(vFov/2)。
  const screenUp = new THREE.Vector3(0, 1, 0);
  screenUp.addScaledVector(dir, -screenUp.dot(dir)).normalize(); // 世界 up 去掉視線分量
  const look = sphere.center.clone().addScaledVector(screenUp, inset * dist * Math.tan(vFov / 2));
  return { pos: look.clone().addScaledVector(dir, dist), target: look };
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
