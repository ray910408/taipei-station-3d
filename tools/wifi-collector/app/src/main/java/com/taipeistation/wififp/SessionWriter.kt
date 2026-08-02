package com.taipeistation.wififp

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** JSONL 隨採隨寫：append+fsync；IO 失敗留在 pending，下次 append 一併重試 */
class SessionWriter(baseDir: File, val sessionId: String, val prefix: String = "wifi-fp") {
  val file = File(baseDir, "sessions/$prefix-$sessionId.jsonl")
  private val pending = ArrayDeque<String>()

  init { file.parentFile?.mkdirs() }

  @Synchronized
  fun append(line: String): Boolean {
    pending.addLast(line)
    return try {
      FileOutputStream(file, true).use { fos ->
        while (pending.isNotEmpty()) {
          fos.write((pending.first() + "\n").toByteArray(Charsets.UTF_8))
          pending.removeFirst()
        }
        fos.fd.sync()
      }
      true
    } catch (e: IOException) { false }
  }

  /** 重試 pending 佇列(不新增行)。消費端重試不可重呼 append(line)——同一行會二次入佇列,成功時寫出重複列。 */
  @Synchronized
  fun flushPending(): Boolean {
    if (pending.isEmpty()) return true
    return try {
      FileOutputStream(file, true).use { fos ->
        while (pending.isNotEmpty()) {
          fos.write((pending.first() + "\n").toByteArray(Charsets.UTF_8))
          pending.removeFirst()
        }
        fos.fd.sync()
      }
      true
    } catch (e: IOException) { false }
  }

  fun readLines(): List<String> = if (file.exists()) file.readLines() else emptyList()

  companion object {
    fun list(baseDir: File, prefix: String = "wifi-fp"): List<File> =
      File(baseDir, "sessions").listFiles { f -> f.name.startsWith("$prefix-") && f.name.endsWith(".jsonl") }
        ?.sortedByDescending { it.name } ?: emptyList()

    fun newSessionId(): String =
      "s" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))
  }
}
