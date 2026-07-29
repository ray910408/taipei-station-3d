import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { distPointSeg, pointInPolygon } from '../src/geometry'
import { chainRows, distToPolygonEdge, type Pt } from './rp-geometry'

const WALKABLE_KINDS = new Set(['corridor', 'unpaid', 'paid', 'platform'])
const AREA_FILL: Record<string, string> = {
  corridor: '#dbeafe', unpaid: '#dcfce7', paid: '#fef9c3',
  platform: '#e0e7ff', track: '#fecaca', 'stair-void': '#f3e8ff',
}

interface FloorArea { id: string; kind: string; polygon: Pt[]; note?: string }
interface FloorUnit { id: string; kind: string; polygon?: Pt[] }
export interface FloorJson {
  id: string
  slab: { outline: Pt[] }
  areas?: FloorArea[]
  units?: FloorUnit[]
}
export interface RpPoint { id: string; floor: string; x: number; y: number; note?: string }

/** host 邊界中距 p < clearance 的邊,若越過該邊 5cm 仍在任一可走區內(內部縫)就不算牆 */
function nearWall(p: Pt, host: Pt[], areas: FloorArea[], clearance: number): boolean {
  for (let i = 0, j = host.length - 1; i < host.length; j = i++) {
    const a = host[j], b = host[i]
    if (distPointSeg(p, a, b) >= clearance) continue
    const dx = b[0] - a[0], dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy
    let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    const qx = a[0] + t * dx, qy = a[1] + t * dy
    const nx = p[0] - qx, ny = p[1] - qy
    const nl = Math.hypot(nx, ny) || 1
    const probe: Pt = [qx - (nx / nl) * 0.05, qy - (ny / nl) * 0.05]
    if (!areas.some(ar => pointInPolygon(probe, ar.polygon))) return true
  }
  return false
}

/** 最小面積有向包圍盒的方向。凸多邊形的最小 OBB 必有一邊與某條邊共線,故逐邊試投影取面積最小者。
 *  軸對齊的區會回傳軸方向(輸出與未旋轉時相同);斜置的區(B4 月台)才需要這個——
 *  直接對 AABB 的 X/Y 各自取格點時,斜長條上兩座標會同步前進,實際間隔變成 √2 倍。 */
function principalAxis(poly: Pt[]): [number, number] {
  let best: [number, number] = [1, 0]
  let bestArea = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const dx = poly[i][0] - poly[j][0], dy = poly[i][1] - poly[j][1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const ux = dx / len, uy = dy / len
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity
    for (const [px, py] of poly) {
      const u = px * ux + py * uy, v = -px * uy + py * ux
      uMin = Math.min(uMin, u); uMax = Math.max(uMax, u)
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v)
    }
    const area = (uMax - uMin) * (vMax - vMin)
    if (area < bestArea) { bestArea = area; best = [ux, uy] }
  }
  return best
}

/** 格點被障礙擋住時的替代位置(單位:spacing 的倍數,由近到遠)。
 *  橫向(dv)優先——月台樓梯井多半只吃掉中線,旁邊還走得過去。 */
const BACKFILL: [number, number][] = ([] as [number, number][]).concat(
  ...[0.25, 0.4, 0.5].map(r => [[0, r], [0, -r], [r, 0], [-r, 0], [r, r], [r, -r], [-r, r], [-r, -r]] as [number, number][]),
)

export function generateFloorPoints(floor: FloorJson, prefix: string, spacing: number, clearance = 0.8): RpPoint[] {
  const areas = (floor.areas ?? []).filter(a => WALKABLE_KINDS.has(a.kind) && (a.polygon?.length ?? 0) >= 3)
  const units = (floor.units ?? []).filter(u => (u.polygon?.length ?? 0) >= 3)
  if (areas.length === 0) return []

  // 格線逐區生成並置中。全樓層共用一組格線時,比 spacing 窄的可走區會依格線相位
  // 整座落空——B2 四座月台各只有 11 m 寬,20 m 格線只落進其中兩座,另兩座完全沒有點。
  // 置中後窄區至少拿到中央那一排,寬區的實際間距為 extent/round(extent/spacing),接近 spacing。
  const ticks = (min: number, max: number): number[] => {
    const n = Math.max(1, Math.round((max - min) / spacing))
    const step = (max - min) / n
    return Array.from({ length: n }, (_, i) => min + step * (i + 0.5))
  }

  const allRows: { x: number; y: number; note?: string }[][] = []
  for (const area of areas) {
    // 在該區自己的主軸座標系 (u,v) 裡佈點,再轉回世界座標
    const [ux, uy] = principalAxis(area.polygon)
    const toXY = (u: number, v: number): Pt => [u * ux - v * uy, u * uy + v * ux]
    const us = area.polygon.map(([x, y]) => x * ux + y * uy)
    const vs = area.polygon.map(([x, y]) => -x * uy + y * ux)

    // 列在該區的主軸方向上成形;跨區的走訪順序交給 chainRows,不要丟進全域的
    // round(y/spacing) 重新分列——各區相位不同會把不同區的列交錯在一起
    // (B3 曾因此在第 37→38 點倒退 52 m)。
    // 只收自己這一區的點:落在鄰區的交給該區自己的格線。相鄰區相位不同時,
    // 縫邊仍可能出現約 spacing/4 的點對(B3 有 5 對),屬冗餘而非錯誤——
    // 不做距離去重,否則會砍掉窄區唯一的那一排,把覆蓋問題換個形式帶回來。
    const placeable = (u: number, v: number): Pt | null => {
      const p = toXY(u, v)
      if (!pointInPolygon(p, area.polygon)) return null
      if (nearWall(p, area.polygon, areas, clearance)) return null // 貼牆/月台緣/軌道緣剔除;內部縫不算牆
      if (units.some(un => pointInPolygon(p, un.polygon!) || distToPolygonEdge(p, un.polygon!) < clearance)) return null
      return p
    }

    const uTicks = ticks(Math.min(...us), Math.max(...us))
    for (const v of ticks(Math.min(...vs), Math.max(...vs))) {
      const row: { x: number; y: number; note?: string }[] = []
      for (const u of uTicks) {
        // 被障礙擋掉就在鄰域找替代位置,不要直接丟棄:月台上的樓梯井會把整個
        // 格點吃掉,留下兩倍間距的空洞(B4 曾出現兩段 41 m)。先讓開(橫向繞過
        // 樓梯井)再前後挪,位移上限 spacing/2 以免和鄰點靠太近。
        const p = placeable(u, v) ?? BACKFILL.reduce<Pt | null>(
          (hit, [du, dv]) => hit ?? placeable(u + du * spacing, v + dv * spacing), null)
        if (p) row.push({ x: p[0], y: p[1], note: area.note })
      }
      allRows.push(row)
    }
  }
  return chainRows(allRows).map((p, i) => ({
    id: `${prefix}-${String(i + 1).padStart(3, '0')}`,
    floor: floor.id, x: p.x, y: p.y, ...(p.note ? { note: p.note } : {}),
  }))
}

export function floorSvg(floor: FloorJson, points: RpPoint[]): string {
  const outline = floor.slab.outline
  const xs = outline.map(p => p[0]); const ys = outline.map(p => p[1])
  const minX = Math.min(...xs) - 5, maxX = Math.max(...xs) + 5
  const minY = Math.min(...ys) - 5, maxY = Math.max(...ys) + 5
  const fy = (y: number) => maxY + minY - y // 模型 +Y 朝北,SVG y 朝下 → 翻轉
  const poly = (pts: Pt[], fill: string, stroke = '#9ca3af') =>
    `<polygon points="${pts.map(([x, y]) => `${x},${fy(y)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="0.3"/>`
  const parts: string[] = []
  parts.push(poly(outline, '#f3f4f6', '#6b7280'))
  for (const a of floor.areas ?? []) if ((a.polygon?.length ?? 0) >= 3) parts.push(poly(a.polygon, AREA_FILL[a.kind] ?? '#e5e7eb'))
  for (const u of floor.units ?? []) if ((u.polygon?.length ?? 0) >= 3) parts.push(poly(u.polygon!, '#d1d5db'))
  for (const [i, p] of points.entries()) {
    parts.push(`<circle cx="${p.x}" cy="${fy(p.y)}" r="0.8" fill="#dc2626"/>`)
    parts.push(`<text x="${p.x + 1}" y="${fy(p.y) - 1}" font-size="2.2" fill="#111827">${i + 1}</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">\n${parts.join('\n')}\n</svg>\n`
}

// ---- CLI ----
function main() {
  // parseArgs 為 strict:預設擋下未知選項(打錯 --spacng 不再靜默走預設值)
  const { values } = parseArgs({ options: {
    spacing: { type: 'string' }, clearance: { type: 'string' }, out: { type: 'string' },
    n: { type: 'string' }, floors: { type: 'string' }, svg: { type: 'boolean' },
  } })
  // --spacing 支援逐層覆寫:`12,tra-platform-b2=20`。月台是長條一維空間、
  // PDR 在那裡最準,不需要跟大廳一樣密。
  // 間距必須 > 0:0 會讓格線迴圈永遠不前進(CLI 直接卡死),負值同理
  const positive = (v: string, what: string): number => {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) { console.error(`${what} 必須是大於 0 的數字:${v}`); process.exit(1) }
    return n
  }
  const [defSpacing, ...overrides] = String(values.spacing ?? 6).split(',')
  const spacing = positive(defSpacing, '--spacing')
  const byFloor = new Map(overrides.map(o => {
    const [id, v] = o.split('=')
    if (!id || v === undefined) { console.error(`--spacing 覆寫格式要 <floorId>=<公尺>:${o}`); process.exit(1) }
    return [id, positive(v, `--spacing 覆寫 ${id}`)] as const
  }))
  const clearance = Number(values.clearance ?? 0.8)
  const outDir = values.out ?? 'rp'
  const n = Number(values.n ?? 10) // 工時估算用的每點掃描次數
  const station = JSON.parse(readFileSync('data/station.json', 'utf8'))
  const wanted = (values.floors ?? '').split(',').filter(Boolean)
  const floors = station.floors.filter((f: { id: string }) => wanted.length === 0 || wanted.includes(f.id))
  // 打錯樓層 id 會靜默走預設密度,採完才發現——先擋下來
  const ids = new Set(station.floors.map((f: { id: string }) => f.id))
  for (const id of byFloor.keys()) if (!ids.has(id)) { console.error(`--spacing 覆寫的樓層不存在:${id}(可用:${[...ids].join(', ')})`); process.exit(1) }

  const all: RpPoint[] = []
  mkdirSync(join(outDir, 'maps'), { recursive: true })
  for (const f of floors) {
    const floor: FloorJson = JSON.parse(readFileSync(join('data', f.file), 'utf8'))
    const sp = byFloor.get(floor.id) ?? spacing
    const pts = generateFloorPoints(floor, f.labels.complex, sp, clearance)
    all.push(...pts)
    const hours = (pts.length * (n * 4.5 + 15)) / 3600
    console.log(`${f.labels.complex} ${floor.id}: ${pts.length} 點 · 間距 ${sp}m · 預估 ${hours.toFixed(1)} h (N=${n})`)
    if (values.svg) writeFileSync(join(outDir, 'maps', `${floor.id}.svg`), floorSvg(floor, pts))
  }
  if (all.length === 0) { console.error('產出 0 點——檢查 --floors 或樓層資料'); process.exit(1) }
  writeFileSync(join(outDir, 'rp-points.json'), JSON.stringify({
    schema: 'rp-list@1', station: station.id, coordSystem: 'model',
    generated: new Date().toISOString(), spacing,
    ...(byFloor.size ? { spacingByFloor: Object.fromEntries(byFloor) } : {}),
    points: all,
  }, null, 2))
  const totalH = (all.length * (n * 4.5 + 15)) / 3600
  console.log(`共 ${all.length} 點 · 預估 ${totalH.toFixed(1)} h → ${join(outDir, 'rp-points.json')}`)
}

// 見 fp-sim.ts 同處註解：vite-node 無進入點資訊，改以「非測試環境」為判準
if (!process.env.VITEST) main()
