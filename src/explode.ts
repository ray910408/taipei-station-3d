import type * as THREE from 'three';
import type { StationModel } from './types';

export const EXPLODE_GAP = 24; // 爆炸時相鄰樓層間距（公尺）；真實層距 6–7m 近等距，取等距最簡

/** factor 0=實高、1=全爆炸。最深層不動，往上每層墊高到等距 GAP；回傳加在實高上的 y 位移。 */
export function floorOffsetY(model: StationModel, floorId: string, factor: number): number {
  const floors = model.station.floors; // station.json 順序＝淺→深
  const i = floors.findIndex((f) => f.id === floorId);
  if (i < 0) return 0;
  const deepest = floors[floors.length - 1].elevation;
  const target = deepest + (floors.length - 1 - i) * EXPLODE_GAP;
  return (target - floors[i].elevation) * factor;
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** 樓層 group y 位移；connectors 需拉伸、由呼叫端以 buildConnectorsGroup(offsetY) 重建。 */
export function applyExplode(stationGroup: THREE.Group, model: StationModel, factor: number): void {
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') continue;
    child.position.y = floorOffsetY(model, child.name, factor);
  }
}
