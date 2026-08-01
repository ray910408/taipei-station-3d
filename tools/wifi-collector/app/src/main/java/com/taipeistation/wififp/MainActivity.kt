package com.taipeistation.wififp

import android.hardware.SensorManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

enum class Screen { SETUP, COLLECT, WALK_SETUP, WALK }

/** 新 session 的預設值。續採會由檔頭覆寫,切回「新 session」時必須還原回來——
 *  否則點過一個舊的 N=10 session 再開新的,會沿用 N=10 默默把採集時間加倍。 */
const val DEFAULT_MODE = "single"
/** N=5:實測 N=5 的指紋庫雜訊 1.2 dB,而使用者端單次掃描帶進 10 dB——
 *  把庫做得更準沒有意義,只是多花一倍採集時間。 */
const val DEFAULT_SCANS_PER_POINT = 5
/** 名目步長預設值:walkEnd「步數×步長 vs 邊長」檢查用;Setup 可調(Phase 7 步長旋鈕經驗) */
const val DEFAULT_STEP_LENGTH_M = 0.65
const val APP_VERSION = "0.2.1"

class AppState {
  var screen by mutableStateOf(Screen.SETUP)
  var rpList by mutableStateOf<RpList?>(null)
  var mode by mutableStateOf(DEFAULT_MODE)
  var scansPerPoint by mutableStateOf(DEFAULT_SCANS_PER_POINT)
  var rpName by mutableStateOf("rp-points.json")
  var writer by mutableStateOf<SessionWriter?>(null)
  var progress by mutableStateOf(Progress(emptySet(), emptySet()))
  var edgeList by mutableStateOf<EdgeList?>(null)
  var edgeName by mutableStateOf("edge-list.json")
  var stepLengthM by mutableStateOf(DEFAULT_STEP_LENGTH_M)
  var walkWriter by mutableStateOf<SessionWriter?>(null)
  var walkProgress by mutableStateOf(WalkProgress(emptySet()))
}

class MainActivity : ComponentActivity() {
  val app = AppState()
  val engine by lazy { WifiScanEngine(this) }
  val rig by lazy { SensorRig(getSystemService(SensorManager::class.java)) }
  val walkRig by lazy { WalkSensorRig(getSystemService(SensorManager::class.java)) }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContent {
      MaterialTheme {
        when (app.screen) {
          Screen.SETUP -> SetupScreen(app) { app.screen = Screen.COLLECT }
          Screen.COLLECT -> {
            DisposableEffect(Unit) { rig.start(); onDispose { rig.stop() } }
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            val ctl = androidx.compose.runtime.remember { CollectController(app, engine, rig, scope) }
            CollectScreen(app, ctl, rig) { app.writer?.let { w -> shareSession(this@MainActivity, w.file) } }
          }
          Screen.WALK_SETUP -> WalkSetupScreen(app) { app.screen = Screen.WALK }
          Screen.WALK -> {
            DisposableEffect(Unit) { walkRig.start(); onDispose { walkRig.stop() } }
            val scope = androidx.compose.runtime.rememberCoroutineScope()
            val ctl = androidx.compose.runtime.remember { WalkController(app, walkRig, scope) }
            WalkScreen(app, ctl, walkRig) { app.walkWriter?.let { w -> shareSession(this@MainActivity, w.file) } }
          }
        }
      }
    }
  }
}
