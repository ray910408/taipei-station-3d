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
fun WalkScreen(app: AppState, ctl: WalkController, rig: WalkSensorRig, onExport: () -> Unit) {
  var magAcc by remember { mutableStateOf(0) }
  var elapsedS by remember { mutableStateOf(0L) }
  LaunchedEffect(Unit) {
    while (true) {
      magAcc = rig.currentMagAccuracy
      elapsedS = if (ctl.walking) (android.os.SystemClock.elapsedRealtime() - ctl.beginMs) / 1000 else 0
      delay(200)
    }
  }
  LaunchedEffect(Unit) { ctl.ensureCurrent() }
  var showJump by remember { mutableStateOf(false) }
  var showAbort by remember { mutableStateOf(false) }

  val w = ctl.current()
  val walks = app.edgeList?.walks ?: emptyList()
  val reqWalks = walks.filter { it.required }
  val doneCount = reqWalks.count { ctl.isDone(it.key()) }
  val floorReq = reqWalks.filter { it.floor == w?.floor }
  val floorDone = floorReq.count { ctl.isDone(it.key()) }

  if (showJump) {
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().padding(20.dp)) {
      items(walks.size) { i ->
        val x = walks[i]
        val mark = if (ctl.isDone(x.key())) "✓" else "·"
        val opt = if (x.required) "" else " [選收]"
        OutlinedButton(
          onClick = { ctl.jumpTo(x.key()); showJump = false },
          modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        ) { Text("$mark #${x.seq}$opt ${x.floor} ${x.from}→${x.to} ${x.lengthM}m" + (x.note?.let { " $it" } ?: "")) }
      }
    }
    return
  }

  Column(
    Modifier.fillMaxSize().padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (w == null) {
      Text("必收走線全部完成 🎉", style = MaterialTheme.typography.headlineLarge)
      Text("選收(gate)可從走線清單跳選", style = MaterialTheme.typography.bodyMedium)
      Button(onClick = onExport, modifier = Modifier.fillMaxWidth().height(60.dp)) { Text("分享 session 檔") }
      OutlinedButton(onClick = { showJump = true }, modifier = Modifier.fillMaxWidth()) { Text("走線清單") }
      return@Column
    }

    Text("#${w.seq} ${w.from} → ${w.to}", style = MaterialTheme.typography.headlineMedium)
    Text("${w.floor} · ${w.lengthM}m" + (if (w.required) "" else " · 選收") + (w.note?.let { " · $it" } ?: ""),
      style = MaterialTheme.typography.titleMedium)
    Text("必收 $doneCount/${reqWalks.size} · 本層 $floorDone/${floorReq.size}")
    Text("磁力校正 ${magAccLabel(magAcc)}")

    if (magNeedsCalibration(magAcc)) Text("⚠ 磁力計${magAccLabel(magAcc)}——手機畫 8 字(∞)約 10 秒再開始",
      color = Color(0xFF92400E), style = MaterialTheme.typography.titleMedium)
    if (ctl.writeWarn) Text("⚠ 寫檔失敗——資料暫存記憶體,下一筆會重試;請檢查儲存空間", color = Color.Red)
    ctl.lastQuality?.let { q ->
      if (q.warnings.isEmpty()) Text("✓ 上一條走線品質 OK（%.2f m/s·實測步長 %s）".format(q.speedMps, q.stepLenEstM?.let { "%.2fm".format(it) } ?: "--"), color = Color(0xFF166534))
      for (warn in q.warnings) Text("⚠ 上一條:$warn", color = Color(0xFF92400E))
    }

    Button(
      onClick = { if (ctl.walking) ctl.end() else ctl.begin() },
      modifier = Modifier.fillMaxWidth().height(96.dp),
    ) {
      Text(
        if (ctl.walking) "結束走線 · ${elapsedS}s · ${ctl.liveSteps} 步 · ${ctl.liveSamples} 樣本"
        else "站在 ${w.from},按下後勻速走向 ${w.to}",
        style = MaterialTheme.typography.headlineSmall)
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      OutlinedButton(onClick = { showAbort = true }, enabled = ctl.walking) { Text("作廢") }
      OutlinedButton(onClick = { ctl.redo(w.key()) }, enabled = !ctl.walking && ctl.isDone(w.key())) { Text("重走此線") }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      OutlinedButton(onClick = { showJump = true }, enabled = !ctl.walking) { Text("走線清單") }
      OutlinedButton(onClick = onExport, enabled = !ctl.walking) { Text("匯出") }
    }
  }

  if (showAbort) {
    androidx.compose.material3.AlertDialog(
      onDismissRequest = { showAbort = false },
      title = { Text("作廢這次走線?") },
      text = { Text("中斷/誤按/被打斷的走線沒有搶救價值——作廢後可直接重走。") },
      confirmButton = {
        Button(onClick = { ctl.abort("手動作廢"); showAbort = false }) { Text("作廢") }
      },
      dismissButton = { OutlinedButton(onClick = { showAbort = false }) { Text("繼續走") } },
    )
  }
}
