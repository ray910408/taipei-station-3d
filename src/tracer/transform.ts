import type { CalibrationControlPoint, Vec2 } from '../types';

/** 影像像素 → 站內 local 公尺的相似變換（等比縮放＋旋轉＋平移）。
 *  影像 u 向右、v 向下；local x 向東、y 向北——v 軸翻轉內建於係數：
 *  x = c·Δu + d·Δv + x0；y = d·Δu − c·Δv + y0（Δu=u−u0、Δv=v−v0） */
export interface PxTransform {
  c: number; d: number;
  u0: number; v0: number;
  x0: number; y0: number;
}

export function fitSimilarity(cps: [CalibrationControlPoint, CalibrationControlPoint]): PxTransform {
  const [p, q] = cps;
  const du = q.px[0] - p.px[0];
  const dv = q.px[1] - p.px[1];
  const dx = q.local[0] - p.local[0];
  const dy = q.local[1] - p.local[1];
  const det = du * du + dv * dv;
  if (det === 0) throw new Error('兩個控制點的像素座標相同');
  if (dx * dx + dy * dy === 0) throw new Error('兩個控制點的 local 座標相同');
  const c = (dx * du - dy * dv) / det;
  const d = (dy * du + dx * dv) / det;
  return { c, d, u0: p.px[0], v0: p.px[1], x0: p.local[0], y0: p.local[1] };
}

export function pxToLocal(t: PxTransform, px: Vec2): Vec2 {
  const du = px[0] - t.u0;
  const dv = px[1] - t.v0;
  return [t.x0 + t.c * du + t.d * dv, t.y0 + t.d * du - t.c * dv];
}

export function localToPx(t: PxTransform, xy: Vec2): Vec2 {
  const dx = xy[0] - t.x0;
  const dy = xy[1] - t.y0;
  const s2 = t.c * t.c + t.d * t.d;
  return [t.u0 + (t.c * dx + t.d * dy) / s2, t.v0 + (t.d * dx - t.c * dy) / s2];
}

/** 由變換推導比例尺（px/m），供寫回 calibration.px_per_m 與一致性檢查 */
export function pxPerM(t: PxTransform): number {
  return 1 / Math.hypot(t.c, t.d);
}
