import { describe, expect, it } from 'vitest'
import { cleanSamples, parseSessions } from '../tools/fp-build'

const SESSION = JSON.stringify({ type: 'session', schema: 'wifi-fp@1', session: 's1', device: 'sim', android: 0, app: 'x', mode: 'single', scansPerPoint: 10, rpList: 'x', rpGenerated: 't', startedAt: 't' })
const MAG_OK = { n: 100, mean: [18, 18, -35], std: [0.4, 0.4, 0.4], magMean: 45, magStd: 0.6, accuracy: 3 }
/** 最小 point 行;overrides 蓋欄位 */
const pt = (o: object = {}) => JSON.stringify({
  type: 'point', pointId: 'P1', floor: 'f0', x: 0, y: 0, headingSlot: null, headingDeg: 0, headingAcc: 3,
  startedAt: 't', durationMs: 1, actualScans: 10, throttled: false,
  scans: [{ t: 't', fresh: true, aps: [{ bssid: 'aa:00:00:00:00:01', ssid: 'A', rssi: -50, freq: 2437 }] }],
  mag: MAG_OK, ...o,
})

describe('parseSessions', () => {
  it('last-line-wins:同 (pointId, headingSlot) 取最後一行;skip 略過', () => {
    const text = [SESSION, pt({ actualScans: 9 }), JSON.stringify({ type: 'skip', pointId: 'P9', reason: '施工', t: 't' }), pt({ actualScans: 7 })].join('\n')
    const { samples, sessions } = parseSessions([text])
    expect(sessions).toEqual(['s1'])
    expect(samples.length).toBe(1)
    expect(samples[0].actualScans).toBe(7) // 重採取最後
    expect(samples[0].scansPerPoint).toBe(10) // 掛上 session header 的 N
  })

  it('多檔合併:後檔同 key 蓋前檔;slot 不同不互蓋', () => {
    const f1 = [SESSION, pt({ actualScans: 9 })].join('\n')
    const s2 = SESSION.replace('"s1"', '"s2"')
    const f2 = [s2, pt({ actualScans: 5 }), pt({ pointId: 'P1', headingSlot: 90, actualScans: 4 })].join('\n')
    const { samples, sessions } = parseSessions([f1, f2])
    expect(sessions).toEqual(['s1', 's2'])
    expect(samples.length).toBe(2)
    expect(samples.find(s => s.headingSlot === null)!.actualScans).toBe(5)
    expect(samples.find(s => s.headingSlot === 90)!.session).toBe('s2')
  })

  it('point 行出現在 session header 前 → 報行號錯', () => {
    expect(() => parseSessions([pt()])).toThrow(/1/)
  })

  it('截斷行(斷電中斷)→ 報行號而非裸 SyntaxError', () => {
    expect(() => parseSessions([[SESSION, '{"type":"point","poi'].join('\n')])).toThrow(/2/)
  })

  it('session header 缺 scansPerPoint → 報行號(否則短掃描規則靜默失效)', () => {
    const bad = SESSION.replace('"scansPerPoint":10,', '')
    expect(() => parseSessions([[bad, pt()].join('\n')])).toThrow(/1/)
  })
})

describe('cleanSamples(spec 1.1 逐條)', () => {
  const parse = (lines: string[]) => parseSessions([[SESSION, ...lines].join('\n')]).samples

  it('throttled → 整筆剔除,記 reason', () => {
    const { kept, dropped } = cleanSamples(parse([pt({ throttled: true })]))
    expect(kept.length).toBe(0)
    expect(dropped).toEqual([{ pointId: 'P1', reason: 'throttled' }])
  })

  it('actualScans < 0.6×N → 降權 0.5', () => {
    const { kept } = cleanSamples(parse([pt({ actualScans: 5 })]))
    expect(kept[0].w).toBe(0.5)
    expect(kept[0].magOk).toBe(true)
  })

  it('mag.accuracy ≤ 1 → 剔磁力、留 WiFi 全權重', () => {
    const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, accuracy: 1 } })]))
    expect(kept[0]).toMatchObject({ w: 1, magOk: false })
  })

  it('轉動(max std>3 且 magStd<2)→ 剔磁力＋WiFi 降權 0.5', () => {
    const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, std: [16, 15, 2], magStd: 1.7 } })]))
    expect(kept[0]).toMatchObject({ w: 0.5, magOk: false })
  })

  it('環境擾動(magStd>2)→ 剔磁力、留 WiFi 全權重', () => {
    const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, magStd: 3.2 } })]))
    expect(kept[0]).toMatchObject({ w: 1, magOk: false })
  })

  it('複合:短掃描＋轉動 → 權重相乘 0.25', () => {
    const { kept } = cleanSamples(parse([pt({ actualScans: 5, mag: { ...MAG_OK, std: [16, 15, 2], magStd: 1.7 } })]))
    expect(kept[0].w).toBe(0.25)
  })

  it('accuracy≤1 優先於轉動:磁力已不可信不再看 std 特徵,WiFi 不降權', () => {
    const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, accuracy: 1, std: [16, 15, 2], magStd: 1.7 } })]))
    expect(kept[0]).toMatchObject({ w: 1, magOk: false })
  })
})
