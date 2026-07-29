import { describe, expect, it } from 'vitest'
import { buildDb, cleanSamples, filterHotspots, HOTSPOT_MIN_RP, mergeAnchors, parseSessions, TOP_K } from '../tools/fp-build'

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

  it('混不同清單版本的檔 → 擋下(否則產出摻兩套座標的庫且不報錯)', () => {
    // 樣本只以 (pointId, headingSlot) 為鍵,而重產的清單會把同一個 id 指到不同座標。
    // 合併時新檔覆蓋同名 id、舊清單獨有的 id 原封留下,結果無聲無息地混了兩套座標。
    const f1 = [SESSION, pt()].join('\n')
    const f2 = [SESSION.replace('"s1"', '"s2"').replace('"rpGenerated":"t"', '"rpGenerated":"t2"'), pt()].join('\n')
    expect(() => parseSessions([f1, f2])).toThrow(/清單版本不一致/)
    // 同版本照常合併
    expect(parseSessions([f1, [SESSION.replace('"s1"', '"s3"'), pt()].join('\n')]).sessions).toEqual(['s1', 's3'])
  })

  it('缺 rpGenerated 的檔要合併 → 擋(缺版本≠版本相同)', () => {
    // 兩個舊檔都沒記版本時,把它們都正規化成 '' 會讓相等檢查放行,
    // 正好漏掉這個檢查要擋的情形——它們可能各自來自不同的清單。
    const noVer = SESSION.replace(',"rpGenerated":"t"', '')
    const a = [noVer, pt()].join('\n')
    const b = [noVer.replace('"s1"', '"s2"'), pt()].join('\n')
    expect(() => parseSessions([a, b])).toThrow(/沒記錄 rpGenerated/)
    expect(() => parseSessions([a, [SESSION.replace('"s1"', '"s2"'), pt()].join('\n')])).toThrow(/沒記錄 rpGenerated/)
    // 只有一個 session 時沒有可混的對象,缺版本無妨
    expect(parseSessions([a]).sessions).toEqual(['s1'])
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

  it('轉動(軸向>3 且 軸向>合力×2)→ 剔磁力＋WiFi 降權 0.5', () => {
    const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, std: [16, 15, 2], magStd: 1.7 } })]))
    expect(kept[0]).toMatchObject({ w: 0.5, magOk: false })
  })

  it('殘留硬鐵下的大幅轉動:合力也超標仍判轉動(真機 0726 P01/P07——舊 magStd<2 規則會誤標環境擾動)', () => {
    // P01 軸10.16/合2.75、P07 軸18.70/合3.95:舊規則因 magStd>2 落進環境擾動分支 → 污染的 WiFi 拿全權重
    for (const [axis, magStd] of [[10.16, 2.75], [18.70, 3.95]]) {
      const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, std: [axis, axis * 0.9, 2], magStd } })]))
      expect(kept[0]).toMatchObject({ w: 0.5, magOk: false })
    }
  })

  it('兩者同幅度漲=環境擾動:軸向超標但未達合力×2 → WiFi 不降權', () => {
    const { kept } = cleanSamples(parse([pt({ mag: { ...MAG_OK, std: [7.0, 6.5, 6], magStd: 4.0 } })]))
    expect(kept[0]).toMatchObject({ w: 1, magOk: false }) // 軸 7.0 超過門檻 6 但未達 4.0×2=8 → 非轉動
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

/** 出現率測試用:設定 N 與實際批數都是 3,分母才等於批數(否則要用設定的 scansPerPoint) */
const SESSION_N3 = SESSION.replace('"scansPerPoint":10', '"scansPerPoint":3')

/** 同上,但只讓 AP 出現在 3 批中的前 `hits` 批——用來造出「出現率低」的樣本 */
const sampleRate = (pointId: string, x: number, y: number, bssid: string, ssid: string, rssi: number,
                    hits: number, slot: number | null = null) =>
  parseSessions([[SESSION_N3, pt({
    pointId, x, y, floor: 'f0', headingSlot: slot,
    scans: Array.from({ length: 3 }, (_, i) => ({
      t: 't', fresh: true, aps: i < hits ? [{ bssid, ssid, rssi, freq: 2437 }] : [],
    })),
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

  it('規則3 rare:RP 數少且在該點也只是偶爾出現 → 判熱點', () => {
    const kept = [
      ...goodBase('aa:00:00:00:00:01', 'OK'),
      // 只有 2 個 RP,且兩處都只被 1/3 批掃到——路過的手機
      ...sampleRate('G1', 0, 0, 'ff:00:00:00:00:01', 'Z', -70, 1),
      ...sampleRate('G2', 5, 0, 'ff:00:00:00:00:01', 'Z', -72, 1),
    ]
    const ex = filterHotspots(kept)
    expect(ex.get('ff:00:00:00:00:01')).toBe('rare')
    expect(ex.has('aa:00:00:00:00:01')).toBe(false) // 3 RP 達標
    expect(HOTSPOT_MIN_RP).toBe(3)
  })

  it('規則3 出現率分母含同 RP 的其他朝向:四朝向各中一次不算高出現率', () => {
    // quad 模式同一個 pointId 有 4 筆樣本(headingSlot 0/90/180/270)。命中數會跨朝向
    // 累加,分母若只取「第一個看到它的朝向」,4 次命中會算成 4/3=1.0 而脫罪;
    // 正確分母是該 RP 的全部批數 4×3=12 → 0.33,仍屬 rare。
    const quad = (slot: number) => sampleRate('Q1', 0, 0, 'dd:00:00:00:00:01', 'T', -70, 1, slot)
    const kept = [...goodBase('aa:00:00:00:00:01', 'OK'),
      ...quad(0), ...quad(90), ...quad(180), ...quad(270)]
    expect(filterHotspots(kept).get('dd:00:00:00:00:01')).toBe('rare')
  })

  it('規則3 掃描大量失敗的點不能靠僅有的一批脫罪', () => {
    // 掃描失敗不會產生批次(ScanEngine 的 Outcome.Failed 不寫入),所以 N=10 只成功 1 批時
    // 用「實際批數」當分母,那一批裡的任何 BSSID 都是 100% 出現率——一次性的路過熱點
    // 就這樣脫罪。分母改用設定的 scansPerPoint(10),1/10=0.1 仍判 rare。
    const one = parseSessions([[SESSION, pt({
      pointId: 'S1', x: 0, y: 0, floor: 'f0', actualScans: 1,
      scans: [{ t: 't', fresh: true, aps: [{ bssid: 'cc:00:00:00:00:09', ssid: 'Once', rssi: -70, freq: 2437 }] }],
    })].join('\n')]).samples.map(rec => ({ rec, w: 1, magOk: true }))
    expect(filterHotspots([...goodBase('aa:00:00:00:00:01', 'OK'), ...one]).get('cc:00:00:00:00:09')).toBe('rare')
  })

  it('規則3 出現率脫罪:RP 數少但每批都在 → 是固定 AP,不是熱點', () => {
    // RP 間距 20 m 的月台上,正常 AP 的有效範圍常只涵蓋 1~2 個 RP,湊滿 3 個要橫跨約 40 m。
    // 只用 RP 數當判準會隨間距漂移,把真 AP 當熱點刪掉。
    const kept = [
      ...goodBase('aa:00:00:00:00:01', 'OK'),
      ...sampleRate('P1', 0, 0, 'ee:00:00:00:00:01', 'Fixed', -60, 3),
      ...sampleRate('P2', 20, 0, 'ee:00:00:00:00:01', 'Fixed', -78, 3),
    ]
    expect(filterHotspots(kept).has('ee:00:00:00:00:01')).toBe(false)
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

describe('buildDb(Stage 2)', () => {
  /** 兩樣本同點:w=1 全勤(2 批皆 -50/-60),w=0.5 半勤(-70 出現 1/2 批) */
  const twoSampleText = () => {
    const mk = (scans: object[], o: object) => pt({ scans, ...o })
    const ap = (rssi: number) => ({ bssid: 'a4:97:33:e9:c6:7f', ssid: 'AP1', rssi, freq: 2437 })
    // 湊滿 rare 門檻:AP1 也出現在 P2/P3(數值不影響 P1 斷言)
    const bg = (id: string, x: number) => mk(
      [{ t: 't', fresh: true, aps: [ap(-80)] }, { t: 't', fresh: true, aps: [ap(-80)] }],
      { pointId: id, x, actualScans: 2 })
    return [SESSION.replace('"scansPerPoint":10', '"scansPerPoint":2'),
      mk([{ t: 't', fresh: true, aps: [ap(-50)] }, { t: 't', fresh: true, aps: [ap(-60)] }], { actualScans: 2 }),
      // 同點重採(last-line-wins 已在 parse 測過)→ 這裡改用另一個 slot 當第二樣本,兩樣本都算
      mk([{ t: 't', fresh: true, aps: [ap(-70)] }], { headingSlot: 90, actualScans: 1 }), // 半勤(1 < 0.6×2)→ w=0.5;scans.length 恆等 actualScans
      bg('P2', 5), bg('P3', 10),
    ].join('\n')
  }

  it('加權聚合數學:mean/rate/n 精確;跨 slot 聚合(heading-agnostic)', () => {
    const db = buildDb([twoSampleText()], { station: 'test', generated: 'g' })
    const rp = db.floors['f0'].rps.find(r => r.id === 'P1')!
    const [mean, , rate, n] = rp.aps['a4:97:33:e9:c6:7e'] ?? rp.aps['a4:97:33:e9:c6:7f']
    // 樣本1 w=1:批值 -50,-60(2 批全到);樣本2 w=0.5:批值 -70(1/1 批)
    // mean = (1·(-50)+1·(-60)+0.5·(-70)) / (1+1+0.5) = -145/2.5 = -58
    expect(mean).toBeCloseTo(-58, 1)
    // rate = (1·2 + 0.5·1) / (1·2 + 0.5·1) …分母=實掃批數加權 (1·2+0.5·1)=2.5 → 1.0(全到)
    expect(rate).toBeCloseTo(1.0, 2)
    expect(n).toBe(3) // 原始出現批數
  })

  it('Top-K:超過 15 顆錨點只留 detectRate×強度前 15', () => {
    // 造 20 顆全勤錨點,RSSI -40..-78(每顆差 2):rate 同 → 弱的被切
    // OUI 第三 byte 隔開(0a:00:i)——否則尾 bytes 差 1 bit 會被同源合併吃掉
    const aps20 = Array.from({ length: 20 }, (_, i) => ({ bssid: `0a:00:${i.toString(16).padStart(2, '0')}:00:00:01`, ssid: `S${i}`, rssi: -40 - 2 * i, freq: 2437 }))
    const mkPt = (id: string, x: number) => pt({ pointId: id, x, scans: [{ t: 't', fresh: true, aps: aps20 }, { t: 't', fresh: true, aps: aps20 }], actualScans: 2 })
    const text = [SESSION.replace('"scansPerPoint":10', '"scansPerPoint":2'), mkPt('P1', 0), mkPt('P2', 5), mkPt('P3', 10)].join('\n')
    const db = buildDb([text], { station: 'test', generated: 'g' })
    const rp = db.floors['f0'].rps.find(r => r.id === 'P1')!
    expect(Object.keys(rp.aps).length).toBe(TOP_K)
    expect(Object.values(rp.aps).every(([m]) => m <= -40 && m >= -68 - 1)).toBe(true) // 最弱 5 顆(-70..-78)被切
  })

  it('同批同錨點多成員取 max;anchors 表記成員與 ssid', () => {
    const batch = { t: 't', fresh: true, aps: [
      { bssid: 'a4:97:33:e9:c6:7e', ssid: 'AP1', rssi: -55, freq: 2437 },
      { bssid: 'a4:97:33:e9:c6:7f', ssid: 'AP1_5G', rssi: -50, freq: 5745 },
    ] }
    const mkPt = (id: string, x: number) => pt({ pointId: id, x, scans: [batch, batch], actualScans: 2 })
    const text = [SESSION.replace('"scansPerPoint":10', '"scansPerPoint":2'), mkPt('P1', 0), mkPt('P2', 5), mkPt('P3', 10)].join('\n')
    const db = buildDb([text], { station: 'test', generated: 'g' })
    const rp = db.floors['f0'].rps.find(r => r.id === 'P1')!
    expect(rp.aps['a4:97:33:e9:c6:7e'][0]).toBeCloseTo(-50, 1) // max(-55,-50)
    expect(db.anchors['a4:97:33:e9:c6:7e'].bssids.sort()).toEqual(['a4:97:33:e9:c6:7e', 'a4:97:33:e9:c6:7f'])
    expect(db.anchors['a4:97:33:e9:c6:7e'].ssid).toBe('AP1')
  })

  it('磁力:magOk 樣本加權 magMean;三軸僅低 std 樣本;excluded 序列化', () => {
    const A: [string, string, number] = ['aa:00:00:00:00:01', 'OK', -60]
    const mk = (o: object, aps: [string, string, number][]) => pt({
      scans: [{ t: 't', fresh: true, aps: aps.map(([bssid, ssid, rssi]) => ({ bssid, ssid, rssi, freq: 2437 })) }],
      actualScans: 1, ...o,
    })
    const text = [SESSION.replace('"scansPerPoint":10', '"scansPerPoint":1'),
      mk({ mag: { ...MAG_OK, magMean: 40 } }, [A, ['dd:00:00:00:00:09', 'iPhone', -50]]),
      mk({ headingSlot: 90, headingDeg: 90, mag: { ...MAG_OK, magMean: 50, std: [2, 2, 2] } }, [A]), // 同點另一 slot → 兩樣本都算(跨 slot 聚合)
      mk({ pointId: 'P2', x: 5 }, [A]), mk({ pointId: 'P3', x: 10 }, [A]), // 湊 rare 門檻
    ].join('\n')
    const db = buildDb([text], { station: 'test', generated: 'g' })
    const rp = db.floors['f0'].rps.find(r => r.id === 'P1')!
    expect(rp.mag!.magMean).toBeCloseTo(45, 1) // 兩樣本 w=1 等權:(40+50)/2
    expect(rp.mag!.axes).toEqual([18, 18, -35]) // 只有 std 低的樣本(第一筆 0.4)進三軸;第二筆 std 2 ≥ 1.5 擋掉
    expect(db.excluded['dd:00:00:00:00:09']).toBe('ssid-pattern')
    expect(db.schema).toBe('fp-db@1')
    expect(db.magNorthOffsetDeg).toBeNull() // 現場量的佔位
  })
})
