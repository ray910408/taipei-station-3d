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

let shadowTex: THREE.CanvasTexture | null = null;
function markerShadowTexture(): THREE.CanvasTexture | null {
  if (shadowTex || typeof document === 'undefined') return shadowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.85)'); // 中段保深——環外露出的一圈才夠暗，淡出只留最外緣
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

export function buildPositionMarker(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'position-marker';
  // 懸浮感靠兩件事：mesh 整體抬 markerLift＋路線平面上的接觸陰影盤（無光照材質下唯一的高度線索，
  // 亦遮掉低視角時環/箭頭螢幕空隙漏出的 ribbon）。全材質 transparent——同進 transparent pass 使
  // renderOrder（陰影 9 < 本體 10）成為唯一畫序；depthTest/depthWrite 關＝穿牆保險（牆帶/柱不遮 marker）
  const flags = { toneMapped: false, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide } as const;
  const capMat = new THREE.MeshBasicMaterial({ color: THEME.route.marker, ...flags });
  const sideMat = new THREE.MeshBasicMaterial({ color: THEME.route.markerSide, ...flags });
  // 水平立體箭頭（Google 導航風）：尖端在 yaw=0 時朝世界 +Z——headingYaw 的 atan2(dx,dz) 對齊
  const shape = new THREE.Shape();
  shape.moveTo(0, 1.8);
  shape.lineTo(1.3, -1.3);
  shape.lineTo(0, -0.6);
  shape.lineTo(-1.3, -1.3);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.6, bevelEnabled: false });
  const lift = THEME.route.markerLift; // group origin 在路線平面——mesh 整體抬 lift 形成可見空隙
  const arrow = new THREE.Mesh(geo, [capMat, sideMat]); // ExtrudeGeometry group 0=上下蓋、1=側壁
  arrow.rotation.x = Math.PI / 2; // shape +y → 世界 +z；extrude 厚度轉為 -y
  arrow.position.y = lift + 0.65; // 厚度朝下 0.6——體積佔 lift+0.05 至 lift+0.65
  arrow.renderOrder = 10;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.14, 8, 24), capMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = lift + 0.15; // 管半徑 0.14——環底 lift+0.01，完全在空隙之上
  ring.renderOrder = 10;
  const tex = markerShadowTexture();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(THEME.route.markerShadow.radius, 32),
    new THREE.MeshBasicMaterial({
      map: tex ?? undefined, color: tex ? '#ffffff' : '#000000',
      opacity: THEME.route.markerShadow.opacity, ...flags,
    }));
  shadow.name = 'marker-shadow';
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02; // 貼路線平面——本體與影分離＝懸浮
  shadow.renderOrder = 9;
  g.add(arrow, ring, shadow);
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

/** 單一子樹調暗/還原：dim=null 走快照還原；dim=true/false 套 dimFactor/基準。
 *  快照與 clone 防護邏輯與原 setFloorEmphasis 相同（終審 Important 的 depthWrite 規則保留）。 */
function dimSubtree(root: THREE.Object3D, dim: boolean | null, dimFactor: number): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    let list = materialsOf(mesh);
    if (list.length === 0 || !list[0].isMaterial) return;
    if (dim === null) {
      // 還原 opacity 與 transparent，並清除快照——快照生命週期＝單次聚焦/會話
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
      m.opacity = bases[i] * (dim ? dimFactor : 1);
      // 調暗即不寫深度——SSAO/透明排序不吃隱形樓層；還原走快照防描邊漂移（終審 Important）
      m.depthWrite = dws[i] && m.opacity >= 1;
    });
  });
}

export function setFloorEmphasis(
  stationGroup: THREE.Group,
  active: string | readonly string[] | null,
  dimFactor: number = THEME.emphasis.dim,
): void {
  const activeSet = active === null ? null
    : new Set(typeof active === 'string' ? [active] : active);
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') {
      // 豎井依兩端樓層判斷：任一端在 active 集合即保亮（preview 跨層路徑豎井不受害）；
      // 未標 floors 保守不調暗
      for (const conn of child.children) {
        const floors = conn.userData.floors as string[] | undefined;
        const dim = activeSet === null ? null
          : floors === undefined ? false : !floors.some((f) => activeSet.has(f));
        dimSubtree(conn, dim, dimFactor);
      }
      continue;
    }
    dimSubtree(child, activeSet === null ? null : !activeSet.has(child.name), dimFactor);
  }
}
