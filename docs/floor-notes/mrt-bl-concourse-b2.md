# mrt-bl-concourse-b2 判讀筆記

## 校準

- `trtc-info-b2`：control points＝px(965,1082)↔local(88.8,-83.2)、
  px(1141,518)↔local(147.3,49.4)；`px_per_m`＝4.08，status＝estimated。
- 全部描圖點以 `src/tracer/transform.ts` 的 `fitSimilarity`／`pxToLocal` 轉入 local frame，
  座標取到 0.1m。

## T 字形 slab

- 東西向主帶依資訊圖深灰牆中心線收邊，納入 M3–M8、詢問處2/3、兩側閘門陣列及四組
  下板南線月台梯井；誠品與站前地下街不入模。
- 北伸 stem 沿淡水信義線轉乘廊道描入。電梯1落點 `n-bc-010=[92.9,-81.4]`
  對應 px(981,1073)，在 slab 與 `a-bc-paid` 內。
- stem 最北牆線與同高程 `tra-platform-b2` 的示意矩形相距不足；為維持「同深不同體不重疊」
  契約，北緣裁在 local y=-75.8 以下。資訊圖牆線與既有臺鐵示意 slab 的張力未提供實測解，
  故 slab confidence 2 並在元素 note 明記。

## 付費區、非付費帶與閘門

- `a-bc-paid`：四梯井之間的東西向主幹，加上北伸淡信轉乘 stem。
- `a-bc-unpaid-n`：詢問處2、M4–M6 一側；主帶在 local frame 向東南傾斜，此端 local y 較高。
- `a-bc-unpaid-s`：詢問處3、M3/M8 與主帶南緣出口帶。
- `g-bc-n-*`／`g-bc-s-*` 分別沿詢問處2/3旁的斜向閘門陣列分群。圖面沒有逐道進出箭頭，
  因此方向排序採 in/out/both 最小拓撲模型，confidence 2；兩端較寬通道依鄰近無障礙
  電梯4/7動線判為 accessible both。非 both gate edge 均為 `bidir:false`。

## 梯井、nav 與垂直對端

- `u-bc-stairs-w/cw/ce/e` 與 `u-bp-stairs-w/cw/ce/e` 使用完全相同的 local polygon。
- `n-bc-004/005/006/007` 分別與 B3 的 `n-bp-004/005/007/008` 同 xy：
  `[17.5,-139.3]`、`[53.1,-143.3]`、`[88.2,-147.3]`、`[123.5,-151.3]`。
- `n-bc-010=[92.9,-81.4]` 是 Task 7 淡信轉乘電梯1三停靠的 B2 端；id 與座標不得漂移。
- 唯一具名 nav 地標為 `n-bc-001`：`板南線大廳（詢問處）`。另保留 3 筆 POI 示範：
  詢問處2、詢問處3、板南線轉乘指標。

## 未入模

- 誠品、站前地下街及資訊圖淡灰背景通道。
- 閘門單道實際進出配置、櫃台與梯井施工尺寸；圖面只提供示意符號，維持 confidence 2。
- 本 task 不新增 connectors；B2↔B3 梯井與電梯連接由 Task 7 建立。
