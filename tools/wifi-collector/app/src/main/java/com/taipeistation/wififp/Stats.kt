package com.taipeistation.wififp

import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

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
