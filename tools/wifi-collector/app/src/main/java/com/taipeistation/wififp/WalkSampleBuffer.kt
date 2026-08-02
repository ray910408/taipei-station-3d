// WalkSampleBuffer.kt
package com.taipeistation.wififp

import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.min

data class Batch(val rows: List<DoubleArray>, val magAccMin: Int)

/** 走線樣本緩衝：mag 事件驅動成行（標稱 50Hz），grav/acc/rotvec 以最新值 ZOH 併行。
 *  ZOH 誤差 ≤20ms ≈ 走速 2.4cm，遠細於弧長錨定需求。行 14 欄:
 *  [t,mx,my,mz,gx,gy,gz,ax,ay,az,r0,r1,r2,r3]，t＝相對 t0 的 ms。
 *  每滿一秒切一個 Batch（呼叫端每秒 append+fsync 一次——50Hz 逐行 fsync 不可行）。
 *  純 JVM 可測；感測器執行緒與 UI 執行緒並發，方法一律 @Synchronized。 */
class WalkSampleBuffer(private val t0Nanos: Long) {
  private var grav: DoubleArray? = null
  private var acc: DoubleArray? = null
  private var rot: DoubleArray? = null
  private var rotPrev: DoubleArray? = null
  private var rotPrevTMs = Double.NaN
  private var curSec = -1L
  private var cur = ArrayList<DoubleArray>()
  private var curAccMin = 3
  private val ready = ArrayDeque<Batch>()
  private val steps = ArrayList<Double>()

  var sampleCount = 0; private set
  var magAccMin = 3; private set
  var rotMaxDegPerS = 0.0; private set
  var lastT1Ms = 0.0; private set
  val stepsMs: List<Double> get() = synchronized(this) { steps.toList() }

  private fun relMs(tNanos: Long) = (tNanos - t0Nanos) / 1e6

  @Synchronized fun onGrav(x: Double, y: Double, z: Double) { grav = doubleArrayOf(x, y, z) }
  @Synchronized fun onAcc(x: Double, y: Double, z: Double) { acc = doubleArrayOf(x, y, z) }

  @Synchronized fun onRotvec(r0: Double, r1: Double, r2: Double, r3: Double) {
    rot = doubleArrayOf(r0, r1, r2, r3)
  }

  @Synchronized fun onStep(tNanos: Long) {
    val t = relMs(tNanos)
    if (t < 0) return // begin 前的步遲送——不屬於本走線
    steps += t
  }

  @Synchronized fun onMag(tNanos: Long, x: Double, y: Double, z: Double, accuracy: Int) {
    val g = grav ?: return; val a = acc ?: return; val r = rot ?: return // 到齊前不成行
    val t = relMs(tNanos)
    val sec = (t / 1000.0).toLong()
    if (curSec >= 0 && sec != curSec && cur.isNotEmpty()) {
      ready.addLast(Batch(cur, curAccMin)); cur = ArrayList(); curAccMin = 3
    }
    curSec = sec
    cur += doubleArrayOf(t, x, y, z, g[0], g[1], g[2], a[0], a[1], a[2], r[0], r[1], r[2], r[3])
    sampleCount++; lastT1Ms = t
    curAccMin = min(curAccMin, accuracy); magAccMin = min(magAccMin, accuracy)
    // rot 峰值角速率：品質守門用（rotvec 不入特徵,ADR 0003）。以 mag 行的節奏取樣即可。
    rotPrev?.let { p ->
      if (!rotPrevTMs.isNaN() && t > rotPrevTMs) {
        var dot = p[0] * r[0] + p[1] * r[1] + p[2] * r[2] + p[3] * r[3]
        dot = abs(dot).coerceAtMost(1.0)
        val deg = Math.toDegrees(2.0 * acos(dot))
        rotMaxDegPerS = maxOf(rotMaxDegPerS, deg / ((t - rotPrevTMs) / 1000.0))
      }
    }
    rotPrev = r; rotPrevTMs = t
  }

  @Synchronized fun takeReady(): List<Batch> {
    val out = ready.toList(); ready.clear(); return out
  }

  @Synchronized fun drain(): Batch? {
    if (cur.isEmpty()) return null
    val b = Batch(cur, curAccMin); cur = ArrayList(); curSec = -1; curAccMin = 3
    return b
  }
}
