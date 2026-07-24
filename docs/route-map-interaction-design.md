# 路線與地圖互動改善 — Design Spec

日期：2026-07-24
狀態：已與使用者逐段核可（brainstorming 流程）
範圍：7 個既有問題的修復與改善，不含新功能面

## 背景

真機使用回饋 7 個問題，經探勘全部對應到現有程式碼根因：

| # | 問題 | 定位 | 根因 |
|---|------|------|------|
| 1 | 路線流動箭頭只剩一半 | `src/path.ts` | chevron 紋理繞 `TubeGeometry` 管壁一整圈，鏡頭只見面向自己的半圈；Frenet frame 沿曲線扭轉使箭頭常轉到側面 |
| 2 | 點擊地點無法放大 | `src/main.ts` pointerup | 選點只放 pin＋確認小卡，未接 `CameraRig` |
| 3 | 使用者指標無方向性 | `src/follow.ts` `buildPositionMarker` | 倒圓錐＋圓環，無方向概念 |
| 4 | 使用者指標被路線擋住 | 同上 | marker 與路線管高度帶重疊，深度測試讓管面蓋住 marker |
| 5 | 三級 LOD 未完成 | `src/labels.ts` | 標籤只有 tier 0/1 兩級；資料僅 8 個節點標 tier |
| 6 | 樓層聚焦不夠透明 | `src/follow.ts` `setFloorEmphasis` | dim=0.15 偏高；connectors 豎井整組跳過不調暗；非聚焦樓層標籤照顯 |
| 7 | 手機發燙掉幀 | `src/main.ts` `setAnimationLoop` | 靜止畫面也持續 60fps 全力渲染（n8ao＋AA＋dpr≤2＋陰影） |

## 決策記錄（與使用者裁定）

- 問題 2：**只有現有選點**（snap 節點）拉近；不做 POI 圖示點擊、不做任意樓面點擊。
- 問題 3：箭頭方向 = **沿路線前進方向**（marker 滑行方向差分）；不用裝置羅盤。
- 問題 5：標籤做滿三級距離制＋補 tier 資料；**POI 圖示不納入 LOD、維持永遠全顯**。
- 問題 6：非聚焦樓層降到 **0.05**，豎井與標籤一併調暗/隱藏。
- 問題 7：**只做靜止免重繪**；不降任何畫質（不動 dpr／AO／抗鋸齒，不加 fps 上限）。
- 問題 1 修法：**平帶 ribbon**（否決管壁雙 chevron、實體箭頭 InstancedMesh）。

## 設計

### A. 路線平帶 ribbon（問題 1）

`buildRouteObject`（`src/path.ts`）同層 run 段從 `TubeGeometry` 改自製水平 ribbon：

- 沿既有 `CatmullRomCurve3` 取樣（密度沿用 `max(16, pts×8)`）；每取樣點以「切線 × 世界 +Y」求水平側向量，左右各偏 `THEME.route.radius`（帶寬 1.8m）；y 固定取樣點高度（同層 run 等高）。切線水平分量趨零時沿用前一側向量。
- up 恆為世界 +Y → 無 Frenet 扭轉，箭頭永遠完整朝上。
- UV：u = 弧長 / `THEME.route.arrowInterval`（箭頭間距語意不變）；v 橫跨帶寬 0→1。chevron 紋理與 `tickRouteArrows` 共用 offset 流動機制原封不動。
- Material 加 `side: DoubleSide`（自下往上看仍可見）。
- 跨層細管 link、起訖 pin、node 環境無 canvas 的純色 fallback：皆不動。

### B. 使用者指標箭頭＋永不被擋（問題 3、4）

- `buildPositionMarker`（`src/follow.ts`）：圓錐改**水平扁箭頭**（`ShapeGeometry` chevron 輪廓，長約 2.4m，置於 y≈0.2，`DoubleSide`），地面圓環保留，色沿用 `THEME.route.marker`。
- 方向：main loop 以 `session.frame()` 的 `markerPos` **前後幀差分**求 yaw；位移 < 1mm 保持原朝向；wrap-aware lerp（係數 ~0.15）平滑轉向，獨立為純函數。不改 nav-session API。
- 遮擋：marker 全材質 `depthTest: false`、`depthWrite: false`、`renderOrder = 10`——永遠畫在路線與樓板之上。起訖 pin 不改。

### C. 點擊放大＋樓層聚焦透明（問題 2、6）

- 選點成功（pin＋小卡）時：`rig.goal = frameGoal([nodeWorld(node.id)], camera.aspect)`——單點走 `MIN_RADIUS=12` 路徑平滑拉近；取消選點不動鏡頭；reduced-motion 直接到位（既有機制）。
- `THEME.emphasis` 加 `focusDim: 0.05`；`setFloorEmphasis` 加第三參數 `dimFactor`（預設 `THEME.emphasis.dim`=0.15，preview/nav 現行為不變）；右側樓層鍵路徑傳 `focusDim`。
- 豎井調暗：builder 對每個 connector 子物件（含 escalator 箭頭）蓋 `userData.floors = [兩端樓層 id]`；`setFloorEmphasis` 不再整組跳過 connectors，改為「兩端皆不在 active 集合才調暗」——preview 跨層路徑豎井保亮，nav/preview 順帶受益。
- 標籤隱藏：label entry 記 floorId；`LabelLayer.update()` 增加聚焦樓層參數（null＝無聚焦），非聚焦樓層的樓層牌／地標籤直接 `visible=false`（不用半透明——CSS2D 半透明仍佔 declutter 格）。

### D. 三級標籤 LOD（問題 5）

- 型別：`NavNode.tier?: 0 | 1 | 2`（`src/types.ts`）。
- `labelVisible`（純函數）階梯：
  - L0：overview 常駐（現行為）
  - L1：cameraDist < `landmarkMaxDist`（現值 320）
  - L2：cameraDist < `landmarkNearDist`（`THEME.labels` 新增，預設 140，可調）
  - 未標 tier 視為 1（向後相容）；樓層牌規則不變。
- declutter 優先序：樓層牌 4 > L0 3 > L1 2 > L2 1。
- 資料標注（`data/floors/*.json` 四檔）：盤點所有具名節點——轉乘核心／大廳／出口群 = 0、一般設施 = 1、次要（個別出口、邊角設施）= 2。實作計畫列逐檔清單。
- POI 圖示（`src/icons.ts`）完全不動。

### E. 靜止免重繪（問題 7）

rAF 迴圈保持跑（判斷成本趨近零），無事跳過整段 render（n8ao／render／CSS2D update 全省）：

- 持續動畫條件：`explodeAnim`、`session` 存在、`rig.goal` 未到位、路線可見（preview/nav 箭頭流動）。
- 單次髒污 `invalidate()`：controls `change`、canvas pointer 事件（兜底）、resize、`refreshRoute`、`setFloorEmphasis` 呼叫處、pick pin 增減、`setMode`——所有動到 3D 的路徑。
- 每幀：`const moved = controls.update()`（damping 拖尾靠回傳值）→ `if (持續動畫 || moved || 髒污)` 才 render＋`labelLayer.update`＋`compass.tick`。
- 預期：overview 閒置態 0 次重繪（發燙主因歸零）；preview/nav 維持動畫、畫質不變。
- 風險：漏掛 invalidate → 畫面停格。防護：pointer 事件一律 invalidate 兜底；`?fps=1` overlay 直接觀察 render 停止；QA 清單逐互動驗證。

## 測試與驗證

- 單元測試（vitest node 環境，沿用既有慣例）：
  - ribbon 幾何：頂點等高、帶寬正確、UV 弧長縮放
  - yaw 平滑純函數：wrap-aware（±π 跨界）
  - `labelVisible` 三級 gate 全矩陣
  - `setFloorEmphasis`：dimFactor 參數、connector `userData.floors` 判斷、還原快照
- 手動驗證：`?fps=1` 靜止時 render 停止與 draws 數；先前發燙手機實測 10 分鐘溫度／掉幀；nav 走整段驗箭頭完整、marker 不被擋、樓層聚焦透明度。

## 明確不做（out of scope）

- POI 圖示點擊與 POI LOD（使用者裁定維持全顯）
- 裝置羅盤 heading（室內磁場不可靠；箭頭用路線方向）
- 幾何細節 LOD、行動裝置畫質降級、fps 上限
- nav-session API 變更（heading 差分在 adapter 層解）

## 影響檔案

`src/path.ts`、`src/follow.ts`、`src/main.ts`、`src/labels.ts`、`src/theme.ts`、`src/types.ts`、`src/builder.ts`、`data/floors/*.json`（tier 標注）、對應測試檔。
