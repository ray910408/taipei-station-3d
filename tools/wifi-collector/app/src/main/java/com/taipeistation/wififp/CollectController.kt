package com.taipeistation.wififp

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class CollectController(
  private val app: AppState,
  private val engine: WifiScanEngine,
  private val rig: SensorRig,
  private val scope: CoroutineScope,
) {
  var scanning by mutableStateOf(false)
  var scanK by mutableStateOf(0)
  var apCount by mutableStateOf(0)
  var lastThrottled by mutableStateOf(false)
  var lowScanWarn by mutableStateOf(false)
  var currentId by mutableStateOf<String?>(null)
  private var job: Job? = null

  fun slotsFor(): List<Int?> = if (app.mode == "quad") listOf(0, 90, 180, 270) else listOf(null)

  fun pendingSlots(id: String): List<Int?> =
    slotsFor().filter { DoneKey(id, it) !in app.progress.done }

  fun isPointComplete(id: String): Boolean =
    id in app.progress.skipped || pendingSlots(id).isEmpty()

  fun nextPending(): RpPoint? = app.rpList?.points?.firstOrNull { !isPointComplete(it.id) }

  fun current(): RpPoint? = currentId?.let { id -> app.rpList?.points?.firstOrNull { it.id == id } }

  fun ensureCurrent() {
    if (currentId == null || isPointComplete(currentId!!)) currentId = nextPending()?.id
  }

  fun startScan() {
    if (scanning) return
    val p = current() ?: return
    job = scope.launch { runOneSlot(p) }
  }

  fun cancel() { job?.cancel(); scanning = false }

  fun redo(id: String) {
    // 檔案裡舊行留著（離線同 key 取最後一行）；記憶體中清掉重跑
    app.progress = app.progress.copy(done = app.progress.done.filterNot { it.pointId == id }.toSet())
    currentId = id
  }

  fun skip(reason: String) {
    val p = current() ?: return
    app.writer?.append(buildSkipLine(p.id, reason, isoNow()))
    app.progress = app.progress.copy(skipped = app.progress.skipped + p.id)
    ensureCurrent()
  }

  fun jumpTo(id: String) { if (!scanning) currentId = id }

  private suspend fun runOneSlot(p: RpPoint) {
    val slot = pendingSlots(p.id).firstOrNull() ?: return
    scanning = true; scanK = 0; lowScanWarn = false
    val startedAt = isoNow()
    val t0 = SystemClock.elapsedRealtime()
    rig.beginWindow()
    val batches = ArrayList<ScanBatch>()
    var cachedStreak = 0
    var throttled = false
    var ok = 0
    try {
      repeat(app.scansPerPoint) { i ->
        when (val o = engine.scanOnce()) {
          is WifiScanEngine.Outcome.Fresh -> {
            batches += ScanBatch(isoNow(), true, o.aps); ok++; cachedStreak = 0; apCount = o.aps.size
          }
          is WifiScanEngine.Outcome.Cached -> {
            batches += ScanBatch(isoNow(), false, o.aps); cachedStreak++
            if (cachedStreak >= 2) throttled = true
            apCount = o.aps.size
          }
          WifiScanEngine.Outcome.Failed -> {}
        }
        scanK = i + 1
      }
      val win = rig.endWindow()
      app.writer?.append(buildPointLine(p, slot, win.headingMeanDeg, win.headingAcc, startedAt,
        SystemClock.elapsedRealtime() - t0, ok, throttled, batches, win.mag))
      app.progress = app.progress.copy(done = app.progress.done + DoneKey(p.id, slot))
      lastThrottled = throttled
      lowScanWarn = ok * 10 < app.scansPerPoint * 6 // ok < 60% N
      ensureCurrent()
    } finally {
      scanning = false
    }
  }
}
