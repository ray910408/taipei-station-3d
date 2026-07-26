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
      const rec = JSON.parse(line)
      if (rec.type === 'session') { cur = rec; sessions.push(rec.session); continue }
      if (rec.type === 'skip') continue
      if (rec.type !== 'point') continue
      if (!cur) throw new Error(`第 ${i + 1} 行:point 出現在 session header 前`)
      byKey.set(`${rec.pointId}|${rec.headingSlot}`, { ...rec, session: cur.session, scansPerPoint: cur.scansPerPoint })
    }
  }
  return { samples: [...byKey.values()], sessions }
}

// ---- Stage 1.1 樣本級品質過濾 ----

export interface CleanSample { rec: RawSample; w: number; magOk: boolean }

export function cleanSamples(samples: RawSample[]): { kept: CleanSample[]; dropped: { pointId: string; reason: string }[] } {
  const kept: CleanSample[] = []
  const dropped: { pointId: string; reason: string }[] = []
  for (const rec of samples) {
    if (rec.throttled) { dropped.push({ pointId: rec.pointId, reason: 'throttled' }); continue } // 快取非當下環境
    let w = 1, magOk = true
    if (rec.actualScans < 0.6 * rec.scansPerPoint) w *= 0.5
    const m = rec.mag
    if (m.accuracy <= 1) magOk = false
    else if (Math.max(...m.std) > 3 && m.magStd < 2) { magOk = false; w *= 0.5 } // 手機轉動:WiFi 亦污染
    else if (m.magStd > 2) magOk = false // 列車/電梯環境擾動:WiFi 保留
    kept.push({ rec, w, magOk })
  }
  return { kept, dropped }
}
