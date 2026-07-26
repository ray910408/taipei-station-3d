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
