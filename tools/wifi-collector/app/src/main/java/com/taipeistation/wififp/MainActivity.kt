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

enum class Screen { SETUP, COLLECT }

class AppState {
  var screen by mutableStateOf(Screen.SETUP)
  var rpList by mutableStateOf<RpList?>(null)
  var mode by mutableStateOf("single")
  var scansPerPoint by mutableStateOf(10)
  var rpName by mutableStateOf("rp-points.json")
  var writer by mutableStateOf<SessionWriter?>(null)
  var progress by mutableStateOf(Progress(emptySet(), emptySet()))
}

class MainActivity : ComponentActivity() {
  val app = AppState()
  val engine by lazy { WifiScanEngine(this) }
  val rig by lazy { SensorRig(getSystemService(SensorManager::class.java)) }

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
        }
      }
    }
  }
}
