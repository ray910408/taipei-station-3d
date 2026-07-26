import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { FloorJson } from '../tools/gen-rp-points'
import { pointInPolygon } from '../tools/rp-geometry'
import { HOTSPOT_SSIDS, buildWorld, gauss, hash32, mulberry32 } from '../tools/fp-sim'

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
