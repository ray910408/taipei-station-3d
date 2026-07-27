import type { Vec2 } from '../src/types'
import { distPointSeg } from '../src/geometry'

/** 參考點座標。與 src 的 Vec2 同構——保留別名讓產點工具的語彙維持 Pt。 */
export type Pt = Vec2

/** 點到多邊形邊界(所有邊)最短距離;內外點皆可用 */
export function distToPolygonEdge(p: Pt, poly: Pt[]): number {
  let min = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    min = Math.min(min, distPointSeg(p, poly[j], poly[i]))
  }
  return min
}

/** 蛇行(boustrophedon):按 y 分列由南到北,列內 x 隔列反向 */
export function serpentineOrder<T extends { x: number; y: number }>(points: T[], spacing: number): T[] {
  const rows = new Map<number, T[]>()
  for (const p of points) {
    const r = Math.round(p.y / spacing)
    const row = rows.get(r)
    if (row) row.push(p)
    else rows.set(r, [p])
  }
  const out: T[] = []
  const keys = [...rows.keys()].sort((a, b) => a - b)
  keys.forEach((r, idx) => {
    out.push(...rows.get(r)!.sort((a, b) => (idx % 2 === 0 ? a.x - b.x : b.x - a.x)))
  })
  return out
}
