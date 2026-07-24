package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatsTest {
  @Test fun magStats_meanStdMagnitude() {
    val s = MagStats()
    s.add(3.0, 0.0, 4.0)  // |v| = 5
    s.add(3.0, 0.0, 4.0)
    s.add(0.0, 0.0, 0.0)  // |v| = 0
    val m = s.summary(2)!!
    assertEquals(3, m.n)
    assertEquals(2.0, m.mean[0], 1e-9)
    assertEquals(0.0, m.mean[1], 1e-9)
    // std of {3,3,0} = sqrt(2) ≈ 1.4142（母體標準差）
    assertEquals(1.41421356, m.std[0], 1e-6)
    assertEquals(10.0 / 3, m.magMean, 1e-9)
    assertEquals(2, m.accuracy)
  }

  @Test fun magStats_empty() { assertNull(MagStats().summary(3)) }

  @Test fun circularMean_wraparound() {
    assertEquals(0.0, circularMeanDeg(listOf(350.0, 10.0))!!, 1e-6)
    assertEquals(90.0, circularMeanDeg(listOf(80.0, 100.0))!!, 1e-6)
    assertNull(circularMeanDeg(emptyList()))
  }

  @Test fun angDiff() {
    assertEquals(20.0, angDiffDeg(350.0, 10.0), 1e-9)
    assertEquals(180.0, angDiffDeg(0.0, 180.0), 1e-9)
    assertEquals(0.0, angDiffDeg(90.0, 450.0), 1e-9)
  }
}
