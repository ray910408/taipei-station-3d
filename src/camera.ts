import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { THEME } from './theme';

export interface CameraGoal { pos: THREE.Vector3; target: THREE.Vector3 }

export const CHASE_BACK = THEME.nav.chaseBack; // chase cam 後方水平距離（公尺）
export const CHASE_UP = THEME.nav.chaseUp;     // chase cam 高度；back/up ≈ 27° 俯角

// viewer 相機與 frameGoal 的 insets 投影共用——兩者不一致時讓位量算錯但不會炸，只會把內容推錯位置
export const VIEW_FOV = 55;

const FIT_MARGIN = 1.3;
const MIN_RADIUS = 12; // 兩點很近（如單一豎井）時仍拉出能看清兩層的距離
// inset 總和上限：總和→1 時可用半角→0、dist→∞。矮視窗配高卡片時夾住，寧可讓一點點遮擋。
const MAX_INSET = 0.45;

/** 畫面被固定 UI 佔掉的邊緣比例（0～1，佔畫面高度）。 */
export interface ScreenInsets { top?: number; bottom?: number }

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
 *  insets＝畫面上／下被固定 UI 卡片佔掉的高度比例。有值時內容不再對齊畫面中心，而是
 *  壓進卡片之間那條可見帶的中央——垂直可用半角縮為 (1-top-bottom) 倍（相機退遠以維持
 *  框景），注視點再位移，讓內容在螢幕上等量偏移。
 *
 *  上下都要支援的理由：導航橫幅在桌機是頂部卡片，但 max-width:600px 時變成**底部** sheet
 *  （index.html 的 mobile 區塊）。只做 top inset 會在手機上把內容往下推進 sheet 裡，
 *  正好推反（PR #5 review）。
 *
 *  存在理由（QA ISSUE-009）：梯前全景框的是 connector 兩端，marker 只在其中一端，
 *  必然偏離畫面中心半個高差。往下的梯 marker 落在中心上方，正好是桌機導航橫幅的位置，
 *  不讓位就整個被蓋掉——而 marker 是使用者的自身位置指示。
 */
export function frameGoal(
  pts: THREE.Vector3[], aspect: number, fovDeg = VIEW_FOV, insets: ScreenInsets = {},
): CameraGoal {
  const sphere = new THREE.Box3().setFromPoints(pts).getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, MIN_RADIUS);
  const vFov = THREE.MathUtils.degToRad(fovDeg);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  let top = Math.min(Math.max(insets.top ?? 0, 0), 1);
  let bottom = Math.min(Math.max(insets.bottom ?? 0, 0), 1);
  // 夾總和而非各自夾：等比例縮小才保住上下比值，讓位方向不會因為夾住而偏掉
  const sum = top + bottom;
  if (sum > MAX_INSET) { const k = MAX_INSET / sum; top *= k; bottom *= k; }
  const used = top + bottom;
  const dir = new THREE.Vector3(0.47, 0.46, 0.76).normalize(); // 與初始視角同側的斜俯視
  const halfV = Math.atan(Math.tan(vFov / 2) * (1 - used)); // 可見帶只剩 (1-used) 高
  const dist = (r * FIT_MARGIN) / Math.tan(Math.min(halfV, hFov / 2));
  if (used === 0) {
    return { pos: sphere.center.clone().addScaledVector(dir, dist), target: sphere.center.clone() };
  }
  // 可見帶中央比畫面中心低 (top-bottom)/2（佔畫面高）。畫面高在該距離的世界尺度
  // ＝2·dist·tan(vFov/2)，故注視點沿「螢幕上方」移 (top-bottom)·dist·tan(vFov/2)。
  const screenUp = new THREE.Vector3(0, 1, 0);
  screenUp.addScaledVector(dir, -screenUp.dot(dir)).normalize(); // 世界 up 去掉視線分量
  const look = sphere.center.clone()
    .addScaledVector(screenUp, (top - bottom) * dist * Math.tan(vFov / 2));
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
