import type * as THREE from 'three';
import type { StationModel } from './types';

export const EXPLODE_GAP = 24; // 爆炸時相鄰樓層間距（公尺）；真實層距 6–7m 近等距，取等距最簡

/** factor 0=實高、1=全爆炸。槽位依「相異 elevation」深→淺排列，最深槽不動、往上每槽
 *  墊高到等距 GAP；同深站體（ADR 0002：樓層＝站體×深度，如 tp/bc 同 −14）共用槽位、
 *  自然並排——不得用陣列 index 當槽位。回傳加在實高上的 y 位移。 */
export function floorOffsetY(model: StationModel, floorId: string, factor: number): number {
  const me = model.station.floors.find((f) => f.id === floorId);
  if (!me) return 0;
  const elevs = [...new Set(model.station.floors.map((f) => f.elevation))].sort((x, y) => x - y); // 深→淺
  const target = elevs[0] + elevs.indexOf(me.elevation) * EXPLODE_GAP;
  return (target - me.elevation) * factor;
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

/** 釋放 runtime 重建物（route/connectors）的 GPU 資源：geometry＋獨占 material。
 *  floor mesh 不經此函數——其 material 可能跨 mesh 共用（如 POI sprite），不得在此處置。 */
export function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) for (const x of m) x.dispose();
    else m?.dispose();
  });
}
