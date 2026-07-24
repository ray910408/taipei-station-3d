package com.taipeistation.wififp

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelTest {
  private val rpJson = """
    {"schema":"rp-list@1","station":"taipei-main-station","generated":"2026-07-24T10:00:00+08:00",
     "points":[{"id":"B1-001","floor":"tra-concourse-b1","x":40,"y":-10,"note":"東翼"},
               {"id":"B1-002","floor":"tra-concourse-b1","x":46,"y":-10}]}
  """.trimIndent()

  @Test fun parseRpList_ok() {
    val list = parseRpList(rpJson)
    assertEquals(2, list.points.size)
    assertEquals("B1-001", list.points[0].id)
    assertEquals(40.0, list.points[0].x, 1e-9)
    assertEquals("東翼", list.points[0].note)
    assertNull(list.points[1].note)
  }

  @Test(expected = IllegalArgumentException::class)
  fun parseRpList_badSchema() { parseRpList("""{"schema":"nope","points":[]}""") }

  @Test fun pointLine_roundtrip() {
    val p = RpPoint("B1-001", "tra-concourse-b1", 40.0, -10.0, "東翼")
    val line = buildPointLine(
      p, headingSlot = 90, headingDeg = 88.5, headingAcc = 3,
      startedAt = "2026-07-24T10:31:00+08:00", durationMs = 41000, actualScans = 9, throttled = false,
      scans = listOf(ScanBatch("2026-07-24T10:31:04+08:00", true, listOf(ApObs("aa:bb:cc:dd:ee:ff", "TPE-Free", -67, 5745)))),
      mag = MagSummary(750, listOf(12.1, -33.0, 28.4), listOf(0.4, 0.5, 0.3), 46.2, 0.8, 3),
    )
    val o = JSONObject(line)
    assertEquals("point", o.getString("type"))
    assertEquals(90, o.getInt("headingSlot"))
    assertEquals(9, o.getInt("actualScans"))
    assertEquals(true, o.getJSONArray("scans").getJSONObject(0).getBoolean("fresh"))
    assertEquals("aa:bb:cc:dd:ee:ff",
      o.getJSONArray("scans").getJSONObject(0).getJSONArray("aps").getJSONObject(0).getString("bssid"))
    assertEquals(46.2, o.getJSONObject("mag").getDouble("magMean"), 1e-9)
  }

  @Test fun pointLine_nullables() {
    val p = RpPoint("B1-002", "tra-concourse-b1", 46.0, -10.0, null)
    val line = buildPointLine(p, null, null, -1, "t", 1000, 0, true, emptyList(), null)
    val o = JSONObject(line)
    assertTrue(o.isNull("headingSlot"))
    assertTrue(!o.has("headingDeg"))
    assertTrue(!o.has("mag"))
    assertEquals(true, o.getBoolean("throttled"))
  }

  @Test fun parseSession_progress() {
    val p = RpPoint("B1-001", "f", 0.0, 0.0, null)
    val lines = sequenceOf(
      buildSessionLine("Redmi", 33, "0.1.0", "quad", 10, "g", "s"),
      buildPointLine(p, 0, 1.0, 3, "t", 1, 1, false, emptyList(), null),
      buildPointLine(p, 90, 1.0, 3, "t", 1, 1, false, emptyList(), null),
      "not json at all",
      buildSkipLine("B1-002", "施工", "t"),
    )
    val prog = parseSession(lines)
    assertEquals(setOf(DoneKey("B1-001", 0), DoneKey("B1-001", 90)), prog.done)
    assertEquals(setOf("B1-002"), prog.skipped)
  }
}
