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
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.2, 16),
    new THREE.MeshBasicMaterial({ color: THEME.route.marker, toneMapped: false }),
  );
  cone.rotation.x = Math.PI; // 尖端朝下指樓面
  cone.position.y = 1.1;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.12, 8, 24),
    new THREE.MeshBasicMaterial({ color: THEME.route.marker, toneMapped: false }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  g.add(cone, ring);
  return g;
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
          list.forEach((m, i) => { m.opacity = bases[i]; m.transparent = flags[i]; });
          delete mesh.userData.baseOpacity;
          delete mesh.userData.baseTransparent;
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
      }
      const bases = mesh.userData.baseOpacity as number[];
      list.forEach((m, i) => {
        m.transparent = true;
        m.opacity = bases[i] * (dim ? THEME.emphasis.dim : 1);
      });
    });
  }
}
