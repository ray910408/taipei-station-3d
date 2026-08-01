package com.taipeistation.wififp

import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

/** 走線感測器薄殼：五 sensor @ SENSOR_DELAY_GAME(~50Hz),事件轉發進作用中的 buffer。
 *  無 buffer 時只維護即時磁力校正等級(走線前 UI 提示用)。
 *  rotvec 以 getQuaternionFromVector 轉四元數,存 [x,y,z,w]。
 *  STEP_DETECTOR 事件的 e.timestamp 依 spec 是「腳落地時刻」,批次晚送也不失真。 */
class WalkSensorRig(private val sm: SensorManager) : SensorEventListener {
  @Volatile var currentMagAccuracy = SensorManager.SENSOR_STATUS_UNRELIABLE
    private set
  @Volatile private var buffer: WalkSampleBuffer? = null
  private val quat = FloatArray(4)

  private val types = listOf(Sensor.TYPE_MAGNETIC_FIELD, Sensor.TYPE_GRAVITY,
    Sensor.TYPE_ACCELEROMETER, Sensor.TYPE_ROTATION_VECTOR, Sensor.TYPE_STEP_DETECTOR)

  fun start() {
    for (t in types) sm.getDefaultSensor(t)?.let { sm.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
  }

  fun stop() = sm.unregisterListener(this)
  fun beginWalk(b: WalkSampleBuffer) { buffer = b }
  fun endWalk() { buffer = null }

  override fun onSensorChanged(e: SensorEvent) {
    val b = buffer
    when (e.sensor.type) {
      Sensor.TYPE_MAGNETIC_FIELD -> {
        // 每個 event 自帶 accuracy——不能只靠 onAccuracyChanged(部分裝置不觸發)
        currentMagAccuracy = e.accuracy
        b?.onMag(e.timestamp, e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble(), e.accuracy)
      }
      Sensor.TYPE_GRAVITY -> b?.onGrav(e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
      Sensor.TYPE_ACCELEROMETER -> b?.onAcc(e.values[0].toDouble(), e.values[1].toDouble(), e.values[2].toDouble())
      Sensor.TYPE_ROTATION_VECTOR -> {
        SensorManager.getQuaternionFromVector(quat, e.values) // 回傳 [w,x,y,z]
        b?.onRotvec(quat[1].toDouble(), quat[2].toDouble(), quat[3].toDouble(), quat[0].toDouble())
      }
      Sensor.TYPE_STEP_DETECTOR -> b?.onStep(e.timestamp)
    }
  }

  override fun onAccuracyChanged(s: Sensor, accuracy: Int) {
    if (s.type == Sensor.TYPE_MAGNETIC_FIELD) currentMagAccuracy = accuracy
  }
}
