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
      if (mesh.userData.baseOpacity === undefined) {
        // GLB 軌 material 可能跨 mesh 共用——首次調整前 clone，避免調暗洩漏到其他樓層
        mesh.material = m.clone();
        mesh.userData.baseOpacity = (mesh.material as THREE.MeshStandardMaterial).opacity;
      }
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = (mesh.userData.baseOpacity as number) * (dim ? 0.15 : 1);
    });
  }
}
