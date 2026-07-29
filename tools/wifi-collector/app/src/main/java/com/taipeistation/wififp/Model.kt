package com.taipeistation.wififp

import org.json.JSONArray
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.format.DateTimeFormatter

data class RpPoint(val id: String, val floor: String, val x: Double, val y: Double, val note: String?)
data class RpList(val station: String, val generated: String, val points: List<RpPoint>)

fun parseRpList(json: String): RpList {
  val root = try { JSONObject(json) } catch (e: Exception) { throw IllegalArgumentException("不是合法 JSON:${e.message}") }
  require(root.optString("schema") == "rp-list@1") { "schema 不是 rp-list@1:${root.optString("schema")}" }
  val arr = root.optJSONArray("points") ?: throw IllegalArgumentException("缺 points 陣列")
  val pts = ArrayList<RpPoint>(arr.length())
  for (i in 0 until arr.length()) {
    val o = arr.getJSONObject(i)
    try {
      pts += RpPoint(o.getString("id"), o.getString("floor"), o.getDouble("x"), o.getDouble("y"),
        if (o.has("note")) o.getString("note") else null)
    } catch (e: Exception) { throw IllegalArgumentException("points[$i] 格式錯:${e.message}") }
  }
  require(pts.isNotEmpty()) { "points 為空" }
  return RpList(root.optString("station"), root.optString("generated"), pts)
}

data class ApObs(val bssid: String, val ssid: String, val rssi: Int, val freq: Int)
data class ScanBatch(val t: String, val fresh: Boolean, val aps: List<ApObs>)
data class MagSummary(val n: Int, val mean: List<Double>, val std: List<Double>,
                      val magMean: Double, val magStd: Double, val accuracy: Int)

fun isoNow(): String = OffsetDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME)

fun buildSessionLine(session: String, device: String, android: Int, app: String, mode: String,
                     scansPerPoint: Int, rpList: String, rpGenerated: String, startedAt: String): String =
  JSONObject().put("type", "session").put("schema", "wifi-fp@1")
    .put("session", session)
    .put("device", device).put("android", android).put("app", app)
    .put("mode", mode).put("scansPerPoint", scansPerPoint)
    .put("rpList", rpList).put("rpGenerated", rpGenerated).put("startedAt", startedAt).toString()

fun buildPointLine(p: RpPoint, headingSlot: Int?, headingDeg: Double?, headingAcc: Int,
                   startedAt: String, durationMs: Long, actualScans: Int, throttled: Boolean,
                   scans: List<ScanBatch>, mag: MagSummary?): String {
  val o = JSONObject().put("type", "point")
    .put("pointId", p.id).put("floor", p.floor).put("x", p.x).put("y", p.y)
    .put("headingSlot", headingSlot ?: JSONObject.NULL)
    .put("headingAcc", headingAcc)
    .put("startedAt", startedAt).put("durationMs", durationMs)
    .put("actualScans", actualScans).put("throttled", throttled)
  if (headingDeg != null && headingDeg.isFinite()) o.put("headingDeg", headingDeg)
  o.put("scans", JSONArray().apply {
    for (b in scans) put(JSONObject().put("t", b.t).put("fresh", b.fresh)
      .put("aps", JSONArray().apply {
        for (a in b.aps) put(JSONObject().put("bssid", a.bssid).put("ssid", a.ssid)
          .put("rssi", a.rssi).put("freq", a.freq))
      }))
  })
  if (mag != null) o.put("mag", JSONObject()
    .put("n", mag.n).put("mean", JSONArray(mag.mean)).put("std", JSONArray(mag.std))
    .put("magMean", mag.magMean).put("magStd", mag.magStd).put("accuracy", mag.accuracy))
  return o.toString()
}

fun buildSkipLine(pointId: String, reason: String, t: String): String =
  JSONObject().put("type", "skip").put("pointId", pointId).put("reason", reason).put("t", t).toString()

data class DoneKey(val pointId: String, val slot: Int?)
data class Progress(val done: Set<DoneKey>, val skipped: Set<String>)

fun parseSession(lines: Sequence<String>): Progress {
  val done = LinkedHashSet<DoneKey>()
  val skipped = LinkedHashSet<String>()
  for (line in lines) {
    val o = try { JSONObject(line) } catch (e: Exception) { continue }
    when (o.optString("type")) {
      "point" -> done += DoneKey(o.optString("pointId"),
        if (o.isNull("headingSlot")) null else o.optInt("headingSlot"))
      "skip" -> skipped += o.optString("pointId")
    }
  }
  return Progress(done, skipped)
}

data class SessionHeader(val mode: String, val scansPerPoint: Int, val rpGenerated: String)

/** 讀 session 檔第一個 type=session 行的 mode/N/清單版本;無則 null */
fun parseSessionHeader(lines: Sequence<String>): SessionHeader? {
  for (line in lines) {
    val o = try { JSONObject(line) } catch (e: Exception) { continue }
    if (o.optString("type") == "session") {
      return SessionHeader(
        o.optString("mode", "single"), o.optInt("scansPerPoint", 10), o.optString("rpGenerated", ""))
    }
  }
  return null
}

/** 續採前必須擋:進度只認 point id,而重產清單會把同一個 id 指到不同座標
 *  (例:B1-001 從 (87,-57) 變成 (18,-54))。清單版本不符卻續採,已完成的 id
 *  會靜默跳過完全不相干的新位置,整個 session 混到兩套座標。 */
fun resumeBlockReason(header: SessionHeader?, listGenerated: String): String? = when {
  header == null -> "讀不到 session 檔頭,無法確認清單版本"
  header.rpGenerated.isEmpty() -> "舊版 session 檔沒記錄清單版本,無法確認"
  header.rpGenerated != listGenerated -> "清單版本不符——此 session 用的是 ${header.rpGenerated.take(10)} 產的清單,目前選的是 ${listGenerated.take(10)} 產的。請改開新 session。"
  else -> null
}
