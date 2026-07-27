import type { Vec2 } from './types';

// 2D 多邊形基本運算的單一來源。viewer(visibility/tracer)與 node 工具
// (validate/rp-geometry/gen-rp-points/fp-sim)共用——這些式子先前各有 2~4 份
// 逐字相同的複本,任何一處修正都得記得同步到其他份,漏一份就是模組間行為不一致。

/** Ray-cast 點在多邊形內（polygon 開環）。邊界上的點結果未定義——呼叫端以取樣容忍。 */
export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 鞋帶公式帶號面積：>0 逆時針、<0 順時針。繞向判定（validate 的幾何規則、
 *  tracer 的 ensureWinding）依賴此符號；只要面積大小的呼叫端請自行取 Math.abs。 */
export function ringArea(ring: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

/** 點到線段最短距離（投影參數夾限於 [0,1]，故端點外的點取端點距離）。 */
export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
