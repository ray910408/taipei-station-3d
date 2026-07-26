import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildDb } from '../tools/fp-build'
import { generateFloorPoints, type FloorJson } from '../tools/gen-rp-points'
import { CROSS_FLOOR_DB, FLOOR_SEP, bodyShadow, pairShadow, simSession, type DirtOpts } from '../tools/fp-sim'

const floors: FloorJson[] = ['hall-b1', 'plat-b2']
  .map(id => JSON.parse(readFileSync(`tests/fixtures/mini/data/floors/${id}.json`, 'utf8')))
const rpPoints = floors.flatMap((f, i) => generateFloorPoints(f, `B${i + 1}`, 4)) // 兩層各 ~10 點

describe('E2E:simSession → buildDb(mini 兩層——正好測跨層與樓層分節)', () => {
  const run = (dirt: DirtOpts = {}) => {
    const sim = simSession({ seed: 7, floors, rpPoints, world: { apsPerFloor: 5, hotspotCount: 2 }, dirt })
    return { sim, db: buildDb([sim.lines.join('\n')], { station: 'mini', generated: 'g' }) }
  }

  it('結構:兩層分節、每 RP 1–15 錨點、[mean,std,rate,n] 形狀、熱點進 excluded、合併發生過', () => {
    const { db } = run()
    expect(db.schema).toBe('fp-db@1')
    expect(Object.keys(db.floors).sort()).toEqual(['hall-b1', 'plat-b2'])
    const rps = Object.values(db.floors).flatMap(f => f.rps)
    expect(rps.length).toBe(rpPoints.length) // 乾淨資料無剔點
    for (const rp of rps) {
      const entries = Object.values(rp.aps)
      expect(entries.length).toBeGreaterThan(0)
      expect(entries.length).toBeLessThanOrEqual(15)
      for (const [mean, std, rate, n] of entries) {
        expect(mean).toBeLessThan(-20)
        expect(mean).toBeGreaterThan(-120) // sanity 界——sigmoid 尾的深偵測可到 ~-105(rate 低),此界抓 NaN/爆值而非物理
        expect(std).toBeGreaterThanOrEqual(0)
        expect(rate).toBeGreaterThan(0); expect(rate).toBeLessThanOrEqual(1)
        expect(Number.isInteger(n)).toBe(true)
      }
    }
    expect(Object.values(db.excluded)).toContain('ssid-pattern') // 模擬熱點被規則 1 抓
    expect(Object.values(db.anchors).some(a => a.bssids.length >= 2)).toBe(true) // 同源合併真的發生
  })

  it('乾淨資料:rate≥0.9 錨點對路損 ground truth——平均誤差 <2.5 dB、單對 <8 dB', () => {
    const { sim, db } = run()
    // 世界(含 AP 真實位置)由 simSession 回傳——「ground truth 留在模組內供程式化取用」的驗法
    const headingOf = new Map(sim.lines.slice(1).map(l => JSON.parse(l)).map(p => [p.pointId, p.headingDeg]))
    const errs: number[] = []
    for (const [floorId, f] of Object.entries(db.floors)) {
      const level = sim.world.floors.find(x => x.id === floorId)!.level
      for (const rp of f.rps) for (const [anchor, [mean, , rate]] of Object.entries(rp.aps)) {
        if (rate < 0.9) continue // 弱錨點有偵測截斷偏差,不入樣
        const ap = sim.world.aps.find(a => a.id === anchor)
        if (!ap) continue
        const dx = ap.x - rp.x, dy = ap.y - rp.y
        const dLevel = Math.abs(ap.level - level)
        const d3 = Math.max(1, Math.hypot(dx, dy, FLOOR_SEP * dLevel))
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI
        const expected = ap.tx - 30 * Math.log10(d3) - CROSS_FLOOR_DB * dLevel
          - pairShadow(sim.world, ap.id, rp.x, rp.y) - bodyShadow(headingOf.get(rp.id)!, bearing)
        // 錨點值=成員 max ≈ 2.4G(offset 0);jitter 均值誤差 ~5/√10
        errs.push(Math.abs(mean - expected))
      }
    }
    expect(errs.length).toBeGreaterThan(10) // 確認真的驗了夠多對,不是空迴圈假綠
    const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length
    expect(meanErr).toBeLessThan(2.5) // 校準品質:平均絕對誤差(jitter SEM ~1.6 + member-max 偏置)
    expect(Math.max(...errs)).toBeLessThan(8) // 單對極值(數十對取 max;codex 首跑觀測 4.82)
  })

  it('規模外插:702 點量級為數百 KB(靜態 JSON 決策依據)', () => {
    const { db } = run()
    const rps = Object.values(db.floors).flatMap(f => f.rps)
    const extrapolated = (JSON.stringify(db.floors).length / rps.length) * 702
    expect(extrapolated).toBeGreaterThan(100_000)
    expect(extrapolated).toBeLessThan(1_200_000)
  })

  it('髒資料 E2E:高髒率仍建庫成功;throttled 剔點使 RP 數下降', () => {
    const { db } = run({ throttledRate: 0.3, rotationRate: 0.2, lowMagAccRate: 0.2 })
    const rps = Object.values(db.floors).flatMap(f => f.rps)
    expect(rps.length).toBeGreaterThan(0)
    expect(rps.length).toBeLessThan(rpPoints.length) // 30% throttled 必有點被整筆剔
  })
})
