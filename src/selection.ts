import type { Object3D } from 'three';
import type { NavGraph, GraphNode, Landmark } from './nav';
import type { StationModel, Vec2 } from './types';

// 3D 選點的純邏輯：raycast 命中後的樓層解析、節點吸附、Landmark 轉換。
// three 只用型別——node 環境可測，無 renderer 依賴。

/** hit object 沿祖先鏈解析樓層 id（builder.ts 樓層 group 帶 userData.floorId）。 */
export function resolveFloor(obj: Object3D | null): string | null {
  for (let o: Object3D | null = obj; o; o = o.parent) {
    const id = o.userData?.floorId;
    if (typeof id === 'string') return id;
  }
  return null;
}

/** 同層 2D 最近 nav 節點；該層無節點回 null。 */
export function snapToNode(graph: NavGraph, floorId: string, xy: Vec2): GraphNode | null {
  let best: GraphNode | null = null;
  let bestD = Infinity;
  for (const n of graph.nodes.values()) {
    if (n.floor !== floorId) continue;
    const d = (n.xy[0] - xy[0]) ** 2 + (n.xy[1] - xy[1]) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

/** 組出可餵起訖流程的 Landmark；無名節點 fallback 名「B1 選點」。 */
export function toLandmark(model: StationModel, node: GraphNode): Landmark {
  const meta = model.station.floors.find((f) => f.id === node.floor)!;
  const code = meta.labels['complex'] ?? meta.id;
  return {
    floor: node.floor,
    floorLabel: `${meta.labels['complex'] ?? ''} ${meta.name.zh}`.trim(),
    id: node.id,
    label: node.name ?? `${code} 選點`,
  };
}
