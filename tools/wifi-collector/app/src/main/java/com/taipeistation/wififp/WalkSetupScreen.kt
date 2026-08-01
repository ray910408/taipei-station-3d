package com.taipeistation.wififp

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.core.content.PermissionChecker
import java.io.File

private fun hasStepPerm(ctx: Context): Boolean =
  PermissionChecker.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) ==
    PermissionChecker.PERMISSION_GRANTED

@Composable
fun WalkSetupScreen(app: AppState, onStart: () -> Unit) {
  val ctx = androidx.compose.ui.platform.LocalContext.current
  val prefs = remember { ctx.getSharedPreferences("wififp", 0) }
  var permOk by remember { mutableStateOf(hasStepPerm(ctx)) }
  var edgeError by remember { mutableStateOf<String?>(null) }
  var resumeFile by remember { mutableStateOf<File?>(null) }
  val baseDir = remember { ctx.getExternalFilesDir(null)!! }
  val sessions = remember { mutableStateOf(SessionWriter.list(baseDir, "mag-walk")) }

  val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
    permOk = hasStepPerm(ctx)
  }
  val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
    if (uri == null) return@rememberLauncherForActivityResult
    try {
      ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val text = ctx.contentResolver.openInputStream(uri)!!.bufferedReader().readText()
      app.edgeList = parseEdgeList(text)
      app.edgeName = uri.lastPathSegment?.substringAfterLast('/') ?: "edge-list.json"
      prefs.edit().putString("lastEdgeUri", uri.toString()).putString("lastEdgeName", app.edgeName).apply()
      edgeError = null
    } catch (e: Exception) { edgeError = e.message ?: "讀檔失敗"; app.edgeList = null }
  }

  // 開機自動載上次的清單檔（同 rp 清單模式）
  androidx.compose.runtime.LaunchedEffect(Unit) {
    val last = prefs.getString("lastEdgeUri", null) ?: return@LaunchedEffect
    if (app.edgeList != null) return@LaunchedEffect
    try {
      val text = ctx.contentResolver.openInputStream(Uri.parse(last))!!.bufferedReader().readText()
      app.edgeList = parseEdgeList(text)
      app.edgeName = prefs.getString("lastEdgeName", null) ?: app.edgeName
    } catch (e: Exception) { /* 上次的檔失效就重選 */ }
  }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    Text("磁力走線採集", style = MaterialTheme.typography.headlineMedium)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(selected = false, onClick = { app.screen = Screen.SETUP }, label = { Text("站點採集(WiFi)") })
      FilterChip(selected = true, onClick = {}, label = { Text("走線採集(磁力)") })
    }
    Text("進場前:畫 8 字校正磁力計;走線時手機身前持平、與 WiFi 採集同姿勢、高度一致",
      style = MaterialTheme.typography.bodyMedium, color = Color(0xFF92400E))

    Text(if (permOk) "✓ 活動辨識權限 OK" else "✗ 缺活動辨識權限——步伐事件收不到",
      color = if (permOk) Color(0xFF166534) else Color.Red)
    OutlinedButton(onClick = { permLauncher.launch(Manifest.permission.ACTIVITY_RECOGNITION) }) { Text("要求權限") }

    OutlinedButton(onClick = { fileLauncher.launch(arrayOf("application/json", "application/octet-stream")) },
      modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("選走線清單檔（edge-list.json）") }
    edgeError?.let { Text("✗ $it", color = Color.Red) }
    app.edgeList?.let { l ->
      val req = l.walks.count { it.required }
      Text("✓ ${l.walks.size} 走線（必收 $req）· ${l.walks.map { it.floor }.distinct().size} 層", color = Color(0xFF166534))
    }

    Text("名目步長 = %.2f m（walkEnd 步數×步長 vs 邊長檢查用）".format(app.stepLengthM))
    Slider(value = app.stepLengthM.toFloat(), onValueChange = { app.stepLengthM = (Math.round(it * 100.0) / 100.0) },
      valueRange = 0.5f..0.9f, enabled = resumeFile == null)

    Text("Session", style = MaterialTheme.typography.titleMedium)
    FilterChip(selected = resumeFile == null, label = { Text("新 session") },
      onClick = { resumeFile = null; app.stepLengthM = DEFAULT_STEP_LENGTH_M })
    sessions.value.take(5).forEach { f ->
      FilterChip(selected = resumeFile == f, onClick = {
        resumeFile = f
        f.useLines { parseWalkSessionHeader(it) }?.let { h -> app.stepLengthM = h.stepLengthM }
      }, label = { Text("續採 ${f.name.removePrefix("mag-walk-").removeSuffix(".jsonl")}") })
    }
    val resumeBlock = resumeFile?.let { f ->
      app.edgeList?.let { walkResumeBlockReason(f.useLines { parseWalkSessionHeader(it) }, it.generated) }
    }
    if (resumeBlock != null) {
      Text("⚠ 不能續採:$resumeBlock", color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium)
    }

    Button(
      enabled = permOk && app.edgeList != null && resumeBlock == null,
      modifier = Modifier.fillMaxWidth().height(60.dp),
      onClick = {
        val list = app.edgeList!!
        val w = if (resumeFile != null) {
          SessionWriter(baseDir, resumeFile!!.name.removePrefix("mag-walk-").removeSuffix(".jsonl"), "mag-walk")
        } else {
          SessionWriter(baseDir, SessionWriter.newSessionId(), "mag-walk").also {
            it.append(buildWalkSessionLine(it.sessionId, android.os.Build.MODEL,
              android.os.Build.VERSION.SDK_INT, "0.2.0", app.edgeName, list.generated,
              app.stepLengthM, isoNow()))
          }
        }
        app.walkWriter = w
        app.walkProgress = parseWalkSession(w.readLines().asSequence())
        onStart()
      },
    ) { Text(if (resumeFile != null) "續採" else "開始走線", style = MaterialTheme.typography.titleLarge) }
  }
}
