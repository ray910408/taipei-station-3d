# 資料慣例速查

## 座標框架
- 站內 local 公尺；+X 沿臺鐵站體長軸約東向、+Y 約北向、原點站體中心；|x|,|y| < 500。
- three.js 對映：`toWorld([x,y], elev) = (x, elev, −y)`。
- R 線站體長軸約 N20°E：`u=(0.342,0.940)`、`p=(0.940,−0.342)`；沿線點 = `center + u·t + p·s`。

### 方位角：核對過，但 `bearing_status` 仍是 `estimated`
`local +Y = 真北` 已用北捷開放資料 `trtc-od-exit-coords` 核對過，**假設未被推翻，但沒有升級**——
這份資料的解析度不夠。模型 `a-rp-platform` 主軸距 local +Y 為 17.5°，而實際 R 線在台北車站的
切線由兩段半弦估得 N14.8°（台大醫院→台北車站）與 N21.0°（台北車站→中山），平均 N17.9°
→ local +Y 與真北差 **0.4°**。

誤差來自參考點本身：`exit-coords.csv` 只有出入口座標，**站的「位置」只能取出口重心，而重心不是
軌道上的點**。各站出口離散度 RMS 台北車站 129 m（8 個出口）、台大醫院 105 m（4 個）、中山 85 m（6 個），
除以 √出口數得各站重心標準誤 **45.6／52.5／34.7 m**；一條弦有兩端，兩端合成後的端點不確定度是
69.5 m（台大醫院→台北車站，552 m）與 57.3 m（台北車站→中山，701 m），換算成角度即 ±7.2°／±4.7°。

兩條半弦**共用台北車站這個端點**，而它在兩式中以相反符號進入（δθ₁=(b⊥−a⊥)/L₁、δθ₂=(c⊥−b⊥)/L₂），
所以平均值的變異數是 ¼[σ²ₐ/L₁² + σ²_b(1/L₁−1/L₂)² + σ²_c/L₂²]，得 **±3.1°**——
把兩條當獨立來平均會算成 ±4.3°，那是高估。**結論：local +Y 與真北差 0.4°±3.1°（僅隨機項）。**

護欄容差仍取 6°，多出來的餘裕留給**沒被這條式子涵蓋的系統性偏差**：台北車站（BL12/R10）與
中山（R11/G14）都是轉乘站，出口分佈涵蓋兩條線的站體，重心會被非 R 線那半邊拉走，
而 CSV 沒有逐出口的線別可供拆分——那部分不是隨機誤差，開不出標準差。長基線的弦
（台大醫院→雙連 14.0°／1793 m、台大醫院→民權西路 8.8°／2307 m）SE 較小，
但 R 線本身有曲率，弦不等於台北車站處的切線。

結論：這條路能證明的是「0° 附近，隨機項 ±3.1° 再加一段開不出標準差的系統性偏差」，不足以宣告實測，所以 `bearing_status` 維持 `estimated`。
由 `tests/frame-bearing.test.ts` 當一致性護欄——容差就取參考值本身的解析度，不是精度宣稱。

**但這已經足夠說「不要拿底圖的指北針來轉模型」。** trtc 系列四張圖的指北針主軸量得 12.3–14.3°，
以出入口 GPS 對 floor-1 做相似變換也得 14.7°（RMS 23.6 m，留一法 sd 1.0°）——兩者一致但**不獨立**，
共用同一份底圖的繪製偏差，也就是 `docs/floor-notes/mrt-r-platform-b4.md` 早就記下的
「底圖北方偏 local 北方約 6.5°」。照它轉，月台會變成 N24–26°E，落在上面估計的 1.5–1.9σ 外緣，
且與長基線弦（8.8–14.0°）的走勢相反。底圖是示意圖，用來描相對形狀就好。

### 樓層標高：`trtc-section` 幫不上忙
`station.json` 各層 `elevation`/`height` 仍是 `estimated: true`，而且**這份公開資料無法升級它**：
剖面圖自己標「本示意圖僅供參考」，圖上沒有任何尺寸標註，樓板線間距量得
258/241/262/239 px（近等距、±5%），純粹是版面節奏而非實際層高。
該圖能佐證的只有樓層順序、各系統所在層、以及電梯編號的垂直跨距。要升級標高需要另尋來源（實測或工程圖）。

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
