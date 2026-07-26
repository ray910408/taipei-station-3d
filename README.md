# 台北車站室內 3D 導航

樓層 JSON 為唯一資料真相的室內 3D 導航實驗。
範圍：淡水信義線月台(B4) → R 線大廳(B3) → 台鐵轉乘區 → B3 轉乘電梯 → 臺鐵第3/4月台候車點(B2)，
含 B1 臺鐵穿堂局部與無障礙路徑模式（全程電梯＋寬閘門）。
Phase 2 起幾何以描圖工具對校準官方站圖重描（status=traced），並支援 GLB 雙軌輸出。
Phase 3 起支援導航跟隨模式：地標清單選起訖、「我到了」逐節點推進、跟隨相機與當前樓層聚焦、
手機底部面板與大字/高對比切換。
Phase 4/5 起視覺由 `src/theme.ts` 單一真源驅動：亮色系配色、體塊語言（頂亮側暗＋描邊）、
場景標籤層與 POI 官方圖例圖示；導航模式改單樓層低視角跟隨、marker 滑行與大導航線。

另有一條 WiFi 指紋室內定位的工具鏈（現場採集 APK → 離線 pipeline → 指紋庫 JSON），
目前止於產出指紋庫——**定位引擎尚未接進 viewer，app 行為不受影響**。

## 快速使用

需先安裝 Node.js 與 npm。

```bash
npm ci
npm run dev
```

啟動後開啟終端機顯示的網址（預設為 `http://localhost:5173/`）：

1. 從「起點」與「終點」選擇地標。
2. 選擇「一般路徑」或「無障礙路徑」產生路線。
3. 按「開始導航」，到達目前指示的節點後按「我到了」前往下一段。
4. 可依需求切換「大字」或「高對比」顯示。

描圖工具位於 `http://localhost:5173/tracer.html`。

## 指令

**開發與建置**

- `npm run dev`——viewer（`/`）與描圖工具（`/tracer.html`），資料熱重載
- `npm run dev:lan`——同上但綁定區網位址，供手機真機驗收
- `npm run build`——產出 `dist/`
- `npm test`——單元/整合/GLB parity 測試；`npm run typecheck`——TS 檢查

**資料**

- `npm run validate`——資料驗證（schema/參照/幾何/語意/校準一致性）
- `npm run format:data`——資料檔 canonical 排版（`-- --check` 為檢查模式）
- `npm run export:glb`——離線匯出 `public/models/station.glb`；`npm run validate:glb`——Khronos 驗證

**WiFi 指紋定位（離線工具鏈，不影響 viewer）**

- `npm run gen:rp`——由樓層 JSON 產參考點清單與找點 SVG（`-- --spacing 6 --svg`）
- `npm run sim:fp`——指紋模擬器：沒有現場資料時產生合成採集檔（`-- --seed 1`）
- `npm run build:fp`——離線 pipeline：採集檔（真的或合成的）→ 指紋庫 `public/fp/<站>.json`
- `npm run analyze:spacing`——由採集檔估算「兩點要隔多遠才分得出來」

網址參數：`?geom=glb` 切換 GLB 幾何軌、`?fps=1` 開啟效能 overlay（FPS／frame ms／draw calls）。

## 目錄

- `data/`——樓層 JSON（唯一真相）：station 索引、floors/ 每樓一檔、connectors 垂直設施
- `schemas/`——JSON Schema；`tools/`——validate / format-data / save-handler / export-glb
- `refs/`——參考圖與來源清單（含描圖校準）；`docs/floor-notes/`——各層判讀筆記
- `src/`——viewer（three.js）；`src/theme.ts` 視覺單一真源；`src/tracer/`——描圖工具
- `src/fp/`——指紋數學（viewer 與 CLI 共用）；`tools/fp-sim.ts` 模擬器、`tools/fp-build.ts` 離線 pipeline
- `tools/wifi-collector/`——現場採集用 Android APK（Kotlin）；操作手冊 `docs/wifi-collector-guide.md`
- `rp/`——參考點清單與找點圖（`rp/sim/` 合成資料與 `public/fp/` 指紋庫為建置產物，gitignored）
- `tests/`——vitest 單元/整合測試（含 GLB parity、theme/CSS 同步防線、真機採集 fixture）
- 慣例：`docs/data-conventions.md`；描圖工具說明：`docs/tracer.md`；架構決策：`docs/adr/`
- 版本變更：`CHANGELOG.md`（自 0.2.0 起逐版記錄）
- 領域詞彙：`CONTEXT.md`。實作計畫與 spec 草稿放在 `docs/superpowers/`（本機工作區，未入 git）

## 資料信心

幾何為公開站圖描繪（每元素標 source/confidence/status），非測量資料；高度全部估計。
已知疑點見 `docs/floor-notes/`。
