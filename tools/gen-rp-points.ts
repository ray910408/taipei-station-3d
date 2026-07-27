import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { distPointToSegment, distToPolygonEdge, pointInPolygon, serpentineOrder, type Pt } from './rp-geometry'

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
    if (distPointToSegment(p, a, b) >= clearance) continue
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

export function generateFloorPoints(floor: FloorJson, prefix: string, spacing: number, clearance = 0.8): RpPoint[] {
  const areas = (floor.areas ?? []).filter(a => WALKABLE_KINDS.has(a.kind) && (a.polygon?.length ?? 0) >= 3)
  const units = (floor.units ?? []).filter(u => (u.polygon?.length ?? 0) >= 3)
  if (areas.length === 0) return []

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const a of areas) for (const [x, y] of a.polygon) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }

  const raw: { x: number; y: number; note?: string }[] = []
  for (let y = minY + spacing / 2; y <= maxY; y += spacing) {
    for (let x = minX + spacing / 2; x <= maxX; x += spacing) {
      const p: Pt = [x, y]
      const host = areas.find(a => pointInPolygon(p, a.polygon))
      if (!host) continue
      if (nearWall(p, host.polygon, areas, clearance)) continue // 貼牆/月台緣/軌道緣剔除;內部縫不算牆
      if (units.some(u => pointInPolygon(p, u.polygon!) || distToPolygonEdge(p, u.polygon!) < clearance)) continue
      raw.push({ x, y, note: host.note })
    }
  }
  return serpentineOrder(raw, spacing).map((p, i) => ({
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
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def
}
function flag(name: string): boolean { return process.argv.includes(`--${name}`) }

function main() {
  const spacing = Number(arg('spacing', '6'))
  const clearance = Number(arg('clearance', '0.8'))
  const outDir = arg('out', 'rp')
  const n = Number(arg('n', '10')) // 工時估算用的每點掃描次數
  const station = JSON.parse(readFileSync('data/station.json', 'utf8'))
  const wanted = arg('floors', '').split(',').filter(Boolean)
  const floors = station.floors.filter((f: { id: string }) => wanted.length === 0 || wanted.includes(f.id))

  const all: RpPoint[] = []
  mkdirSync(join(outDir, 'maps'), { recursive: true })
  for (const f of floors) {
    const floor: FloorJson = JSON.parse(readFileSync(join('data', f.file), 'utf8'))
    const pts = generateFloorPoints(floor, f.labels.complex, spacing, clearance)
    all.push(...pts)
    const hours = (pts.length * (n * 4.5 + 15)) / 3600
    console.log(`${f.labels.complex} ${floor.id}: ${pts.length} 點 · 預估 ${hours.toFixed(1)} h (N=${n})`)
    if (flag('svg')) writeFileSync(join(outDir, 'maps', `${floor.id}.svg`), floorSvg(floor, pts))
  }
  if (all.length === 0) { console.error('產出 0 點——檢查 --floors 或樓層資料'); process.exit(1) }
  writeFileSync(join(outDir, 'rp-points.json'), JSON.stringify({
    schema: 'rp-list@1', station: station.id, coordSystem: 'model',
    generated: new Date().toISOString(), spacing, points: all,
  }, null, 2))
  console.log(`共 ${all.length} 點 → ${join(outDir, 'rp-points.json')}`)
}

// 見 fp-sim.ts 同處註解：vite-node 無進入點資訊，改以「非測試環境」為判準
if (!process.env.VITEST) main()
