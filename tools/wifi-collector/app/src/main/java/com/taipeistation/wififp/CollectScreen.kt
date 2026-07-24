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
  LaunchedEffect(Unit) { while (true) { heading = rig.currentHeadingDeg; delay(200) } }
  LaunchedEffect(Unit) { ctl.ensureCurrent() }

  val p = ctl.current()
  val total = app.rpList?.points?.size ?: 0
  val doneCount = app.rpList?.points?.count { ctl.isPointComplete(it.id) } ?: 0
  val floorPts = app.rpList?.points?.filter { it.floor == p?.floor } ?: emptyList()
  val floorDone = floorPts.count { ctl.isPointComplete(it.id) }

  Column(
    Modifier.fillMaxSize().padding(20.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    if (p == null) {
      Text("全部完成 🎉", style = MaterialTheme.typography.headlineLarge)
      Button(onClick = onExport, modifier = Modifier.fillMaxWidth().height(60.dp)) { Text("分享 session 檔") }
      return@Column
    }

    Text(p.id, style = MaterialTheme.typography.displaySmall)
    Text("${p.floor} · (${p.x}, ${p.y})" + (p.note?.let { " · $it" } ?: ""),
      style = MaterialTheme.typography.titleMedium)
    Text("全站 $doneCount/$total · 本層 $floorDone/${floorPts.size}")
    Text("羅盤 ${if (heading.isNaN()) "--" else "%.0f°".format(heading)}")

    if (ctl.lastThrottled) Text("⚠ 偵測到掃描節流——去開發者選項關掉後按「重採上一點」",
      color = Color.Red, style = MaterialTheme.typography.titleMedium)
    if (ctl.lowScanWarn) Text("⚠ 上一點成功掃描 <60%,建議重採", color = Color(0xFF92400E))

    Button(
      onClick = { ctl.startScan() }, enabled = !ctl.scanning,
      modifier = Modifier.fillMaxWidth().height(80.dp),
    ) {
      Text(if (ctl.scanning) "${ctl.scanK}/${app.scansPerPoint} 次 · ${ctl.apCount} AP"
           else "開始掃描", style = MaterialTheme.typography.headlineMedium)
    }

    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
      OutlinedButton(onClick = { ctl.cancel() }, enabled = ctl.scanning) { Text("中斷") }
      OutlinedButton(onClick = { ctl.skip("現場不可達") }, enabled = !ctl.scanning) { Text("跳過") }
      OutlinedButton(onClick = onExport, enabled = !ctl.scanning) { Text("匯出") }
    }
  }
}
