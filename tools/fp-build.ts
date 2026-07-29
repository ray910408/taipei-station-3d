/**
 * 離線 pipeline Stage 1(清洗)＋ Stage 2(建庫):wifi-fp@1 JSONL → fp-db@1 JSON。
 * 原始 JSONL 永不修改;規則常數 exported 可調可回溯。
 * 用法:npm run build:fp -- rp/sim/xxx.jsonl [more.jsonl] [--station id] [--out path]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
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
  // 樣本只以 (pointId, headingSlot) 為鍵,而重產的清單會把同一個 id 指到不同座標。
  // 混版合併的結果是:新檔覆蓋同名 id、舊清單獨有的 id 原封留下,產出一份摻了
  // 兩套座標的庫,而且完全不會報錯。只能擋,不能靠鍵去分。
  let listVer: string | null = null
  for (const text of texts) {
    let cur: { session: string; scansPerPoint: number } | null = null
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (!line.trim()) continue
      let rec: any
      try { rec = JSON.parse(line) } catch (e) { throw new Error(`第 ${i + 1} 行:JSON 解析失敗——${e}`) } // 截斷行(採集中斷)最常見
      if (rec.type === 'session') {
        if (typeof rec.scansPerPoint !== 'number') throw new Error(`第 ${i + 1} 行:session header 缺 scansPerPoint`) // 否則短掃描規則靜默比 NaN
        const ver = typeof rec.rpGenerated === 'string' ? rec.rpGenerated : ''
        if (listVer === null) listVer = ver // 只有一個 session 時沒有可混的對象,缺版本無妨
        else if (ver === '' || listVer === '') {
          // 缺版本 ≠ 版本相同。兩個都缺時若各自來自不同清單,把它們都正規化成 ''
          // 會讓相等檢查放行,正好漏掉這個檢查要擋的情形
          throw new Error(`要合併多個 session,但有檔案沒記錄 rpGenerated(${!ver ? rec.session : sessions[0]}),` +
            `無法確認是否同一份清單。請分開建庫。`)
        } else if (ver !== listVer) {
          throw new Error(`清單版本不一致:${sessions[0]} 用 rpGenerated=${listVer},${rec.session} 用 ${ver}。` +
            `同一個 pointId 在兩份清單指向不同座標,合併會產出摻了兩套座標的庫——請分開建庫。`)
        }
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
// 必須與 APK 的 MAG_AXIS_NOISY_STD 同值:採集端顯示 OK 的點若在這裡被判成轉動,
// 磁力會被剔除且 WiFi 遭降權——採集者看到綠燈,建庫卻默默丟掉。
// 6.0 由實測兩端夾出:北車手持站定軸向 std 上限 4.75,真轉動 10~19。
export const ROT_AXIS_STD = 6       // 軸向 std 超過此(µT)才談轉動
export const ROT_AXIS_RATIO = 2     // 且軸向 > 合力×此 → 手機轉動(轉動的軸向擾動遠大於合力擾動)
export const MAGSTD_SPLIT = 2       // 合力 std 超過此(µT)=環境磁場真的變了
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
    // 轉動的特徵是「軸向擾動遠大於合力擾動」,環境磁場變化則兩者同步漲。不可只看 magStd 門檻:
    // 殘留硬鐵偏移會讓合力也隨轉動超標(真機 0726 P01 軸10.16/合2.75、P07 軸18.70/合3.95),
    // 單看門檻會把轉動誤判成環境擾動而讓污染的 WiFi 拿到全權重。與 APK magQuality() 同一判別式。
    const axisMax = Math.max(...m.std)
    if (m.accuracy <= MIN_MAG_ACCURACY) magOk = false
    else if (axisMax > ROT_AXIS_STD && axisMax > m.magStd * ROT_AXIS_RATIO) { magOk = false; w *= DOWNWEIGHT } // 手機轉動:WiFi 亦污染
    else if (m.magStd > MAGSTD_SPLIT || axisMax > ROT_AXIS_STD) magOk = false // 環境擾動(含兩者同幅度漲):WiFi 保留
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
export const HOTSPOT_MIN_RP = 3   // 全庫出現 RP 數低於此 → rare(但可被出現率脫罪,見下)
/** 出現 RP 數少不必然是熱點:RP 間距 20 m 的月台上,正常 AP 的有效範圍常只涵蓋 1~2 個 RP,
 *  湊滿 3 個要橫跨約 40 m。真熱點的特徵是「連在該點也只是偶爾出現」——路過的手機只被少數
 *  幾批掃到,固定 AP 則幾乎每批都在。改用出現率脫罪,判準就不再隨 RP 密度漂移。 */
export const RARE_RESCUE_DETECT_RATE = 0.8
export const DRIFT_DIST = 30      // 相距 >30m 的 RP 皆不弱 → 在移動
export const DRIFT_STRONG = -75   // 「不弱」門檻(dBm)

export function filterHotspots(kept: CleanSample[]): Map<string, string> {
  // 每 BSSID:出現過的 RP(座標/樓層/每 RP 平均 RSSI)與看過的 ssid
  const stat = new Map<string, { ssids: Set<string>; rps: Map<string, { floor: string; x: number; y: number; sum: number; n: number; batches: number }> }>()
  for (const { rec } of kept) {
    for (const scan of rec.scans) for (const ap of scan.aps) {
      let s = stat.get(ap.bssid)
      if (!s) stat.set(ap.bssid, s = { ssids: new Set(), rps: new Map() })
      if (ap.ssid) s.ssids.add(ap.ssid)
      let r = s.rps.get(rec.pointId)
      if (!r) s.rps.set(rec.pointId, r = { floor: rec.floor, x: rec.x, y: rec.y, sum: 0, n: 0, batches: rec.scans.length })
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
    // 出現率高＝在該點穩定可見,是固定 AP 而非路過的手機;RP 數少不足以定罪
    const bestRate = Math.max(...[...s.rps.values()].map(r => r.n / Math.max(1, r.batches)))
    if (s.rps.size < HOTSPOT_MIN_RP && bestRate < RARE_RESCUE_DETECT_RATE) excluded.set(bssid, 'rare')
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

// ---- Stage 2 建庫 ----

export const TOP_K = 15            // 每 RP 錨點數上限(detectRate×強度排序,spec 2.1)
export const MAG_AXIS_STD_MAX = 1.5 // 三軸 mean 僅收 std 低於此的樣本(spec 2.2)

export interface FpDbRp {
  id: string; x: number; y: number
  aps: Record<string, [number, number, number, number]> // [mean, std, rate, n]
  mag: { magMean: number; axes?: [number, number, number] } | null
}
export interface FpDb {
  schema: 'fp-db@1'; station: string; generated: string; sourceSessions: string[]
  magNorthOffsetDeg: null // 磁北→模型北偏角:現場量一次的常數,佔位
  anchors: Record<string, { bssids: string[]; ssid: string }>
  excluded: Record<string, string>
  floors: Record<string, { rps: FpDbRp[] }>
}

const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

export function buildDb(texts: string[], opts: { station: string; generated: string }): FpDb {
  const { samples, sessions } = parseSessions(texts)
  const { kept } = cleanSamples(samples)
  const excluded = filterHotspots(kept)
  // 合併名單:全庫非熱點 BSSID
  const members = new Map<string, string>() // bssid → 首見 ssid
  for (const { rec } of kept) for (const s of rec.scans) for (const ap of s.aps) {
    if (!excluded.has(ap.bssid) && !members.has(ap.bssid)) members.set(ap.bssid, ap.ssid)
  }
  const anchorOf = mergeAnchors([...members].map(([bssid, ssid]) => ({ bssid, ssid })))

  // RP 聚合:pointId → 樓層/座標＋各錨點的加權統計(跨 slot 聚合,heading-agnostic)
  interface Acc { vals: { v: number; w: number }[]; wPresent: number; n: number }
  const rps = new Map<string, { floor: string; x: number; y: number; aps: Map<string, Acc>; wScan: number
    magW: number; magSum: number; axW: number; axSum: [number, number, number] }>()
  for (const { rec, w, magOk } of kept) {
    let rp = rps.get(rec.pointId)
    if (!rp) rps.set(rec.pointId, rp = { floor: rec.floor, x: rec.x, y: rec.y, aps: new Map(), wScan: 0, magW: 0, magSum: 0, axW: 0, axSum: [0, 0, 0] })
    rp.wScan += w * rec.scans.length
    for (const scan of rec.scans) {
      const best = new Map<string, number>() // 同批同錨點取 max
      for (const ap of scan.aps) {
        const anchor = anchorOf.get(ap.bssid)
        if (!anchor) continue // 已排除的熱點
        best.set(anchor, Math.max(best.get(anchor) ?? -Infinity, ap.rssi))
      }
      for (const [anchor, v] of best) {
        let a = rp.aps.get(anchor)
        if (!a) rp.aps.set(anchor, a = { vals: [], wPresent: 0, n: 0 })
        a.vals.push({ v, w }); a.wPresent += w; a.n++
      }
    }
    if (magOk) {
      rp.magW += w; rp.magSum += w * rec.mag.magMean
      if (Math.max(...rec.mag.std) < MAG_AXIS_STD_MAX) {
        rp.axW += w
        rp.axSum[0] += w * rec.mag.mean[0]; rp.axSum[1] += w * rec.mag.mean[1]; rp.axSum[2] += w * rec.mag.mean[2]
      }
    }
  }

  const floors: Record<string, { rps: FpDbRp[] }> = {}
  const usedAnchors = new Set<string>()
  for (const [id, rp] of rps) {
    const entries: [string, [number, number, number, number]][] = []
    for (const [anchor, a] of rp.aps) {
      const wSum = a.vals.reduce((s, x) => s + x.w, 0)
      const mean = a.vals.reduce((s, x) => s + x.w * x.v, 0) / wSum
      const std = Math.sqrt(a.vals.reduce((s, x) => s + x.w * (x.v - mean) ** 2, 0) / wSum)
      entries.push([anchor, [r1(mean), r1(std), r2(a.wPresent / rp.wScan), a.n]])
    }
    entries.sort((a, b) => b[1][2] * (b[1][0] + 100) - a[1][2] * (a[1][0] + 100)) // detectRate×強度
    const top = entries.slice(0, TOP_K)
    for (const [anchor] of top) usedAnchors.add(anchor)
    const mag = rp.magW > 0
      ? { magMean: r1(rp.magSum / rp.magW), ...(rp.axW > 0 ? { axes: rp.axSum.map(v => r1(v / rp.axW)) as [number, number, number] } : {}) }
      : null
    ;(floors[rp.floor] ??= { rps: [] }).rps.push({ id, x: rp.x, y: rp.y, aps: Object.fromEntries(top), mag })
  }

  // anchors 表:只留被任一 RP 引用的
  const anchorMembers = new Map<string, string[]>()
  for (const [bssid, anchor] of anchorOf) (anchorMembers.get(anchor) ?? anchorMembers.set(anchor, []).get(anchor)!).push(bssid)
  const anchors: Record<string, { bssids: string[]; ssid: string }> = {}
  for (const anchor of usedAnchors) {
    const bssids = [...(anchorMembers.get(anchor) ?? [anchor])].sort() // 先排序再取 ssid——首個非空與掃描遭遇序無關
    const ssid = bssids.map(b => members.get(b) ?? '').find(s => s !== '') ?? ''
    anchors[anchor] = { bssids, ssid }
  }

  return {
    schema: 'fp-db@1', station: opts.station, generated: opts.generated, sourceSessions: sessions,
    magNorthOffsetDeg: null, anchors, excluded: Object.fromEntries(excluded), floors,
  }
}

// ---- CLI ----
function main() {
  // parseArgs 為 strict:預設擋下未知選項;檔名走 positionals,不再誤收 --out 的值
  const { values, positionals } = parseArgs({
    options: { station: { type: 'string' }, out: { type: 'string' } },
    allowPositionals: true,
  })
  const files = positionals.filter(a => a.endsWith('.jsonl'))
  if (files.length === 0) { console.error('用法:npm run build:fp -- <session.jsonl> [more.jsonl] [--station id] [--out path]'); process.exit(1) }
  const station = values.station ?? 'taipei-main-station'
  const out = values.out ?? join('public', 'fp', `${station}.json`)
  const db = buildDb(files.map(f => readFileSync(f, 'utf8')), { station, generated: new Date().toISOString() })
  const json = JSON.stringify(db)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, json)
  const nRp = Object.values(db.floors).reduce((s, f) => s + f.rps.length, 0)
  console.log(`RP ${nRp} 點 · 錨點 ${Object.keys(db.anchors).length} · 排除 ${Object.keys(db.excluded).length} BSSID`)
  console.log(`${(json.length / 1024).toFixed(0)} KB(gzip ${(gzipSync(json).length / 1024).toFixed(0)} KB)→ ${out}`)
}

// 見 fp-sim.ts 同處註解：vite-node 無進入點資訊，改以「非測試環境」為判準
if (!process.env.VITEST) main()
