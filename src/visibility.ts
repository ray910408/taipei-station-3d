import type { Vec2 } from './types';
import { pointInPolygon } from './geometry';

const STEP = 0.5; // 取樣間距（公尺）

/** a→b 是否全程落在 area polygon 內且不進入任何 unit 障礙。
 *  ponytail: 取樣法而非精確線段相交——資料尺度 ~150m、0.5m 取樣誤差可控；
 *  Phase 4 升級 navmesh + funnel 時整組替換。 */
export function segmentClear(a: Vec2, b: Vec2, area: Vec2[], units: Vec2[][]): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return false;
  const n = Math.max(2, Math.ceil(len / STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (!pointInPolygon(p, area)) return false;
    for (const u of units) if (pointInPolygon(p, u)) return false;
  }
  return true;
}
