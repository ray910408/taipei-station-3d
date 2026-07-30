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
    // 每層至少要有點,否則現場會走到一層沒有任何點位
    val byFloor = list.points.groupBy { it.floor }
    assertEquals("樓層數不符", 4, byFloor.size)
    for ((floor, pts) in byFloor) assertTrue("$floor 沒有點", pts.isNotEmpty())
  }
}
