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

/** 把已成形的列串成一條行走路線:每次挑端點離目前位置最近的未走列,必要時整列反向。
 *  列必須由呼叫端依各自的區/方向產生——逐區各自蛇行會在區與區之間留下整條長廊的
 *  回頭路(B2 四座月台每座都從同一端開始,曾因此多走 450 m)。 */
export function chainRows<T extends { x: number; y: number }>(rows: T[][]): T[] {
  const valid = rows.filter(r => r.length > 0)
  if (valid.length === 0) return []

  // 純貪婪的結果高度取決於起點,隨便挑第一列會留下一條橫跨全樓層的回頭路
  // (B1 曾因此出現 96 m 的單步跳躍)。列數每層 ≤20,直接試遍所有起點取最短。
  const runFrom = (start: number): { seq: T[]; len: number } => {
    const left = valid.map((r, i) => ({ r, i }))
    const seq: T[] = []
    let len = 0
    let cur: { x: number; y: number } | null = null
    let pick = left.findIndex(e => e.i === start)
    while (left.length > 0) {
      if (cur !== null) {
        let bd = Infinity
        for (const [i, e] of left.entries()) {
          const dh = Math.hypot(e.r[0].x - cur.x, e.r[0].y - cur.y)
          const dt = Math.hypot(e.r[e.r.length - 1].x - cur.x, e.r[e.r.length - 1].y - cur.y)
          if (dh < bd) { bd = dh; pick = i }
          if (dt < bd) { bd = dt; pick = ~i } // 補碼表示「這列要反向」
        }
        len += bd
      }
      const rev = pick < 0
      const idx = rev ? ~pick : pick
      const row = rev ? [...left[idx].r].reverse() : left[idx].r
      left.splice(idx, 1)
      for (let k = 1; k < row.length; k++) len += Math.hypot(row[k].x - row[k - 1].x, row[k].y - row[k - 1].y)
      seq.push(...row)
      cur = row[row.length - 1]
      pick = 0
    }
    return { seq, len }
  }

  let best = runFrom(0)
  for (let s = 1; s < valid.length; s++) {
    const cand = runFrom(s)
    if (cand.len < best.len) best = cand
  }
  return best.seq
}

