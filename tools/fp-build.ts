/**
 * 離線 pipeline Stage 1(清洗)＋ Stage 2(建庫):wifi-fp@1 JSONL → fp-db@1 JSON。
 * 原始 JSONL 永不修改;規則常數 exported 可調可回溯。
 * 用法:npm run build:fp -- rp/sim/xxx.jsonl [more.jsonl] [--station id] [--out path]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'

export interface ScanApRec { bssid: string; ssid: string; rssi: number; freq: number }
export interface PointRecord {
  type: 'point'; pointId: string; floor: string; x: number; y: number
  headingSlot: number | null; headingDeg: number
  actualScans: number; throttled: boolean
  scans: { t: string; fresh: boolean; aps: ScanApRec[] }[]
  mag: { n: number; mean: number[]; std: number[]; magMean: number; magStd: number; accuracy: number }
}
export interface RawSample extends PointRecord { session: string; scansPerPoint: number }

/** 多檔合併解析:同 (pointId, headingSlot) 取最後一行(重採語意);skip 略過 */
export function parseSessions(texts: string[]): { samples: RawSample[]; sessions: string[] } {
  const byKey = new Map<string, RawSample>()
  const sessions: string[] = []
  for (const text of texts) {
    let cur: { session: string; scansPerPoint: number } | null = null
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      let rec: any
      try { rec = JSON.parse(line) } catch (e) { throw new Error(`第 ${i + 1} 行:JSON 解析失敗——${e}`) } // 截斷行(採集中斷)最常見
      if (rec.type === 'session') {
        if (typeof rec.scansPerPoint !== 'number') throw new Error(`第 ${i + 1} 行:session header 缺 scansPerPoint`) // 否則短掃描規則靜默比 NaN
        cur = rec; sessions.push(rec.session); continue
      }
      if (rec.type === 'skip') continue
      if (rec.type !== 'point') continue
      if (!cur) throw new Error(`第 ${i + 1} 行:point 出現在 session header 前`)
      byKey.set(`${rec.pointId}|${rec.headingSlot}`, { ...rec, session: cur.session, scansPerPoint: cur.scansPerPoint })
    }
  }
  return { samples: [...byKey.values()], sessions }
}

// ---- Stage 1.1 樣本級品質過濾 ----

// Stage 1.1 門檻(真機資料進來後的調參旋鈕;可調可回溯)
export const SHORT_SCAN_RATIO = 0.6 // actualScans < 此×scansPerPoint → 降權
export const DOWNWEIGHT = 0.5       // 短掃描/轉動共用降權係數
export const ROT_AXIS_STD = 3       // 三軸 std 超過此(µT)且 magStd<MAGSTD_SPLIT → 手機轉動
export const MAGSTD_SPLIT = 2       // 合力 std 分流線(µT):<此=轉動特徵、>此=環境擾動
export const MIN_MAG_ACCURACY = 1   // accuracy ≤ 此 → 剔磁力

export interface CleanSample { rec: RawSample; w: number; magOk: boolean }

export function cleanSamples(samples: RawSample[]): { kept: CleanSample[]; dropped: { pointId: string; reason: string }[] } {
  const kept: CleanSample[] = []
  const dropped: { pointId: string; reason: string }[] = []
  for (const rec of samples) {
    if (rec.throttled) { dropped.push({ pointId: rec.pointId, reason: 'throttled' }); continue } // 快取非當下環境
    let w = 1, magOk = true
    if (rec.actualScans < SHORT_SCAN_RATIO * rec.scansPerPoint) w *= DOWNWEIGHT
    const m = rec.mag
    if (m.accuracy <= MIN_MAG_ACCURACY) magOk = false
    else if (Math.max(...m.std) > ROT_AXIS_STD && m.magStd < MAGSTD_SPLIT) { magOk = false; w *= DOWNWEIGHT } // 手機轉動:WiFi 亦污染
    else if (m.magStd > MAGSTD_SPLIT) magOk = false // 列車/電梯環境擾動:WiFi 保留
    kept.push({ rec, w, magOk })
  }
  return { kept, dropped }
}

// ---- Stage 1.2 行動熱點濾除(BSSID 是主 key;三條規則任一命中即排除) ----

/** 裝置型號/隨身熱點 SSID 樣式。注意:` 5G`(含空白)是型號型;`_5G` 是正牌 AP 命名,不殺。 */
export const HOTSPOT_SSID_PATTERNS: RegExp[] = [
  /iphone/i, /^androidap/i, /^oppo\b/i, /smartphone_connect/i,
  /^xiaomi\b/i, /^redmi\b/i, /^huawei\b/i, /^samsung\b/i, /^pixel\b/i, /^vivo\b/i, / 5g$/i,
]
export const HOTSPOT_MIN_RP = 3   // 全庫出現 RP 數低於此 → rare
export const DRIFT_DIST = 30      // 相距 >30m 的 RP 皆不弱 → 在移動
export const DRIFT_STRONG = -75   // 「不弱」門檻(dBm)

export function filterHotspots(kept: CleanSample[]): Map<string, string> {
  // 每 BSSID:出現過的 RP(座標/樓層/每 RP 平均 RSSI)與看過的 ssid
  const stat = new Map<string, { ssids: Set<string>; rps: Map<string, { floor: string; x: number; y: number; sum: number; n: number }> }>()
  for (const { rec } of kept) {
    for (const scan of rec.scans) for (const ap of scan.aps) {
      let s = stat.get(ap.bssid)
      if (!s) stat.set(ap.bssid, s = { ssids: new Set(), rps: new Map() })
      if (ap.ssid) s.ssids.add(ap.ssid)
      let r = s.rps.get(rec.pointId)
      if (!r) s.rps.set(rec.pointId, r = { floor: rec.floor, x: rec.x, y: rec.y, sum: 0, n: 0 })
      r.sum += ap.rssi; r.n++
    }
  }
  const excluded = new Map<string, string>()
  for (const [bssid, s] of stat) {
    if ([...s.ssids].some(ss => HOTSPOT_SSID_PATTERNS.some(p => p.test(ss)))) { excluded.set(bssid, 'ssid-pattern'); continue }
    // 規則2:同層兩 RP 相距 >30m 且兩處平均皆不弱
    const strong = [...s.rps.values()].filter(r => r.sum / r.n > DRIFT_STRONG)
    let drift = false
    for (let i = 0; i < strong.length && !drift; i++) for (let j = i + 1; j < strong.length; j++) {
      if (strong[i].floor !== strong[j].floor) continue
      if (Math.hypot(strong[i].x - strong[j].x, strong[i].y - strong[j].y) > DRIFT_DIST) { drift = true; break }
    }
    if (drift) { excluded.set(bssid, 'drift'); continue }
    if (s.rps.size < HOTSPOT_MIN_RP) excluded.set(bssid, 'rare')
  }
  return excluded
}

// ---- Stage 1.3 多 BSSID 同源合併 ----

export function popcount(x: number): number {
  let n = 0
  while (x) { n += x & 1; x >>>= 1 }
  return n
}

const macBytes = (bssid: string) => bssid.split(':').map(b => parseInt(b, 16))
const ouiOf = (bssid: string) => bssid.slice(0, 8)
const tailOf = (bssid: string) => { const b = macBytes(bssid); return (b[3] << 16) | (b[4] << 8) | b[5] }

/** OUI 相同＋尾 3 bytes xor popcount ≤1 → 同實體 AP;anchor id = 組內最小 bssid。回傳 bssid→anchorId。 */
export function mergeAnchors(members: { bssid: string; ssid: string }[]): Map<string, string> {
  const list = [...new Map(members.map(m => [m.bssid, m])).values()] // 去重
  const parent = new Map<string, string>(list.map(m => [m.bssid, m.bssid]))
  const find = (x: string): string => { const p = parent.get(x)!; if (p === x) return x; const r = find(p); parent.set(x, r); return r }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb) }
  const byOui = new Map<string, typeof list>()
  for (const m of list) { const g = byOui.get(ouiOf(m.bssid)); if (g) g.push(m); else byOui.set(ouiOf(m.bssid), [m]) }
  for (const group of byOui.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      if (popcount(tailOf(group[i].bssid) ^ tailOf(group[j].bssid)) <= 1) union(group[i].bssid, group[j].bssid)
    }
  }
  return new Map(list.map(m => [m.bssid, find(m.bssid)]))
}
