# 板南線終審 findings 修復報告

- 分支：`feat/bannan-line-expansion`（未切換）
- 範圍：F-1 路線驗收強化、F-2 電梯6豎井對齊與不變式、F-3 三筆 POI confidence 修正

## F-1：票務與無障礙鏈驗收

### RED

先加入精確樓層序列、`g-bc-link-*` 閘門與兩條 `accessibleOnly` 圖手術驗收，再暫時把 `without` 改成不剔除任何邊：

```text
npx.cmd vitest run tests/route.integration.test.ts
F1_MUTATION_EXIT=1
Tests  2 failed | 12 passed (14)

判準2b：g-bc-link-* 斷言 expected false to be true
判準3a：c-elv-bctc-1 斷言 expected false to be true
```

隨即還原 `without((e) => !pred(e))`。判準1改用 `toEqual` 的四層 literal，因此任何漏層、增層或次序改變都會失敗；原本僅 `toContain` 無法攔截。判準3b同理直接鎖 `c-elv-rpbc-1` 與 `c-elv-bpbc-1`，不接受 B1 鏈混過。

### GREEN

```text
npx.cmd vitest run tests/route.integration.test.ts tests/connectors.test.ts
Test Files  2 passed (2)
Tests       17 passed (17)
```

保留無閘門斷言與原 `n-rp-002` 起點案；`n-tp-001 → 板南線月台（往頂埔）` 分成封 B3 鏈必走 B1、封 B1 鏈必走 B3 兩案。

## F-2：電梯6豎井對齊

### RED

先新增五座指定電梯相鄰停靠 XY 差必須為 `[0, 0]` 的資料不變式，未改資料時：

```text
npx.cmd vitest run tests/route.integration.test.ts tests/connectors.test.ts
TEST_FIRST_EXIT=1
Tests  1 failed | 16 passed (17)

c-elv-bpbc-1: expected [-0.4000000000000057, 9.5] to deeply equal [0, 0]
```

### GREEN

- 新增 `n-bc-019`：`xy: [71.9, -147]`、`area: a-bc-paid`。
- 新增 `n-bc-019 → n-bc-003` walk 邊。
- `c-elv-bpbc-1` 的 `mrt-bl-concourse-b2` 停靠改指 `n-bc-019`。
- 指定五座電梯不變式已納入上述 targeted GREEN。

## F-3：POI confidence

### RED

基準資料的 `p-bc-info-2`、`p-bc-info-3`、`p-bc-sign-bl` 均為 `confidence: 3`，與 spec 裁定不符。

### GREEN

三筆均改為 `confidence: 2`；資料驗證與格式檢查皆通過。

## 全套驗證

```text
npx.cmd vitest run tests/route.integration.test.ts tests/connectors.test.ts
  2 files passed；17 tests passed

npm.cmd test
  68 files passed；456 tests passed；0 failed；0 skipped

npm.cmd run validate
  validate: 0 errors, 0 warnings

npm.cmd run format:data
  format-data: 0 檔已重排，共 9 檔

npm.cmd run format:data -- --check
  format-data: 0 檔需重排，共 9 檔

npx.cmd tsc --noEmit
  exit 0

git diff --check
  exit 0
```

`npm.cmd test` 仍輸出既有 Three.js `map is undefined` 與 GLTFExporter material 建議訊息，但沒有 test failure 或 skip。
