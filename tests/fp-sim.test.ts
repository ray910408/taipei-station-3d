import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FloorJson } from '../tools/gen-rp-points'
import { pointInPolygon } from '../tools/rp-geometry'
import { HOTSPOT_SSIDS, buildWorld, gauss, hash32, mulberry32, scanAt, type SimWorld } from '../tools/fp-sim'
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
