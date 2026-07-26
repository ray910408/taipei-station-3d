/**
 * 間距試驗分析:回答「RP 點該隔多遠」。
 *
 * 判準:兩點的指紋差異必須明顯大於同一點自己的雜訊,才算分得開。
 *   - 雜訊底線 = 同點掃描分兩半(奇/偶次)各算一份指紋,兩者的差異
 *   - 訊號 = 不同點之間的指紋差異
 * 指紋差異超過雜訊底線約 2 倍的那個距離,就是可用的最小間距。
 *
 * 用法:npm run analyze:spacing -- <session.jsonl>
 */
import { readFileSync } from 'node:fs'

const RSSI_FLOOR = -95 // 未偵測到的 AP 以此值代入(低於一般雜訊底 -90)
const MIN_DETECT_RATE = 0.5 // 出現率低於此的 AP 不列入(閃爍 AP 只會加雜訊)

interface PointRec {
  pointId: string
  x: number
  y: number
  headingSlot: number | null
  scans: { aps: { bssid: string; rssi: number }[] }[]
}

type Fingerprint = Map<string, number>

/** 由若干批掃描算出指紋:每個 BSSID 的平均 RSSI。
 *  `allowed` 指定時只算這些 BSSID(分半比對用——兩半必須共用同一份 AP 名單,
 *  否則 50% 出現率的 AP 會在一半入選、另一半缺席,被記成滿額懲罰,雜訊被高估)。 */
export function fingerprint(scans: PointRec['scans'], allowed?: Set<string>): Fingerprint {
  const sum = new Map<string, number>()
  const cnt = new Map<string, number>()
  for (const s of scans) {
    for (const ap of s.aps) {
      if (allowed && !allowed.has(ap.bssid)) continue
      sum.set(ap.bssid, (sum.get(ap.bssid) ?? 0) + ap.rssi)
      cnt.set(ap.bssid, (cnt.get(ap.bssid) ?? 0) + 1)
    }
  }
  const fp: Fingerprint = new Map()
  for (const [bssid, c] of cnt) {
    if (allowed) fp.set(bssid, sum.get(bssid)! / c) // 名單已篩過,不再二次過濾
    else if (c / scans.length >= MIN_DETECT_RATE) fp.set(bssid, sum.get(bssid)! / c)
  }
  return fp
}

/** 指紋距離:取兩者 BSSID 聯集,缺席以 RSSI_FLOOR 代入,算 RMS 差(dB) */
export function fpDistance(a: Fingerprint, b: Fingerprint): number {
  const keys = new Set([...a.keys(), ...b.keys()])
  if (keys.size === 0) return NaN
  let sq = 0
  for (const k of keys) {
    const d = (a.get(k) ?? RSSI_FLOOR) - (b.get(k) ?? RSSI_FLOOR)
    sq += d * d
  }
  return Math.sqrt(sq / keys.size)
}

function main(file: string) {
const points: PointRec[] = readFileSync(file, 'utf8')
  .split(/\r?\n/).filter(Boolean)
  .map(l => JSON.parse(l))
  .filter((o: { type: string }) => o.type === 'point')

if (points.length < 3) { console.error(`只有 ${points.length} 個點,至少要 3 個`); process.exit(1) }

// —— 1. 雜訊底線:同點奇偶批各算一份指紋 ——
const noises: number[] = []
const apCounts: number[] = []
for (const p of points) {
  if (p.scans.length < 4) continue
  const allowed = new Set(fingerprint(p.scans).keys()) // 名單由完整資料決定,兩半共用
  apCounts.push(allowed.size)
  const even = fingerprint(p.scans.filter((_, i) => i % 2 === 0), allowed)
  const odd = fingerprint(p.scans.filter((_, i) => i % 2 === 1), allowed)
  noises.push(fpDistance(even, odd))
}
const noiseFloor = noises.reduce((a, b) => a + b, 0) / noises.length

console.log(`\n檔案:${file}`)
console.log(`點數:${points.length}  每點掃描:${points[0].scans.length} 批`)
console.log(`可用 AP(出現率 ≥${MIN_DETECT_RATE * 100}%):平均每點 ${(apCounts.reduce((a, b) => a + b, 0) / apCounts.length).toFixed(1)} 顆`)
console.log(`\n=== 雜訊底線(同點分半比對)===`)
console.log(`平均 ${noiseFloor.toFixed(2)} dB   範圍 ${Math.min(...noises).toFixed(2)} ~ ${Math.max(...noises).toFixed(2)} dB`)

// —— 2. 兩兩比對:實體距離 vs 指紋距離 ——
const fps = points.map(p => ({ p, fp: fingerprint(p.scans) }))
const bins = new Map<number, number[]>()
const repeats: { a: string; b: string; d: number }[] = []

for (let i = 0; i < fps.length; i++) {
  for (let j = i + 1; j < fps.length; j++) {
    const A = fps[i], B = fps[j]
    if (A.p.headingSlot !== B.p.headingSlot) continue // 只比同朝向
    const phys = Math.hypot(A.p.x - B.p.x, A.p.y - B.p.y)
    const d = fpDistance(A.fp, B.fp)
    if (phys < 0.5) { repeats.push({ a: A.p.pointId, b: B.p.pointId, d }); continue }
    const bin = Math.round(phys / 2) * 2
    const arr = bins.get(bin)
    if (arr) arr.push(d); else bins.set(bin, [d])
  }
}

// 基準選擇:分半雜訊只看「同一個 26 秒時窗內」的抖動,低估了真實雜訊;
// 同位置隔一段時間重測才是指紋庫日後被查詢時要面對的雜訊。有重測就用它。
let baseline = noiseFloor
let baselineName = '分半雜訊'
if (repeats.length) {
  const repMean = repeats.reduce((a, r) => a + r.d, 0) / repeats.length
  console.log(`\n=== 同位置重測(時間漂移)===`)
  for (const r of repeats) console.log(`${r.a} vs ${r.b}: ${r.d.toFixed(2)} dB`)
  if (repMean > noiseFloor) {
    baseline = repMean
    baselineName = '時間漂移'
    console.log(`時間漂移(${repMean.toFixed(2)} dB)> 分半雜訊(${noiseFloor.toFixed(2)} dB)`)
    console.log(`→ 改用時間漂移當基準(指紋庫日後被查詢時面對的是這個量級)`)
  }
}

const sorted = [...bins.keys()].sort((a, b) => a - b)
if (sorted.length === 0) {
  console.log(`\n沒有可比對的點對——需要「同朝向、不同位置」的點至少 2 個`)
  console.log(`(四朝向檔只有單一位置時會這樣;間距試驗請用 rp-pilot-spacing.json 的直線清單)\n`)
  process.exit(0)
}

console.log(`\n=== 指紋距離 vs 實體距離(基準:${baselineName} ${baseline.toFixed(2)} dB)===`)
console.log(`距離(m)  對數   指紋差(dB)  對基準倍率`)
let recommend = 0
const xs: number[] = [], ys: number[] = []
for (const bin of sorted) {
  const arr = bins.get(bin)!
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length
  const ratio = mean / baseline
  const mark = ratio >= 2 ? ' ★' : ''
  console.log(`${String(bin).padStart(5)}   ${String(arr.length).padStart(4)}   ${mean.toFixed(2).padStart(9)}   ${ratio.toFixed(2).padStart(8)}${mark}`)
  if (recommend === 0 && ratio >= 2) recommend = bin
  for (const d of arr) { xs.push(bin); ys.push(d) }
}

// 空間鑑別力:指紋距離必須隨實體距離成長才代表指紋帶位置資訊
const n = xs.length
const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
let sxy = 0, sxx = 0, syy = 0
for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2 }
const corr = sxy / Math.sqrt(sxx * syy)

console.log(`\n=== 結論 ===`)
console.log(`實體距離 vs 指紋距離 相關係數 r = ${corr.toFixed(3)}`)
if (corr < 0.3) {
  console.log(`\n⚠ 指紋距離幾乎不隨實體距離成長 —— 這批資料無法回答間距問題。`)
  console.log(`  常見原因(逐一排除):`)
  console.log(`  1. 實際沒有走足 ${sorted[0]} m 間距(分析假設清單座標＝真實移動距離)`)
  console.log(`  2. 可用 AP 太少(本批平均 ${(apCounts.reduce((a, b) => a + b, 0) / apCounts.length).toFixed(1)} 顆),不足以分辨位置`)
  console.log(`  3. 時間漂移(${baseline.toFixed(2)} dB)蓋過空間差異`)
  console.log(`  → 要在 AP 密度足夠的真實場域(北車)重做,並確認有走足間距。`)
} else if (recommend > 0) {
  console.log(`指紋差達基準 2 倍的最小距離:${recommend} m`)
  console.log(`→ 建議 RP 間距 ≥ ${recommend} m(再密只是重複採同一份資訊)`)
} else {
  console.log(`在 ${Math.max(...sorted)} m 內指紋差都未達基準 2 倍`)
  console.log(`→ 這個環境 AP 鑑別力偏低,間距要放到 ${Math.max(...sorted) + 2} m 以上,或改走區段級定位`)
}
console.log(`(★ = 該距離已可分辨)\n`)
}

const file = process.argv.find(a => a.endsWith('.jsonl'))
if (file) main(file)
else if (process.env.npm_lifecycle_event === 'analyze:spacing') {
  console.error('用法:npm run analyze:spacing -- <session.jsonl>')
  process.exit(1)
}
