# 描圖工具（tracer）使用說明

dev-only 工具：`npm run dev` 後開 `http://localhost:5173/tracer.html`。
存檔走 dev server 的 `POST /__tracer/save`——整批驗證（schema/參照/幾何/語意）通過才寫檔，
寫入即 canonical 格式；viewer 同時熱重載，描完立刻看 3D。

## 界面

左欄：樓層/底圖選擇、底圖透明度、圖層開關、工具切換、描繪表單、儲存/復原。
畫布：左鍵＝工具動作；空白處拖曳或中鍵＝平移；滾輪＝縮放（游標為中心）；
左下比例尺與原點軸線；zoom 夠大時顯示元素 id 標籤。

## 校準（每張底圖一次）

1. 選底圖 → 「校準底圖」工具。
2. 依面板指示點四下：底圖點 A → A 的 local 位置 → 底圖點 B → B 的 local 位置。
   local 點磁吸既有頂點（建議錨到既有幾何的對角兩點，基線越長越穩）；Enter 可改輸入座標。
3. 預覽對位滿意後「儲存校準」→ 寫入 refs/sources.json（control_points + px_per_m + basis）。

校準的意義：把底圖錨進既有模型座標框架（141m 月台基準、N20°E 軸向）；先定框架、再修內容。

## 描圖流程（每樓層）

1. 校準底圖 → 圖層透明度 50–80% 對照。
2. 重描既有元素：選取工具選元素 → 描繪工具「替換選取元素幾何」重畫
   （provenance 自動蓋 status=traced、source=當前底圖、confidence 取表單值）。
3. 新元素：描繪工具選目標類別，填 kind/id 描述段/confidence 後描繪。
4. nav node：nav 工具點擊新增（自動序號與 area）、拖移；edge 手動編修 JSON 後跑 npm run format:data。
5. Ctrl+S 儲存 → viewer 熱重載目視 → 疑點記入 docs/floor-notes/。

## 快捷鍵

| 鍵 | 作用 |
|---|---|
| Ctrl+S / Ctrl+Z | 儲存 / 復原（存檔後頁面會隨資料熱重載刷新，undo 歷史清空——已存內容以 git 為回復手段） |
| Enter / 雙擊 | 完成描繪（poi 1 點、gate 2 點自動完成） |
| Esc / Backspace | 取消描繪、清選取 / 退一點 |
| Shift（描繪中） | 與上一點正交 |
| Alt+點 | 刪頂點（選取工具）/ 刪 nav node（nav 工具，被 edge 引用時拒絕） |

## 限制（設計取捨）

- 元素級刪除、nav edge 編輯不在 UI 內——直接改 JSON（避免懸空引用）；工具架構已預留擴充點。
- 命中順序＝圖層順序（上層優先）；要選下層元素先關上層圖層。
- build 出的 tracer.html 頁面可看不可存（save API 僅 dev server 有）。
