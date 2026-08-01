package com.taipeistation.wififp

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay

@Composable
fun CollectScreen(app: AppState, ctl: CollectController, rig: SensorRig, onExport: () -> Unit) {
  var heading by remember { mutableStateOf(Double.NaN) }
  var elapsedS by remember { mutableStateOf(0L) }
  LaunchedEffect(Unit) {
    while (true) {
      heading = rig.currentHeadingDeg
      elapsedS = if (ctl.scanning) (android.os.SystemClock.elapsedRealtime() - ctl.scanStartMs) / 1000 else 0
      delay(200)
    }
  }
  LaunchedEffect(Unit) { ctl.ensureCurrent() }
  var showSkip by remember { mutableStateOf(false) }
  var skipReason by remember { mutableStateOf("") }
  var showJump by remember { mutableStateOf(false) }

  val p = ctl.current()
  val total = app.rpList?.points?.size ?: 0
  val doneCount = app.rpList?.points?.count { ctl.isPointComplete(it.id) } ?: 0
  val floorPts = app.rpList?.points?.filter { it.floor == p?.floor } ?: emptyList()
  val floorDone = floorPts.count { ctl.isPointComplete(it.id) }

  // 四朝向閘門
  val slot = p?.let { ctl.pendingSlots(it.id).firstOrNull() }
  val quadGateOk = app.mode != "quad" || slot == null ||
    (!heading.isNaN() && angDiffDeg(heading, slot.toDouble()) <= 20.0)
  val pointDone = p != null && ctl.pendingSlots(p.id).isEmpty()

  if (showJump) {
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().padding(20.dp)) {
      items(app.rpList?.points?.size ?: 0) { i ->
        val pt = app.rpList!!.points[i]
        val mark = when {
          pt.id in app.progress.skipped -> "⏭"
          ctl.isPointComplete(pt.id) -> "✓"
          else -> "·"
        }
        OutlinedButton(
          onClick = { ctl.jumpTo(pt.id); showJump = false },
          modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        ) { Text("$mark ${pt.id}  (${pt.x}, ${pt.y})" + (pt.note?.let { " $it" } ?: "")) }
      }
    }
    return
  }

  Column(
    Modifier.fillMaxSize().padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (p == null) {
      Text("全部完成 🎉", style = MaterialTheme.typography.headlineLarge)
      Button(onClick = onExport, modifier = Modifier.fillMaxWidth().height(60.dp)) { Text("分享 session 檔") }
      OutlinedButton(onClick = { showJump = true }, modifier = Modifier.fillMaxWidth()) { Text("點位清單") }
      return@Column
    }

    Text(p.id, style = MaterialTheme.typography.displaySmall)
    Text("${p.floor} · (${p.x}, ${p.y})" + (p.note?.let { " · $it" } ?: ""),
      style = MaterialTheme.typography.titleMedium)
    Text("全站 $doneCount/$total · 本層 $floorDone/${floorPts.size}")

    if (app.mode == "quad" && slot != null) {
      Text("目標朝向 ${slot}° · 目前 ${if (heading.isNaN()) "--" else "%.0f°".format(heading)}" +
        if (quadGateOk) " ✓ 可掃" else "（轉到 ±20° 內）",
        style = MaterialTheme.typography.titleLarge,
        color = if (quadGateOk) Color(0xFF166534) else Color(0xFF92400E))
    }

    if (ctl.lastThrottled) Text("⚠ 偵測到掃描節流——去開發者選項關掉後重採",
      color = Color.Red, style = MaterialTheme.typography.titleMedium)
    if (ctl.lowScanWarn) Text("⚠ 上一點成功掃描 <60%,建議重採", color = Color(0xFF92400E))
    if (ctl.writeWarn) Text("⚠ 寫檔失敗——資料暫存記憶體,下一筆會重試;請檢查儲存空間", color = Color.Red)

    Button(
      onClick = { ctl.startScan() }, enabled = !ctl.scanning && quadGateOk && !pointDone,
      modifier = Modifier.fillMaxWidth().height(80.dp),
    ) {
      Text(when {
        ctl.scanning -> "掃描中 ${elapsedS}s · ${ctl.scanK}/${app.scansPerPoint} 次 · ${ctl.apCount} AP"
        pointDone -> "此點已完成——重測按「重採此點」"
        else -> "開始掃描"
      }, style = MaterialTheme.typography.headlineMedium)
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      OutlinedButton(onClick = { ctl.cancel() }, enabled = ctl.scanning) { Text("中斷") }
      OutlinedButton(onClick = { showSkip = true }, enabled = !ctl.scanning) { Text("跳過") }
      OutlinedButton(onClick = { ctl.redo(p.id) }, enabled = !ctl.scanning) { Text("重採此點") }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      OutlinedButton(onClick = { showJump = true }, enabled = !ctl.scanning) { Text("點位清單") }
      OutlinedButton(onClick = onExport, enabled = !ctl.scanning) { Text("匯出") }
    }
  }

  if (showSkip) {
    androidx.compose.material3.AlertDialog(
      onDismissRequest = { showSkip = false },
      title = { Text("跳過 ${p?.id}") },
      text = {
        androidx.compose.material3.OutlinedTextField(
          value = skipReason, onValueChange = { skipReason = it }, label = { Text("原因") })
      },
      confirmButton = {
        Button(onClick = {
          ctl.skip(skipReason.ifBlank { "未填" }); skipReason = ""; showSkip = false
        }) { Text("確定跳過") }
      },
      dismissButton = { OutlinedButton(onClick = { showSkip = false }) { Text("取消") } },
    )
  }
}

fun shareSession(ctx: android.content.Context, file: java.io.File) {
  val uri = androidx.core.content.FileProvider.getUriForFile(ctx, "com.taipeistation.wififp.files", file)
  val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
    type = "application/json"
    putExtra(android.content.Intent.EXTRA_STREAM, uri)
    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }
  ctx.startActivity(android.content.Intent.createChooser(send, "分享 session 檔"))
}
