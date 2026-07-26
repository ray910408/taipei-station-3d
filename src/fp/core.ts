/**
 * 指紋核心:由掃描批算指紋、算指紋距離。
 * analyze-spacing(CLI)與定位引擎(瀏覽器,第②包)共用,故住 src/。
 */
export const RSSI_FLOOR = -95 // 未偵測到的 AP 以此值代入(低於一般雜訊底 -90)
export const MIN_DETECT_RATE = 0.5 // 出現率低於此的 AP 不列入(閃爍 AP 只會加雜訊)

export interface ScanBatch { aps: { bssid: string; rssi: number }[] }
export type Fingerprint = Map<string, number>

/** 由若干批掃描算出指紋:每個 BSSID 的平均 RSSI。
 *  `allowed` 指定時只算這些 BSSID(分半比對用——兩半必須共用同一份 AP 名單,
 *  否則 50% 出現率的 AP 會在一半入選、另一半缺席,被記成滿額懲罰,雜訊被高估)。 */
export function fingerprint(scans: ScanBatch[], allowed?: Set<string>): Fingerprint {
  const sum = new Map<string, number>()
  const cnt = new Map<string, number>()
  for (const s of scans) {
    for (const ap of s.aps) {
      if (allowed && !allowed.has(ap.bssid)) continue
      sum.set(ap.bssid, (sum.get(ap.bssid) ?? 0) + ap.rssi)
      cnt.set(ap.bssid, (cnt.get(ap.bssid) ?? 0) + 1)
    }
  }
  const fp: Fingerprint = new Map()
  for (const [bssid, c] of cnt) {
    if (allowed) fp.set(bssid, sum.get(bssid)! / c) // 名單已篩過,不再二次過濾
    else if (c / scans.length >= MIN_DETECT_RATE) fp.set(bssid, sum.get(bssid)! / c)
  }
  return fp
}

/** 指紋距離:取兩者 BSSID 聯集,缺席以 RSSI_FLOOR 代入,算 RMS 差(dB) */
export function fpDistance(a: Fingerprint, b: Fingerprint): number {
  const keys = new Set([...a.keys(), ...b.keys()])
  if (keys.size === 0) return NaN
  let sq = 0
  for (const k of keys) {
    const d = (a.get(k) ?? RSSI_FLOOR) - (b.get(k) ?? RSSI_FLOOR)
    sq += d * d
  }
  return Math.sqrt(sq / keys.size)
}
