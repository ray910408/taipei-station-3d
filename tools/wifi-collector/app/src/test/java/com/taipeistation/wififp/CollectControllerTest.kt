package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectControllerTest {
  private val pts = listOf(
    RpPoint("B1-001", "f", 0.0, 0.0, null),
    RpPoint("B1-002", "f", 6.0, 0.0, null),
    RpPoint("B1-003", "f", 12.0, 0.0, null),
  )

  @Test fun slots_single_vs_quad() {
    assertEquals(listOf<Int?>(null), slotsForMode("single"))
    assertEquals(listOf<Int?>(0, 90, 180, 270), slotsForMode("quad"))
  }

  @Test fun quad_partial_progress() {
    val prog = Progress(setOf(DoneKey("B1-001", 0), DoneKey("B1-001", 90)), emptySet())
    assertEquals(listOf<Int?>(180, 270), pendingSlotsFor("B1-001", "quad", prog))
    assertFalse(isPointCompleteFor("B1-001", "quad", prog))
    val full = Progress(setOf(0, 90, 180, 270).map { DoneKey("B1-001", it) }.toSet(), emptySet())
    assertTrue(isPointCompleteFor("B1-001", "quad", full))
  }

  @Test fun skipped_counts_complete() {
    val prog = Progress(emptySet(), setOf("B1-001"))
    assertTrue(isPointCompleteFor("B1-001", "single", prog))
    assertEquals("B1-002", nextPendingPoint(pts, "single", prog)!!.id)
  }

  @Test fun mode_mismatch_quad_file_single_mode() {
    // quad 檔以 single 模式解讀:null 槽不在 done → 仍 pending(續採必須還原 mode 的根據)
    val quadDone = Progress(setOf(0, 90, 180, 270).map { DoneKey("B1-001", it) }.toSet(), emptySet())
    assertFalse(isPointCompleteFor("B1-001", "single", quadDone))
  }

  @Test fun redo_clears_all_slots_and_next_refills() {
    val prog = Progress(setOf(DoneKey("B1-001", null), DoneKey("B1-002", null)), emptySet())
    val after = progressAfterRedo(prog, "B1-001")
    assertEquals(setOf(DoneKey("B1-002", null)), after.done)
    assertEquals("B1-001", nextPendingPoint(pts, "single", after)!!.id)
    assertNull(nextPendingPoint(pts, "single",
      Progress(pts.map { DoneKey(it.id, null) }.toSet(), emptySet())))
  }
}
