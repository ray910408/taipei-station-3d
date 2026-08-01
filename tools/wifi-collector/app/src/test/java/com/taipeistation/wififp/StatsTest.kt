package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatsTest {
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
