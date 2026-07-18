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
