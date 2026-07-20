import * as THREE from 'three';
import { THEME } from './theme';
import { toWorld } from './builder';
import type { StationModel, PoiKind } from './types';

/** canvas 畫「圓底＋白邊＋glyph」——零外部資產，pixelRatio 2 下 128px 夠銳利。 */
function makeIconTexture(bg: string, glyph: string): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 6, 0, Math.PI * 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 64px "Noto Sans TC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, S / 2, S / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 每 kind 一份共用 material（上限 5 個，永不釋放；station group 非每幀重建物）
const matCache = new Map<PoiKind, THREE.SpriteMaterial>();
function poiMaterial(kind: PoiKind): THREE.SpriteMaterial {
  let m = matCache.get(kind);
  if (!m) {
    const t = THEME.poi[kind];
    m = new THREE.SpriteMaterial({ map: makeIconTexture(t.bg, t.glyph), toneMapped: false });
    matCache.set(kind, m);
  }
  return m;
}

/** POI billboard 圖示：runtime 附掛進樓層 group（隨爆炸位移；json/glb 兩軌通用，GLB 不烘焙 Sprite）。
 *  共用 material 跨樓層無 dim 洩漏——setFloorEmphasis 首次調整前會 per-sprite clone（follow.ts 既有防護）。 */
export function attachPoiIcons(stationGroup: THREE.Group, model: StationModel): void {
  for (const meta of model.station.floors) {
    const floorGroup = stationGroup.getObjectByName(meta.id);
    const floor = model.floors.get(meta.id);
    if (!floorGroup || !floor) continue;
    for (const poi of floor.pois ?? []) {
      const sprite = new THREE.Sprite(poiMaterial(poi.kind));
      sprite.scale.setScalar(THEME.poiSize);
      sprite.position.copy(toWorld(poi.position, meta.elevation + 2));
      sprite.userData.kind = `poi-${poi.kind}`;
      floorGroup.add(sprite);
    }
  }
}
