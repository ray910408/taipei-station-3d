# 設計：導航會話（NavSession）deep module

狀態：**已裁決、未動工**（2026-07-24 grilling 定案；實作排後續 phase）。
來源：`/improve-codebase-architecture` 審查候選 A＋六題 grilling。審查報告快照：
`%TEMP%\architecture-review-20260724-103320.html`（temp 檔，過期以本文件為準）。

## 動機與證據

- `main.ts boot()` 閉包持有 17 個可變狀態變數（`followState`、`pdrWalk`、`markerTween`、
  `markerPath`、`floorSwap`、`lastNavFloor`、`chaseAuto`、`stepState`、`pdrGen`⋯），
  invariant 只存在於註解（如 `markerTween≠null ⟺ markerPath 非空`，main.ts:197）。
- 歷史 bug 全數集中在這條接線：QA0723-1/2/3/4（相機 goal／入場回正卡死／搭乘跳北／梯前全景）、
  I-1 四輪（平行狀態旗標失配）、終審 F1（晚到授權 race）。
- 測試自承缺口（tests/pdr.integration.test.ts:19）：「main.ts 的 onStep→advanceOnce 接線
  （tween/相機/語音）不在此測——待真機/sim 親驗」。純函式葉子有測，**組合**無測。
- 刪除測試：把編排層刪掉，invariant 維護會散落回每個 callback——複雜度會集中，值得 deepen。

## 六項裁決

### 1. 幾何 seam：世界座標入會話

會話以注入的 `nodeWorld(id) → THREE.Vector3` 依賴在世界座標運算。marker 位置、chase goal、
梯前全景（框 connector 兩端）、出梯瞄準（`aimPastVertical`）全留在 module 內——
QA0723-3/4 的決策現場變成可測。`THREE.Vector3` 當純數值型別用（vitest 已有前例）。
爆炸動畫留在外：`nodeWorld` 閉包讀當下 `explodeFactor`，會話每幀重算自然跟著收斂。

### 2. 生命週期：nav 限定的會話物件

`startNav` 時以 `(routeEdges, 依賴)` 建構，退出即銷毀；一次導航＝一個實例，
`exitNav` 那串手工清理變成「銷毀即清理」。
**收進來**：`followState`、`pdrWalk`、滑行佇列（`markerTween`＋`markerPath`）、
`floorSwap` 時序、`lastNavFloor`、`chaseAuto`、PDR 啟用權世代票。
**留在外**：`mode`、`routeEdges` 的所有權（preview 產物，入會話時傳入即凍結）、
explode、3D 選點／tap、compass、route arrows（path.ts）。

### 3. interface：兩時間尺度的純資料

- `handle(NavEvent) → EventOutcome`——一次性效果：UI 文案（下一步／剩餘／進度／transition）、
  語音句、emphasis 樓層變更、「去請求權限＋票號」。
- `frame(now) → FrameDirective`——冪等連續狀態：marker 世界座標、`cameraGoal | null`
  （含梯前全景 hold）、各樓層 fade 係數。
- `NavEvent` 用 discriminated union：QA 重現步驟＝可回放事件腳本，regression test＝
  事件序列＋斷言 directive。
- 不注入 ui/speaker callback（測試表面會變 mock 互動）；不把一次性效果塞進每幀 directive
  （語音不能冪等重發）。

### 4. PDR 啟用權：狀態機入會話、async 留 adapter

會話收兩個同步事件：`pdrToggleRequested`（outcome 回「去要權限＋票號」）與
`pdrPermissionResult(granted, 票號)`；世代票比對在會話內——「拒絕／晚到授權」race
變成可回放的事件序列測試。原 `pdrGen`（main）＋`pdrReq`（ui）兩張票合併為一張。
50Hz 取樣與 `stepSample`（`StepState`）留在 sensor adapter，會話只收語意化的
`stepDetected` 事件；`pdrWalk`（沿邊累距）在會話內。**候選 D 由此吸收。**

### 5. 命名

`src/nav-session.ts`、建構器 `startNavSession()`、型別 `NavEvent` / `EventOutcome` /
`FrameDirective`。領域詞彙「導航會話」入 `CONTEXT.md`（本次一併建立）。
與 `nav.ts`（路網）、`navview.ts`（視覺純函式）同字首成組。

### 6. 動工方式：本文件即本次交付，實作排後續 phase

實作時的既定路線（已裁決，屆時不重議）：

1. 新 branch；**測試先行**——把 QA0723-1/2/3/4、I-1、終審 F1 寫成事件腳本測試釘住行為。
2. 抽出 `nav-session.ts`；`main.ts` 瘦身成 adapter（directive → THREE / DOM / speech）。
3. 既有 249 tests 一字不改全綠（follow/pdr/navview 葉測試＝internal seam 測試，保留）。
4. 行為保持（behavior-parity）：不改任何體感，只搬編排。
5. 真機親驗通過才 READY；merge 由使用者裁定。

## 內部化清單（成為 implementation 細節）

- `follow.ts`：`advance`／`back`／`atEnd`／`currentNodeId`／`remainingEdges` 的「使用」
- `pdr.ts`：`walkStep`／`crossedNodeIds` 的「使用」
- `navview.ts`：`chaseAim`／`aimPastVertical`／`planStepPath`／`makeTween`／`tweenAt`／
  `swapFactors` 的「使用」
- `camera.ts`：`chaseGoal`／`frameGoal` 的「使用」（`CameraRig.tick` 的套用留 adapter）
- 滑行佇列（審查候選 C）：在會話內出生，invariant 由建構保證，六個手工維護點歸零

葉 module 本身照舊 export、照舊有自己的測試——它們是 internal seam，不是 public interface 的一部分。

## 留在 adapter／main 的

THREE scene 增刪與 dispose、`setFloorEmphasis`／`applyFloorFade` 的實際套用
（快照系統的深化＝審查候選 B，另案）、speaker 發聲、DOM 事件、`rig.tick`、
compass、選點 raycast、explode 動畫、shadow map 開關、route arrows。

## NavEvent 目錄草案

`advanceRequested`（手動確認）／`backRequested`／`stepDetected`／`recenterRequested`／
`userCameraGrab`／`pdrToggleRequested(on)`／`pdrPermissionResult(granted, ticket)`。
「退出」不是事件——銷毀實例即退出。
欄位與簽名細節**刻意不在此定案**：留給實作 phase，必要時用 `/codebase-design` 的
design-it-twice 平行探兩版 interface 再比深度。

## 風險與註記

- tween 端點在 explode 收合期間是世界座標快照（現行行為同此；refactor 保持不動）。
  未來 knob：滑行目標改存拓撲（節點 id＋比例）、frame 時經 `nodeWorld` 解析，
  可順帶消除 stale-endpoint 微陷阱——**不在本次範圍**。
- `REDUCED_MOTION` 是建構參數（免滑行路徑在會話內分支，與現行 `advanceOnce` 一致）。
- 語音只能在事件時發（EventOutcome），不得出現在 FrameDirective。
- 測試新增 `tests/nav-session.test.ts`：每個歷史 bug 一個事件腳本劇本。
