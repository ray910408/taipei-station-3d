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
import { MIN_DETECT_RATE, fingerprint, fpDistance } from '../src/fp/core'

interface PointRec {
  pointId: string
  x: number
  y: number
  headingSlot: number | null
  startedAt: string
  scans: { aps: { bssid: string; rssi: number }[] }[]
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

// —— 2. 兩兩比對 ——
const fps = points.map(p => ({ p, fp: fingerprint(p.scans) }))

// 原地時間序列:座標全同(清單本身就同點),或使用者以 --fixed 宣告「名目座標不同但人沒移動」
const allSameSpot = fps.every(f => f.p.x === fps[0].p.x && f.p.y === fps[0].p.y)
if (allSameSpot || process.argv.includes('--fixed')) {
  console.log(`\n=== 原地時間序列${allSameSpot ? '(座標全同)' : '(--fixed 宣告)'} ===`)
  const rows: { gap: number; d: number }[] = []
  for (let i = 0; i < fps.length; i++) {
    for (let j = i + 1; j < fps.length; j++) {
      const gap = (Date.parse(fps[j].p.startedAt) - Date.parse(fps[i].p.startedAt)) / 1000
      rows.push({ gap: Math.abs(gap), d: fpDistance(fps[i].fp, fps[j].fp) })
    }
  }
  const drift = rows.reduce((a, r) => a + r.d, 0) / rows.length
  console.log(`跨度 ${(Math.max(...rows.map(r => r.gap)) / 60).toFixed(1)} 分鐘 · ${rows.length} 對`)
  console.log(`\n間隔(分)  對數  平均漂移(dB)`)
  const tb = new Map<number, number[]>()
  for (const r of rows) {
    const b = Math.max(1, Math.round(r.gap / 60))
    const arr = tb.get(b); if (arr) arr.push(r.d); else tb.set(b, [r.d])
  }
  for (const b of [...tb.keys()].sort((a, c) => a - c)) {
    const arr = tb.get(b)!
    console.log(`${String(b).padStart(6)}${String(arr.length).padStart(6)}${(arr.reduce((a, c) => a + c, 0) / arr.length).toFixed(2).padStart(14)}`)
  }
  // 窗內 vs 跨窗:決定「每點掃幾次」的關鍵。跨窗遠大於窗內 → 加掃次數效益很低
  const nEff = points[0].scans.length
  const tot = (n: number) => Math.sqrt(drift ** 2 + (noiseFloor * Math.sqrt(nEff / n)) ** 2)
  console.log(`\n窗內雜訊 ${noiseFloor.toFixed(2)} dB · 跨窗漂移 ${drift.toFixed(2)} dB(比 ${(drift / noiseFloor).toFixed(1)}×)`)
  console.log(`總雜訊推估:N=${nEff} → ${tot(nEff).toFixed(2)} dB;N=${Math.ceil(nEff / 2)} → ${tot(Math.ceil(nEff / 2)).toFixed(2)} dB`)
  if (drift > noiseFloor * 3) {
    console.log(`→ 主雜訊在跨窗尺度,加掃次數幾乎沒用;N 可減半換取採集時間`)
  }
  console.log(`\n指紋要能分辨兩個位置,空間差異需 > ${(drift * 2).toFixed(1)} dB(漂移的 2 倍)`)
  console.log(`→ 空間鑑別力要靠「真的走開」的樣線才量得出來,本檔無法回答間距問題\n`)
  process.exit(0)
}

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
  console.log(`\n  若這批其實是「原地連測」(人沒移動,座標只是清單給的名目值):`)
  console.log(`  加 --fixed 重跑,會改測時間穩定性並推估每點該掃幾次。`)
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
