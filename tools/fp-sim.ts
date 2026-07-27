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

export interface SimApBssid {
  bssid: string; ssid: string; freq: number
  offset: number // 相對 tx 的 dB 修正(5G 頻段 −4)
}
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
  return [(minX + maxX) / 2, (minY + maxY) / 2] // 退而求其次:bbox 中心(凹多邊形可能在外,僅備援)
}

/** 產生 seeded 世界。floors 需依垂直順序傳入——level 取陣列索引(非樓層編號),跨層衰減靠它算層差。 */
export function buildWorld(floors: FloorJson[], seed: number, opts: WorldOpts = {}): SimWorld {
  const { txMean = -40, txStd = 4, hotspotCount = 3 } = opts
  const rng = mulberry32(hash32(`world|${seed}`))
  const simFloors: SimFloor[] = floors.map((f, level) => ({ id: f.id, level, outline: f.slab.outline }))

  const aps: SimAp[] = []
  for (const [level, f] of floors.entries()) {
    // 預設密度:每 400 m²(鞋帶公式實算)一顆,至少 4 顆
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
      // 同胞:對基底尾 byte 各翻 1 個 bit(^1、^2)——與基底差 1 bit、同胞彼此差 2 bit,Stage 1.3 需靠 union-find 遞移合併
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

// ---- RSSI 物理 ----

export const FLOOR_SEP = 5 // 樓層垂直間隔(m):d3D 與跨層數用
export const CROSS_FLOOR_DB = 20 // 每跨一層衰減
const PATH_LOSS_N = 3
const JITTER_STD = 5 // 每批 N(0,5) → 10 批 span ≈16 dB(對齊實測)
const SHADOW_STD = 4

/** 持久 per-pair shadowing:seeded hash → N(0,4)。0.5m 格量化 → 同點重測同 shadow。 */
export function pairShadow(world: SimWorld, apId: string, x: number, y: number): number {
  const key = `${world.seed}|${apId}|${Math.round(x * 2)}|${Math.round(y * 2)}`
  return gauss(mulberry32(hash32(key)), 0, SHADOW_STD)
}

/** 人體遮擋:AP 在背後衰減峰值 12 dB(對齊實測 11.9) */
export function bodyShadow(headingDeg: number, apBearingDeg: number): number {
  return 6 * (1 - Math.cos(((headingDeg - apBearingDeg) * Math.PI) / 180))
}

/** 偵測機率:sigmoid((rssi+90)/3) → 弱 AP 自然閃爍 */
export function detectProb(rssi: number): number {
  return 1 / (1 + Math.exp(-(rssi + 90) / 3))
}

export interface ScanAp { bssid: string; ssid: string; rssi: number; freq: number }

/** 單批掃描——下包引擎的即時觀測源;simSession 內部就是重複呼叫它 */
export function scanAt(world: SimWorld, floorId: string, x: number, y: number, headingDeg: number, rng: Rng): ScanAp[] {
  const level = world.floors.find(f => f.id === floorId)?.level
  if (level === undefined) throw new Error(`未知樓層:${floorId}`)
  const out: ScanAp[] = []
  for (const ap of world.aps) {
    const dx = ap.x - x, dy = ap.y - y
    const dLevel = Math.abs(ap.level - level)
    const d3 = Math.max(1, Math.hypot(dx, dy, FLOOR_SEP * dLevel))
    const bearing = (Math.atan2(dx, dy) * 180) / Math.PI // 模型 +Y 朝北 → 方位角 atan2(dx,dy)
    const base = ap.tx - 10 * PATH_LOSS_N * Math.log10(d3) - CROSS_FLOOR_DB * dLevel
      - pairShadow(world, ap.id, x, y) - bodyShadow(headingDeg, bearing)
    for (const m of ap.bssids) {
      const rssi = Math.round(base + m.offset + gauss(rng, 0, JITTER_STD))
      if (rng() < detectProb(rssi)) out.push({ bssid: m.bssid, ssid: m.ssid, rssi, freq: m.freq })
    }
  }
  for (const h of world.hotspots) { // 位置逐批漂移:永遠在採集者附近 3–15m
    if (rng() >= h.activeProb) continue
    const d = 3 + rng() * 12
    const rssi = Math.round(h.tx - 10 * PATH_LOSS_N * Math.log10(d) + gauss(rng, 0, JITTER_STD))
    if (rng() < detectProb(rssi)) out.push({ bssid: h.bssid, ssid: h.ssid, rssi, freq: h.freq })
  }
  return out
}

// ---- 磁力模型 ----

export interface MagStats {
  n: number
  mean: [number, number, number]
  std: [number, number, number]
  magMean: number
  magStd: number
  accuracy: number
}
export interface MagDirt { rotating?: boolean; disturbed?: boolean; lowAccuracy?: boolean }

/** 該層基準向量 + 弦波空間梯度 → 世界座標真場 */
export function magTrueAt(world: SimWorld, floorId: string, x: number, y: number): [number, number, number] {
  const f = world.mag[floorId]
  if (!f) throw new Error(`未知樓層磁場:${floorId}`)
  const v: [number, number, number] = [...f.base]
  for (const wv of f.waves) {
    const s = Math.sin(wv.kx * x + wv.ky * y + wv.phase)
    v[0] += wv.amp[0] * s; v[1] += wv.amp[1] * s; v[2] += wv.amp[2] * s
  }
  return v
}

const MAG_SAMPLES = 100 // 模擬 ~100 樣本算統計(spec:掃描時窗 50Hz 累積)

/** 掃描時窗的磁力取樣統計。rotating=手機轉一圈(三軸亂、合力穩);disturbed=列車擾動(合力也亂)。 */
export function sampleMag(
  world: SimWorld, floorId: string, x: number, y: number, headingDeg: number,
  hardIron: [number, number, number], rng: Rng, dirt: MagDirt = {},
): MagStats {
  const truth = magTrueAt(world, floorId, x, y)
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], mags: number[] = []
  for (let i = 0; i < MAG_SAMPLES; i++) {
    const hdg = dirt.rotating ? headingDeg + (360 * i) / MAG_SAMPLES : headingDeg // 時窗內轉整圈
    const rad = (hdg * Math.PI) / 180
    // 列車慢漂移旋鈕:magStd ≈ |B| × 振幅 × std(sin over [0,π)) = |B| × 振幅 × 0.308。
    // 本世界 plat-b2 |B|≈40 µT,取 0.25 → magStd≈3.1(0.15 只有 1.86,連 spec 的 >2 都不到)
    const disturb = dirt.disturbed ? 1 + 0.25 * Math.sin((Math.PI * i) / MAG_SAMPLES) : 1
    // 裝置座標 = 世界向量依 heading 旋轉(x,y 平面),z 不變;硬鐵固定在裝置座標
    const wx = truth[0] * disturb, wy = truth[1] * disturb, wz = truth[2] * disturb
    const dxv = wx * Math.cos(rad) - wy * Math.sin(rad) + hardIron[0] + gauss(rng, 0, 0.3)
    const dyv = wx * Math.sin(rad) + wy * Math.cos(rad) + hardIron[1] + gauss(rng, 0, 0.3)
    const dzv = wz + hardIron[2] + gauss(rng, 0, 0.3)
    xs.push(dxv); ys.push(dyv); zs.push(dzv)
    mags.push(Math.hypot(dxv, dyv, dzv))
  }
  const stat = (a: number[]): [number, number] => {
    const m = a.reduce((s, v) => s + v, 0) / a.length
    return [m, Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)]
  }
  const [mx, sx] = stat(xs), [my, sy] = stat(ys), [mz, sz] = stat(zs), [mm, ms] = stat(mags)
  const r1 = (v: number) => Math.round(v * 10) / 10
  return {
    n: MAG_SAMPLES,
    mean: [r1(mx), r1(my), r1(mz)], std: [r1(sx), r1(sy), r1(sz)],
    magMean: r1(mm), magStd: r1(ms),
    accuracy: dirt.lowAccuracy ? 1 : 3,
  }
}

// ---- session 模擬 ----

export interface DirtOpts {
  throttledRate?: number; shortScanRate?: number; rotationRate?: number
  lowMagAccRate?: number; resampleRate?: number
}
export interface SimSessionOpts {
  seed: number
  floors: FloorJson[]
  rpPoints: RpPoint[]
  scansPerPoint?: number
  mode?: 'single' | 'quad'
  world?: WorldOpts
  dirt?: DirtOpts
  hardIron?: [number, number, number]
}
export interface SimResult { world: SimWorld; lines: string[] }

const SCAN_MS = 4400 // 單批 4.3–4.6s(實測)
const T0 = Date.parse('2026-07-25T01:00:00Z') // 假時鐘起點;seed 平移,禁 Date.now
const iso = (ms: number) => new Date(ms).toISOString()

/** 圓形方位角:p → q(模型 +Y 朝北) */
const bearingTo = (p: RpPoint, q: RpPoint) => (Math.atan2(q.x - p.x, q.y - p.y) * 180) / Math.PI

export function simSession(opts: SimSessionOpts): SimResult {
  const { seed, rpPoints, scansPerPoint: N = 10, mode = 'single', hardIron = [0, 0, 0] } = opts
  const dirt = { throttledRate: 0, shortScanRate: 0, rotationRate: 0, lowMagAccRate: 0, resampleRate: 0, ...opts.dirt }
  const world = buildWorld(opts.floors, seed, opts.world)
  const rng = mulberry32(hash32(`session|${seed}`))
  let clock = T0 + seed * 60_000
  const lines: string[] = []

  lines.push(JSON.stringify({
    type: 'session', schema: 'wifi-fp@1', session: `sim-s${seed}`, device: 'sim', android: 0,
    app: 'fp-sim/0.1', mode, scansPerPoint: N, rpList: 'sim', rpGenerated: iso(T0), startedAt: iso(clock),
  }))

  /** 一個 (point, slot) 的完整 point record;會被主迴圈與重採共用 */
  const emitPoint = (p: RpPoint, slot: number | null, walkHeading: number) => {
    const throttled = rng() < dirt.throttledRate
    const short = rng() < dirt.shortScanRate
    const rotating = rng() < dirt.rotationRate
    const lowAcc = rng() < dirt.lowMagAccRate
    const heading = slot === null ? walkHeading : slot + gauss(rng, 0, 5) // quad:對準磁方位槽 ±小噪
    const n = short ? Math.floor(N * 0.5) : N // < 0.6×N → Stage 1 降權可抓
    const started = clock
    const scans: object[] = []
    let cached: ScanAp[] | null = null
    for (let i = 0; i < n; i++) {
      // 轉動污染:中途 180° → RSSI 階梯跳變(對齊實測 s1702 slot 180)
      const hdg = rotating && i >= n / 2 ? heading + 180 : heading
      const aps = throttled ? (cached ??= scanAt(world, p.floor, p.x, p.y, hdg, rng)) : scanAt(world, p.floor, p.x, p.y, hdg, rng)
      clock += SCAN_MS
      scans.push({ t: iso(clock), fresh: !throttled, aps })
    }
    const mag = sampleMag(world, p.floor, p.x, p.y, heading, hardIron, rng,
      { rotating, disturbed: !rotating && rng() < world.mag[p.floor].disturbProb, lowAccuracy: lowAcc }) // 轉動與擾動互斥:各留乾淨特徵給 Stage 1 抓
    clock += 15_000 // 換點
    lines.push(JSON.stringify({
      type: 'point', pointId: p.id, floor: p.floor, x: p.x, y: p.y,
      headingSlot: slot, headingDeg: Math.round(((heading % 360) + 360) % 360 * 10) / 10, headingAcc: 3,
      startedAt: iso(started), durationMs: n * SCAN_MS, actualScans: n, throttled, scans, mag,
    }))
  }

  const slots = mode === 'quad' ? [0, 90, 180, 270] : [null]
  let walkHeading = 0
  for (const [i, p] of rpPoints.entries()) {
    const next = rpPoints[i + 1]
    if (next && next.floor === p.floor) walkHeading = bearingTo(p, next) // 面向行走方向;末點沿用
    for (const slot of slots) emitPoint(p, slot, walkHeading)
  }
  // 重採:同 (pointId,slot) 再 append 一行 → 離線「取最後一行」語意可測
  for (const p of rpPoints) if (rng() < dirt.resampleRate) for (const slot of slots) emitPoint(p, slot, walkHeading)

  return { world, lines }
}

// ---- CLI ----
function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def
}

function main() {
  const seed = Number(arg('seed', '1'))
  const rpFile = arg('rp', 'rp/rp-points.json')
  const outDir = arg('out', 'rp/sim')
  const mode = arg('mode', 'single') as 'single' | 'quad'
  const N = Number(arg('n', '10'))
  const rpList = JSON.parse(readFileSync(rpFile, 'utf8')) as { points: RpPoint[] }
  const station = JSON.parse(readFileSync('data/station.json', 'utf8'))
  const wanted = new Set(rpList.points.map(p => p.floor))
  const floors: FloorJson[] = station.floors
    .filter((f: { id: string }) => wanted.has(f.id))
    .map((f: { file: string }) => JSON.parse(readFileSync(join('data', f.file), 'utf8')))
  // 預設帶少量髒資料:Stage 1 每條規則都有東西可抓
  const { lines, world } = simSession({
    seed, floors, rpPoints: rpList.points, scansPerPoint: N, mode,
    dirt: { throttledRate: 0.05, shortScanRate: 0.05, rotationRate: 0.05, lowMagAccRate: 0.05, resampleRate: 0.02 },
  })
  mkdirSync(outDir, { recursive: true })
  const out = join(outDir, `wifi-fp-sim-s${seed}.jsonl`)
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(`${rpList.points.length} 點 × ${mode} → ${lines.length - 1} 筆 point`)
  console.log(`世界:${world.aps.length} 顆實體 AP(${world.aps.reduce((s, a) => s + a.bssids.length, 0)} BSSID)、${world.hotspots.length} 熱點`)
  console.log(`→ ${out}`)
}

// vite-node 不透露進入點（process.argv[1] 恆為 vite-node.mjs、env 也無此資訊），
// 因此無法判斷「我是不是被直接執行」。反過來判斷即可：唯一會 import 本檔的是測試。
if (!process.env.VITEST) main()
