// WalkChecks.kt
package com.taipeistation.wififp

/** 勻速範圍（m/s）。門檻寬鬆起步——pilot 資料回來再夾（MAG_AXIS 3.0→6.0 誤報前科）。 */
const val SPEED_MIN_MPS = 0.5
const val SPEED_MAX_MPS = 2.0
/** 步數×步長 與邊長的相對差上限。 */
const val STEP_LEN_MISMATCH_FRAC = 0.4
/** rotvec 峰值角速率門檻（°/s）：走路自然擺動實測遠低於此;甩手/掉手機才會超。pilot 後夾緊。 */
const val ROT_SPIKE_DEG_PER_S = 300.0

data class WalkQuality(val speedMps: Double, val stepLenEstM: Double?, val warnings: List<String>)

/** walkEnd 三檢＋校正檢查。全部警告不擋——重走與否人裁；旗標數值已在 walkEnd 行,離線可重算。 */
fun walkQuality(entry: WalkEntry, durationMs: Long, stepCount: Int, stepLengthM: Double,
                rotMaxDegPerS: Double, magAccMin: Int, sampleCount: Int, t1Ms: Double): WalkQuality {
  val warnings = ArrayList<String>()
  val speed = if (durationMs > 0) entry.lengthM / (durationMs / 1000.0) else 0.0
  if (speed < SPEED_MIN_MPS || speed > SPEED_MAX_MPS)
    warnings += "速度 %.2f m/s 出範圍(%.1f–%.1f)——中途停頓過久或走錯邊?".format(speed, SPEED_MIN_MPS, SPEED_MAX_MPS)
  val est = if (stepCount > 0) entry.lengthM / stepCount else null
  val walked = stepCount * stepLengthM
  if (kotlin.math.abs(walked - entry.lengthM) > entry.lengthM * STEP_LEN_MISMATCH_FRAC)
    warnings += "步數×步長 %.1fm 與邊長 %.1fm 差 >%d%%——漏步或走錯邊?".format(walked, entry.lengthM, (STEP_LEN_MISMATCH_FRAC * 100).toInt())
  if (rotMaxDegPerS > ROT_SPIKE_DEG_PER_S)
    warnings += "偵測到劇烈晃動(峰值 %.0f°/s)——手機甩動過,建議重走".format(rotMaxDegPerS)
  if (magNeedsCalibration(magAccMin))
    warnings += "走線中磁力校正掉到「${magAccLabel(magAccMin)}」——建議畫 8 字後重走"
  if (sampleCount == 0)
    warnings += "整條走線沒有錄到任何樣本——感測器缺席或未就緒?"
  else if (durationMs > 1000 && sampleCount < 20 * durationMs / 1000)
    warnings += "有效取樣率過低(${sampleCount} 樣本/${durationMs / 1000}s)——感測器被系統節流?"
  if (sampleCount > 0 && kotlin.math.abs(t1Ms - durationMs) > 500 + 0.1 * durationMs)
    warnings += "樣本時基與碼表差 %.0fms——裝置 sensor 時戳基準異常,離線弧長不可信".format(kotlin.math.abs(t1Ms - durationMs))
  return WalkQuality(speed, est, warnings)
}
