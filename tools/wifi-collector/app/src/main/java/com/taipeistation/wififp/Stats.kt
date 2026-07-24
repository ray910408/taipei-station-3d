package com.taipeistation.wififp

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/** 磁力計時窗累積器：3 軸 + 合力強度的 mean/std（母體），只存累積和 */
class MagStats {
  private var n = 0
  private val sum = DoubleArray(3)
  private val sumSq = DoubleArray(3)
  private var magSum = 0.0
  private var magSumSq = 0.0

  fun add(x: Double, y: Double, z: Double) {
    val v = doubleArrayOf(x, y, z)
    for (i in 0..2) { sum[i] += v[i]; sumSq[i] += v[i] * v[i] }
    val mag = sqrt(x * x + y * y + z * z)
    magSum += mag; magSumSq += mag * mag
    n++
  }

  fun summary(accuracy: Int): MagSummary? {
    if (n == 0) return null
    fun std(s: Double, sq: Double): Double {
      val varr = sq / n - (s / n) * (s / n)
      return sqrt(if (varr > 0) varr else 0.0)
    }
    return MagSummary(
      n = n,
      mean = (0..2).map { sum[it] / n },
      std = (0..2).map { std(sum[it], sumSq[it]) },
      magMean = magSum / n, magStd = std(magSum, magSumSq),
      accuracy = accuracy,
    )
  }
}

/** 圓形平均，回 0..360；空集合回 null */
fun circularMeanDeg(samplesDeg: List<Double>): Double? {
  if (samplesDeg.isEmpty()) return null
  var s = 0.0; var c = 0.0
  for (d in samplesDeg) { val r = Math.toRadians(d); s += sin(r); c += cos(r) }
  val deg = Math.toDegrees(atan2(s, c))
  return (deg + 360.0) % 360.0
}

/** 兩方位角最小夾角 0..180 */
fun angDiffDeg(a: Double, b: Double): Double {
  val d = Math.abs(a - b) % 360.0
  return if (d > 180.0) 360.0 - d else d
}
