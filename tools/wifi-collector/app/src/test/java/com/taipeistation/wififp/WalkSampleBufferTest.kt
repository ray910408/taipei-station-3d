// WalkSampleBufferTest.kt
package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WalkSampleBufferTest {
  private fun ms(v: Long) = v * 1_000_000L // ms → nanos

  private fun primed(t0: Long = 0L): WalkSampleBuffer {
    val b = WalkSampleBuffer(t0)
    b.onGrav(0.0, 0.0, 9.8); b.onAcc(0.0, 0.1, 9.9); b.onRotvec(0.0, 0.0, 0.0, 1.0)
    return b
  }

  @Test fun rows_wait_for_aux_streams() {
    // grav/acc/rotvec 都到齊前的 mag 事件不成行——JSON 不能寫 NaN,骨架列離線也沒用
    val b = WalkSampleBuffer(ms(0))
    b.onMag(ms(20), 10.0, 20.0, 30.0, 3)
    assertEquals(0, b.sampleCount)
    b.onGrav(0.0, 0.0, 9.8); b.onAcc(0.0, 0.1, 9.9); b.onRotvec(0.0, 0.0, 0.0, 1.0)
    b.onMag(ms(40), 10.0, 20.0, 30.0, 3)
    assertEquals(1, b.sampleCount)
  }

  @Test fun batches_split_on_second_boundary() {
    val b = primed()
    for (t in listOf(100L, 500L, 999L, 1000L, 1500L)) b.onMag(ms(t), 1.0, 2.0, 3.0, 3)
    val ready = b.takeReady()
    assertEquals(1, ready.size)               // 第 0 秒(3 筆)完成;第 1 秒還在累積
    assertEquals(3, ready[0].rows.size)
    assertEquals(100.0, ready[0].rows[0][0], 1e-6) // t 相對 ms
    assertEquals(0, b.takeReady().size)       // 取走即空
    val tail = b.drain()!!
    assertEquals(2, tail.rows.size)
    assertNull(b.drain())
  }

  @Test fun mag_acc_min_tracked_per_batch_and_total() {
    val b = primed()
    b.onMag(ms(100), 1.0, 2.0, 3.0, 3)
    b.onMag(ms(200), 1.0, 2.0, 3.0, 1)
    b.onMag(ms(1100), 1.0, 2.0, 3.0, 2)
    assertEquals(1, b.takeReady()[0].magAccMin)
    assertEquals(1, b.magAccMin)
  }

  @Test fun steps_recorded_relative_ms() {
    val b = primed()
    b.onStep(ms(600)); b.onStep(ms(1150))
    assertEquals(listOf(600.0, 1150.0), b.stepsMs)
  }

  @Test fun steps_before_begin_are_ignored() {
    val b = primed(ms(1000))
    b.onStep(ms(900))
    assertEquals(emptyList<Double>(), b.stepsMs)
    b.onStep(ms(1100))
    assertEquals(listOf(100.0), b.stepsMs)
  }

  @Test fun rot_rate_peak_from_consecutive_quats() {
    val b = primed()
    b.onMag(ms(0), 1.0, 2.0, 3.0, 3)
    // 100ms 內轉 90°（z 軸）：q=[0,0,sin45°,cos45°] → 900°/s，遠超門檻
    b.onRotvec(0.0, 0.0, 0.7071068, 0.7071068)
    b.onMag(ms(100), 1.0, 2.0, 3.0, 3)
    assertTrue("rotMax=${b.rotMaxDegPerS}", b.rotMaxDegPerS > 800.0)
  }
}
