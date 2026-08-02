package com.taipeistation.wififp

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 建議下一條：required 走線依 seq 序(歐拉迴路順序)取第一條未完成;選收(gate)不入建議,只能跳選 */
fun nextPendingWalk(walks: List<WalkEntry>, done: Set<WalkKey>): WalkEntry? =
  walks.asSequence().filter { it.required }.sortedBy { it.seq }.firstOrNull { it.key() !in done }

class WalkController(
  private val app: AppState,
  private val rig: WalkSensorRig,
  private val scope: CoroutineScope,
) {
  var walking by mutableStateOf(false)
  var currentKey by mutableStateOf<WalkKey?>(null)
  var lastQuality by mutableStateOf<WalkQuality?>(null)
  var writeWarn by mutableStateOf(false)
  var pendingWrites by mutableStateOf(0)
    private set
  var liveSteps by mutableStateOf(0)
  var liveSamples by mutableStateOf(0)
  var beginMs by mutableStateOf(0L)
  private var buffer: WalkSampleBuffer? = null
  private var flushJob: Job? = null

  /** 寫檔走單一 Channel 消費者:多個 launch 各自 withContext(IO) 會在執行緒池亂序,
   *  walkEnd 可能先於最後一批 samples 落盤;Channel FIFO 保證行序＝呼叫序。 */
  private val lines = Channel<String>(Channel.UNLIMITED)
  init {
    scope.launch {
      for (line in lines) {
        val ok = withContext(Dispatchers.IO) { app.walkWriter?.append(line) ?: false }
        writeWarn = !ok
        pendingWrites-- // append 與此處都在 main dispatcher；只有實際寫檔切到 IO，計數不需 atomic。
      }
    }
  }

  fun isDone(key: WalkKey): Boolean = key in app.walkProgress.done
  fun current(): WalkEntry? = currentKey?.let { k -> app.edgeList?.walks?.firstOrNull { it.key() == k } }

  fun ensureCurrent() {
    if (currentKey == null || isDone(currentKey!!))
      currentKey = nextPendingWalk(app.edgeList?.walks ?: emptyList(), app.walkProgress.done)?.key()
  }

  fun jumpTo(key: WalkKey) { if (!walking) currentKey = key }

  fun redo(key: WalkKey) {
    if (walking) return
    // 檔案裡舊 walk 留著（離線同 key 取最後一個完整 walk）；記憶體中清掉重走
    app.walkProgress = WalkProgress(app.walkProgress.done - key)
    currentKey = key
  }

  fun begin() {
    if (walking) return
    val w = current() ?: return
    walking = true // 同步豎旗封雙擊（CollectController 同款教訓）
    beginMs = SystemClock.elapsedRealtime()
    liveSteps = 0; liveSamples = 0; lastQuality = null
    val b = WalkSampleBuffer(SystemClock.elapsedRealtimeNanos())
    buffer = b
    append(buildWalkBeginLine(w, isoNow()))
    rig.beginWalk(b)
    flushJob = scope.launch {
      while (true) {
        delay(500)
        flushReady(b)
        liveSteps = b.stepsMs.size; liveSamples = b.sampleCount
      }
    }
  }

  fun end() {
    val w = current() ?: return
    val b = buffer ?: return
    stopStream()
    flushReady(b)
    b.drain()?.let { append(buildSamplesLine(it.rows, it.magAccMin)) }
    val durationMs = SystemClock.elapsedRealtime() - beginMs
    append(buildWalkEndLine(b.lastT1Ms, durationMs, b.sampleCount, b.stepsMs, b.magAccMin, b.rotMaxDegPerS))
    app.walkProgress = WalkProgress(app.walkProgress.done + w.key())
    lastQuality = walkQuality(w, durationMs, b.stepsMs.size, app.stepLengthM, b.rotMaxDegPerS, b.magAccMin,
      b.sampleCount, b.lastT1Ms)
    buffer = null
    ensureCurrent()
  }

  fun abort(reason: String) {
    val w = current() ?: return
    stopStream()
    append(buildWalkAbortLine(w, reason, isoNow()))
    buffer = null
  }

  private fun stopStream() {
    rig.endWalk()
    flushJob?.cancel(); flushJob = null
    walking = false
  }

  private fun flushReady(b: WalkSampleBuffer) {
    for (batch in b.takeReady()) append(buildSamplesLine(batch.rows, batch.magAccMin))
  }

  private fun append(line: String) { pendingWrites++; lines.trySend(line) }
}
