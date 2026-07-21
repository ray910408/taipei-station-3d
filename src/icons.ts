import * as THREE from 'three';
import { THEME } from './theme';
import { toWorld } from './builder';
import type { StationModel, PoiKind } from './types';

const S = 128;

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 官方站內設施圖例語言：深色圓角方塊＋白 pictogram；出口＝白底藍圈藍「出」。零外部資產。 */
function drawIcon(ctx: CanvasRenderingContext2D, kind: PoiKind): void {
  const P = THEME.poi;
  if (kind === 'exit') {
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, 54, 0, Math.PI * 2);
    ctx.fillStyle = P.gateBg;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = P.gate;
    ctx.stroke();
    ctx.fillStyle = P.gate;
    ctx.font = '700 60px "Noto Sans TC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('出', S / 2, S / 2 + 4);
    return;
  }
  roundRectPath(ctx, 8, 8, 112, 112, 22);
  ctx.fillStyle = P.tile;
  ctx.fill();
  ctx.fillStyle = P.fg;
  if (kind === 'toilet') {
    ctx.beginPath();
    ctx.arc(46, 36, 11, 0, Math.PI * 2);
    ctx.fill();
    roundRectPath(ctx, 34, 50, 24, 34, 6);
    ctx.fill();
    ctx.fillRect(37, 84, 8, 26);
    ctx.fillRect(51, 84, 8, 26);
    ctx.beginPath();
    ctx.arc(84, 36, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(77, 50);
    ctx.lineTo(91, 50);
    ctx.lineTo(102, 92);
    ctx.lineTo(66, 92);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(77, 92, 7, 18);
    ctx.fillRect(88, 92, 7, 18);
  } else if (kind === 'tvm') {
    roundRectPath(ctx, 34, 26, 60, 76, 8);
    ctx.fill();
    ctx.fillStyle = P.tile;
    ctx.fillRect(42, 36, 44, 26);
    ctx.fillRect(42, 72, 44, 8);
    ctx.fillStyle = P.fg;
    ctx.fillRect(30, 102, 68, 6);
  } else if (kind === 'info') {
    ctx.beginPath();
    ctx.arc(64, 36, 10, 0, Math.PI * 2);
    ctx.fill();
    roundRectPath(ctx, 55, 52, 18, 46, 6);
    ctx.fill();
    ctx.fillRect(50, 96, 28, 8);
  } else {
    ctx.save();
    ctx.translate(64, 64);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -14, 10, 44);
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(-16, -8);
    ctx.lineTo(16, -8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}

function makeIconTexture(kind: PoiKind): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = S;
  drawIcon(c.getContext('2d')!, kind);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// 每 kind 一份共用 material（上限 5 個，永不釋放；station group 非每幀重建物）
const matCache = new Map<PoiKind, THREE.SpriteMaterial>();
function poiMaterial(kind: PoiKind): THREE.SpriteMaterial {
  let m = matCache.get(kind);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: makeIconTexture(kind), toneMapped: false });
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
