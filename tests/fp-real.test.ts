import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildDb, cleanSamples, parseSessions, popcount, ROT_AXIS_RATIO, ROT_AXIS_STD } from '../tools/fp-build'

/** 真機採集(家中 8 點,2026-07-26)的匿名化版本;採集條件與已知發現見同目錄 README.md */
const TEXT = readFileSync('tests/fixtures/real-home/session.jsonl', 'utf8')
const clean = () => {
  const { kept } = cleanSamples(parseSessions([TEXT]).samples)
  return new Map(kept.map(k => [k.rec.pointId, k]))
}

describe('真機回歸:Stage 1 清洗判定', () => {
  it('P01 原地轉 360° 判轉動——合力 magStd 7.09 早已超過環境擾動門檻,只看 magStd 會誤判', () => {
    const p = clean().get('P01')!
    expect(Math.max(...p.rec.mag.std)).toBeCloseTo(24.72, 1)
    expect(p.rec.mag.magStd).toBeCloseTo(7.09, 1) // > MAGSTD_SPLIT(2):舊規則會落進環境擾動分支
    expect(Math.max(...p.rec.mag.std)).toBeGreaterThan(p.rec.mag.magStd * ROT_AXIS_RATIO) // 比值才抓得到
    expect(p).toMatchObject({ w: 0.5, magOk: false }) // 轉動污染 WiFi → 降權
  })

  it('P07 正常站定判乾淨;P02/P04/P05/P06 同樣乾淨', () => {
    const c = clean()
    for (const id of ['P02', 'P04', 'P05', 'P06', 'P07']) expect(c.get(id)).toMatchObject({ w: 1, magOk: true })
    expect(Math.max(...c.get('P07')!.rec.mag.std)).toBeLessThan(ROT_AXIS_STD)
  })

  it('P03 環境擾動:軸向與合力同幅度漲 → 剔磁力但 WiFi 保留全權重', () => {
    const p = clean().get('P03')!
    expect(Math.max(...p.rec.mag.std)).toBeLessThan(p.rec.mag.magStd * ROT_AXIS_RATIO) // 比值不成立
    expect(p).toMatchObject({ w: 1, magOk: false })
  })

  it('P08 手舉高判裝置移動——姿勢改變同樣讓軸向主導,處置與轉動相同', () => {
    expect(clean().get('P08')).toMatchObject({ w: 0.5, magOk: false })
  })

  it('無點被整筆剔除(這次採集沒有 throttled)', () => {
    expect(cleanSamples(parseSessions([TEXT]).samples).dropped).toEqual([])
  })
})

describe('真機回歸:建庫結構', () => {
  const db = buildDb([TEXT], { station: 'real-home', generated: 'fixture' })

  it('八點全數入庫,每點 Top-15 滿額,轉動/擾動點的磁力被剔除', () => {
    const rps = Object.values(db.floors).flatMap(f => f.rps)
    expect(rps.length).toBe(8)
    for (const rp of rps) expect(Object.keys(rp.aps).length).toBe(15)
    const magNull = rps.filter(rp => rp.mag === null).map(rp => rp.id).sort()
    expect(magNull).toEqual(['P01', 'P03', 'P08']) // 轉動、環境擾動、裝置移動
  })

  it('熱點濾除零誤殺:排除的全是出現率過低者,沒有任何 ssid-pattern/drift', () => {
    expect(new Set(Object.values(db.excluded))).toEqual(new Set(['rare']))
  })

  it('雙頻合併有發生:9 個錨點含多個 BSSID', () => {
    expect(Object.values(db.anchors).filter(a => a.bssids.length > 1).length).toBe(9)
  })
})

describe('【已知缺口】衍生 MAC 未合併——待決 #4 裁定後這兩條會紅', () => {
  // 廠商常把 IEEE locally-administered bit 設起來另開 BSSID:bytes 1-2 與尾 3 bytes 幾乎相同、
  // 只有首 byte 不同。現行 mergeAnchors 先用完整 OUI 分組,所以這些永遠不會被拿來比對,
  // 同一台 AP 被算成兩份獨立證據。刻意保留,見 docs/adr/0001-anchor-as-independent-evidence.md。
  const db = buildDb([TEXT], { station: 'real-home', generated: 'fixture' })
  const tail3 = (s: string) => { const b = s.split(':').map(x => parseInt(x, 16)); return (b[3] << 16) | (b[4] << 8) | b[5] }
  const mid2 = (s: string) => { const b = s.split(':').map(x => parseInt(x, 16)); return (b[1] << 8) | b[2] }
  const anchors = Object.keys(db.anchors)
  const suspect = anchors.flatMap((a, i) => anchors.slice(i + 1)
    .filter(c => mid2(a) === mid2(c) && popcount(tail3(a) ^ tail3(c)) <= 1)
    .map(c => [a, c] as const))

  it('目前有 5 對疑似同源的錨點未被合併(改判準後應為 0)', () => {
    expect(suspect.length).toBe(5)
  })

  it('其中 10 對同時進了某個 RP 的 Top-15,佔全部欄位 16.7%(改判準後應為 0)', () => {
    const rps = Object.values(db.floors).flatMap(f => f.rps)
    const dupInTop = rps.reduce((n, rp) => n + suspect.filter(([a, c]) => a in rp.aps && c in rp.aps).length, 0)
    expect(dupInTop).toBe(10)
    expect((dupInTop * 2) / (rps.length * 15)).toBeCloseTo(0.167, 2)
  })
})
