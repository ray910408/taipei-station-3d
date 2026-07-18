import type { Vec2 } from '../types';

/** local(m，y 向北) ↔ 螢幕(px，y 向下) 檢視變換；zoom = px/m */
export interface ViewState { zoom: number; panX: number; panY: number }

export function localToScreen(v: ViewState, xy: Vec2): Vec2 {
  return [xy[0] * v.zoom + v.panX, -xy[1] * v.zoom + v.panY];
}

export function screenToLocal(v: ViewState, s: Vec2): Vec2 {
  return [(s[0] - v.panX) / v.zoom, -(s[1] - v.panY) / v.zoom];
}

/** 以螢幕點為中心縮放（游標下的 local 點不動） */
export function zoomAt(v: ViewState, s: Vec2, factor: number): ViewState {
  const zoom = Math.min(200, Math.max(0.5, v.zoom * factor));
  const k = zoom / v.zoom;
  return { zoom, panX: s[0] - (s[0] - v.panX) * k, panY: s[1] - (s[1] - v.panY) * k };
}

/** 讓 [min,max]（local）置中塞進 vw×vh 的 90% */
export function fitView(vw: number, vh: number, min: Vec2, max: Vec2): ViewState {
  const w = Math.max(1, max[0] - min[0]);
  const h = Math.max(1, max[1] - min[1]);
  const zoom = Math.min((vw * 0.9) / w, (vh * 0.9) / h);
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  return { zoom, panX: vw / 2 - cx * zoom, panY: vh / 2 + cy * zoom };
}
