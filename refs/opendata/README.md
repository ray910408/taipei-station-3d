# 北捷開放資料（全路網 CSV）

原檔為 **Big5**，此處副本一律轉 UTF-8、內容一字未改（比照「原始資料永不修改」慣例）。
要重新下載時記得再轉一次編碼，直讀 Big5 會全亂碼。

檔案在 `refs/sources.json` 以 `trtc-od-*` 註冊，引用時就寫該 source id；那裡的 `url` 是資料集
**頁面**而非直接下載連結（下載網址會隨版本變動，頁面才是穩定識別）。五個頁面都核對過標題、
提供機關與欄位清單與此處檔案相符：

| 檔案 | 資料集 |
|---|---|
| `exit-coords.csv` | [臺北捷運車站出入口座標](https://data.gov.tw/dataset/128428) |
| `exit-elevator-ramp-gps.csv` | [臺北捷運車站出入口無障礙電梯、無障礙坡道GPS座標](https://data.gov.tw/dataset/128414) |
| `accessibility-facilities.csv` | [臺北捷運車站無障礙設施資料](https://data.gov.tw/dataset/128416) |
| `elevator-locations.csv` | [臺北捷運車站無障礙電梯位置](https://data.taipei/dataset/detail?id=ba6b64b1-a387-4b34-93c6-7c3bf2dad3db)（只在 data.taipei，非 data.gov.tw） |
| `station-facilities.csv` | [臺北捷運車站設施資訊](https://data.gov.tw/dataset/128453) |

## 跨檔比對前必先正規化 join key

不正規化會爆假陽性（曾誤報 191 筆缺漏，實際 118 站完全對齊）：

- 出口編號：`exit-elevator-ramp-gps` 寫「出口1」「單一出口」，`exit-coords` 寫「1」「0」。
  **「單一出口」↔「0」有一個例外**：奇岩站在 `exit-elevator-ramp-gps` 標「單一出口」，
  但 `exit-coords` 給的是出口 1／2／3、沒有 0 這筆——該列的坡道無法用出口編號 join，
  只能靠座標就近配對。其餘 20 站的「單一出口」與「0」一對一對得上。
- 站名尾綴分三種寫法：
  | 寫法 | 檔案 | 例 |
  |---|---|---|
  | 無「站」字 | `station-facilities`、`elevator-locations` | `七張` |
  | 有「站」字 | `accessibility-facilities` | `七張站` |
  | 站名嵌在出入口名稱裡（帶「站」字） | `exit-coords`、`exit-elevator-ramp-gps` | `七張站出口1` |

  唯一的例外是**台北車站**——它本名就以「站」結尾，所以在無尾綴的兩檔裡也寫作 `台北車站`；
  無腦 `replace(/站$/,'')` 會把它砍成「台北車」。板橋另在 `station-facilities` 拆成
  `板橋(板南線)`／`板橋(環狀線)` 兩列。
- 站名異體字：Y19 幸福站在 `accessibility-facilities`／`elevator-locations`／`exit-elevator-ramp-gps`
  三檔都寫成 `幸褔`（示部），只有 `exit-coords`／`station-facilities` 是正確的 `幸福`。
  只修其中一檔仍會對不上，正規化時要一起處理。
- 車站編號有兩處錯值（見下），拿編號當 join key 前先修，否則 `G03` 查無資料、`G03A` 對到兩站。

## 已知原檔錯誤（刻意未修，用時自行處理）

1. `exit-elevator-ramp-gps`：圓山站出口2坡道 緯度 `250717908`，應為 `25.0717908`（掉小數點）
2. Y19 `幸褔站` → `幸福站`（異體字），出現在 `accessibility-facilities`、`elevator-locations`、
   `exit-elevator-ramp-gps` 三檔
3. `elevator-locations`：中山國中 車站編號 `BF12`，應為 `BR12`（文湖線編號一律 BR）
4. `elevator-locations`：七張 車站編號 `G03A`，應為 `G03`——`G03A` 是小碧潭，該檔內同編號對到兩站
5. `accessibility-facilities`：**台北車站那列的 `Line` 與 `Station_Number` 順序相反**——
   寫成 `淡水信義線/板南線` 配 `BL12/R10`，但實際是 淡水信義線＝R10、板南線＝BL12。
   直接把兩欄拆開對位 zip 會把兩條線的代碼互換。

3、4 是把 `elevator-locations` 與 `accessibility-facilities` 逐站比對編號掃出來的，
全檔就這兩筆編號值不一致（其餘 133 筆一致）。5 是另一種缺陷、**那次掃描看不到**：
它比的是「該站的編號集合有沒有對上」，而台北車站兩邊都是 {R10, BL12}，集合相同、
只有複合列內的順序反了。16 個複合列逐列對位比過，只有台北車站這一列是反的。

`exit-elevator-ramp-gps`（電梯/坡道點）與 `exit-coords`（出口點）同編號座標差 40–140m 是
不同設施的正常位移，不是錯誤。
