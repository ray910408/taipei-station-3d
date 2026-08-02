package com.taipeistation.wififp

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** 實際要帶去現場的 rp/rp-points.json 必須能被 APK 解析。
 *  產點器(TypeScript)與解析器(Kotlin)是兩套實作,欄位規則會各自漂移;
 *  這條在現場之前就把「清單載不進去」擋下來——不然是整趟白跑。 */
class ShippedRpListTest {
  private fun repoRoot(): File {
    var d: File? = File(System.getProperty("user.dir"))
    while (d != null && !File(d, "rp/rp-points.json").exists()) d = d.parentFile
    return d ?: error("找不到 repo 根目錄(rp/rp-points.json)")
  }

  @Test fun shipped_list_parses() {
    val f = File(repoRoot(), "rp/rp-points.json")
    val list = parseRpList(f.readText())

    assertTrue("generated 不可為空,否則新 session 記不到清單版本、之後無法續採",
      list.generated.isNotEmpty())
    assertTrue("點數異常:${list.points.size}", list.points.size in 50..900)
    assertEquals("點 id 不可重複(續採進度以 id 為鍵)",
      list.points.size, list.points.map { it.id }.toSet().size)
    // 樓層集合必須與站體模型一致——硬編層數會隨站體擴充漂移
    // (板南線擴充 4→6 後這裡紅了一個月沒人發現;集合相等也涵蓋「每層至少有點」)
    val byFloor = list.points.groupBy { it.floor }
    val stationFloors = org.json.JSONObject(File(repoRoot(), "data/station.json").readText())
      .getJSONArray("floors").let { arr ->
        (0 until arr.length()).map { arr.getJSONObject(it).getString("id") }.toSet()
      }
    assertEquals("rp 清單樓層集合與 station.json 不一致", stationFloors, byFloor.keys)
    for ((floor, pts) in byFloor) assertTrue("$floor 沒有點", pts.isNotEmpty())
  }
}
