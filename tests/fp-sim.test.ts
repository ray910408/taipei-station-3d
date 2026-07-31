import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FloorJson } from '../tools/gen-rp-points'
import { pointInPolygon } from '../src/geometry'
import { HOTSPOT_SSIDS, buildWorld, gauss, hash32, magTrueAt, mulberry32, sampleMag, scanAt, simSession, type SimWorld } from '../tools/fp-sim'
import { fingerprint, fpDistance } from '../src/fp/core'

const loadMini = (): FloorJson[] => ['hall-b1', 'plat-b2']
  .map(id => JSON.parse(readFileSync(`tests/fixtures/mini/data/floors/${id}.json`, 'utf8')))

/** 尾 3 bytes 的 xor popcount(同源判定用) */
const tailXorBits = (a: string, b: string): number => {
  const tail = (s: string) => parseInt(s.split(':').slice(3).join(''), 16)
  let x = tail(a) ^ tail(b), n = 0
  while (x) { n += x & 1; x >>>= 1 }
  return n
}

describe('fp-sim 亂數', () => {
  it('mulberry32:同 seed 同序列,不同 seed 不同', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43)
    const seqA = [a(), a(), a()], seqB = [b(), b(), b()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual([c(), c(), c()])
    expect(seqA.every(v => v >= 0 && v < 1)).toBe(true)
  })

  it('gauss:均值/標準差量級正確', () => {
    const rng = mulberry32(1)
    const xs = Array.from({ length: 2000 }, () => gauss(rng, 10, 3))
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    const std = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
    expect(mean).toBeGreaterThan(9.7); expect(mean).toBeLessThan(10.3)
    expect(std).toBeGreaterThan(2.7); expect(std).toBeLessThan(3.3)
  })

  it('hash32:決定性且不同輸入不同雜湊', () => {
    expect(hash32('a|b')).toBe(hash32('a|b'))
    expect(hash32('a|b')).not.toBe(hash32('a|c'))
  })
})

describe('buildWorld', () => {
  const floors = loadMini()

  it('同 seed 同世界;不同 seed 不同', () => {
    expect(buildWorld(floors, 7)).toEqual(buildWorld(floors, 7))
    expect(buildWorld(floors, 7)).not.toEqual(buildWorld(floors, 8))
  })

  it('levels 覆寫:同深站體同 level,AP 繼承樓層 level(不再以陣列索引假造跨層衰減)', () => {
    const w = buildWorld(floors, 7, { apsPerFloor: 4, levels: [0, 0] })
    expect(w.floors.map(f => f.level)).toEqual([0, 0])
    for (const ap of w.aps) expect(ap.level).toBe(0)
  })

  it('AP 落在自己樓層 slab 內,tx 在合理範圍', () => {
    const w = buildWorld(floors, 7, { apsPerFloor: 5 })
    expect(w.aps.length).toBe(10) // 兩層各 5
    for (const ap of w.aps) {
      const f = w.floors.find(f => f.id === ap.floor)!
      expect(pointInPolygon([ap.x, ap.y], f.outline)).toBe(true)
      expect(ap.tx).toBeGreaterThan(-60); expect(ap.tx).toBeLessThan(-20)
    }
  })

  it('BSSID 同胞:1–3 個、同 OUI、尾 3 bytes 差 ≤1 bit、含 5G/隱藏 SSID 樣態', () => {
    const w = buildWorld(floors, 7, { apsPerFloor: 5 })
    let sawMulti = false, sawHidden = false, saw5g = false
    for (const ap of w.aps) {
      expect(ap.bssids.length).toBeGreaterThanOrEqual(1)
      expect(ap.bssids.length).toBeLessThanOrEqual(3)
      const base = ap.bssids[0].bssid
      expect(ap.id).toBe([...ap.bssids.map(b => b.bssid)].sort()[0]) // 錨點 id=最小 bssid
      for (const m of ap.bssids.slice(1)) {
        sawMulti = true
        expect(m.bssid.slice(0, 8)).toBe(base.slice(0, 8)) // 同 OUI
        expect(tailXorBits(base, m.bssid)).toBeLessThanOrEqual(1)
        if (m.ssid === '') sawHidden = true
        if (m.freq > 5000) saw5g = true
      }
    }
    expect(sawMulti && sawHidden && saw5g).toBe(true) // 給 Stage 1.3 合併邏輯抓的樣態都在
  })

  it('熱點:SSID 出自樣式庫;月台層磁場擾動機率 > 穿堂層', () => {
    const w = buildWorld(floors, 7, { hotspotCount: 3 })
    expect(w.hotspots.length).toBe(3)
    for (const h of w.hotspots) expect(HOTSPOT_SSIDS).toContain(h.ssid)
    expect(w.mag['plat-b2'].disturbProb).toBeGreaterThan(w.mag['hall-b1'].disturbProb) // plat 有 platform area
  })
})

/** 手工小世界:單顆 AP 正北 10m,無熱點——朝向/物理公式的顯微鏡 */
const oneApWorld = (): SimWorld => ({
  seed: 1,
  floors: [{ id: 'f0', level: 0, outline: [[-50, -50], [50, -50], [50, 50], [-50, 50]] }],
  aps: [{
    id: 'aa:00:00:00:00:01', floor: 'f0', level: 0, x: 0, y: 10, tx: -40,
    bssids: [{ bssid: 'aa:00:00:00:00:01', ssid: 'ONE', freq: 2437, offset: 0 }],
  }],
  hotspots: [],
  mag: { f0: { base: [18, 18, -35], waves: [], disturbProb: 0 } },
})

const batches = (w: SimWorld, floor: string, x: number, y: number, hdg: number, n: number, rng: () => number) =>
  Array.from({ length: n }, () => ({ aps: scanAt(w, floor, x, y, hdg, rng) }))

describe('scanAt 物理校準(對齊 spec 實測表)', () => {
  it('決定性:同 seed rng 兩次呼叫同輸出', () => {
    const w = buildWorld(loadMini(), 7, { apsPerFloor: 5 })
    const a = scanAt(w, 'hall-b1', 5, 0, 0, mulberry32(99))
    const b = scanAt(w, 'hall-b1', 5, 0, 0, mulberry32(99))
    expect(a).toEqual(b)
  })

  it('每批 AP 數量級 6–16;弱 AP 閃爍(全出現比例低)', () => {
    const w = buildWorld(loadMini(), 7, { apsPerFloor: 5, hotspotCount: 2 })
    const rng = mulberry32(11)
    const bs = batches(w, 'hall-b1', 5, 0, 0, 10, rng)
    const counts = bs.map(b => b.aps.length)
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length
    // 上限對齊本 fixture:mini 兩層共 23 個 bssid＋2 熱點,不閃爍的話每批會逼近 24;
    // 實測 mean 15.2–15.4(與 rng seed 幾乎無關——mini 全部 AP 都在 15m 內,路損咬不動)
    expect(mean).toBeGreaterThanOrEqual(6); expect(mean).toBeLessThanOrEqual(16)
    // 全出現比例:10 批全到的 bssid / 出現過的 bssid < 0.7(實測 10/21)
    const seen = new Map<string, number>()
    for (const b of bs) for (const ap of b.aps) seen.set(ap.bssid, (seen.get(ap.bssid) ?? 0) + 1)
    const full = [...seen.values()].filter(c => c === 10).length
    expect(full / seen.size).toBeLessThan(0.7)
    expect(seen.size).toBeGreaterThan(4)
  })

  it('同點同 AP 跨 10 批 span 量級 ~16 dB(jitter N(0,5))', () => {
    const w = oneApWorld()
    const rng = mulberry32(3)
    const rssis = batches(w, 'f0', 0, 0, 0, 10, rng).flatMap(b => b.aps.map(a => a.rssi))
    expect(rssis.length).toBeGreaterThanOrEqual(8) // 強 AP 幾乎全出現
    const span = Math.max(...rssis) - Math.min(...rssis)
    expect(span).toBeGreaterThanOrEqual(8); expect(span).toBeLessThanOrEqual(30)
  })

  it('朝向差:背對 AP 較面向低 ~12 dB(6·(1−cos),對齊實測 11.9)', () => {
    const w = oneApWorld()
    const rng = mulberry32(5)
    const mean = (hdg: number) => {
      const rs = batches(w, 'f0', 0, 0, hdg, 40, rng).flatMap(b => b.aps.map(a => a.rssi))
      return rs.reduce((a, b) => a + b, 0) / rs.length
    }
    const face = mean(0), back = mean(180) // AP 在正北,heading 0=面向
    expect(face - back).toBeGreaterThan(9); expect(face - back).toBeLessThan(15)
  })

  it('持久 shadowing:同點兩次指紋距 < 異點(指紋定位成立前提)', () => {
    const w = buildWorld(loadMini(), 7, { apsPerFloor: 5, hotspotCount: 0 })
    const rng = mulberry32(23)
    const fpOf = (x: number, y: number) => fingerprint(batches(w, 'hall-b1', x, y, 0, 10, rng))
    const a1 = fpOf(5, 0), a2 = fpOf(5, 0), b = fpOf(-5, 0) // 10m 外
    expect(fpDistance(a1, a2)).toBeLessThan(fpDistance(a1, b))
  })

  it('雜訊底線量級:同點分半指紋距 1.5–8 dB', () => {
    const w = buildWorld(loadMini(), 7, { apsPerFloor: 5, hotspotCount: 0 })
    const bs = batches(w, 'hall-b1', 5, 0, 0, 10, mulberry32(31))
    const allowed = new Set(fingerprint(bs).keys())
    const even = fingerprint(bs.filter((_, i) => i % 2 === 0), allowed)
    const odd = fingerprint(bs.filter((_, i) => i % 2 === 1), allowed)
    const noise = fpDistance(even, odd)
    expect(noise).toBeGreaterThan(1.5); expect(noise).toBeLessThan(8)
  })

  it('跨層衰減:樓下同座標點看同一 AP 弱 ≥30 dB', () => {
    const w = oneApWorld()
    w.floors.push({ id: 'f1', level: 1, outline: w.floors[0].outline })
    const rng = mulberry32(41)
    const at = (fl: string) => {
      const rs = batches(w, fl, 0, 10, 0, 30, rng).flatMap(b => b.aps.map(a => a.rssi))
      return rs.reduce((a, b) => a + b, 0) / Math.max(1, rs.length)
    }
    expect(at('f0') - at('f1')).toBeGreaterThan(30) // 解析 ~41 dB(20 dB 跨層 + d3D 拉長 ~21 dB),偵測截斷吃掉一點;門檻 30 釘住 CROSS_FLOOR_DB 量級
  })
})

describe('磁力模型', () => {
  const w = () => buildWorld(loadMini(), 7, { apsPerFloor: 4 })
  const IRON0: [number, number, number] = [0, 0, 0]

  it('magTrueAt:決定性、空間有梯度、合力量級 ~45 µT', () => {
    const world = w()
    expect(magTrueAt(world, 'hall-b1', 3, 1)).toEqual(magTrueAt(world, 'hall-b1', 3, 1))
    const a = magTrueAt(world, 'hall-b1', -8, -3), b = magTrueAt(world, 'hall-b1', 8, 3)
    expect(a).not.toEqual(b) // 弦波空間梯度
    const mag = Math.hypot(...a)
    expect(mag).toBeGreaterThan(25); expect(mag).toBeLessThan(65)
  })

  it('乾淨取樣:低 std、accuracy 3、magMean ≈ |真場|', () => {
    const world = w()
    const s = sampleMag(world, 'hall-b1', 3, 1, 0, IRON0, mulberry32(1))
    expect(s.n).toBe(100)
    expect(s.accuracy).toBe(3)
    expect(Math.max(...s.std)).toBeLessThan(1)
    expect(s.magStd).toBeLessThan(1)
    expect(Math.abs(s.magMean - Math.hypot(...magTrueAt(world, 'hall-b1', 3, 1)))).toBeLessThan(1)
  })

  it('硬鐵旋鈕:未校正手機 magMean 明顯偏移(對齊實測 14.7 µT 現象)', () => {
    const world = w()
    const clean = sampleMag(world, 'hall-b1', 3, 1, 0, IRON0, mulberry32(1))
    const iron = sampleMag(world, 'hall-b1', 3, 1, 0, [12, 6, 0], mulberry32(1))
    expect(Math.abs(iron.magMean - clean.magMean)).toBeGreaterThan(3)
  })

  it('轉動污染:三軸 std 大、magStd 仍小(對齊實測 s1649:std~16、magStd 1.75)', () => {
    const s = sampleMag(w(), 'hall-b1', 3, 1, 0, IRON0, mulberry32(2), { rotating: true })
    expect(Math.max(...s.std)).toBeGreaterThan(8)
    expect(s.magStd).toBeLessThan(2)
  })

  it('環境擾動(列車):magStd > 2', () => {
    const s = sampleMag(w(), 'plat-b2', 0, 0, 0, IRON0, mulberry32(3), { disturbed: true })
    expect(s.magStd).toBeGreaterThan(2)
  })

  it('低 accuracy 旋鈕', () => {
    const s = sampleMag(w(), 'hall-b1', 3, 1, 0, IRON0, mulberry32(4), { lowAccuracy: true })
    expect(s.accuracy).toBeLessThanOrEqual(1)
  })

  it('硬鐵在裝置座標:heading 90° 時偏移不隨世界向量旋轉', () => {
    const world = w()
    const [wx, wy, wz] = magTrueAt(world, 'hall-b1', 3, 1)
    const s = sampleMag(world, 'hall-b1', 3, 1, 90, [12, 6, 0], mulberry32(1))
    // R(+90°):dev = [wx·cos−wy·sin, wx·sin+wy·cos, wz] = [−wy, wx, wz],硬鐵加在旋轉之後
    // 若誤把硬鐵放世界座標(旋轉前),mean[0] 會變 −(wy+6) 而非 −wy+12,差 18 → 必抓
    expect(s.mean[0]).toBeCloseTo(-wy + 12, 0)
    expect(s.mean[1]).toBeCloseTo(wx + 6, 0)
    expect(s.mean[2]).toBeCloseTo(wz, 0)
  })
})

describe('simSession:wifi-fp@1 輸出', () => {
  const mkOpts = (extra: object = {}) => ({
    seed: 7, floors: loadMini(),
    rpPoints: [
      { id: 'B1-001', floor: 'hall-b1', x: -5, y: 0 }, { id: 'B1-002', floor: 'hall-b1', x: 5, y: 0 },
      { id: 'B2-001', floor: 'plat-b2', x: 0, y: 0 },
    ],
    world: { apsPerFloor: 5, hotspotCount: 2 }, ...extra,
  })

  it('schema key 一字不差對齊 collector spec 範例', () => {
    const { lines } = simSession(mkOpts())
    const recs = lines.map(l => JSON.parse(l))
    const session = recs[0]
    expect(Object.keys(session).sort()).toEqual(
      ['android', 'app', 'device', 'mode', 'rpGenerated', 'rpList', 'scansPerPoint', 'schema', 'session', 'startedAt', 'type'].sort())
    expect(session.schema).toBe('wifi-fp@1')
    const p = recs[1]
    expect(Object.keys(p).sort()).toEqual(
      ['actualScans', 'durationMs', 'floor', 'headingAcc', 'headingDeg', 'headingSlot', 'mag', 'pointId', 'scans', 'startedAt', 'throttled', 'type', 'x', 'y'].sort())
    expect(Object.keys(p.scans[0]).sort()).toEqual(['aps', 'fresh', 't'].sort())
    expect(Object.keys(p.scans[0].aps[0]).sort()).toEqual(['bssid', 'freq', 'rssi', 'ssid'].sort())
    expect(Object.keys(p.mag).sort()).toEqual(['accuracy', 'magMean', 'magStd', 'mean', 'n', 'std'].sort())
    expect(p.headingSlot).toBeNull() // 單朝向
  })

  it('決定性假時鐘:同 opts 同輸出;時戳 ISO 且遞增', () => {
    const a = simSession(mkOpts()), b = simSession(mkOpts())
    expect(a.lines).toEqual(b.lines)
    const pts = a.lines.slice(1).map(l => JSON.parse(l))
    const ts = pts.map(p => Date.parse(p.startedAt))
    expect(ts.every(t => Number.isFinite(t))).toBe(true)
    expect([...ts].sort((x, y) => x - y)).toEqual(ts)
  })

  it('quad 模式:每點 4 行,slot 0/90/180/270', () => {
    const { lines } = simSession(mkOpts({ mode: 'quad' }))
    const pts = lines.slice(1).map(l => JSON.parse(l)).filter(r => r.pointId === 'B1-001')
    expect(pts.map(p => p.headingSlot)).toEqual([0, 90, 180, 270])
  })

  it('髒資料旋鈕:throttled/短掃描/轉動/低磁力 accuracy 各自留下可抓特徵', () => {
    const { lines } = simSession(mkOpts({ dirt: { throttledRate: 1 } }))
    for (const p of lines.slice(1).map(l => JSON.parse(l))) {
      expect(p.throttled).toBe(true)
      expect(p.scans.every((s: { fresh: boolean }) => s.fresh === false)).toBe(true)
      expect(new Set(p.scans.map((s: object) => JSON.stringify((s as { aps: object }).aps))).size).toBe(1) // 快取:每批相同
    }
    const short = simSession(mkOpts({ dirt: { shortScanRate: 1 } })).lines.slice(1).map(l => JSON.parse(l))
    for (const p of short) { expect(p.actualScans).toBeLessThan(6); expect(p.scans.length).toBe(p.actualScans) }
    const rot = simSession(mkOpts({ dirt: { rotationRate: 1 } })).lines.slice(1).map(l => JSON.parse(l))
    for (const p of rot) {
      expect(Math.max(...p.mag.std)).toBeGreaterThan(3)
      expect(p.mag.magStd).toBeLessThan(2)
      // WiFi 中途階梯跳變:前後半批朝向差 180 → 有 AP 前後半均值差得開
      expect(p.scans.length).toBe(10)
      // 階梯訊號釘測:對齊朝向的 AP 前後半均值差 >10 dB(來源 bodyShadow ±12;無階梯時取極值的雜訊期望 ~8,10 才有鑑別力;實測 13.7+)
      const half = (ss: { aps: { bssid: string; rssi: number }[] }[]) => {
        const m = new Map<string, { s: number; c: number }>()
        for (const s of ss) for (const a of s.aps) {
          const e = m.get(a.bssid) ?? { s: 0, c: 0 }
          e.s += a.rssi; e.c++; m.set(a.bssid, e)
        }
        return m
      }
      const h1 = half(p.scans.slice(0, 5)), h2 = half(p.scans.slice(5))
      let maxStep = 0
      for (const [b, e1] of h1) {
        const e2 = h2.get(b)
        if (e1.c >= 3 && e2 && e2.c >= 3) maxStep = Math.max(maxStep, Math.abs(e1.s / e1.c - e2.s / e2.c))
      }
      expect(maxStep).toBeGreaterThan(10)
    }
    const lowAcc = simSession(mkOpts({ dirt: { lowMagAccRate: 1 } })).lines.slice(1).map(l => JSON.parse(l))
    for (const p of lowAcc) expect(p.mag.accuracy).toBeLessThanOrEqual(1)
  })

  it('重採語意:resampleRate=1 → 每 (pointId,slot) 出現兩行', () => {
    const { lines } = simSession(mkOpts({ dirt: { resampleRate: 1 } }))
    const ids = lines.slice(1).map(l => JSON.parse(l)).map(p => `${p.pointId}|${p.headingSlot}`)
    expect(ids.length).toBe(6) // 3 點 × 2
    expect(new Set(ids).size).toBe(3)
    expect(ids.slice(3)).toEqual(ids.slice(0, 3)) // 重採行附加在檔尾,非交錯——last-line-wins 的前提
  })
})
