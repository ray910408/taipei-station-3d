# 台北車站室內 3D 導航（Phase 1）

樓層 JSON 為唯一資料真相的室內 3D 導航實驗。
Phase 1 範圍：淡水信義線月台(B4) → R 線大廳(B3) → 臺鐵轉乘閘門（demo 終點），
含 B1 臺鐵穿堂局部、B2 月台層脈絡與無障礙路徑模式。

## 指令

- `npm run dev`——viewer（Vite dev server，資料熱重載）
- `npm run validate`——資料驗證（schema/參照/幾何/語意）
- `npm test`——單元與整合測試；`npm run typecheck`——TS 檢查

## 目錄

- `data/`——樓層 JSON（唯一真相）：station 索引、floors/ 每樓一檔、connectors 垂直設施
- `schemas/`——JSON Schema（draft 2020-12）；`tools/validate.mjs` 驗證器
- `refs/`——參考圖與來源清單（sources.json）；`docs/floor-notes/`——各層判讀筆記
- `src/`——viewer（three.js）：loader / builder / nav / path / ui / main
- 設計 spec：`docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md`
- 實作計畫：`docs/superpowers/plans/2026-07-17-taipei-station-phase1.md`

## 資料信心

幾何為公開示意圖描繪（confidence 1–5 標註於每個元素），非測量資料；
高程全部估計。已知疑點見 `docs/floor-notes/`。
