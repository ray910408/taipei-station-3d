import { describe, expect, it } from 'vitest'
import { cleanSamples, filterHotspots, HOTSPOT_MIN_RP, mergeAnchors, parseSessions } from '../tools/fp-build'

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

/** 造樣本:一個 RP 看到一組 (bssid, ssid, rssi),重複 nScan 批 */
const sampleAt = (pointId: string, x: number, y: number, aps: [string, string, number][], floor = 'f0') =>
  parseSessions([[SESSION, pt({
    pointId, x, y, floor,
    scans: Array.from({ length: 3 }, () => ({ t: 't', fresh: true, aps: aps.map(([bssid, ssid, rssi]) => ({ bssid, ssid, rssi, freq: 2437 })) })),
  })].join('\n')]).samples.map(rec => ({ rec, w: 1, magOk: true }))

/** 三個相距 <30m 的 RP 都看到同一 AP → 通過 rare 門檻的「良民背景」 */
const goodBase = (bssid: string, ssid: string) => [
  ...sampleAt('G1', 0, 0, [[bssid, ssid, -60]]),
  ...sampleAt('G2', 5, 0, [[bssid, ssid, -62]]),
  ...sampleAt('G3', 10, 0, [[bssid, ssid, -64]]),
]

describe('filterHotspots(spec 1.2 三規則)', () => {
  it('規則1 SSID 樣式:iPhone/AndroidAP/OPPO…中;正牌 _5G/TPE-Free 不誤殺', () => {
    const kept = [
      ...goodBase('aa:00:00:00:00:01', '6-3Fwifi6_5G'),
      ...sampleAt('G1', 0, 0, [['dd:00:00:00:00:01', 'iPhone', -50], ['dd:00:00:00:00:02', 'AndroidAP_1252', -50], ['dd:00:00:00:00:03', 'OPPO Reno5 5G', -50], ['ee:00:00:00:00:01', 'TPE-Free', -60]]),
      ...sampleAt('G2', 5, 0, [['dd:00:00:00:00:01', 'iPhone', -55], ['dd:00:00:00:00:02', 'AndroidAP_1252', -55], ['dd:00:00:00:00:03', 'OPPO Reno5 5G', -55], ['ee:00:00:00:00:01', 'TPE-Free', -62]]),
      ...sampleAt('G3', 10, 0, [['dd:00:00:00:00:01', 'iPhone', -58], ['dd:00:00:00:00:02', 'AndroidAP_1252', -58], ['dd:00:00:00:00:03', 'OPPO Reno5 5G', -58], ['ee:00:00:00:00:01', 'TPE-Free', -64]]),
    ]
    const ex = filterHotspots(kept)
    expect(ex.get('dd:00:00:00:00:01')).toBe('ssid-pattern')
    expect(ex.get('dd:00:00:00:00:02')).toBe('ssid-pattern')
    expect(ex.get('dd:00:00:00:00:03')).toBe('ssid-pattern')
    expect(ex.has('aa:00:00:00:00:01')).toBe(false) // 底線 _5G 是正牌 AP 命名
    expect(ex.has('ee:00:00:00:00:01')).toBe(false)
  })

  it('規則2 跨點漂移:同 BSSID 兩 RP 相距 >30m 且皆不弱 → drift;遠端弱訊號不誤殺', () => {
    const drifting = [
      ...sampleAt('A', 0, 0, [['bb:00:00:00:00:01', 'X', -50]]),
      ...sampleAt('B', 20, 0, [['bb:00:00:00:00:01', 'X', -55]]),
      ...sampleAt('C', 40, 0, [['bb:00:00:00:00:01', 'X', -52]]), // A–C 距 40m,皆強
      ...sampleAt('A', 0, 0, [['cc:00:00:00:00:01', 'Y', -50]]),
      ...sampleAt('B', 20, 0, [['cc:00:00:00:00:01', 'Y', -60]]),
      ...sampleAt('C', 40, 0, [['cc:00:00:00:00:01', 'Y', -85]]), // 遠端自然衰減 → 不算漂移
    ]
    const ex = filterHotspots(drifting)
    expect(ex.get('bb:00:00:00:00:01')).toBe('drift')
    expect(ex.has('cc:00:00:00:00:01')).toBe(false)
  })

  it('規則2 跨樓層不比:同 BSSID 兩層皆強不觸發 drift(垂直穿透是常態)', () => {
    const kept = [
      ...sampleAt('A', 0, 0, [['bb:00:00:00:00:02', 'X', -50]], 'f0'),
      ...sampleAt('B', 40, 0, [['bb:00:00:00:00:02', 'X', -52]], 'f1'), // 40m 但不同層 → 跳過不比
      ...sampleAt('C', 5, 0, [['bb:00:00:00:00:02', 'X', -55]], 'f0'), // 同層近距 → 不觸發;湊滿 3 RP 免 rare
    ]
    const ex = filterHotspots(kept)
    expect(ex.has('bb:00:00:00:00:02')).toBe(false)
  })

  it('規則3 極低出現率:出現 RP 數 < 3 → rare', () => {
    const kept = [
      ...goodBase('aa:00:00:00:00:01', 'OK'),
      ...sampleAt('G1', 0, 0, [['ff:00:00:00:00:01', 'Z', -70]]),
      ...sampleAt('G2', 5, 0, [['ff:00:00:00:00:01', 'Z', -72]]), // 只有 2 個 RP
    ]
    const ex = filterHotspots(kept)
    expect(ex.get('ff:00:00:00:00:01')).toBe('rare')
    expect(ex.has('aa:00:00:00:00:01')).toBe(false) // 3 RP 達標
    expect(HOTSPOT_MIN_RP).toBe(3)
  })
})

describe('mergeAnchors(spec 1.3:OUI 同＋尾 3 bytes 同或差 1 bit)', () => {
  it('實測樣態:a4:97:33:e9:c6:7f / :7e 併;anchor id 取最小', () => {
    const m = mergeAnchors([
      { bssid: 'a4:97:33:e9:c6:7f', ssid: '6-3F' },
      { bssid: 'a4:97:33:e9:c6:7e', ssid: '6-3F_5G' },
    ])
    expect(m.get('a4:97:33:e9:c6:7f')).toBe('a4:97:33:e9:c6:7e')
    expect(m.get('a4:97:33:e9:c6:7e')).toBe('a4:97:33:e9:c6:7e')
  })

  it('尾 bytes 中段翻 1 bit 也併;差 2 bits 不併;OUI 不同不併', () => {
    const m = mergeAnchors([
      { bssid: 'a4:97:33:e9:c6:7f', ssid: 'A' },
      { bssid: 'a4:97:33:a9:c6:7f', ssid: 'A2' }, // e9^a9=0x40 → 1 bit → 併
      { bssid: 'a4:97:33:e9:c6:7c', ssid: 'B' },  // 7f^7c=0x03 → 2 bits → 不併
      { bssid: 'b4:97:33:e9:c6:7f', ssid: 'C' },  // OUI 不同 → 不併
    ])
    expect(m.get('a4:97:33:a9:c6:7f')).toBe(m.get('a4:97:33:e9:c6:7f'))
    expect(m.get('a4:97:33:e9:c6:7c')).toBe('a4:97:33:e9:c6:7c')
    expect(m.get('b4:97:33:e9:c6:7f')).toBe('b4:97:33:e9:c6:7f')
  })

  it('鏈式:A~B 差1bit、B~C 差1bit → 三者同組(同一台機器多 BSSID)', () => {
    const m = mergeAnchors([
      { bssid: 'a4:97:33:e9:c6:7e', ssid: 'x' },
      { bssid: 'a4:97:33:e9:c6:7f', ssid: 'y' }, // 7e^7f=1
      { bssid: 'a4:97:33:e9:c6:7c', ssid: 'z' }, // 7e^7c=2 → 差1bit 對 7e
    ])
    const ids = new Set([m.get('a4:97:33:e9:c6:7e'), m.get('a4:97:33:e9:c6:7f'), m.get('a4:97:33:e9:c6:7c')])
    expect(ids.size).toBe(1)
  })
})
