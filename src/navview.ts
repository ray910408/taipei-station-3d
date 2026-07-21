import * as THREE from 'three';
import { THEME } from './theme';

/** marker 等速滑行（盤問 Q5）：時長 = 距離/速度，夾在 [segMinMs, segMaxMs]。 */
export interface Tween { from: THREE.Vector3; to: THREE.Vector3; t0: number; ms: number }

export function makeTween(from: THREE.Vector3, to: THREE.Vector3, t0: number): Tween {
  const ms = THREE.MathUtils.clamp(
    (from.distanceTo(to) / THEME.nav.markerSpeed) * 1000, THEME.nav.segMinMs, THEME.nav.segMaxMs);
  return { from: from.clone(), to: to.clone(), t0, ms };
}

export function tweenAt(tw: Tween, now: number): { pos: THREE.Vector3; done: boolean } {
  const t = Math.min(1, (now - tw.t0) / tw.ms);
  return { pos: tw.from.clone().lerp(tw.to, t), done: t >= 1 };
}

/** nav 每幀 chase 目標：tween 進行中鎖定 tween 終點（含最後一段——atEnd 但 tween 未完仍 chase）；
 *  否則沿既有 next-node 規則（atEnd 或垂直段前不 chase）。回傳 null＝本幀不設 chase goal。 */
export function chaseAim(opts: {
  tween: Tween | null; atEnd: boolean; vertical: boolean; nextPos: THREE.Vector3;
}): THREE.Vector3 | null {
  if (opts.tween) return opts.tween.to;
  if (opts.atEnd || opts.vertical) return null;
  return opts.nextPos;
}

/** 換層柔和過渡（風格關卡裁決版）：疊在 setFloorEmphasis 之後——
 *  from 層視覺 1→dim（factor 1/dim→1）、to 層視覺 dim→1（factor dim→1），線性。 */
export interface FloorSwap { fromFloor: string; toFloor: string; t0: number }

export function swapFactors(sw: FloorSwap, now: number, dim: number, ms = THEME.nav.crossfadeMs):
    { fromFactor: number; toFactor: number; done: boolean } {
  const t = Math.min(1, (now - sw.t0) / ms);
  return { fromFactor: (1 / dim) * (1 - t) + t, toFactor: dim * (1 - t) + t, done: t >= 1 };
}

/** 對整層佈 opacity 係數；null＝還原並清快照（顯式 sentinel——from 側起始 factor=1/dim>1
 *  屬正常補償，不得以 ≥1 觸發還原）。數值套用 opacity = min(1, fadeBase×factor)。
 *  快照鍵（fadeBase）獨立於 setFloorEmphasis（baseOpacity）——nav 換層與 overview 聚焦不互踩；
 *  共用 material（GLB 軌/POI sprite）沿用 matCloned 旗標先 clone，防跨層洩漏。 */
export function applyFloorFade(floorGroup: THREE.Object3D, factor: number | null): void {
  floorGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    let list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    if (list.length === 0 || !(list[0] as THREE.Material).isMaterial) return;
    if (factor === null) {
      if (mesh.userData.fadeBase !== undefined) {
        const bases = mesh.userData.fadeBase as number[];
        const flags = mesh.userData.fadeTransparent as boolean[];
        list.forEach((m, i) => { m.opacity = bases[i]; m.transparent = flags[i]; });
        delete mesh.userData.fadeBase;
        delete mesh.userData.fadeTransparent;
      }
      return;
    }
    if (!mesh.userData.matCloned) {
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => m.clone())
        : (mesh.material as THREE.Material).clone();
      mesh.userData.matCloned = true;
      list = Array.isArray(mesh.material) ? mesh.material : [mesh.material as THREE.Material];
    }
    if (mesh.userData.fadeBase === undefined) {
      mesh.userData.fadeBase = list.map((m) => m.opacity);
      mesh.userData.fadeTransparent = list.map((m) => m.transparent);
    }
    const bases = mesh.userData.fadeBase as number[];
    list.forEach((m, i) => { m.transparent = true; m.opacity = Math.min(1, bases[i] * factor); });
  });
}

/** nav 效能：外殼立面（kind=shell）調暗後近乎不可見（0.06×dim）卻仍整面渲染——
 *  nav 中整批隱藏，省行動 GPU 半透明 overdraw。 */
export function setShellVisible(stationGroup: THREE.Object3D, visible: boolean): void {
  stationGroup.traverse((o) => {
    if (o.userData.kind === 'shell') o.visible = visible;
  });
}
