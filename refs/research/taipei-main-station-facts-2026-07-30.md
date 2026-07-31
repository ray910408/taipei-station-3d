# 臺北車站事實查核彙整（2026-07-30）

> 本檔只收可追溯資料；沒有一手來源的數值不升格為事實。研究擷取日：2026-07-30。

## 站體／月台／樓層

### 可直接機器化的已確認欄位

```yaml
station:
  name_zh: 臺北車站
  main_building:
    floors_above_ground: 6
    floors_below_ground: 4
    confidence: high
    source: S2

  tra_hsr_platform_level:
    floor: U-2
    complex_label: B2
    platform_form: 島式
    platform_count: 4
    track_count: 9
    per_platform:
      length_m: 330
      width_m: 9
    confidence: high
    source: S1

  tra_hsr_platform_order_north_to_south:
    - 臺鐵第四月台
    - 臺鐵第三月台
    - 高鐵第二月台
    - 高鐵第一月台
    confidence: high
    source: S6

  trtc:
    station_codes:
      bannan: BL12
      tamsui_xinyi: R10
    floors:
      B2: 板南線大廳層
      B3: 板南線月台層／淡水信義線大廳層
      B4: 淡水信義線月台層
    platforms:
      bannan:
        floor: B3
        platform_3: 南港展覽館方向
        platform_4: 頂埔方向
      tamsui_xinyi:
        floor: B4
        platform_1: 淡水、北投方向
        platform_2: 象山方向
    confidence: high
    source: S4-S5
```

### 官方鐵道局所列樓層用途

下表逐項轉錄自交通部鐵路改建工程局《工藝精進：臺北、板橋、南港車站規劃設計與施工》PDF 第 25 頁的「臺北車站各層空間概要」。

| 官方樓層代號 | 用途原文摘要 | 可用欄位 | 可信度 |
|---|---|---|---|
| G+4～G+6 | 「臺鐵局辦公室，及1間樓高2層多功能之演藝廳」 | `office_floors=[4,5,6]`；`performance_hall_storeys=2` | 高：工程主管機關出版品 |
| G+3 | 「臺鐵調度總所、防護團、電訊中心」 | `floor_3_use=railway_operations` | 高 |
| G+2 | 「車站商業空間，設百貨商場、美食街、書店及便利商店等」 | `floor_2_use=commercial` | 高 |
| G+1 | 「車站大廳及售票中心，設有40個售票窗口」；另有郵局、鐵路餐廳、站務辦公室 | `floor_1_use=main_hall_ticketing`；`ticket_windows=40` | 高；40 窗口是 2014 年出版品記錄，不保證現況仍同數 |
| U-1 | 「穿堂層，設候車室、2處到站大廳」及東西側停車場 | `B1_use=concourse`；`arrival_halls=2` | 高；商業與停車配置可能已改裝 |
| U-2 | 「車站月台層，4座島式月台9股道，每座寬9公尺，長330公尺」 | 見上方月台欄位 | **最高：直接工程諸元** |
| U-2A | 「車站運轉及監控中心」 | `U2A_use=operations_control` | 高 |
| U-2B | 「車站調度及電務中心」 | `U2B_use=dispatch_and_electrical` | 高 |
| U-2C | 「車站運轉人員走廊」 | `U2C_use=operations_staff_corridor` | 高 |
| U-3 | 「預留臺鐵與臺北捷運系統紅線R13車站轉乘穿堂之結構體」 | `B3_original_design=transfer_concourse_structure` | 高；「R13」是工程舊編號，現營運編號為 R10 |
| U-4 | 「預留臺北捷運系統月台層結構體」 | `B4_original_design=metro_platform_structure` | 高 |

**定義注意：** `U-2A/U-2B/U-2C` 是 U-2 相關運轉夾層／空間代號，不應另外加進「地下 4 層」的樓層總數。現行北捷剖面圖把同一深度帶標成 B1～B4，並明示 B2 板南線大廳、B3 板南線月台／淡水信義線大廳、B4 淡水信義線月台。臺鐵／高鐵 U-2 月台與北捷 B2 大廳位於不同水平位置，但共用「B2」深度標籤，不能誤解為同一平面輪廓。

### 臺鐵／高鐵月台與股道

- **可確認：** B2/U-2 為 **4 座島式月台、9 股道；每座長 330 m、寬 9 m**（S1，第 25 頁）。
- **可確認：** 官方現行 B2 平面位置圖由北向南標示「臺鐵第四月台、臺鐵第三月台、高鐵第二月台、高鐵第一月台」（S6，圖面中央四條月台帶）。
- **不可拆分：** S1 只直接給出臺鐵＋高鐵合計 9 股道，S6 是示意位置圖；本次未找到一手文字明載「臺鐵 5 股／高鐵 4 股」。因此可把 `tracks_total=9` 入庫，但 `tracks_by_operator` 應暫留 `null`，不要沿用 Wikipedia 拆分值。
- **尺寸定義：** 330 m × 9 m 是「每座島式月台」的長、寬，不是整個 B2 站體外包絡尺寸。

### 北捷樓層、月台與服務路線

- 北捷現行車站頁標示本站為 **BL12 / R10**，服務 **板南線、淡水信義線**（S4）。
- 官方剖面圖（圖碼 `BL12/R10-SP(25.12)`）右側樓層列直接標示：
  - B2：板南線大廳層
  - B3：板南線月台層／淡水信義線大廳層
  - B4：淡水信義線月台層
- 官方 B3 資訊圖（圖碼 `BL12R10-SW(25.12)`）標示板南線「三月台：南港展覽館（南港方向）」、「四月台：頂埔（土城、板橋方向）」。
- 官方 B4 資訊圖（同為 `25.12` 版）標示淡水信義線「一月台：淡水、北投方向」、「二月台：象山方向」。
- 圖面幾何顯示兩線各為一座島式月台、兩側各一股軌道；這是**官方圖面的幾何判讀**，不是本次找到的文字工程諸元。若入庫，建議附 `evidence_type: cartographic_inference`、`confidence: 3/5`，不要把圖上量得的長寬當實測值。

### 站體 149 × 110 × 48 m：未能一手確認

```yaml
main_building_dimensions:
  length_m: null
  width_m: null
  height_m: null
  status: unverified
  rejected_candidate:
    length_m: 149
    width_m: 110
    height_m: 48
    reason: 本次未找到同一份臺鐵、鐵道局或建築工程一手資料直接列出此完整三維尺寸
```

- 搜尋到的 `149 m × 110 m × 48 m` 完整組合只出現在 Wikipedia 或轉載其敘述的二手頁面，故**不採用**。
- 臺北市政府捷運工程局 2018 年 C1/D1 招商文件曾寫「配合臺北車站量體高度整體考量，建議不超過臺北車站量體高度 **48 公尺**為原則」（S3，PDF 第 37 頁／印刷頁碼 38）。這可作為 `48 m` 的**官方間接佐證**，但文件用途是鄰地量體管制，不是臺北車站竣工圖或使用執照；因此不能用它確認 149 × 110，也不宜單憑此句把 `height_m` 升格為精確竣工高度。
- 鐵道局 2012 年官方出版品直接描述「今日地上6層、地下4層」（S2，第 66–67 頁），但沒有在該段列 149 m、110 m、48 m。
- **建議資料處理：** `facts.building.length_m/width_m/height_m` 暫設 `null` 或保留值但標 `status=unverified`、`source=Wikipedia-derived`，直到取得使用執照、竣工圖或官方工程諸元表。

### 來源清單

#### S1 — 月台、股道、各層用途（主要一手來源）

- **頁面／出版品：**《工藝精進：臺北、板橋、南港車站規劃設計與施工》
- **出版機關／日期：**交通部鐵路改建工程局，2014-05
- **直接 URL：** https://www.rb.gov.tw/public/files/artsinfo/1526560184-0.pdf
- **出版品中繼資料：** https://www.govbooks.com.tw/books/97966 （GPN 1010300833、ISBN 9789860411720）
- **位置：** PDF 第 25 頁，「臺北車站各層空間概要」第 1～11 點。
- **關鍵原文短摘：**「U-2層為車站月台層，4座島式月台9股道，每座寬9公尺，長330公尺。」
- **可信度／時效：** 高；工程主管機關的規劃設計與施工專書。出版逾 12 年，但月台結構諸元屬低變動事實；商店、售票窗口、停車位等營運配置可能過時。

#### S2 — 地上／地下樓層總數

- **頁面／出版品：**《潛龍騰行：隨著記憶不斷蛻變的臺北鐵道》
- **出版機關／日期：**交通部鐵路改建工程局，2012-01
- **直接 URL：** https://www.rb.gov.tw/public/files/artsinfo/1526562374-0.pdf
- **位置：** PDF 第 66–67 頁，「臺北車站」段落。
- **關鍵原文短摘：**「今日地上6層、地下4層，三鐵共構」。
- **可信度／時效：** 高；官方工程史出版品。樓層數是低變動結構事實，但仍是 2012 年記錄。

#### S3 — 48 m 的官方間接佐證（不可當完整竣工尺寸）

- **頁面標題：**「臺北市西區門戶計畫臺北車站特定專用區 C1/D1（東半街廓）土地開發案」徵求投資人第 1 號補充公告
- **機關／更新日期：**臺北市政府捷運工程局北區工程處，2018-06-15
- **公告 URL：** https://www.dorts.gov.taipei/News_Content.aspx?n=DDCD2AA1D2BCDBC5&s=AB906E6AA5CDAD21&sms=F8A02778178F9DF6
- **附件直接 URL：** https://www-ws.gov.taipei/Download.ashx?icon=..pdf&n=6ZmE6KGoMSBDMUQx5qGI55SE6YG45paH5Lu26YeL55aR5Y%2BK6KOc5YWF6Kqq5piOLnBkZg%3D%3D&u=LzAwMS9VcGxvYWQvMzg4L3JlbGZpbGUvNDMyNTEvNzc1MzkxOC9kZWRjZDEwNi1mNzRhLTQ3OWQtYmVhMS1lZjI2ZDRjZGE2ZmYucGRm
- **位置：**附件《甄選文件釋疑及補充說明》PDF 第 37 頁（印刷頁碼 38），項次 87。
- **關鍵原文短摘：**「建議不超過臺北車站量體高度48公尺為原則。」
- **可信度／時效：** 中；官方文件，但用途是 C1/D1 鄰地設計管制的比較基準，不是臺北車站 as-built 尺寸表。

#### S4 — 北捷現行站碼、路線與樓層

- **頁面標題：**臺北大眾捷運股份有限公司－台北車站車站資訊查詢
- **發布／更新日期：**頁面未標；2026-07-30 擷取
- **URL：** https://web.metro.taipei/pages2026/WebStation/051
- **剖面圖直接 URL：** https://web.metro.taipei/img/ALL/stationprofile/051.jpg
- **位置：**站名頁首（BL12/R10、板南線、淡水信義線）；剖面圖右側 B1～B4 樓層列。
- **可信度／時效：** 高；營運機構現行站頁。剖面圖自註「本示意圖僅供參考」，可確認樓層／垂直關係，不可量測層高。

#### S5 — 北捷月台編號與方向

- **頁面標題：**台北車站資訊圖
- **發布／更新日期：**圖面版號 `BL12R10-SW(25.12)`（2025-12）；2026-07-30 擷取
- **B3 直接 URL：** https://web.metro.taipei/img/ALL/INFOPDF/JPG/051-3.jpg
- **B4 直接 URL：** https://web.metro.taipei/img/ALL/INFOPDF/JPG/051-4.jpg
- **位置：**B3 圖下方板南線月台圖例；B4 圖右上月台兩側標示。
- **可信度／時效：** 高；營運機構現行資訊圖。方向／編號可直接使用，幾何尺寸只可視為示意。

#### S6 — 臺鐵／高鐵 B2 月台名稱與南北次序

- **頁面標題：**臺北車站月台平面位置圖 / Taipei Station B2F Plan
- **發布／更新日期：**圖面未標；官方站圖於 2026-07-30 擷取
- **直接 URL：** https://tip.railway.gov.tw/tra-tip-web/tip/img/0a00114c-3667-4e2f-a897-78b2864d8eba/1140x900
- **位置：**圖面中央四條月台帶，由北向南的文字標籤。
- **可信度／時效：** 高（名稱與相對次序）；圖面本身是示意位置圖，不能反算實際尺度或用圖上線條自行拆分股道。

### 與專案現值的衝突／處置

- `data/station.json` 原有 `building.length_m=149`、`width_m=110`、`height_m=48` 的來源明列為 Wikipedia；本次因無法由一手來源確認而移除。
- `data/station.json` 的臺鐵／高鐵月台長 330 m、寬 9 m 已改引 S1；這兩個數值有官方工程出版品支持。
- `docs/floor-notes/tra-platform-b2.md` 的「帶寬 11m」是模型／描圖假設，與 S1 的官方月台寬 9 m 不同。兩者定義不可混用：事實欄位用 9 m；模型若保留 11 m，需明寫為視覺／導航幾何補償。
- 專案目前估算的各層 `elevation`／`height` 不能從 S4 剖面圖升級；圖面沒有尺寸且自註僅供參考。

## 出入口與無障礙（第二代理複核）

- 北捷官方站頁列 `M1–M8` 共 8 個出口；其中 `M2`、`M4` 有電梯並標為無障礙出口。
- 同頁列出 7 部無障礙電梯：B2→B4、B3→B4、地面→B3、B1→B2、M4→B1、B2→B3，以及 B1→B2。
- 臺鐵官方站頁列北一門、北二門設無障礙坡道；另有月臺電梯。

以上資料直接影響出入口、垂直動線與無障礙路徑建模。來源：[北捷台北車站現行頁](https://web.metro.taipei/pages2026/WebStation/051)、[臺鐵臺北站現行頁](https://www.railway.gov.tw/tra-tip-web/tip/tip00H/tipH41/viewStaInfo/1000)，於 2026-07-30 重新核對。
