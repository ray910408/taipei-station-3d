import * as THREE from 'three';
import type { GraphEdge } from './nav';

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
    new THREE.MeshBasicMaterial({ color: '#ffb020' }),
  );
  cone.rotation.x = Math.PI; // 尖端朝下指樓面
  cone.position.y = 1.1;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.12, 8, 24),
    new THREE.MeshBasicMaterial({ color: '#ffb020' }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  g.add(cone, ring);
  return g;
}

export function setFloorEmphasis(stationGroup: THREE.Group, activeFloorId: string | null): void {
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') continue;
    const dim = activeFloorId !== null && child.name !== activeFloorId;
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!m?.isMaterial) return;
      if (activeFloorId === null) {
        // 還原 opacity 與 transparent，並清除快照——快照生命週期＝單次跟隨會話，
        // 下次跟隨重新取樣，期間的透明度 slider 變更才不會被舊快照蓋掉
        if (mesh.userData.baseOpacity !== undefined) {
          m.opacity = mesh.userData.baseOpacity as number;
          m.transparent = mesh.userData.baseTransparent as boolean;
          delete mesh.userData.baseOpacity;
          delete mesh.userData.baseTransparent;
        }
        return;
      }
      if (!mesh.userData.matCloned) {
        // GLB 軌 material 可能跨 mesh 共用——調整前 clone 一次（跨會話不重複），避免調暗洩漏
        mesh.material = m.clone();
        mesh.userData.matCloned = true;
      }
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mesh.userData.baseOpacity === undefined) {
        mesh.userData.baseOpacity = mat.opacity;
        mesh.userData.baseTransparent = mat.transparent;
      }
      mat.transparent = true;
      mat.opacity = (mesh.userData.baseOpacity as number) * (dim ? 0.15 : 1);
    });
  }
}
