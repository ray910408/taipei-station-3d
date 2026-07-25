import { describe, expect, it } from 'vitest'
import { fingerprint, fpDistance } from '../tools/analyze-spacing'

const scan = (aps: [string, number][]) => ({ aps: aps.map(([bssid, rssi]) => ({ bssid, rssi })) })

describe('analyze-spacing', () => {
  it('fingerprint:平均 RSSI＋出現率過濾', () => {
    const scans = [
      scan([['a', -50], ['b', -70]]),
      scan([['a', -60], ['b', -70]]),
      scan([['a', -55]]), // b 缺席一次 → 出現率 2/3 仍達標
      scan([['a', -55], ['c', -80]]), // c 只出現 1/4 = 25% → 濾掉
    ]
    const fp = fingerprint(scans)
    expect(fp.get('a')).toBeCloseTo(-55) // (-50-60-55-55)/4
    expect(fp.get('b')).toBeCloseTo(-70)
    expect(fp.has('c')).toBe(false)
  })

  it('fingerprint:allowed 名單模式不再二次過濾', () => {
    const scans = [scan([['a', -50], ['c', -80]]), scan([['a', -50]])]
    // c 出現率 50%,若無 allowed 會被邊界過濾;指定 allowed 就一律納入
    const fp = fingerprint(scans, new Set(['c']))
    expect(fp.get('c')).toBeCloseTo(-80)
    expect(fp.has('a')).toBe(false) // 不在 allowed
  })

  it('fpDistance:聯集比對,缺席以 -95 代入', () => {
    const a = new Map([['x', -50], ['y', -60]])
    expect(fpDistance(a, new Map([['x', -50], ['y', -60]]))).toBe(0)
    // 單一 AP 差 10 dB,另一顆相同 → RMS = sqrt((100+0)/2)
    expect(fpDistance(a, new Map([['x', -60], ['y', -60]]))).toBeCloseTo(Math.sqrt(50))
    // b 缺 y → y 以 -95 代入,差 35 dB
    expect(fpDistance(a, new Map([['x', -50]]))).toBeCloseTo(Math.sqrt((0 + 35 * 35) / 2))
  })

  it('分半雜訊:共用 AP 名單才不會高估(真機曾因此把 1.4dB 算成 9.9dB)', () => {
    // a 穩定出現;b 只在偶數批出現(整體 50%)
    const scans = [
      scan([['a', -50], ['b', -80]]),
      scan([['a', -50]]),
      scan([['a', -50], ['b', -80]]),
      scan([['a', -50]]),
    ]
    const allowed = new Set(fingerprint(scans).keys())
    const even = fingerprint(scans.filter((_, i) => i % 2 === 0), allowed)
    const odd = fingerprint(scans.filter((_, i) => i % 2 === 1), allowed)
    // 共用名單下:odd 半沒有 b → b 以 -95 代入,但 a 完全一致
    // 關鍵是不會因為「兩半各自套過濾」而讓 b 在一半入選、另一半消失得更離譜
    expect(even.get('a')).toBeCloseTo(-50)
    expect(odd.get('a')).toBeCloseTo(-50)
    expect(even.get('b')).toBeCloseTo(-80)
    // 不共用名單時 odd 半仍無 b(它本來就沒出現),但 even 半的 b 會通過 100% 過濾 → 同樣距離
    // 真正的差別在 allowed 讓兩半的 AP 集合定義一致,不受各半出現率邊界影響
    const oddNoAllow = fingerprint(scans.filter((_, i) => i % 2 === 1))
    expect(oddNoAllow.has('b')).toBe(false)
  })
})
