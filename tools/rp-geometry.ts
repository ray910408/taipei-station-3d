export type Pt = [number, number]

/** Ray casting;邊上點不保證,格點取樣用途足夠 */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]
    const [xj, yj] = poly[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function distPointToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** 點到多邊形邊界(所有邊)最短距離;內外點皆可用 */
export function distToPolygonEdge(p: Pt, poly: Pt[]): number {
  let min = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    min = Math.min(min, distPointToSegment(p, poly[j], poly[i]))
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
