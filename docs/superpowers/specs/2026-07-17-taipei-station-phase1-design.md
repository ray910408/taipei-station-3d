# 台北車站室內 3D 導航 — Phase 1 設計

版本：1.0（2026-07-17）
狀態：已與使用者逐段核可（含兩項修正：樓層語意命名、無障礙模式）

## 1. 目標與範圍

建立台北車站室內 3D 導航的第一階段資料模型與 viewer，涵蓋路徑：

> 淡水信義線月台 → 淡水信義線大廳 → 捷運與臺鐵轉乘通道 → 臺鐵指定剪票口（臺鐵穿堂局部）

**「指定剪票口」定案（2026-07-17）**：demo 終點 = **B3 淡水信義線大廳北段的臺鐵轉乘閘門**——2025.12 版北捷官方剖面圖與臺鐵 B3「轉乘層」圖佐證：B3 大廳設有臺鐵售票處與轉乘閘門，進閘後直接搭梯上臺鐵月台（複合體 B2），高鐵亦有對應轉乘區。B1 臺鐵穿堂局部與 B3→B1 長電扶梯仍在建模範圍（對應「或大廳局部」），但非 demo 主線。

**成功標準（Phase 1 完成的定義）**：

1. 四個樓層 JSON + 全站索引 + 垂直設施檔全部通過 `npm run validate`。
2. Viewer 顯示四層堆疊 3D 模型，樓層可開關/調透明度。
3. Demo 按鈕算出並畫出「R 線月台 → 臺鐵指定剪票口」路徑，含文字步驟。
4. 無障礙模式切換後，路徑改走電梯與無障礙閘門。
5. vitest 通過（graph 組裝、A*、無障礙過濾、loader 拒絕壞檔）。

**明確不做（YAGNI）**：板南線、各地下街、1F/2F、GLB 匯出（未來雙軌）、網頁描圖工具（視粗版結果再議）、完整導航 UI（起訖點選擇器）、行動裝置優化、真實 georeference。

**資料來源限制**：僅網路公開的平面圖、導覽圖、照片與影片截圖。幾何為示意等級（拓樸正確、比例近似），以 `confidence` 與 `status` 誠實標註，不假裝是測量資料。

## 2. 決策紀錄

| 決策 | 結論 | 理由 |
|---|---|---|
| 嚴謹度 | 輕量 provenance | 舊專案（`D:\taipei-station-3d`）的 provenance-first 全套規則導致大量 `geometry=null`；本次允許示意描繪與估計幾何，但每個元素必標來源與信心值 |
| 呈現管線 | three.js 直讀 JSON、執行期 extrude | 驗證 JSON 資料模型優先；穩定後再考慮雙軌輸出 GLB |
| 拆檔粒度 | 每實體樓層一檔 + station.json 索引 + connectors.json | 檔數精簡、每檔職責清楚；跨樓設施單一真相 |
| 交付範圍 | 模型 + 路徑 demo | 幾何與導航圖兩塊資料模型都要得到驗證 |
| 描圖工作流 | 先手寫粗版跑通 pipeline，後續視需要加描圖工具 | 風險最低、最快看到 3D |
| Schema 風格 | 領域專用、扁平 `[x,y]` 座標 | 手寫友善、diff 乾淨；GIS 互轉用小 script 即可 |
| 樓層命名 | 語意名 + 複合體樓層後綴，如 `tra-concourse-b1`（使用者修正） | 北捷/臺鐵/高鐵各有自己的 B 編號，`b3.json` 會產生「誰的 B3」歧義；語意+樓層雙資訊一眼可讀 |
| 無障礙 | connectors/gates 帶 `accessible`，A* 支援過濾（使用者修正） | 無障礙路徑是室內導航的基本需求 |

## 3. 座標框架

- 站內 local 座標，單位公尺（viewer 1 unit = 1 m）。
- `+X` 沿臺鐵站體長軸（約東向）、`+Y` 與之垂直（約北向）、原點取臺鐵站體中心。
- `Z` 由樓層 `elevation` 決定；所有高程目前皆為估計值（`estimated: true`），僅供疊層與視覺化，不可作工程判斷。
- `station.json` 存 `bearing_deg`（站體長軸相對真北的方位角，estimated）與原點文字描述，供未來 georeference；viewer 不使用。
- 每張參考圖在 `refs/sources.json` 記 `calibration`（pixel→local 的 scale/rotation/offset 概估與所用基準），例如以「R 線月台長約 141 m（高運量 6 節車廂）」推比例尺。

## 4. 樓層定義（語意命名）

**命名規則**：樓層 ID = `{語意名}-{複合體樓層代號}`，檔名 = `floors/{樓層 ID}.json`，兩者一致。語意名描述「這層是誰的什麼」，複合體樓層代號採官方車站配置圖的 B1–B4，雙資訊並列、一眼可讀且無歧義。

| 樓層 ID（= 檔名主體） | short | 中文名 | Phase 1 內容 |
|---|---|---|---|
| `tra-concourse-b1` | `tc` | 臺鐵穿堂層（含轉乘通道） | 臺鐵穿堂局部、指定剪票口、轉乘通道 B1 段 |
| `tra-platform-b2` | `tp` | 臺鐵/高鐵月台層 | 僅樓板與豎井開口（垂直穿越用，幾乎空檔） |
| `mrt-r-concourse-b3` | `rc` | 淡水信義線大廳層 | R 線大廳、捷運付費區界與閘門、往臺鐵電扶梯/電梯錨點 |
| `mrt-r-platform-b4` | `rp` | 淡水信義線月台層 | 島式月台、兩側軌道槽、上行梯群 |

- 樓層順序與高程以 `station.json` 為準；每層帶 `labels` 物件記錄各系統顯示標示（如 `{"complex": "B3", "trtc": "B3"}`），純顯示用，不參與任何邏輯。
- 依據使用者提供的官方「車站配置圖」：R 線月台在複合體 B4、R 線大廳在 B3、臺鐵/高鐵月台在 B2、臺鐵剪票口與穿堂在 B1。

## 5. 資料架構（唯一資料真相）

```
data/
  station.json                  全站索引：座標框架、systems、樓層清單（elevation/height/labels/file）
  floors/
    tra-concourse-b1.json
    tra-platform-b2.json
    mrt-r-concourse-b3.json
    mrt-r-platform-b4.json
  connectors.json               跨樓層垂直設施（樓梯/電扶梯/電梯）
refs/
  sources.json                  參考來源清單 + 校準參數
  <source-id>/                  參考圖檔（沿用舊專案 raw 中相關圖 + 本資料夾兩張圖）
schemas/
  station.schema.json
  floor.schema.json
  connectors.schema.json
  sources.schema.json
```

**單一真相邊界**：

- 樓層檔擁有該層的一切平面內容（slab、areas、walls、units、gates、pois、層內 nav）。
- `connectors.json` 是跨樓層 edge 的唯一來源；樓層檔不重複垂直設施，只提供被 connector 引用的 nav node。
- `refs/sources.json` 是來源資訊唯一來源；樓層元素只以字串 id 引用。
- `station.json` 是樓層清單/高程/座標框架唯一來源；樓層檔不存 elevation。

### 5.1 station.json

```json
{
  "schema": "station@1",
  "id": "taipei-main-station",
  "name": { "zh": "台北車站", "en": "Taipei Main Station" },
  "frame": {
    "units": "m",
    "origin_note": "臺鐵站體中心",
    "axis_note": "+X 沿臺鐵站體長軸約東向，+Y 約北向",
    "bearing_deg": 80,
    "bearing_status": "estimated"
  },
  "systems": {
    "trtc": { "name": { "zh": "台北捷運" }, "color": "#e3002c" },
    "tra":  { "name": { "zh": "臺鐵" },    "color": "#0070bd" }
  },
  "floors": [
    {
      "id": "tra-concourse-b1",
      "short": "tc",
      "file": "floors/tra-concourse-b1.json",
      "name": { "zh": "臺鐵穿堂層（含轉乘通道）", "en": "TRA Concourse" },
      "labels": { "complex": "B1", "trtc": "B1", "tra": "B1" },
      "elevation": -8.0,
      "height": 5.0,
      "estimated": true
    }
  ]
}
```

`floors[]` 依高程由高至低排列；`elevation`/`height` 全部 `estimated: true`（初版概估：tc -8 / tp -15 / rc -22 / rp -29，樓高 4–5 m）。

選填 `demo: {"start": "<node id>", "end": "<node id>"}`：demo 路徑起訖節點；資料未完成前可省略，viewer 據此啟用/停用 demo 按鈕。

### 5.2 樓層檔（floor@1）

除 `schema`、`id`、`slab` 必填外，其餘鍵可省略（視為空）。以 `mrt-r-concourse-b3` 為完整示例（所有元素 ID 前綴必須與該檔樓層的 short 一致）：

```json
{
  "schema": "floor@1",
  "id": "mrt-r-concourse-b3",
  "slab": {
    "outline": [[ -60.0, -20.0 ], [ 60.0, -20.0 ], [ 60.0, 20.0 ], [ -60.0, 20.0 ]],
    "holes": [ [[ -10.0, 14.0 ], [ -10.0, 18.0 ], [ -18.0, 18.0 ], [ -18.0, 14.0 ]] ],
    "source": "trtc-info-map-b3", "confidence": 3
  },
  "areas": [
    { "id": "a-rc-paid", "kind": "paid", "system": "trtc",
      "polygon": [[ -40.0, -12.0 ], [ 30.0, -12.0 ], [ 30.0, 8.0 ], [ -40.0, 8.0 ]],
      "source": "trtc-info-map-b3", "confidence": 3 },
    { "id": "a-rc-unpaid-n", "kind": "unpaid", "system": "trtc",
      "polygon": [[ -40.0, 8.0 ], [ 30.0, 8.0 ], [ 30.0, 18.0 ], [ -40.0, 18.0 ]],
      "source": "trtc-info-map-b3", "confidence": 3 }
  ],
  "walls":  [ { "id": "w-rc-1", "polyline": [[ 30.0, -12.0 ], [ 30.0, 18.0 ]],
                "height": 3.0, "width": 0.3, "source": "trtc-info-map-b3", "confidence": 2 } ],
  "units":  [ { "id": "u-rc-tvm-booth-1", "kind": "machine",
                "polygon": [[ -38.0, 10.0 ], [ -34.0, 10.0 ], [ -34.0, 11.0 ], [ -38.0, 11.0 ]],
                "height": 2.2, "source": "trtc-info-map-b3", "confidence": 2 } ],
  "gates":  [ { "id": "g-rc-out-n", "kind": "faregate", "system": "trtc", "direction": "out",
                "accessible": false, "line": [[ -6.0, 8.0 ], [ 2.0, 8.0 ]],
                "connects": [ "a-rc-paid", "a-rc-unpaid-n" ],
                "source": "trtc-info-map-b3", "confidence": 2 } ],
  "pois":   [ { "id": "p-rc-info-1", "kind": "info", "system": "trtc", "position": [ 8.0, 10.0 ],
                "name": { "zh": "詢問處" }, "source": "trtc-info-map-b3", "confidence": 2 } ],
  "nav": {
    "nodes": [ { "id": "n-rc-010", "xy": [ -2.0, 4.0 ], "area": "a-rc-paid" },
               { "id": "n-rc-011", "xy": [ -2.0, 12.0 ], "area": "a-rc-unpaid-n" } ],
    "edges": [ { "from": "n-rc-010", "to": "n-rc-011", "kind": "gate", "gate": "g-rc-out-n", "bidir": false } ]
  }
}
```

**字彙表與語意規則**：

- `areas[].kind`: `platform` | `paid` | `unpaid` | `corridor` | `track` | `restricted`
- `units[].kind`: `column` | `shop` | `room` | `machine` | `stair-void`；`height` 必填
- `walls[]`: `polyline` + `height`（必填）+ `width`（選填，預設 0.3 m）
- **gate 方向語意**：`connects` 固定寫 `[付費側 area, 非付費側 area]`；`direction: "in"` = 僅進站（非付費→付費）、`"out"` = 僅出站（付費→非付費）、`"both"` = 雙向。`kind=gate` 的 nav edge，其 from/to 節點須分別落在兩側 area，且 edge 方向必須被 gate `direction` 允許（validator 檢查）
- `pois[].kind`: `tvm` | `info` | `toilet` | `exit` | `sign`（純顯示，不參與導航）
- `nav.nodes[].area`：選填，僅供除錯與著色
- `nav.edges[].kind`: `walk` | `gate` | `platform-edge`；`kind=gate` 必須帶 `gate` 引用；`bidir` 選填預設 `true`，但 gate `direction` 非 `both` 時該 edge 必須 `bidir: false`
- 幾何規則：polygon 為開環（不重複首點）；`outline`/`polygon` 頂點逆時針、`holes` 順時針；`track` 面由 viewer 下沉 1.1 m 渲染

**provenance 欄位（所有幾何元素通用）**：`source`（必填，`refs/sources.json` 的 id）、`confidence`（必填 1–5）、`status`（選填 `estimated`|`traced`|`verified`，預設 `estimated`）、`note`（選填，記錄判讀依據或疑點）。

### 5.3 connectors.json（connectors@1）

```json
{
  "schema": "connectors@1",
  "connectors": [
    {
      "id": "c-esc-rp-rc-1",
      "kind": "escalator",
      "system": "trtc",
      "direction": "up",
      "accessible": false,
      "levels": [
        { "floor": "mrt-r-platform-b4",  "node": "n-rp-005" },
        { "floor": "mrt-r-concourse-b3", "node": "n-rc-003" }
      ],
      "source": "trtc-info-map-b4", "confidence": 3
    },
    {
      "id": "c-elv-rc-tc-1",
      "kind": "elevator",
      "system": "shared",
      "direction": "both",
      "accessible": true,
      "levels": [
        { "floor": "mrt-r-concourse-b3", "node": "n-rc-020" },
        { "floor": "tra-concourse-b1",   "node": "n-tc-008" }
      ],
      "source": "trtc-info-map-b3", "confidence": 2,
      "note": "B3 往臺鐵方向電梯，實際位置與是否直達待考證"
    }
  ]
}
```

- `kind`: `stair` | `escalator` | `elevator`；`direction`: `up` | `down` | `both`（相對 `levels` 由低至高）。
- `accessible` 必填：電梯 `true`，樓梯/電扶梯 `false`。
- `levels[].node` 必須存在於對應樓層的 `nav.nodes`；`levels` 依 elevation 由低至高排列。
- 電扶梯常成對（上/下各一筆）；穿越中間樓層（如 rc→tc 直達梯穿越 tp）就只列兩端，viewer 依高程差畫穿越量體。

### 5.4 refs/sources.json（sources@1）

```json
{
  "schema": "sources@1",
  "sources": [
    {
      "id": "trtc-info-map-b4",
      "title": "北捷台北車站 車站資訊圖 B4",
      "file": "refs/trtc-taipei-station/floor-4.jpg",
      "url": "https://…",
      "captured": "2026-07-14",
      "license_note": "北捷公開站圖，僅作描圖參考",
      "calibration": { "px_per_m": 4.2, "basis": "R線月台長 141 m 概估", "status": "estimated" }
    }
  ]
}
```

初始來源：舊專案 `data/sources/raw/` 之 `trtc-taipei-station/floor-1..4.jpg`、`station-section.jpg`、`tra-taipei-station/b1-to-2f-map.jpg`（複製進 `refs/`，沿用舊 manifest 的 URL 資訊），加上本資料夾的官方車站配置圖與 2014 立體導覽圖（立體導覽圖為第三方作品，僅作交叉比對參考，不直接描圖）。

### 5.5 ID 慣例

`{類別字母}-{floor short}-{描述}-{序號}`，全域唯一、穩定、可 grep：

- area `a-rc-paid`、wall `w-rc-1`、unit `u-tc-shop-1`、gate `g-tc-tra-s-1`、poi `p-tc-tvm-1`
- nav node `n-rp-001`（floor short 內嵌，validator 檢查前綴與所在檔一致）
- connector `c-{esc|stair|elv}-{低樓short}{高樓short}-{序號}`，如 `c-esc-rprc-1`（兩個 short 直接相連）

## 6. Viewer 架構

Vite + TypeScript + three.js，無 UI 框架。TS 介面手寫於 `src/types.ts`；結構驗證以 `schemas/*.schema.json` + ajv 為唯一權威（validator CLI 與 dev-mode loader 共用）。

| 模組 | 職責 |
|---|---|
| `src/loader.ts` | 以 Vite JSON import 載入全部資料檔（dev 與 build 皆可用、資料變更觸發熱重載）；ajv 驗證失敗顯示錯誤 overlay（含檔名與 JSON path），不白屏；組成 `StationModel` |
| `src/builder.ts` | 純函式 `StationModel → THREE.Group`：slab 以固定 0.3 m 厚薄板 extrude（含 holes）、areas 半透明染色面（paid/unpaid/corridor/platform 各色、track 下沉 1.1 m）、slab 輪廓自動生成半透明外殼立面、walls/units extrude、gates 畫閘門柱示意、connectors 依兩端 node 座標與樓層高程生成斜坡（stair/escalator）或豎井（elevator） |
| `src/nav.ts` | 合成全站有向圖：層內 edges（`bidir` 展開雙向）+ connectors 展開為跨層 edges（`direction` 決定向性）；A*（3D 歐氏 heuristic）；`accessible` 模式過濾 `accessible === false` 的 connector 與 gate edge |
| `src/path.ts` | 路徑折線 → 發光管線（TubeGeometry），跨層沿 connector 斜行；由 edge kind 序列生成文字步驟（直行/搭電扶梯上一層/出閘門/…） |
| `src/ui.ts` | 樓層開關與透明度、OrbitControls、demo 按鈕、無障礙模式 checkbox |
| `src/main.ts` | 組裝與啟動 |

**Demo 起訖**：由 `station.json` 選填欄位 `demo: {"start": "<node id>", "end": "<node id>"}` 提供（資料未完成前可省略，UI 停用按鈕）。起點 = R 線月台中段節點、終點 = B3 臺鐵轉乘閘門內側節點。一般模式走電扶梯；無障礙模式改走電梯與無障礙閘門。

## 7. 驗證與測試

**`tools/validate.mjs`（`npm run validate`，node + ajv）**：

1. Schema：四類檔案全數通過對應 JSON Schema。
2. 參照完整性：`source` id 存在；gate `connects` 的兩個 area 存在於同檔；nav edge 兩端 node 存在於同檔；connector `levels[].floor` 存在於 station.json、`levels[].node` 存在於該樓層檔；`gate` edge 引用的 gate 存在。
3. ID：全域唯一；前綴與所屬樓層 short 一致。
4. 幾何 sanity：polygon ≥ 3 點、無重複首尾點、outline/polygon 逆時針且 holes 順時針、無 NaN；nav node 落在該層 slab outline 內；座標絕對值 < 500。
5. 語意：connector `levels` 依 elevation 遞增；`accessible` 與 kind 一致性警告（elevator 應為 true、stair/escalator 應為 false）；`confidence` 1–5；gate edge 方向與 gate `direction` 相容、非 `both` 閘門的 gate edge 必須單向。

錯誤訊息一律含檔名 + JSON path + 說明。

**vitest（`npm test`）**：小型雙層 fixture（兩層、一部電梯、一組電扶梯、一道閘門）測：graph 組裝數量與向性、A* 最短路、無障礙過濾改走電梯、gate 單向阻擋反向通行、loader/validator 拒絕壞檔（缺 source、node 前綴錯、connector 引用不存在 node）。

## 8. 工作流

```
看參考圖 → 編修 data/*.json → npm run validate → viewer 熱重載目視 → 標 confidence/note → 記錄 floor-notes
```

- `docs/data-conventions.md`：ID 慣例、kind 字彙表、gate 方向語意、座標框架速查。
- `docs/floor-notes/<floor-id>.md`：每層判讀筆記——用了哪些來源、校準基準、已知疑點與待考證清單。
- 粗版順序：station.json → mrt-r-platform-b4 → mrt-r-concourse-b3 → tra-concourse-b1 → tra-platform-b2（近空檔）→ connectors → nav 補齊 → demo。

## 9. 風險與待考證事項（寫入 floor-notes 追蹤）

| 疑點 | 影響 | 粗版假設 |
|---|---|---|
| ~~B3→B1 電扶梯是否存在~~ **已解決**：官方剖面圖確認 B3↔B1/地面長電扶梯存在；B3 大廳北段設臺鐵轉乘區（售票處＋轉乘閘門直上臺鐵月台），高鐵亦同 | 轉乘動線 | 依剖面圖與臺鐵 B3 圖描繪，confidence 3；閘門精確位置 confidence 2 |
| ~~「臺鐵指定剪票口」是哪組閘門~~ **已定案**（使用者 2026-07-17）：demo 終點 = B3 臺鐵轉乘閘門；B1 穿堂剪票口仍建模但非 demo 主線 | demo 終點 | — |
| R 線月台實際尺寸與大廳輪廓比例 | 全域比例尺 | 月台長 141 m 為基準推算 |
| 無障礙動線：月台電梯 → B3 無障礙閘門 → B1 電梯鏈是否成立 | 無障礙 demo | 各層放一部估計位置電梯，confidence 2 |
| 樓層高程 | 疊層視覺 | tc -8 / tp -15 / rc -22 / rp -29 m，全部 estimated |

## 10. Repo 佈局（目標狀態）

```
D:\taipei-station-3d-2\
  data\  refs\  schemas\  docs\
  src\           (viewer TS 模組)
  tools\validate.mjs
  tests\         (vitest + fixtures)
  index.html  package.json  vite.config.ts  tsconfig.json  .gitignore  README.md
```
