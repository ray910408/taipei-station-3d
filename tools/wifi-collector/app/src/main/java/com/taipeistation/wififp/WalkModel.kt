package com.taipeistation.wififp

import org.json.JSONArray
import org.json.JSONObject

data class WalkEntry(val seq: Int, val floor: String, val from: String, val to: String,
                     val kind: String, val required: Boolean, val lengthM: Double, val note: String?)
data class EdgeList(val station: String, val generated: String, val walks: List<WalkEntry>)
data class WalkKey(val floor: String, val from: String, val to: String)

fun WalkEntry.key() = WalkKey(floor, from, to)

fun parseEdgeList(json: String): EdgeList {
  val root = try { JSONObject(json) } catch (e: Exception) { throw IllegalArgumentException("不是合法 JSON:${e.message}") }
  require(root.optString("schema") == "edge-list@1") { "schema 不是 edge-list@1:${root.optString("schema")}" }
  val arr = root.optJSONArray("walks") ?: throw IllegalArgumentException("缺 walks 陣列")
  val walks = ArrayList<WalkEntry>(arr.length())
  for (i in 0 until arr.length()) {
    val o = arr.getJSONObject(i)
    try {
      walks += WalkEntry(o.getInt("seq"), o.getString("floor"), o.getString("from"), o.getString("to"),
        o.getString("kind"), o.getBoolean("required"), o.getDouble("lengthM"),
        if (o.has("note")) o.getString("note") else null)
    } catch (e: Exception) { throw IllegalArgumentException("walks[$i] 格式錯:${e.message}") }
  }
  require(walks.isNotEmpty()) { "walks 為空" }
  // generated 是續採守門的唯一依據，放行空值會讓中斷後的 session 永遠續不了（同 rp-list 教訓）
  val generated = root.optString("generated")
  require(generated.isNotEmpty()) { "缺 generated(清單版本);請用 npm run gen:edges 重新產生" }
  return EdgeList(root.optString("station"), generated, walks)
}

fun buildWalkSessionLine(session: String, device: String, android: Int, app: String,
                         edgeList: String, edgeListGenerated: String, stepLengthM: Double, startedAt: String): String =
  JSONObject().put("type", "session").put("schema", "mag-walk@1")
    .put("session", session).put("device", device).put("android", android).put("app", app)
    .put("edgeList", edgeList).put("edgeListGenerated", edgeListGenerated)
    .put("stepLengthM", stepLengthM).put("startedAt", startedAt).toString()

fun buildWalkBeginLine(w: WalkEntry, t0Wall: String): String =
  JSONObject().put("type", "walkBegin").put("floor", w.floor).put("from", w.from).put("to", w.to)
    .put("kind", w.kind).put("required", w.required).put("lengthM", w.lengthM).put("t0Wall", t0Wall).toString()

/** row＝14 欄 [t,mx,my,mz,gx,gy,gz,ax,ay,az,r0,r1,r2,r3]；t＝相對 walkBegin 的 ms。
 *  精度:t 取 1 位小數,感測值取 4 位(0.0001 µT/m·s²,遠低於 sensor 解析度),rotvec 取 6 位——
 *  Float→Double 加寬的 12.300000190734863 是雜訊不是訊號,截掉後檔案縮 ~2.5 倍。 */
fun buildSamplesLine(rows: List<DoubleArray>, magAccMin: Int): String {
  fun rnd(v: Double, p: Double) = Math.round(v * p) / p
  return JSONObject().put("type", "samples").put("magAcc", magAccMin)
    .put("rows", JSONArray().apply {
      for (r in rows) put(JSONArray().apply {
        for ((i, v) in r.withIndex()) put(when {
          i == 0 -> rnd(v, 10.0)
          i >= 10 -> rnd(v, 1e6)
          else -> rnd(v, 1e4)
        })
      })
    }).toString()
}

/** steps 同 rows 的 t 取 1 位小數。 */
fun buildWalkEndLine(t1Ms: Double, durationMs: Long, sampleCount: Int, stepsMs: List<Double>,
                     magAccMin: Int, rotMaxDegPerS: Double): String =
  JSONObject().put("type", "walkEnd").put("t1", t1Ms).put("durationMs", durationMs)
    .put("sampleCount", sampleCount).put("stepCount", stepsMs.size)
    .put("steps", JSONArray().apply { for (t in stepsMs) put(Math.round(t * 10.0) / 10.0) })
    .put("magAccMin", magAccMin).put("rotMaxDegPerS", rotMaxDegPerS).toString()

fun buildWalkAbortLine(w: WalkEntry, reason: String, t: String): String =
  JSONObject().put("type", "walkAbort").put("floor", w.floor).put("from", w.from).put("to", w.to)
    .put("reason", reason).put("t", t).toString()

data class WalkProgress(val done: Set<WalkKey>)

/** done＝walkBegin 之後出現配對 walkEnd 的走線。walkEnd 不帶鍵——歸屬最近一個未關閉的
 *  walkBegin；walkAbort 或下一個 walkBegin 都會棄置未關閉者（無 walkEnd＝作廢重走）。 */
fun parseWalkSession(lines: Sequence<String>): WalkProgress {
  val done = LinkedHashSet<WalkKey>()
  var pending: WalkKey? = null
  for (line in lines) {
    // samples 行佔檔案 99%,不進 JSON parse。用 contains 而非行首前綴——
    // JSONObject 鍵序不保證(JVM HashMap/Android LinkedHashMap),"type" 不必然在行首。
    // rows 只有數字,不可能誤含這個子串。
    if ("\"type\":\"walk" !in line) continue
    val o = try { JSONObject(line) } catch (e: Exception) { continue }
    when (o.optString("type")) {
      "walkBegin" -> pending = WalkKey(o.optString("floor"), o.optString("from"), o.optString("to"))
      "walkEnd" -> { pending?.let { done += it }; pending = null }
      "walkAbort" -> pending = null
    }
  }
  return WalkProgress(done)
}

data class WalkSessionHeader(val edgeListGenerated: String, val stepLengthM: Double)

fun parseWalkSessionHeader(lines: Sequence<String>): WalkSessionHeader? {
  for (line in lines) {
    val o = try { JSONObject(line) } catch (e: Exception) { continue }
    if (o.optString("type") == "session")
      return WalkSessionHeader(o.optString("edgeListGenerated", ""), o.optDouble("stepLengthM", 0.65))
  }
  return null
}

/** 清單重產後節點座標可能移動，from→to 鍵卻不變——版本不符一律擋（同 rp 續採守門）。 */
fun walkResumeBlockReason(header: WalkSessionHeader?, listGenerated: String): String? = when {
  header == null -> "讀不到 session 檔頭,無法確認清單版本"
  header.edgeListGenerated.isEmpty() -> "session 檔沒記錄清單版本,無法確認"
  header.edgeListGenerated != listGenerated -> "清單版本不符——此 session 用的是 ${header.edgeListGenerated.take(16)} 產的清單,目前選的是 ${listGenerated.take(16)} 產的。請改開新 session。"
  else -> null
}
