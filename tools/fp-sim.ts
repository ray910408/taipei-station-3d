/**
 * 指紋模擬器:seeded 物理模型產合成 wifi-fp@1 資料。
 * 驗「程式正確＋演算法收斂」,不預測北車真誤差(合成誤差必偏樂觀)。
 * 用法:npm run sim:fp -- --seed 1 [--rp rp/rp-points.json] [--n 10] [--mode single|quad]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FloorJson, RpPoint } from './gen-rp-points'
import { pointInPolygon, type Pt } from './rp-geometry'

export type Rng = () => number

/** mulberry32:32-bit seeded RNG,同 seed 同序列 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Box-Muller 常態分布 */
export function gauss(rng: Rng, mean = 0, std = 1): number {
  const u = 1 - rng() // 避免 log(0)
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

/** FNV-1a:字串 → 32-bit,persistent per-pair shadow 的種子 */
export function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}

// ---- 世界模型 ----

export interface SimApBssid { bssid: string; ssid: string; freq: number; offset: number }
export interface SimAp {
  id: string // = 最小 bssid(同 fp-build 錨點 id 慣例)
  floor: string; level: number; x: number; y: number
  tx: number // 1m 參考 RSSI
  bssids: SimApBssid[]
}
export interface SimHotspot { bssid: string; ssid: string; freq: number; tx: number; activeProb: number }
export interface MagWave { kx: number; ky: number; phase: number; amp: [number, number, number] }
export interface MagField { base: [number, number, number]; waves: MagWave[]; disturbProb: number }
export interface SimFloor { id: string; level: number; outline: Pt[] }
export interface SimWorld {
  seed: number
  floors: SimFloor[]
  aps: SimAp[]
  hotspots: SimHotspot[]
  mag: Record<string, MagField>
}

export interface WorldOpts { apsPerFloor?: number; txMean?: number; txStd?: number; hotspotCount?: number }

/** 行動熱點 SSID 樣式庫(給 Stage 1.2 規則 1 抓) */
export const HOTSPOT_SSIDS = [
  'iPhone', 'iPhone 15', 'AndroidAP_1252', 'OPPO Reno5 5G',
  'Smartphone_connect_607bca', 'Redmi Note 11', 'HUAWEI Mate 40 Pro',
]

const hex = (b: number) => b.toString(16).padStart(2, '0')
const macOf = (bytes: number[]) => bytes.map(hex).join(':')

/** slab 內拒絕取樣一個點 */
function randInPoly(outline: Pt[], rng: Rng): Pt {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of outline) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  for (let i = 0; i < 1000; i++) {
    const p: Pt = [minX + rng() * (maxX - minX), minY + rng() * (maxY - minY)]
    if (pointInPolygon(p, outline)) return p
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2] // 退而求其次:形心附近
}

export function buildWorld(floors: FloorJson[], seed: number, opts: WorldOpts = {}): SimWorld {
  const { txMean = -40, txStd = 4, hotspotCount = 3 } = opts
  const rng = mulberry32(hash32(`world|${seed}`))
  const simFloors: SimFloor[] = floors.map((f, level) => ({ id: f.id, level, outline: f.slab.outline }))

  const aps: SimAp[] = []
  for (const [level, f] of floors.entries()) {
    // 預設密度:每 400 m²(bbox 概算)一顆,至少 4 顆
    let area = 0
    const o = f.slab.outline
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) area += o[j][0] * o[i][1] - o[i][0] * o[j][1]
    area = Math.abs(area) / 2
    const count = opts.apsPerFloor ?? Math.max(4, Math.round(area / 400))
    for (let k = 0; k < count; k++) {
      const [x, y] = randInPoly(o, rng)
      // 基底 MAC:locally-administered 首 byte,其餘隨機
      const bytes = [0x0a, ...Array.from({ length: 5 }, () => Math.floor(rng() * 256))]
      const base = macOf(bytes)
      const nBssid = 1 + Math.floor(rng() * 3) // 1–3 個
      const name = `AP-${f.id}-${k + 1}`
      const bssids: SimApBssid[] = [{ bssid: base, ssid: name, freq: 2437, offset: 0 }]
      // 同胞:尾 byte 翻第 m 個 bit(同 OUI、尾 3 bytes 差 1 bit → Stage 1.3 可抓)
      if (nBssid >= 2) bssids.push({ bssid: macOf([...bytes.slice(0, 5), bytes[5] ^ 1]), ssid: `${name}_5G`, freq: 5745, offset: -4 })
      if (nBssid >= 3) bssids.push({ bssid: macOf([...bytes.slice(0, 5), bytes[5] ^ 2]), ssid: '', freq: 5180, offset: -4 })
      aps.push({ id: [...bssids.map(b => b.bssid)].sort()[0], floor: f.id, level, x, y, tx: gauss(rng, txMean, txStd), bssids })
    }
  }

  const hotspots: SimHotspot[] = Array.from({ length: hotspotCount }, () => ({
    bssid: macOf([0xda, ...Array.from({ length: 5 }, () => Math.floor(rng() * 256))]),
    ssid: HOTSPOT_SSIDS[Math.floor(rng() * HOTSPOT_SSIDS.length)],
    freq: 2437, tx: -35, activeProb: 0.5,
  }))

  const mag: Record<string, MagField> = {}
  for (const f of floors) {
    const isPlatform = (f.areas ?? []).some(a => a.kind === 'platform')
    const nWaves = 2 + Math.floor(rng() * 2) // 2–3 個弦波空間梯度
    mag[f.id] = {
      base: [gauss(rng, 18, 3), gauss(rng, 18, 3), gauss(rng, -35, 3)], // 水平 ~25 µT、合力 ~45 µT
      waves: Array.from({ length: nWaves }, () => ({
        kx: (2 * Math.PI) / (15 + rng() * 25), ky: (2 * Math.PI) / (15 + rng() * 25),
        phase: rng() * 2 * Math.PI,
        amp: [gauss(rng, 0, 2), gauss(rng, 0, 2), gauss(rng, 0, 2)],
      })),
      disturbProb: isPlatform ? 0.3 : 0, // 月台層列車擾動事件
    }
  }

  return { seed, floors: simFloors, aps, hotspots, mag }
}
