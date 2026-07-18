# 台北車站室內 3D 導航

樓層 JSON 為唯一資料真相的室內 3D 導航實驗。
範圍：淡水信義線月台(B4) → R 線大廳(B3) → 臺鐵轉乘閘門（demo 終點），
含 B1 臺鐵穿堂局部、B2 月台層脈絡與無障礙路徑模式。
Phase 2 起幾何以描圖工具對校準官方站圖重描（status=traced），並支援 GLB 雙軌輸出。

## 指令

- `npm run dev`——viewer（`/`）與描圖工具（`/tracer.html`），資料熱重載
- `npm run validate`——資料驗證（schema/參照/幾何/語意/校準一致性）
- `npm run format:data`——資料檔 canonical 排版（`-- --check` 為檢查模式）
- `npm run export:glb`——離線匯出 `public/models/station.glb`；`npm run validate:glb`——Khronos 驗證
- `npm test`——單元/整合/GLB parity 測試；`npm run typecheck`——TS 檢查

## 目錄

- `data/`——樓層 JSON（唯一真相）：station 索引、floors/ 每樓一檔、connectors 垂直設施
- `schemas/`——JSON Schema；`tools/`——validate / format-data / save-handler / export-glb
- `refs/`——參考圖與來源清單（含描圖校準）；`docs/floor-notes/`——各層判讀筆記
- `src/`——viewer（three.js，`?geom=glb` 切換 GLB 軌）；`src/tracer/`——描圖工具
- 慣例：`docs/data-conventions.md`；描圖工具說明：`docs/tracer.md`
- 設計 spec：`docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md`
- 實作計畫：`docs/superpowers/plans/`（Phase 1、Phase 2）

## 資料信心

幾何為公開站圖描繪（每元素標 source/confidence/status），非測量資料；高程全部估計。
已知疑點見 `docs/floor-notes/`。
