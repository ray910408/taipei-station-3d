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

  @Test fun magQuality_separates_rotation_from_ambient() {
    fun mag(std: List<Double>, magStd: Double) =
      MagSummary(100, listOf(0.0, 0.0, 0.0), std, 40.0, magStd, 3)
    // 真機實測:握穩(0726 P02~P06)三軸 std ~1.2、magStd ~1.2
    assertEquals(MagQuality.OK, magQuality(mag(listOf(0.42, 0.33, 0.44), 0.36)))
    assertEquals(MagQuality.OK, magQuality(mag(listOf(1.13, 0.9, 1.0), 1.15)))
    // 真機實測:轉動(0725 s1649)三軸 ~16、magStd 1.75
    assertEquals(MagQuality.DEVICE_MOVED, magQuality(mag(listOf(16.27, 14.58, 13.55), 1.75)))
    // 真機實測:轉動且殘留偏移讓合力也超標(0726 P01 / P07)——舊版會誤判成 AMBIENT
    assertEquals(MagQuality.DEVICE_MOVED, magQuality(mag(listOf(10.16, 8.0, 6.0), 2.75)))
    assertEquals(MagQuality.DEVICE_MOVED, magQuality(mag(listOf(18.70, 12.0, 9.0), 3.95)))
    // 真機實測:輕微環境擾動(0726 P10)軸向未超標、合力超標
    assertEquals(MagQuality.AMBIENT_NOISY, magQuality(mag(listOf(2.12, 1.8, 1.5), 2.53)))
    // 環境磁場真的變(列車):兩者同幅度漲
    assertEquals(MagQuality.AMBIENT_NOISY, magQuality(mag(listOf(8.0, 7.0, 6.0), 5.0)))
    assertEquals(MagQuality.OK, magQuality(null))
  }

  @Test fun magAccuracy_labels_and_calibration_gate() {
    assertEquals("未校正", magAccLabel(0))
    assertEquals("低", magAccLabel(1))
    assertEquals("中", magAccLabel(2))
    assertEquals("高", magAccLabel(3))
    assertTrue(magNeedsCalibration(0))   // 真機首採實測值:accuracy 0 必須提示
    assertTrue(magNeedsCalibration(1))
    assertFalse(magNeedsCalibration(2))
    assertFalse(magNeedsCalibration(3))
  }

  @Test fun pickSlot_single_null_slot_runs_not_done() {
    // 單朝向 pending=[null] 必須 Run(null);原 firstOrNull()?:return 會誤判 Done → 掃描不啟動
    assertEquals(SlotPick.Run(null), pickSlot(listOf<Int?>(null)))
    assertEquals(SlotPick.Run(0), pickSlot(listOf<Int?>(0, 90, 180, 270)))
    assertEquals(SlotPick.Done, pickSlot(emptyList()))
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
