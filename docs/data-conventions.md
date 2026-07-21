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
- **GLB 雙軌**：`npm run export:glb` 產 `public/models/station.glb`（gitignored 建置產物），
  `npm run validate:glb` 跑 Khronos 驗證；viewer `?geom=glb` 載入。雙軌契約＝group name（樓層開關）
  與 userData.kind（透明度）經 extras 保留，由 tests/glb-roundtrip.test.ts 守住。
  資料改動後記得重新 export，GLB 不會自動更新。

## Phase 3 增補慣例

- **nav node `name`**：選用欄位 `{ zh, en? }`——起訖選擇清單只列具名節點（`listLandmarks`），
  命名格式「地點（限定語）」如「臺鐵第4月台（候車）」。
- **跟隨模式**：位置推進唯一入口＝`follow.ts` 的 `advance()`；之後的定位技術（PDR 等）掛同一介面，
  不另開推進路徑。樓層聚焦 `setFloorEmphasis` 首次調整前 clone material（GLB 軌 material 可能共用），
  由 tests/follow-emphasis.test.ts 守住不洩漏。

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
