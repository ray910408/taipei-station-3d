// WalkChecksTest.kt
package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WalkChecksTest {
  private val w = WalkEntry(1, "f", "a", "b", "walk", true, 16.0, null)

  @Test fun clean_walk_no_warnings() {
    // 16m、13s、25 步 ×0.65m=16.25m → 全部在範圍內
    val q = walkQuality(w, 13000, 25, 0.65, 40.0, 3)
    assertEquals(0, q.warnings.size)
    assertEquals(16.0 / 13.0, q.speedMps, 1e-6)
    assertEquals(16.0 / 25, q.stepLenEstM!!, 1e-6)
  }

  @Test fun each_check_fires() {
    // 速度低於 0.5 m/s（16m/40s）
    assertTrue(walkQuality(w, 40000, 25, 0.65, 40.0, 3).warnings.any { "速度" in it })
    // 步數×步長 5×0.65=3.25m vs 16m,差 >40%
    assertTrue(walkQuality(w, 13000, 5, 0.65, 40.0, 3).warnings.any { "步" in it })
    // rot 峰值超門檻
    assertTrue(walkQuality(w, 13000, 25, 0.65, 500.0, 3).warnings.any { "晃動" in it })
    // 磁力校正低
    assertTrue(walkQuality(w, 13000, 25, 0.65, 40.0, 1).warnings.any { "校正" in it })
  }

  @Test fun zero_steps_no_div_by_zero() {
    val q = walkQuality(w, 13000, 0, 0.65, 40.0, 3)
    assertEquals(null, q.stepLenEstM)
    assertTrue(q.warnings.isNotEmpty())
  }
}
