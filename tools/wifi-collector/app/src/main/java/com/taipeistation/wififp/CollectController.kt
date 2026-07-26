package com.taipeistation.wififp

import android.os.SystemClock
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// —— 純邏輯(JVM 可測)——

fun slotsForMode(mode: String): List<Int?> = if (mode == "quad") listOf(0, 90, 180, 270) else listOf(null)

fun pendingSlotsFor(id: String, mode: String, progress: Progress): List<Int?> =
  slotsForMode(mode).filter { DoneKey(id, it) !in progress.done }

fun isPointCompleteFor(id: String, mode: String, progress: Progress): Boolean =
  id in progress.skipped || pendingSlotsFor(id, mode, progress).isEmpty()

fun nextPendingPoint(points: List<RpPoint>, mode: String, progress: Progress): RpPoint? =
  points.firstOrNull { !isPointCompleteFor(it.id, mode, progress) }

fun progressAfterRedo(progress: Progress, id: String): Progress =
  progress.copy(done = progress.done.filterNot { it.pointId == id }.toSet())

/** 合力擾動門檻(µT):magStd 超標=環境磁場本身在變(列車/電梯) */
const val MAG_NOISY_STD = 2.0

/** 單軸擾動門檻(µT):合力穩但三軸狂擺=手機被轉動;magStd 是旋轉不變量,抓不到這種 */
const val MAG_AXIS_NOISY_STD = 3.0

enum class MagQuality { OK, AMBIENT_NOISY, DEVICE_MOVED }

/** 轉動的特徵是「軸向擾動遠大於合力擾動」——環境磁場變化則兩者同步漲。
 *  不可只看 magStd 門檻:殘留硬鐵偏移會讓合力也隨轉動變化(實測轉動時 magStd 也超標),
 *  單看門檻會把轉動誤判成環境擾動。 */
fun magQuality(mag: MagSummary?): MagQuality {
  if (mag == null) return MagQuality.OK
  val axisMax = mag.std.maxOrNull() ?: 0.0
  return when {
    axisMax > MAG_AXIS_NOISY_STD && axisMax > mag.magStd * 2 -> MagQuality.DEVICE_MOVED
    mag.magStd > MAG_NOISY_STD -> MagQuality.AMBIENT_NOISY
    axisMax > MAG_AXIS_NOISY_STD -> MagQuality.AMBIENT_NOISY // 兩者同幅度漲＝環境
    else -> MagQuality.OK
  }
}

fun magAccLabel(acc: Int): String = when (acc) {
  3 -> "高"
  2 -> "中"
  1 -> "低"
  else -> "未校正"
}

/** accuracy ≤ 1 代表磁力資料不可信,要提示畫 8 字 */
fun magNeedsCalibration(acc: Int): Boolean = acc <= 1

sealed class SlotPick {
  data object Done : SlotPick()
  data class Run(val slot: Int?) : SlotPick()
}

/** 決定本輪要跑的槽:空=Done;否則 Run(第一個槽)——單朝向槽本身是 null,不可用 firstOrNull()?:return 判空 */
fun pickSlot(pending: List<Int?>): SlotPick =
  if (pending.isEmpty()) SlotPick.Done else SlotPick.Run(pending.first())

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
  var writeWarn by mutableStateOf(false)
  var lastMagQuality by mutableStateOf(MagQuality.OK)
  var lastMagAcc by mutableStateOf(-1)
  var scanStartMs by mutableStateOf(0L)
  var currentId by mutableStateOf<String?>(null)
  private var job: Job? = null

  fun slotsFor(): List<Int?> = slotsForMode(app.mode)

  fun pendingSlots(id: String): List<Int?> = pendingSlotsFor(id, app.mode, app.progress)

  fun isPointComplete(id: String): Boolean = isPointCompleteFor(id, app.mode, app.progress)

  fun nextPending(): RpPoint? = nextPendingPoint(app.rpList?.points ?: emptyList(), app.mode, app.progress)

  fun current(): RpPoint? = currentId?.let { id -> app.rpList?.points?.firstOrNull { it.id == id } }

  fun ensureCurrent() {
    if (currentId == null || isPointComplete(currentId!!)) currentId = nextPending()?.id
  }

  fun startScan() {
    if (scanning) return
    val p = current() ?: return
    scanning = true // 同步豎旗封雙擊——coroutine 內設旗會慢一拍,連點會塞進兩個掃描迴圈
    scanStartMs = SystemClock.elapsedRealtime()
    job = scope.launch { runOneSlot(p) }
  }

  fun cancel() { job?.cancel(); scanning = false }

  fun redo(id: String) {
    // 檔案裡舊行留著（離線同 key 取最後一行）；記憶體中清掉重跑
    app.progress = progressAfterRedo(app.progress, id)
    currentId = id
  }

  fun skip(reason: String) {
    val p = current() ?: return
    val ok = app.writer?.append(buildSkipLine(p.id, reason, isoNow())) ?: false
    writeWarn = !ok
    app.progress = app.progress.copy(skipped = app.progress.skipped + p.id)
    ensureCurrent()
  }

  fun jumpTo(id: String) { if (!scanning) currentId = id }

  private suspend fun runOneSlot(p: RpPoint) {
    try {
      // 早退路徑也在 try 內——確保 finally 一定放下 scanning 旗
      val slot = when (val s = pickSlot(pendingSlots(p.id))) {
        SlotPick.Done -> return
        is SlotPick.Run -> s.slot
      }
      scanK = 0; lowScanWarn = false
      val startedAt = isoNow()
      val t0 = scanStartMs
      rig.beginWindow()
      val batches = ArrayList<ScanBatch>()
      var cachedStreak = 0
      var throttled = false
      var ok = 0
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
      val line = buildPointLine(p, slot, win.headingMeanDeg, win.headingAcc, startedAt,
        SystemClock.elapsedRealtime() - t0, ok, throttled, batches, win.mag)
      val okWrite = withContext(Dispatchers.IO) { app.writer?.append(line) ?: false }
      writeWarn = !okWrite
      app.progress = app.progress.copy(done = app.progress.done + DoneKey(p.id, slot))
      lastThrottled = throttled
      lowScanWarn = ok * 10 < app.scansPerPoint * 6 // ok < 60% N
      lastMagAcc = win.headingAcc
      lastMagQuality = magQuality(win.mag)
      ensureCurrent()
    } finally {
      rig.endWindow() // 中斷路徑關閉時窗；正常路徑已取值，重複呼叫無害
      scanning = false
    }
  }
}
