package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WalkControllerTest {
  private fun w(seq: Int, from: String, to: String, required: Boolean = true) =
    WalkEntry(seq, "f", from, to, if (required) "walk" else "gate", required, 10.0, null)

  @Test fun next_pending_follows_seq_and_skips_optional_and_done() {
    val walks = listOf(w(1, "a", "b"), w(2, "b", "a"), w(3, "g1", "g2", required = false), w(4, "b", "c"))
    assertEquals("a", nextPendingWalk(walks, emptySet())!!.from)
    // seq 1 完成 → 下一條是 seq 2；選收(gate)永不入建議
    assertEquals(2, nextPendingWalk(walks, setOf(WalkKey("f", "a", "b")))!!.seq)
    assertEquals(4, nextPendingWalk(walks, setOf(WalkKey("f", "a", "b"), WalkKey("f", "b", "a")))!!.seq)
    assertNull(nextPendingWalk(walks, setOf(
      WalkKey("f", "a", "b"), WalkKey("f", "b", "a"), WalkKey("f", "b", "c"))))
  }
}
