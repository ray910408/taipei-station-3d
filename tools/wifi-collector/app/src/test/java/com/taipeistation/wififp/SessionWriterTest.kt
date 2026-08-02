package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class SessionWriterTest {
  @get:Rule val tmp = TemporaryFolder()

  @Test fun append_readback_roundtrip() {
    val w = SessionWriter(tmp.root, "s20260724-1030")
    assertTrue(w.append("""{"type":"session"}"""))
    assertTrue(w.append("""{"type":"point","pointId":"B1-001"}"""))
    assertEquals(2, w.readLines().size)
    assertTrue(w.file.name == "wifi-fp-s20260724-1030.jsonl")
    // 重開同 session 續寫
    val w2 = SessionWriter(tmp.root, "s20260724-1030")
    w2.append("""{"type":"skip","pointId":"B1-002","reason":"r","t":"t"}""")
    assertEquals(3, w2.readLines().size)
  }

  @Test fun list_sorted_desc() {
    SessionWriter(tmp.root, "s20260101-0900").append("x")
    SessionWriter(tmp.root, "s20260201-0900").append("x")
    val names = SessionWriter.list(tmp.root).map { it.name }
    assertEquals(listOf("wifi-fp-s20260201-0900.jsonl", "wifi-fp-s20260101-0900.jsonl"), names)
  }

  @Test fun prefix_separates_walk_sessions() {
    val dir = java.nio.file.Files.createTempDirectory("sw").toFile()
    SessionWriter(dir, "s1").append("""{"a":1}""")
    SessionWriter(dir, "s2", "mag-walk").append("""{"b":2}""")
    assertEquals(listOf("wifi-fp-s1.jsonl"), SessionWriter.list(dir).map { it.name })
    assertEquals(listOf("mag-walk-s2.jsonl"), SessionWriter.list(dir, "mag-walk").map { it.name })
  }

  @Test fun newSessionId_format() {
    assertTrue(Regex("^s\\d{8}-\\d{6}$").matches(SessionWriter.newSessionId()))
  }
}
