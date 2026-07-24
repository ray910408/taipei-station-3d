package com.taipeistation.wififp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.net.wifi.WifiManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/** 單次 WiFi 掃描：startScan → 等 broadcast → getScanResults；節流偵測靠 fresh 判定 */
class WifiScanEngine(context: Context) {
  private val ctx = context.applicationContext
  private val wifi = ctx.getSystemService(WifiManager::class.java)
  private var lastMaxTs = 0L

  sealed class Outcome {
    data class Fresh(val aps: List<ApObs>) : Outcome()
    data class Cached(val aps: List<ApObs>) : Outcome()
    data object Failed : Outcome()
  }

  suspend fun scanOnce(timeoutMs: Long = 10_000): Outcome {
    val updated = withTimeoutOrNull(timeoutMs) {
      suspendCancellableCoroutine<Boolean> { cont ->
        val receiver = object : BroadcastReceiver() {
          override fun onReceive(c: Context?, i: Intent?) {
            runCatching { ctx.unregisterReceiver(this) }
            if (cont.isActive) cont.resume(i?.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false) ?: false)
          }
        }
        ContextCompat.registerReceiver(ctx, receiver,
          IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED)
        cont.invokeOnCancellation { runCatching { ctx.unregisterReceiver(receiver) } }
        @Suppress("DEPRECATION")
        val started = try { wifi.startScan() } catch (e: SecurityException) { false }
        if (!started) { // 節流或系統拒絕：直接以快取結果收場
          runCatching { ctx.unregisterReceiver(receiver) }
          if (cont.isActive) cont.resume(false)
        }
      }
    } ?: return Outcome.Failed

    val results = try { wifi.scanResults } catch (e: SecurityException) { return Outcome.Failed }
    val maxTs = results.maxOfOrNull { it.timestamp } ?: 0L
    val fresh = updated && maxTs > lastMaxTs
    if (maxTs > lastMaxTs) lastMaxTs = maxTs
    @Suppress("DEPRECATION")
    val aps = results.map { ApObs(it.BSSID ?: "", it.SSID ?: "", it.level, it.frequency) }
    return if (fresh) Outcome.Fresh(aps) else Outcome.Cached(aps)
  }
}

/** 磁力計 + 旋轉向量：常駐提供即時 heading，beginWindow/endWindow 夾出採集時窗統計 */
class SensorRig(private val sm: SensorManager) : SensorEventListener {
  @Volatile var currentHeadingDeg: Double = Double.NaN
    private set
  private var magAccuracy = SensorManager.SENSOR_STATUS_UNRELIABLE
  private var window: MagStats? = null
  private val headingWindow = ArrayList<Double>()
  private val rotMat = FloatArray(9)
  private val orient = FloatArray(3)

  data class WindowResult(val mag: MagSummary?, val headingMeanDeg: Double?, val headingAcc: Int)

  fun start() {
    sm.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
  }

  fun stop() = sm.unregisterListener(this)

  @Synchronized fun beginWindow() { window = MagStats(); headingWindow.clear() }

  @Synchronized fun endWindow(): WindowResult {
    val res = WindowResult(window?.summary(magAccuracy), circularMeanDeg(headingWindow.toList()), magAccuracy)
    window = null; headingWindow.clear()
    return res
  }

  override fun onSensorChanged(e: SensorEvent) {
    when (e.sensor.type) {
      Sensor.TYPE_MAGNETIC_FIELD -> synchronized(this) {
        window?.add(e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
      }
      Sensor.TYPE_ROTATION_VECTOR -> {
        SensorManager.getRotationMatrixFromVector(rotMat, e.values)
        SensorManager.getOrientation(rotMat, orient)
        val deg = (Math.toDegrees(orient[0].toDouble()) + 360.0) % 360.0
        currentHeadingDeg = deg
        synchronized(this) { if (window != null) headingWindow += deg }
      }
    }
  }

  override fun onAccuracyChanged(s: Sensor, accuracy: Int) {
    if (s.type == Sensor.TYPE_MAGNETIC_FIELD) magAccuracy = accuracy
  }
}
