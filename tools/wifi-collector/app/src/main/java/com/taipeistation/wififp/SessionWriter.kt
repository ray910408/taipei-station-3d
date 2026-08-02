package com.taipeistation.wififp

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter

/** JSONL 隨採隨寫：append+fsync；IO 失敗留在 pending，由 append/flushPending 重試 */
class SessionWriter(baseDir: File, val sessionId: String, val prefix: String = "wifi-fp") {
  val file = File(baseDir, "sessions/$prefix-$sessionId.jsonl")
  private val pending = ArrayDeque<String>()
  private var needsSync = false // 行已進 OS cache 但 fsync 未確認——耐久前不得回 true

  init { file.parentFile?.mkdirs() }

  @Synchronized
  fun append(line: String): Boolean { pending.addLast(line); return flushLocked() }

  /** 重試 pending 佇列(不新增行)。消費端重試不可重呼 append(line)——同一行會二次入佇列,成功時寫出重複列。 */
  @Synchronized
  fun flushPending(): Boolean = flushLocked()

  /** 有未落盤行或 fsync 未確認——controller 建構時檢查,把失敗的 session header 納入重試閘門 */
  @Synchronized
  fun hasPending(): Boolean = pending.isNotEmpty() || needsSync

  // 只在 @Synchronized 方法內呼叫。行寫出即出佇列(重試不重寫→不產生重複列);
  // fsync 成功前掛 needsSync——sync 拋錯時佇列可能已空,旗保證下次補 sync 而非空放。
  private fun flushLocked(): Boolean {
    if (pending.isEmpty() && !needsSync) return true
    return try {
      FileOutputStream(file, true).use { fos ->
        while (pending.isNotEmpty()) {
          fos.write((pending.first() + "\n").toByteArray(Charsets.UTF_8))
          pending.removeFirst()
          needsSync = true
        }
        if (needsSync) { fos.fd.sync(); needsSync = false }
      }
      true
    } catch (e: IOException) { false }
  }

  fun readLines(): List<String> = if (file.exists()) file.readLines() else emptyList()

  companion object {
    fun list(baseDir: File, prefix: String = "wifi-fp"): List<File> =
      File(baseDir, "sessions").listFiles { f -> f.name.startsWith("$prefix-") && f.name.endsWith(".jsonl") }
        ?.sortedByDescending { it.name } ?: emptyList()

    fun newSessionId(baseDir: File, prefix: String): String =
      uniqueSessionId(baseDir, prefix,
        "s" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss")))

    /** 同一秒連開兩個新 session 會撞同檔(append 模式=混寫)——已存在就加序號。base 拆參數供測試 */
    fun uniqueSessionId(baseDir: File, prefix: String, base: String): String {
      var id = base
      var k = 2
      while (File(baseDir, "sessions/$prefix-$id.jsonl").exists()) { id = "$base-${k++}" }
      return id
    }
  }
}
