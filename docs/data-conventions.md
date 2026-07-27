# 資料慣例速查

## 座標框架
- 站內 local 公尺；+X 沿臺鐵站體長軸約東向、+Y 約北向、原點站體中心；|x|,|y| < 500。
- three.js 對映：`toWorld([x,y], elev) = (x, elev, −y)`。
- R 線站體長軸約 N20°E：`u=(0.342,0.940)`、`p=(0.940,−0.342)`；沿線點 = `center + u·t + p·s`。

## ID 慣例
| 類別 | 格式 | 例 |
|---|---|---|
| area | `a-{short}-…` | `a-rc-paid` |
| wall / unit / gate / poi | `w- / u- / g- / p-{short}-…` | `g-rc-tra-in` |
| nav node | `n-{short}-{三位數}` | `n-rp-003` |
| connector | `c-{esc|stair|elv}-{低short}{高short}-{n}` | `c-esc-rprc-1` |

短碼：tc=臺鐵穿堂層(B1)、tp=臺鐵月台層(B2)、rc=R線大廳層(B3)、rp=R線月台層(B4)。

## 語意規則
- polygon 開環；outline/polygon 逆時針、holes 順時針。
- gate `connects = [付費側, 非付費側]`；`in`=僅進、`out`=僅出、`both`=雙向；非 both 的 gate edge 必須 `bidir:false`。
- 每個幾何元素必填 `source` + `confidence`；不確定就 confidence 2 並寫 `note`。
- 任何資料變更後：`npm run validate`。

## Phase 2 增補慣例

- **status**：經校準底圖以 tracer 重描 → `"traced"`（來源必須有 calibration，validator 警告把關）；
  推測/未重描 → 維持 estimated（不標）。verified 保留給實測。
- **confidence**：官方圖清晰描繪＝3、判讀含糊＝2；1 不用、4–5 留給實測。
- **calibration**（refs/sources.json）：`control_points` 兩點為真相（px 整數、local 0.1m），
  `px_per_m` 為推導值（validator 檢查 2% 一致性）、`status` 一律 estimated、`basis` 寫控制點錨到什麼。
- **序列化**：資料檔唯一格式＝`npm run format:data`（純數字陣列單行）；改資料後必跑，
  QA 用 `npm run format:data -- --check`。
- **viewer 幾何單軌**：viewer 一律 runtime extrude（`buildStationGroup`），資料改動即時反映。
  原本另有 `?geom=glb` 載入軌，已移除——產物 gitignored、CI 從不匯出，部署站上必然
  載入失敗，代價卻是 GLTFLoader 常駐 bundle（約 84 kB raw / 23 kB gzip）。
- **GLB 匯出（單向，給外部工具用）**：`npm run export:glb` 產 `public/models/station.glb`
  （gitignored 建置產物），`npm run validate:glb` 跑 Khronos 規格檢查。用途是把站體幾何
  帶進 Blender 等外部工具當底模，**不會被 viewer 載回**。匯出保真度（樓層節點名、材質槽數、
  bounding box、userData）由 `tests/glb-roundtrip.test.ts` 守住。資料改動後記得重新匯出，
  GLB 不會自動更新。
  註：邊線用的 `LineBasicMaterial`／`LineDashedMaterial` 在 glTF 沒有對應，匯出時
  GLTFExporter 會出提示；帶進 Blender 後那些描邊不會保留原樣。

## Phase 3 增補慣例

- **nav node `name`**：選用欄位 `{ zh, en? }`——起訖選擇清單只列具名節點（`listLandmarks`），
  命名格式「地點（限定語）」如「臺鐵第4月台（候車）」。
- **跟隨模式**：位置推進唯一入口＝`follow.ts` 的 `advance()`；之後的定位技術（PDR 等）掛同一介面，
  不另開推進路徑。樓層聚焦 `setFloorEmphasis` 首次調整前 clone material——material 可能跨 mesh
  共用（POI sprite 每 kind 一份，見 `icons.ts` 的 `matCache`），不 clone 就會把調暗洩漏到其他樓層；
  由 tests/follow-emphasis.test.ts 守住。

## Phase 4／5 增補慣例

- **視覺單一真源**：3D 材質、光影、體塊語言與 UI CSS vars 全部由 `src/theme.ts` 的 `THEME` 驅動，
  不在各模組寫死色值。`palette.ts` 退居 tracer(2D) 編輯配色專用，兩者不互相引用。
  `index.html` 的 `:root` fallback（防 first-paint 閃色）必須與 `THEME.ui` 字面同步，
  由 tests/theme-css-sync.test.ts 守住——改 `THEME.ui` 就要同步改 `:root`。
- **POI**：`kind` 限 `tvm｜info｜toilet｜exit｜sign` 五種；`position` 為所在樓層 local 座標，
  慣例錨定鄰近 nav node（`note` 寫明錨到哪個節點與相對距離／付費側），讓圖示落點可追溯、可複驗。
  圖示由 `icons.ts` 以 canvas 繪製官方站內設施圖例語言（深色圓角方塊＋白 pictogram、
  出口為白底藍圈），零外部資產——新增 kind 要同步補 `PoiKind` 與 `drawIcon` 分支。
  現況為每層 3 筆示範集（confidence 2），非完整盤點。

## WiFi 指紋增補慣例

- **資料流**：`gen:rp` 產參考點 → APK 現場採集（`wifi-fp@1` JSONL）→ `build:fp` 清洗建庫
  （`fp-db@1` JSON）→ 定位引擎載入。每段吃前一段的 schema，中間不改格式；
  原始 JSONL **永不修改**，所有清洗都在 pipeline 內做。
- **`fp-db@1` 形狀**：每站一個靜態 JSON，前端整包載入、不建後端（702 點實測 393 KB／gzip 64 KB）。
  頂層 `{ schema, station, generated, sourceSessions[], magNorthOffsetDeg, anchors, excluded, floors }`；
  `floors[樓層].rps[]` 每點帶 `aps{ 錨點id → [mean, std, detectRate, n] }` 與 `mag`，每點取 Top-15。
  預設輸出 `public/fp/<station>.json`（gitignored 建置產物，比照 `public/models/`）。
- **錨點（anchor）**：定義見 `CONTEXT.md`，為什麼這樣定義見 `docs/adr/0001`。
  合併判準是**代理指標而非定義**，且已知不完整——`tests/fp-real.test.ts` 有標記【已知缺口】的
  特徵測試主動追蹤，看到它斷言「目前未合併」時不要當 bug 順手修掉。
- **清洗門檻全部 exported**：`tools/fp-build.ts` 的 `SHORT_SCAN_RATIO`／`ROT_AXIS_STD`／
  `ROT_AXIS_RATIO`／`MAGSTD_SPLIT`／`MIN_MAG_ACCURACY`／`TOP_K` 等常數是真機資料進來後的調參旋鈕，
  調參改常數、不改邏輯。其中轉動判別與 APK 的 `magQuality()` 是同一條判別式，兩邊要一起改。
- **模擬器只驗程式**：`sim:fp` 產的合成資料用來證明「pipeline 正確、演算法收斂」，
  **不預測北車真實誤差**（合成誤差必偏樂觀）。真機回歸靠 `tests/fixtures/real-home/`。
