import type { Pt } from './rp-geometry'

export interface NavNode { id: string; xy: Pt; area?: string }
export interface NavEdge { from: string; to: string; kind: string }
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
    const a = nodes.get(from)!, b = nodes.get(to)!
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
  // gate 選收：不排進迴路（要刷卡過閘，順路才收），雙向附在該層尾端
  for (const e of nav.edges.filter(e => e.kind === 'gate')) {
    out.push(mk(e.from, e.to, 'gate', false))
    out.push(mk(e.to, e.from, 'gate', false))
  }
  return out
}
