// WalkModelTest.kt
package com.taipeistation.wififp

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class WalkModelTest {
  private val edgeJson = """
    {"schema":"edge-list@1","station":"taipei-main-station","generated":"2026-08-01T10:00:00.000Z",
     "walks":[
       {"seq":1,"floor":"tra-concourse-b1","from":"n-tc-001","to":"n-tc-002","kind":"walk",
        "required":true,"lengthM":16.1,"fromXy":[128,30],"toXy":[140,35],"note":"東廊"},
       {"seq":2,"floor":"tra-concourse-b1","from":"n-tc-002","to":"n-tc-001","kind":"walk",
        "required":true,"lengthM":16.1,"fromXy":[140,35],"toXy":[128,30]}]}
  """.trimIndent()

  @Test fun parseEdgeList_ok() {
    val l = parseEdgeList(edgeJson)
    assertEquals(2, l.walks.size)
    assertEquals(WalkKey("tra-concourse-b1", "n-tc-001", "n-tc-002"), l.walks[0].key())
    assertEquals("東廊", l.walks[0].note)
    assertNull(l.walks[1].note)
    assertEquals(16.1, l.walks[0].lengthM, 1e-9)
  }

  @Test fun parseEdgeList_rejects_bad() {
    assertThrows(IllegalArgumentException::class.java) { parseEdgeList("""{"schema":"rp-list@1"}""") }
    // 空 generated 放行會讓續採永遠被擋——擋在匯入（同 rp-list 教訓）
    assertThrows(IllegalArgumentException::class.java) {
      parseEdgeList(edgeJson.replace("2026-08-01T10:00:00.000Z", ""))
    }
    assertThrows(IllegalArgumentException::class.java) {
      parseEdgeList("""{"schema":"edge-list@1","generated":"g","walks":[]}""")
    }
  }

  @Test fun sampleLines_roundtrip() {
    val row = doubleArrayOf(123.4, 12.300000190734863, -33.0, 28.0, 0.1, 0.2, 9.8, 0.0, 0.1, 9.9, 0.7, 0.0, 0.0, 0.7)
    val o = JSONObject(buildSamplesLine(listOf(row), magAccMin = 2))
    assertEquals("samples", o.getString("type"))
    assertEquals(2, o.getInt("magAcc"))
    assertEquals(14, o.getJSONArray("rows").getJSONArray(0).length())
    assertEquals(123.4, o.getJSONArray("rows").getJSONArray(0).getDouble(0), 1e-9)
    assertEquals(12.3, o.getJSONArray("rows").getJSONArray(0).getDouble(1), 1e-9)
    val end = JSONObject(buildWalkEndLine(41000.5, 41001, 2050, listOf(600.0, 1150.5), 3, 42.0))
    assertEquals("walkEnd", end.getString("type"))
    assertEquals(2, end.getJSONArray("steps").length())
    assertEquals(2050, end.getInt("sampleCount"))
    assertEquals(42.0, end.getDouble("rotMaxDegPerS"), 1e-9)
  }

  @Test fun parseWalkSession_done_needs_complete_pair() {
    val w = parseEdgeList(edgeJson).walks[0]
    val w2 = parseEdgeList(edgeJson).walks[1]
    val lines = sequenceOf(
      buildWalkSessionLine("s1", "Redmi", 34, "0.2.0", "edge-list.json", "g", 0.65, "t"),
      buildWalkBeginLine(w, "t0"),
      buildSamplesLine(listOf(), 3),
      buildWalkEndLine(1000.0, 1000, 50, listOf(), 3, 10.0),   // w 完整
      buildWalkBeginLine(w2, "t1"),                            // w2 只有 begin → 未完成
      "not json",
      buildWalkBeginLine(w2, "t2"),
      buildWalkAbortLine(w2, "誤按", "t3"),                     // abort → 未完成
    )
    assertEquals(setOf(w.key()), parseWalkSession(lines).done)
  }

  @Test fun resume_guard() {
    val h = parseWalkSessionHeader(sequenceOf(
      "junk", buildWalkSessionLine("s1", "d", 34, "0.2.0", "e.json", "gen-A", 0.7, "t")))!!
    assertEquals(0.7, h.stepLengthM, 1e-9)
    assertNull(walkResumeBlockReason(h, "gen-A"))
    assertNotNull(walkResumeBlockReason(h, "gen-B"))
    assertNotNull(walkResumeBlockReason(null, "gen-A"))
    assertNotNull(walkResumeBlockReason(WalkSessionHeader("", 0.65), "gen-A"))
  }
}
