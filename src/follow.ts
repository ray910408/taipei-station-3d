import * as THREE from 'three';
import type { GraphEdge } from './nav';
import { THEME } from './theme';

// 跟隨模式狀態：路線＝節點序列，index＝目前所在節點。
// 推進事件只走 advance()——Phase 4 PDR 自動推進掛同一介面。
export interface FollowState { nodeIds: string[]; index: number }

export function startFollow(edges: GraphEdge[]): FollowState {
  if (edges.length === 0) throw new Error('空路線無法導航');
  return { nodeIds: [edges[0].from, ...edges.map((e) => e.to)], index: 0 };
}

export const advance = (s: FollowState): FollowState =>
  ({ ...s, index: Math.min(s.index + 1, s.nodeIds.length - 1) });

export const back = (s: FollowState): FollowState =>
  ({ ...s, index: Math.max(s.index - 1, 0) });

export const atEnd = (s: FollowState): boolean => s.index === s.nodeIds.length - 1;

export const currentNodeId = (s: FollowState): string => s.nodeIds[s.index];

export const remainingEdges = (edges: GraphEdge[], s: FollowState): GraphEdge[] =>
  edges.slice(s.index);

export function buildPositionMarker(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'position-marker';
  // 問題4：depthTest/depthWrite 關＋renderOrder 拉高——marker 永遠畫在路線與樓板之上
  const m = new THREE.MeshBasicMaterial({
    color: THEME.route.marker, toneMapped: false,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  // 水平扁箭頭（Google 導航風）：尖端在 yaw=0 時朝世界 +Z——headingYaw 的 atan2(dx,dz) 對齊
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.4);
  shape.lineTo(1.0, -1.0);
  shape.lineTo(0, -0.45);
  shape.lineTo(-1.0, -1.0);
  shape.closePath();
  const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), m);
  arrow.rotation.x = Math.PI / 2; // shape +y → 世界 +z，平躺樓面
  arrow.position.y = 0.2;
  arrow.renderOrder = 10;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.12, 8, 24), m);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  ring.renderOrder = 10;
  g.add(arrow, ring);
  return g;
}

/** 前後幀 marker 位置差分 → 前進 yaw（rad）；水平位移 < 1mm 回 null＝保持原朝向。 */
export function headingYaw(prev: THREE.Vector3, cur: THREE.Vector3): number | null {
  const dx = cur.x - prev.x;
  const dz = cur.z - prev.z;
  return dx * dx + dz * dz < 1e-6 ? null : Math.atan2(dx, dz);
}

/** wrap-aware 角度平滑：走最短弧；k=1 直接到位（reduced-motion）。 */
export function lerpYaw(cur: number, target: number, k: number): number {
  let d = (target - cur) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return cur + d * k;
}

const materialsOf = (mesh: THREE.Mesh): THREE.Material[] =>
  Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];

/** slider 於跟隨會話中更新基準值：保留當前 dim 係數，退出後還原至新基準。
 *  非會話中（無快照）則直接設定 opacity。雙材質 mesh 對每個 slot 套同一基準。 */
export function updateBaseOpacity(mesh: THREE.Mesh, newBase: number): void {
  const bases = mesh.userData.baseOpacity as number[] | undefined;
  materialsOf(mesh).forEach((m, i) => {
    if (bases === undefined) { m.opacity = newBase; return; }
    const factor = bases[i] > 0 ? m.opacity / bases[i] : 1;
    bases[i] = newBase;
    m.opacity = newBase * factor;
  });
}

export function setFloorEmphasis(
  stationGroup: THREE.Group,
  active: string | readonly string[] | null,
): void {
  const activeSet = active === null ? null
    : new Set(typeof active === 'string' ? [active] : active);
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') continue;
    const dim = activeSet !== null && !activeSet.has(child.name);
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      let list = materialsOf(mesh);
      if (list.length === 0 || !list[0].isMaterial) return;
      if (activeSet === null) {
        // 還原 opacity 與 transparent，並清除快照——快照生命週期＝單次跟隨會話
        if (mesh.userData.baseOpacity !== undefined) {
          const bases = mesh.userData.baseOpacity as number[];
          const flags = mesh.userData.baseTransparent as boolean[];
          const dws = mesh.userData.baseDepthWrite as boolean[];
          list.forEach((m, i) => { m.opacity = bases[i]; m.transparent = flags[i]; m.depthWrite = dws[i]; });
          delete mesh.userData.baseOpacity;
          delete mesh.userData.baseTransparent;
          delete mesh.userData.baseDepthWrite;
        }
        return;
      }
      if (!mesh.userData.matCloned) {
        // GLB 軌 material 可能跨 mesh 共用——調整前 clone 一次（跨會話不重複），避免調暗洩漏
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map((m) => m.clone())
          : (mesh.material as THREE.Material).clone();
        mesh.userData.matCloned = true;
        list = materialsOf(mesh);
      }
      if (mesh.userData.baseOpacity === undefined) {
        mesh.userData.baseOpacity = list.map((m) => m.opacity);
        mesh.userData.baseTransparent = list.map((m) => m.transparent);
        mesh.userData.baseDepthWrite = list.map((m) => m.depthWrite);
      }
      const bases = mesh.userData.baseOpacity as number[];
      const dws = mesh.userData.baseDepthWrite as boolean[];
      list.forEach((m, i) => {
        m.transparent = true;
        m.opacity = bases[i] * (dim ? THEME.emphasis.dim : 1);
        // 調暗即不寫深度——SSAO/透明排序不吃隱形樓層；還原走快照防描邊漂移（終審 Important）
        m.depthWrite = dws[i] && m.opacity >= 1;
      });
    });
  }
}
