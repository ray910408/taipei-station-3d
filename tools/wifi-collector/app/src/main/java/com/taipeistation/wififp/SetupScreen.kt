package com.taipeistation.wififp

import android.Manifest
import android.content.Context
import android.content.Intent
import android.location.LocationManager
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
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

private fun hasPerms(ctx: Context): Boolean {
  val need = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
  if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.NEARBY_WIFI_DEVICES
  return need.all { PermissionChecker.checkSelfPermission(ctx, it) == PermissionChecker.PERMISSION_GRANTED }
}

@Composable
fun SetupScreen(app: AppState, onStart: () -> Unit) {
  val ctx = androidx.compose.ui.platform.LocalContext.current
  val prefs = remember { ctx.getSharedPreferences("wififp", 0) }
  var permsOk by remember { mutableStateOf(hasPerms(ctx)) }
  var locOn by remember { mutableStateOf(ctx.getSystemService(LocationManager::class.java).isLocationEnabled) }
  var wifiOn by remember { mutableStateOf(ctx.applicationContext.getSystemService(WifiManager::class.java).isWifiEnabled) }
  var rpError by remember { mutableStateOf<String?>(null) }
  var resumeFile by remember { mutableStateOf<File?>(null) }
  val baseDir = remember { ctx.getExternalFilesDir(null)!! }
  val sessions = remember { mutableStateOf(SessionWriter.list(baseDir)) }

  val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
    permsOk = hasPerms(ctx)
  }
  val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
    if (uri == null) return@rememberLauncherForActivityResult
    try {
      ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
      val text = ctx.contentResolver.openInputStream(uri)!!.bufferedReader().readText()
      app.rpList = parseRpList(text)
      app.rpName = uri.lastPathSegment?.substringAfterLast('/') ?: "rp-points.json"
      prefs.edit().putString("lastRpUri", uri.toString()).putString("lastRpName", app.rpName).apply()
      rpError = null
    } catch (e: Exception) { rpError = e.message ?: "讀檔失敗"; app.rpList = null }
  }

  // 開機自動載上次的 RP 檔
  androidx.compose.runtime.LaunchedEffect(Unit) {
    val last = prefs.getString("lastRpUri", null) ?: return@LaunchedEffect
    if (app.rpList != null) return@LaunchedEffect
    try {
      val uri = Uri.parse(last)
      val text = ctx.contentResolver.openInputStream(uri)!!.bufferedReader().readText()
      app.rpList = parseRpList(text)
      app.rpName = prefs.getString("lastRpName", null) ?: app.rpName
    } catch (e: Exception) { /* 上次的檔失效就重選 */ }
  }

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      Text("WiFi 指紋採集", style = MaterialTheme.typography.headlineMedium)
      Text("v$APP_VERSION", style = MaterialTheme.typography.labelSmall, color = Color.Gray)
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(selected = true, onClick = {}, label = { Text("站點採集(WiFi)") })
      FilterChip(selected = false, onClick = { app.screen = Screen.WALK_SETUP }, label = { Text("走線採集(磁力)") })
    }
    Text("進場前:開發者選項關「Wi-Fi 掃描節流」、開定位",
      style = MaterialTheme.typography.bodyMedium, color = Color(0xFF92400E))

    // 前置檢查
    Text(if (permsOk) "✓ 權限 OK" else "✗ 缺定位/鄰近裝置權限", color = if (permsOk) Color(0xFF166534) else Color.Red)
    Text(if (locOn) "✓ 定位服務開啟" else "✗ 定位服務關閉——去系統設定打開", color = if (locOn) Color(0xFF166534) else Color.Red)
    Text(if (wifiOn) "✓ WiFi 開啟" else "✗ WiFi 關閉——打開（不用連線）", color = if (wifiOn) Color(0xFF166534) else Color.Red)
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      OutlinedButton(onClick = {
        val need = mutableListOf(Manifest.permission.ACCESS_FINE_LOCATION)
        if (Build.VERSION.SDK_INT >= 33) need += Manifest.permission.NEARBY_WIFI_DEVICES
        permLauncher.launch(need.toTypedArray())
      }) { Text("要求權限") }
      OutlinedButton(onClick = {
        permsOk = hasPerms(ctx)
        locOn = ctx.getSystemService(LocationManager::class.java).isLocationEnabled
        wifiOn = ctx.applicationContext.getSystemService(WifiManager::class.java).isWifiEnabled
      }) { Text("重新檢查") }
    }

    // RP 清單
    OutlinedButton(onClick = { fileLauncher.launch(arrayOf("application/json", "application/octet-stream")) },
      modifier = Modifier.fillMaxWidth().height(52.dp)) { Text("選 RP 清單檔（rp-points.json）") }
    rpError?.let { Text("✗ $it", color = Color.Red) }
    app.rpList?.let { list ->
      val floors = list.points.map { it.floor }.distinct()
      Text("✓ ${list.points.size} 點 · ${floors.size} 層（${floors.joinToString()}）", color = Color(0xFF166534))
    }

    // 模式與 N
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
      FilterChip(selected = app.mode == "single", onClick = { app.mode = "single" }, label = { Text("單朝向") }, enabled = resumeFile == null)
      FilterChip(selected = app.mode == "quad", onClick = { app.mode = "quad" }, label = { Text("四朝向") }, enabled = resumeFile == null)
    }
    Text("每點掃描次數 N = ${app.scansPerPoint}")
    Slider(value = app.scansPerPoint.toFloat(), onValueChange = { app.scansPerPoint = it.toInt() }, valueRange = 3f..30f, enabled = resumeFile == null)

    // session 選擇
    Text("Session", style = MaterialTheme.typography.titleMedium)
    // 切回新 session 必須把續採檔頭覆寫掉的 mode/N 還原,否則會沿用舊 session 的設定
    FilterChip(selected = resumeFile == null, label = { Text("新 session") },
      onClick = { resumeFile = null; app.mode = DEFAULT_MODE; app.scansPerPoint = DEFAULT_SCANS_PER_POINT })
    sessions.value.take(5).forEach { f ->
      FilterChip(selected = resumeFile == f, onClick = {
        resumeFile = f
        f.useLines { parseSessionHeader(it) }?.let { h ->
          app.mode = h.mode; app.scansPerPoint = h.scansPerPoint
        }
      },
        label = { Text("續採 ${f.name.removePrefix("wifi-fp-").removeSuffix(".jsonl")}") })
    }
    // 清單版本不符時擋下續採:同一個 point id 在重產的清單裡會指到不同座標
    val resumeBlock = resumeFile?.let { f ->
      app.rpList?.let { resumeBlockReason(f.useLines { parseSessionHeader(it) }, it.generated) }
    }
    if (resumeBlock != null) {
      Text("⚠ 不能續採:$resumeBlock", color = MaterialTheme.colorScheme.error,
        style = MaterialTheme.typography.bodyMedium)
    }

    Button(
      enabled = permsOk && locOn && wifiOn && app.rpList != null && resumeBlock == null,
      modifier = Modifier.fillMaxWidth().height(60.dp),
      onClick = {
        val list = app.rpList!!
        val w = if (resumeFile != null) {
          SessionWriter(baseDir, resumeFile!!.name.removePrefix("wifi-fp-").removeSuffix(".jsonl"))
        } else {
          SessionWriter(baseDir, SessionWriter.newSessionId(baseDir, "wifi-fp")).also {
            it.append(buildSessionLine(it.sessionId, Build.MODEL, Build.VERSION.SDK_INT, APP_VERSION,
              app.mode, app.scansPerPoint, app.rpName, list.generated, isoNow()))
          }
        }
        app.writer = w
        app.progress = parseSession(w.readLines().asSequence())
        onStart()
      },
    ) { Text(if (resumeFile != null) "續採" else "開始採集", style = MaterialTheme.typography.titleLarge) }
  }
}
