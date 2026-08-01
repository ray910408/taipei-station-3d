import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { floorSvgBase, type FloorSvgJson } from './floor-svg'
import type { Pt } from './rp-geometry'

export interface NavNode { id: string; xy: Pt; area?: string }
export interface NavEdge { from: string; to: string; kind: string; bidir?: boolean }
/** 只列 floorWalks 用得到的欄位;真 floor JSON 的其餘欄位靠結構化子型別放行。
 *  勿 import gen-rp-points 的 FloorJson——那個檔有 CLI main,value-import 會連帶執行。 */
export interface FloorNavJson {
  id: string
  areas?: { id: string; kind: string; note?: string; polygon?: Pt[] }[]
  nav?: { nodes: NavNode[]; edges: NavEdge[] }
}
export interface DirectedWalk {
  seq: number; floor: string; from: string; to: string; kind: string
  required: boolean; lengthM: number; fromXy: [number, number]; toXy: [number, number]
  note?: string
}

/** Hierholzer：無向邊集 → 有向走訪，每條邊正反各恰一次、首尾相接。
 *  每邊化成兩條反向弧後每個節點入度=出度，連通則歐拉迴路必存在——
 *  這是「雙向都走」白拿的紅利：現場零回頭路。呼叫端保證輸入連通。 */
export function eulerCircuit(edges: [string, string][]): [string, string][] {
  if (edges.length === 0) return []
  const adj = new Map<string, string[]>()
  const push = (a: string, b: string) => {
    let l = adj.get(a); if (!l) { l = []; adj.set(a, l) } l.push(b)
  }
  for (const [a, b] of edges) { push(a, b); push(b, a) }
  const stack = [edges[0][0]]; const order: string[] = []
  while (stack.length) {
    const v = stack[stack.length - 1]
    const nbrs = adj.get(v) ?? []
    if (nbrs.length) stack.push(nbrs.pop()!)
    else order.push(stack.pop()!)
  }
  order.reverse()
  const out: [string, string][] = []
  for (let i = 0; i + 1 < order.length; i++) out.push([order[i], order[i + 1]])
  return out
}

/** walk 子圖的連通塊（gate 會把付費/非付費區隔開，各塊各自成迴路） */
function components(edges: [string, string][]): [string, string][][] {
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let r = x; while (parent.get(r) !== r) r = parent.get(r)!
    parent.set(x, r); return r
  }
  for (const [a, b] of edges) parent.set(find(a), find(b))
  const by = new Map<string, [string, string][]>()
  for (const e of edges) {
    const r = find(e[0])
    let l = by.get(r); if (!l) { l = []; by.set(r, l) } l.push(e)
  }
  return [...by.values()]
}

export function floorWalks(floor: FloorNavJson, startSeq: number): DirectedWalk[] {
  const nav = floor.nav
  if (!nav) return []
  const nodes = new Map(nav.nodes.map(n => [n.id, n]))
  const areaNote = new Map((floor.areas ?? []).map(a => [a.id, a.note]))
  let seq = startSeq
  const mk = (from: string, to: string, kind: string, required: boolean): DirectedWalk => {
    const a = nodes.get(from), b = nodes.get(to)
    if (!a || !b) throw new Error(`nav edge 指到不存在節點: ${floor.id} ${from}→${to}`)
    const note = (a.area && areaNote.get(a.area)) ?? (b.area && areaNote.get(b.area)) ?? undefined
    return {
      seq: seq++, floor: floor.id, from, to, kind, required,
      lengthM: Math.round(Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]) * 10) / 10,
      fromXy: [a.xy[0], a.xy[1]], toXy: [b.xy[0], b.xy[1]],
      ...(note ? { note } : {}),
    }
  }
  const out: DirectedWalk[] = []
  const walkPairs = nav.edges.filter(e => e.kind === 'walk').map(e => [e.from, e.to] as [string, string])
  for (const comp of components(walkPairs))
    for (const [a, b] of eulerCircuit(comp)) out.push(mk(a, b, 'walk', true))
  // gate 選收：不排進迴路（要刷卡過閘，順路才收）。bidir:false=單向閘門，只發可通方向；
  // 平行閘門（同節點對多條 edge）只發一次——識別鍵 (floor,from,to) 必須唯一（Global Constraint）。
  const emitted = new Set<string>()
  for (const e of nav.edges.filter(e => e.kind === 'gate')) {
    const dirs: [string, string][] = e.bidir === false
      ? [[e.from, e.to]]
      : [[e.from, e.to], [e.to, e.from]]
    for (const [a, b] of dirs) {
      if (emitted.has(`${a}>${b}`)) continue
      emitted.add(`${a}>${b}`)
      out.push(mk(a, b, 'gate', false))
    }
  }
  return out
}

export function allWalks(floors: FloorNavJson[]): DirectedWalk[] {
  const out: DirectedWalk[] = []
  for (const f of floors) out.push(...floorWalks(f, out.length + 1))
  return out
}

/** 找邊圖：required 實線箭頭＋迴路序號（正反向各往左偏 0.6m 分離）、gate 虛線、節點標籤 */
export function edgeSvg(floor: FloorNavJson & FloorSvgJson, walks: DirectedWalk[]): string {
  const { fy, open, parts } = floorSvgBase(floor)
  for (const w of walks) {
    const [x1, y1] = w.fromXy; const [x2, y2] = w.toXy
    const dx = x2 - x1, dy = y2 - y1; const len = Math.hypot(dx, dy) || 1
    // 行進方向左側偏移：去回程平行分離，箭頭與序號不互疊
    const ox = (-dy / len) * 0.6, oy = (dx / len) * 0.6
    const a: Pt = [x1 + ox, y1 + oy], b: Pt = [x2 + ox, y2 + oy]
    const dash = w.required ? '' : ' stroke-dasharray="1.5,1"'
    const color = w.required ? '#2563eb' : '#d97706'
    parts.push(`<line x1="${a[0]}" y1="${fy(a[1])}" x2="${b[0]}" y2="${fy(b[1])}" stroke="${color}" stroke-width="0.4"${dash}/>`)
    // 箭頭：線段 70% 處一枚小三角
    const tx = a[0] + (b[0] - a[0]) * 0.7, ty = a[1] + (b[1] - a[1]) * 0.7
    const ux = dx / len, uy = dy / len
    const p1 = `${tx},${fy(ty)}`
    const p2 = `${tx - ux * 1.2 - -uy * 0.6},${fy(ty - uy * 1.2 - ux * 0.6)}`
    const p3 = `${tx - ux * 1.2 + -uy * 0.6},${fy(ty - uy * 1.2 + ux * 0.6)}`
    parts.push(`<polygon points="${p1} ${p2} ${p3}" fill="${color}"/>`)
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
    parts.push(`<text x="${mx}" y="${fy(my)}" font-size="2" fill="${color}">${w.seq}</text>`)
  }
  const seen = new Set<string>()
  for (const w of walks) for (const [id, xy] of [[w.from, w.fromXy], [w.to, w.toXy]] as [string, [number, number]][]) {
    if (seen.has(id)) continue
    seen.add(id)
    parts.push(`<circle cx="${xy[0]}" cy="${fy(xy[1])}" r="0.7" fill="#111827"/>`)
    parts.push(`<text x="${xy[0] + 1}" y="${fy(xy[1]) + 1}" font-size="1.8" fill="#111827">${id}</text>`)
  }
  return `${open}\n${parts.join('\n')}\n</svg>\n`
}

// ---- CLI ----
function main() {
  // 刻意不提供 --floors：局部重產會截斷清單且 generated 無法辨識（gen:rp 前科，acc0032）。
  // 無 partial 情境,覆寫閘門就是一行——勿為此 import gen-rp-points 的 canOverwrite(有 CLI main)。
  const { values } = parseArgs({ options: {
    out: { type: 'string' }, svg: { type: 'boolean' }, force: { type: 'boolean' },
  } })
  const outDir = values.out ?? 'rp'
  const outPath = join(outDir, 'edge-list.json')
  if (existsSync(outPath) && !values.force) {
    console.error(`${outPath} 已存在,重產會覆寫既有清單。確定要覆寫請加 --force`)
    process.exit(1)
  }
  const station = JSON.parse(readFileSync('data/station.json', 'utf8'))
  mkdirSync(join(outDir, 'maps'), { recursive: true })
  const all: DirectedWalk[] = []
  for (const f of station.floors as { id: string; file: string }[]) {
    const floor = JSON.parse(readFileSync(join('data', f.file), 'utf8')) as FloorNavJson & FloorSvgJson
    const ignored = [...new Set((floor.nav?.edges ?? []).map(e => e.kind))].filter(k => k !== 'walk' && k !== 'gate')
    if (ignored.length) console.warn(`${floor.id}: 略過 kind=${ignored.join(',')}（走線只收 walk/gate）`)
    const walks = floorWalks(floor, all.length + 1)
    all.push(...walks)
    const req = walks.filter(w => w.required)
    const mins = req.reduce((s, w) => s + w.lengthM / 1.2 + 15, 0) / 60 // 1.2 m/s＋每線 15s 定位按鈕
    console.log(`${floor.id}: 必收 ${req.length} 走線（${Math.round(req.reduce((s, w) => s + w.lengthM, 0))} m·約 ${mins.toFixed(0)} 分）· 選收 ${walks.length - req.length}`)
    if (values.svg) writeFileSync(join(outDir, 'maps', `edges-${floor.id}.svg`), edgeSvg(floor, walks))
  }
  if (all.length === 0) { console.error('產出 0 走線——檢查樓層 nav 資料'); process.exit(1) }
  const keySet = new Set(all.map(w => `${w.floor}/${w.from}>${w.to}`))
  if (keySet.size !== all.length) { console.error('走線識別鍵重複——bidir/平行閘門處理破損'); process.exit(1) }
  writeFileSync(outPath, JSON.stringify({
    schema: 'edge-list@1', station: station.id, coordSystem: 'model',
    generated: new Date().toISOString(), walks: all,
  }, null, 2))
  console.log(`共 ${all.length} 走線（必收 ${all.filter(w => w.required).length}）→ ${outPath}`)
}

// 見 gen-rp-points.ts 同處註解：vite-node 無進入點資訊，改以「非測試環境」為判準
if (!process.env.VITEST) main()
