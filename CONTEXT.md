# CONTEXT — 領域詞彙表

本專案的 ubiquitous language。架構討論、命名、審查一律以此為準；
新概念定案時隨手補進來（lazily）。架構詞彙（module / interface / seam / depth /
locality / leverage）依 `/codebase-design` 定義，不在此重複。

## 導航會話（nav session）

一次導航的完整生命：從「開始導航」到抵達或退出。持有跟隨游標、PDR 沿邊累距、
滑行佇列、換層過渡時序、相機跟隨意圖（chaseAuto）與 PDR 啟用權世代票。
以事件驅動（`NavEvent` 進、`EventOutcome` 出）、每幀吐純資料畫面指令
（`FrameDirective`）。設計見 `docs/nav-session-design.md`；尚未實作——
目前這些狀態仍散在 `main.ts boot()` 閉包。

- **導航事件（NavEvent）**：使用者或感測器對會話說的話——手動推進、退回、
  偵測到一步、接管相機、回正、PDR 開關與授權結果。discriminated union，可回放。
- **畫面指令（FrameDirective）**：會話每幀吐出的冪等純資料——marker 世界座標、
  相機 goal（或 null＝不干預）、各樓層 fade 係數。adapter 負責套到 THREE/DOM。
- **滑行佇列（glide queue）**：marker 未走完的目標點序列＋作用中 tween。
  invariant（tween 存在 ⟺ 佇列非空且 tween 目標＝佇列頭）由建構保證。
- **世代票（generation ticket）**：非同步授權的防晚到機制——每次切換遞增票號，
  結果回來時票號不符即作廢。

## 既有詞彙（自 code 具現，一行版）

- **路網（nav graph）**：節點＋邊的尋路圖，`nav.ts` 以 A* 尋路；邊分
  walk / gate / platform-edge / stair / escalator / elevator。
- **地標（landmark）**：有中文名的路網節點，搜尋與選點的單位。
- **垂直設施（connector）**：跨樓層的樓梯／電扶梯／電梯；導航中「梯前暫停、
  手動確認過梯」。
- **梯前全景**：站在垂直設施前時，相機框住 connector 兩端的呈現（QA0723-3）。
- **跟隨（follow）**：路線＝節點序列＋目前 index 的游標模型；推進只走 `advance`。
- **PDR（pedestrian dead reckoning）**：步偵測＋固定步長沿邊累距的推進來源；
  connector 邊一律暫停退手動。
- **爆炸圖（explode）**：overview/preview 將樓層沿 y 拉開的呈現；nav 收合回實高。
- **體感**：一次節點推進的完整呈現組合——滑行、相機、語音、UI 更新（`advanceOnce` 的責任）。
