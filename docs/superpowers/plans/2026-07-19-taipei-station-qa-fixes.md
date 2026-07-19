# QA 修復（2026-07-19 qa-only 報告）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修復 `.gstack/qa-reports/qa-report-localhost-5173-2026-07-19.md` 的 5 個 ISSUE 與 2 個 minor：同起訖防呆、B4 月台繞層（資料鏈序＋轉乘懲罰）、手機跟隨面板、電梯方向文字、B1 出站閘門、B1↔B2 直達設施。

**Architecture:** 資料是唯一真相——拓撲錯修 `data/`，定價錯修 `src/nav.ts` 的 `buildGraph`，UI 問題修 `index.html`/`src/main.ts`。每個 task 先寫紅測試再改，資料改動必過 `npm run validate`。

**Tech Stack:** Vite 6 + three.js 0.180 + TypeScript（vanilla，無框架）、vitest 3、資料為 JSON（schema 驗證 ajv）。

## Global Constraints

- 資料為唯一真相；新增幾何/設施必附 provenance：`source`（須存在於 `refs/sources.json`）、`confidence`（1-5）、`status`（可選：estimated/traced/verified）。
- id 慣例：nav node `n-<floor.short>-NNN`（validate 強制前綴）、connector `c-<esc|stair|elv>-<低樓層短碼><高樓層短碼>-N`、gate `g-<short>-...`。
- connector `levels` 依樓層高程**嚴格遞增**排列（低→高），validate 強制。
- 資料檔改動後必跑 `npm run validate`（預期 `validate: 0 errors`）與 `npm run format:data`（canonical 排版）。
- 每個 task 結束前：`npm test`（vitest run，全綠）＋`npm run typecheck`（exit 0）才 commit。
- UI 文案一律繁體中文。dev server：`npm run dev` → http://localhost:5173。
- 不做本計畫範圍外的重構或格式變動；diff 最小化。

**現況基準（修改前，供對照）**：`main` @ 8ae7df1，95 tests / 16 檔全綠，validate 0 errors。

---

### Task 1: 同起訖防呆（ISSUE-001）

**Files:**
- Modify: `src/main.ts:121-124`（`onRoute` 回呼）
- Test: `tests/nav.test.ts`（`findPath` describe 區塊內追加）

**Interfaces:**
- Consumes: `findPath(graph, start, goal, opts)`（`src/nav.ts`）——start===goal 時回傳 `[]`（空陣列，非 null）。此為既有行為，本 task 用測試鎖定。
- Produces: 無新 API。`onRoute` 行為變更：同起訖時顯示訊息、不進入路線計算。

- [ ] **Step 1: 在 `tests/nav.test.ts` 的 `describe('findPath', ...)` 內追加契約測試**

```ts
  it('起訖同點回傳空陣列（非 null）——main.ts 防呆依賴此契約', () => {
    expect(findPath(graph, 'n-pl-001', 'n-pl-001')).toEqual([]);
  });
```

- [ ] **Step 2: 跑測試確認契約成立（characterization test，預期直接綠）**

Run: `npx vitest run tests/nav.test.ts`
Expected: PASS（此測試鎖定既有行為，防止未來把 `[]` 改成 `null` 時默默破壞防呆）

- [ ] **Step 3: 修改 `src/main.ts` 的 `onRoute`，在 `clearRoute()` 之後加 guard**

原始碼（修改前）：

```ts
    onRoute: (start, end, accessibleOnly) => {
      clearRoute();
      const path = findPath(graph, start, end, { accessibleOnly });
```

改為：

```ts
    onRoute: (start, end, accessibleOnly) => {
      clearRoute();
      if (start === end) {
        ui.setSteps(['起點與終點相同，請選擇不同地標']);
        ui.setFollowReady(false);
        return;
      }
      const path = findPath(graph, start, end, { accessibleOnly });
```

（訊息走既有 `setSteps` 通道，與「找不到路徑」同機制，不新增 UI 元素。）

- [ ] **Step 4: 全套測試＋型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全綠（96 tests）、tsc exit 0

- [ ] **Step 5: 瀏覽器手動驗證**

`npm run dev` → http://localhost:5173 → 起點與終點都選「淡水信義線月台（中段）」→ 按「一般路徑」。
Expected: 步驟區顯示「起點與終點相同，請選擇不同地標」；「開始導航」維持 disabled。「無障礙路徑」同。

- [ ] **Step 6: Commit**

```bash
git add src/main.ts tests/nav.test.ts
git commit -m "fix: 同起訖顯示提示訊息——findPath 空陣列不再靜默通過（QA ISSUE-001）"
```

---

### Task 2: B4 月台鏈序修正＋同樓層回歸測試（ISSUE-002 上半）

**Files:**
- Modify: `data/floors/mrt-r-platform-b4.json:170-196`（`nav.edges`）
- Create: `tests/route.samefloor.test.ts`

**Interfaces:**
- Consumes: `assembleModel`（`src/loader.ts`）、`buildGraph`/`findPath`/`listLandmarks` 與型別 `GraphEdge`、`NavGraph`（`src/nav.ts`）。
- Produces: `tests/route.samefloor.test.ts` 內部 helper `pathFloors(edges: GraphEdge[]): string[]`（路線經過的樓層序列，去重相鄰）與 `intraFloorReachable(g, start, goal, accOnly): boolean`——僅供本測試檔使用。資料層面：B4 walk 鏈變為幾何單調的 002-001-003-004-005。

**背景（一行）**：n-rp-002（南端電梯節點, y=-81.4）在 n-rp-001（南端候車, y=-60.6）更南側，現行鏈 001→002→003 逼路徑南折回頭（資料 95.0m vs 幾何 47.4m），使繞 B3 的垂直繞路（122.4m）勝過月台直走（156.0m）。

- [ ] **Step 1: 建立 `tests/route.samefloor.test.ts`（先紅）**

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, listLandmarks } from '../src/nav';
import type { GraphEdge, NavGraph } from '../src/nav';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(stationDoc, {
  'floors/tra-concourse-b1.json': tc,
  'floors/tra-platform-b2.json': tp,
  'floors/mrt-r-concourse-b3.json': rc,
  'floors/mrt-r-platform-b4.json': rp,
}, connectorsDoc);
const graph = buildGraph(model);

const floorOf = (id: string): string => graph.nodes.get(id)!.floor;

/** 路線經過的樓層序列（相鄰去重）。 */
function pathFloors(edges: GraphEdge[]): string[] {
  const seq = [floorOf(edges[0].from)];
  for (const e of edges) {
    const f = floorOf(e.to);
    if (f !== seq[seq.length - 1]) seq.push(f);
  }
  return seq;
}

/** 只走同樓層邊（依模式過濾 accessible）能否從 start 到 goal。 */
function intraFloorReachable(g: NavGraph, start: string, goal: string, accOnly: boolean): boolean {
  const floor = floorOf(start);
  if (floorOf(goal) !== floor) return false;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goal) return true;
    for (const e of g.adj.get(cur) ?? []) {
      if (accOnly && !e.accessible) continue;
      if (floorOf(e.to) !== floor || seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return false;
}

describe('同樓層路線不繞別層（QA ISSUE-002 回歸）', () => {
  it('淡水信義線月台 南端→北端 全程停留 B4', () => {
    const path = findPath(graph, 'n-rp-001', 'n-rp-005')!;
    expect(pathFloors(path)).toEqual(['mrt-r-platform-b4']);
  });

  it('淡水信義線月台 南端→中段 全程停留 B4', () => {
    const path = findPath(graph, 'n-rp-001', 'n-rp-003')!;
    expect(pathFloors(path)).toEqual(['mrt-r-platform-b4']);
  });

  it('窮舉：所有同層可達的地標對，路線不得離層（兩種模式）', () => {
    const lms = listLandmarks(model);
    for (const a of lms) {
      for (const b of lms) {
        if (a.id === b.id) continue;
        for (const accessibleOnly of [false, true]) {
          if (!intraFloorReachable(graph, a.id, b.id, accessibleOnly)) continue;
          const path = findPath(graph, a.id, b.id, { accessibleOnly });
          expect(path, `${a.label}→${b.label} acc=${accessibleOnly}`).not.toBeNull();
          expect(pathFloors(path!), `${a.label}→${b.label} acc=${accessibleOnly}`).toEqual([a.floor]);
        }
      }
    }
  });
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/route.samefloor.test.ts`
Expected: FAIL——「南端→北端」「南端→中段」與窮舉皆因樓層序列含 `mrt-r-concourse-b3` 而紅。

- [ ] **Step 3: 修正 `data/floors/mrt-r-platform-b4.json` 的 `nav.edges`**

把 edges 陣列（原 5 條）改為（僅前兩條變動：`001→002`、`002→003` 換成 `002→001`、`001→003`）：

```json
    "edges": [
      {
        "from": "n-rp-002",
        "to": "n-rp-001",
        "kind": "walk"
      },
      {
        "from": "n-rp-001",
        "to": "n-rp-003",
        "kind": "walk"
      },
      {
        "from": "n-rp-003",
        "to": "n-rp-004",
        "kind": "walk"
      },
      {
        "from": "n-rp-004",
        "to": "n-rp-005",
        "kind": "walk"
      },
      {
        "from": "n-rp-003",
        "to": "n-rp-006",
        "kind": "walk"
      }
    ]
```

（walk 邊 `bidir` 預設 true，from/to 順序只影響可讀性；002 仍經 001 連通全鏈。）

- [ ] **Step 4: 資料驗證＋排版**

Run: `npm run validate && npm run format:data`
Expected: `validate: 0 errors`；format 無 diff 或僅排版正規化

- [ ] **Step 5: 跑測試確認綠**

Run: `npx vitest run tests/route.samefloor.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: 全套測試＋型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全綠、tsc exit 0

- [ ] **Step 7: Commit**

```bash
git add data/floors/mrt-r-platform-b4.json tests/route.samefloor.test.ts
git commit -m "fix: B4 月台 walk 鏈依幾何序重排 002-001-003——南端不再南折回頭（QA ISSUE-002）"
```

---

### Task 3: 垂直設施轉乘懲罰（ISSUE-002 下半）

**Files:**
- Modify: `src/nav.ts:51-64`（`buildGraph` 的 connector 迴圈）
- Test: `tests/nav.test.ts`（`describe('buildGraph', ...)` 內追加）

**Interfaces:**
- Consumes: mini fixture 幾何——`c-esc-plha-1`：n-pl-001 [-5,0] z=-9 → n-ha-001 [-5,0] z=-4（dist3=5.0，純高差）；`c-elv-plha-1`：n-pl-002 [0,0] z=-9 → n-ha-003 [-5,3] z=-4（dist3=√59）。
- Produces: `GraphEdge.length` 語意變更——**connector 邊 = 幾何長＋懲罰常數**；walk/gate/platform-edge 邊不變（`routeSteps` 的「步行約 X 公尺」只累計 walk 類，不受影響）。`TRANSFER_PENALTY` 為 nav.ts 模組私有常數，不匯出。

**背景（一行）**：connector 上下節點多為同 xy，垂直邊只計高差（電扶梯 7m），零轉乘成本讓「上樓再下樓」被定價成比 156m 月台直走便宜；懲罰為公尺當量的等待＋轉乘體感成本。

- [ ] **Step 1: 在 `tests/nav.test.ts` 的 `describe('buildGraph', ...)` 內追加測試（先紅）**

```ts
  it('垂直邊含轉乘懲罰（電扶梯 +20、電梯 +40 公尺當量）', () => {
    const esc = (graph.adj.get('n-pl-001') ?? []).find((e) => e.kind === 'escalator')!;
    expect(esc.length).toBeCloseTo(5 + 20, 6); // 幾何長 = 高差 5
    const elv = (graph.adj.get('n-pl-002') ?? []).find((e) => e.kind === 'elevator')!;
    expect(elv.length).toBeCloseTo(Math.hypot(5, 3, 5) + 40, 6);
  });
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/nav.test.ts`
Expected: FAIL——`esc.length` 為 5（無懲罰）

- [ ] **Step 3: 修改 `src/nav.ts`**

在 `const dist3 = ...`（第 11-12 行）之後加入：

```ts
// 垂直設施轉乘懲罰（公尺當量）：等待＋轉乘體感成本。
// 若無此項，connector 上下節點同 xy 時垂直邊只計高差，
// 「上樓再下樓」會被定價成比月台直走便宜（QA ISSUE-002）。
// 電扶梯 < 樓梯 符合乘客偏好；電梯含候梯時間最高。stair 走 connector 迴圈同一路徑。
const TRANSFER_PENALTY: Record<'stair' | 'escalator' | 'elevator', number> = {
  escalator: 20,
  stair: 25,
  elevator: 40,
};
```

connector 迴圈中（原第 58-60 行）：

```ts
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: c.kind, accessible: c.accessible, length: dist3(a, b), connector: c.id,
      };
```

改為：

```ts
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: c.kind,
        accessible: c.accessible,
        length: dist3(a, b) + TRANSFER_PENALTY[c.kind],
        connector: c.id,
      };
```

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run tests/nav.test.ts tests/route.samefloor.test.ts tests/route.integration.test.ts`
Expected: 全 PASS。注意：demo 一般路徑的 B3→B2 段會從樓梯改選電扶梯（懲罰 20 < 25 打破原本同錨點平手），integration 測試只斷言 gate 數與 rctp connector 存在，不受影響。

- [ ] **Step 5: 全套測試＋型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全綠、tsc exit 0

- [ ] **Step 6: 瀏覽器抽驗**

http://localhost:5173 → 南端→北端「一般路徑」。
Expected: 步驟為單一「步行約 108 公尺」（全程 B4，無電扶梯步驟）。

- [ ] **Step 7: Commit**

```bash
git add src/nav.ts tests/nav.test.ts
git commit -m "fix: buildGraph 垂直邊加轉乘懲罰（電扶梯20/樓梯25/電梯40 公尺當量）（QA ISSUE-002）"
```

---

### Task 4: 跟隨面板置頂＋aria-live（ISSUE-005＋M2）

**Files:**
- Modify: `index.html:60-66`（`#follow-panel` 區塊搬移＋屬性）

**Interfaces:**
- Consumes: `src/ui.ts` 以 `document.querySelector('#follow-panel')` 等 id 取元素——**搬移不改 id**，JS 零改動。
- Produces: DOM 順序變更：`#follow-panel` 移至 `<h1>` 之後。非跟隨時 `display:none`，桌面版版面無感。

**背景（一行）**：375x812 下面板是 48vh 底部抽屜，`#follow-panel` 排在樓層勾選/起訖選單之後，導航中最高頻的「我到了」落在摺疊線下，每按一次都要先捲動。

- [ ] **Step 1: 搬移 `#follow-panel` 並加 aria-live**

把這段（原 `index.html:60-66`）：

```html
    <div id="follow-panel" style="display:none">
      <div id="follow-next"></div>
      <div id="follow-progress"></div>
      <button id="btn-advance">我到了</button>
      <button id="btn-back">上一步</button>
      <button id="btn-exit-follow">結束導航</button>
    </div>
```

整塊刪除，改插到 `<h1>台北車站室內 3D 導航</h1>` 的下一行，並在容器加 `aria-live`：

```html
  <div id="panel">
    <h1>台北車站室內 3D 導航</h1>
    <div id="follow-panel" style="display:none" aria-live="polite">
      <div id="follow-next"></div>
      <div id="follow-progress"></div>
      <button id="btn-advance">我到了</button>
      <button id="btn-back">上一步</button>
      <button id="btn-exit-follow">結束導航</button>
    </div>
```

（單一 live region 容器：每次 `advance` 只播報變動的文字節點，避免 next/progress 各掛一個造成雙重播報。）

- [ ] **Step 2: 全套測試（確認無 DOM 相依測試被打破）**

Run: `npm test && npm run typecheck`
Expected: 全綠（現有測試不掛 index.html，此步是保險）

- [ ] **Step 3: 瀏覽器驗證——手機視口**

http://localhost:5173 → DevTools 裝置模擬 375x812 → 選「中段」→「臺鐵第4月台（候車）」→ 一般路徑 → 開始導航。
在 DevTools console 執行：

```js
(() => { const r = document.querySelector('#btn-advance').getBoundingClientRect();
  return r.top >= 0 && r.bottom <= innerHeight; })()
```

Expected: `true`（「我到了」「下一步」「節點 x/y」不捲動即可見）

- [ ] **Step 4: 瀏覽器驗證——桌面視口**

1280x800：開始導航後跟隨面板顯示於面板頂部、其餘控件如常；結束導航後版面還原。
Expected: 無跑版；`document.querySelector('#follow-panel').getAttribute('aria-live')` 回傳 `"polite"`。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "fix: 跟隨面板移至面板頂並加 aria-live——手機導航主鈕不再摺疊、讀屏可播報（QA ISSUE-005/M2）"
```

---

### Task 5: 電梯步驟補方向文字（M1）

**Files:**
- Modify: `src/nav.ts:140`（`routeSteps` 電梯分支）
- Test: `tests/nav.test.ts:73`、`tests/route.integration.test.ts:57`（期望字串更新）

**Interfaces:**
- Consumes: `routeSteps` 既有 `goingUp = dest.z > src.z` 判斷（電扶梯/樓梯已在用）。
- Produces: 電梯步驟文字格式變更：`搭電梯至「X」` → `搭電梯上至「X」`／`搭電梯下至「X」`。所有斷言此字串的測試須同步。

- [ ] **Step 1: 先更新兩處測試期望（先紅）**

`tests/nav.test.ts:73`：`'搭電梯至「測試大廳」'` → `'搭電梯上至「測試大廳」'`
`tests/route.integration.test.ts:57`：`s.includes('搭電梯至「臺鐵/高鐵月台層」')` → `s.includes('搭電梯上至「臺鐵/高鐵月台層」')`

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/nav.test.ts tests/route.integration.test.ts`
Expected: FAIL ×2（實作仍輸出無方向版本）

- [ ] **Step 3: 修改 `src/nav.ts:140`**

```ts
      else steps.push(`搭電梯${goingUp ? '上' : '下'}至「${name}」`);
```

（原：`` else steps.push(`搭電梯至「${name}」`); ``）

- [ ] **Step 4: 確認無漏網字串**

Run: `grep -rn "搭電梯至" src tests`
Expected: 無任何結果（全部已帶方向）

- [ ] **Step 5: 全套測試＋型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全綠、tsc exit 0

- [ ] **Step 6: Commit**

```bash
git add src/nav.ts tests/nav.test.ts tests/route.integration.test.ts
git commit -m "fix: 電梯步驟補上/下方向，與電扶梯樓梯文字一致（QA M1）"
```

---

### Task 6: B1 東剪票口補出站閘門（ISSUE-004）

**Files:**
- Modify: `data/floors/tra-concourse-b1.json`（`gates` 追加一筆、`nav.edges` 追加一條）
- Test: `tests/route.integration.test.ts`（檔尾追加 describe）

**Interfaces:**
- Consumes: 既有 areas `a-tc-tra-paid`（x 12..82）與 `a-tc-unpaid-e`（x 82..105）、nodes `n-tc-003` [70,12]（付費）與 `n-tc-002` [92,12]（非付費）。
- Produces: gate id `g-tc-tra-out-e`。validate 語意規則：direction=out 的 gate edge 必須「付費→非付費」且 `bidir:false`。

**背景（一行）**：東剪票口現只有進站閘門（單向）＋寬閘門，出站被迫繞北側寬閘門（進 22m／出 40m 不對稱 82%）；實體閘門陣列進出並設。

- [ ] **Step 1: 在 `tests/route.integration.test.ts` 檔尾追加測試（先紅）**

```ts
describe('B1 東剪票口出站閘門（QA ISSUE-004）', () => {
  it('付費島→東剪票口外走出站閘門（單一 gate 邊）', () => {
    const path = findPath(graph, 'n-tc-003', 'n-tc-002')!;
    expect(path.map((e) => e.kind)).toEqual(['gate']);
    expect(path[0].gate).toBe('g-tc-tra-out-e');
  });
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/route.integration.test.ts`
Expected: FAIL——現行路線為 3 段（walk＋acc gate＋walk）繞寬閘門

- [ ] **Step 3: `data/floors/tra-concourse-b1.json` 的 `gates` 陣列追加**

```json
    {
      "id": "g-tc-tra-out-e",
      "kind": "faregate",
      "system": "tra",
      "direction": "out",
      "accessible": false,
      "line": [
        [82, -6],
        [82, 0]
      ],
      "connects": [
        "a-tc-tra-paid",
        "a-tc-unpaid-e"
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "note": "東剪票口出站閘門列（推定於進站列南側並設）"
    }
```

- [ ] **Step 4: `nav.edges` 陣列追加**

```json
      {
        "from": "n-tc-003",
        "to": "n-tc-002",
        "kind": "gate",
        "gate": "g-tc-tra-out-e",
        "bidir": false
      }
```

- [ ] **Step 5: 資料驗證＋排版＋測試綠**

Run: `npm run validate && npm run format:data && npx vitest run tests/route.integration.test.ts`
Expected: `validate: 0 errors`；測試 PASS（出站 22.0m 單邊最短，A* 必選）

- [ ] **Step 6: 全套測試＋型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全綠、tsc exit 0

- [ ] **Step 7: Commit**

```bash
git add data/floors/tra-concourse-b1.json tests/route.integration.test.ts
git commit -m "data: B1 東剪票口補出站閘門 g-tc-tra-out-e——出站不再繞寬閘門（QA ISSUE-004）"
```

---

### Task 7: B1↔B2 直達梯群（ISSUE-003）

**Files:**
- Modify: `data/floors/tra-concourse-b1.json`（`nav.nodes` 追加 2 節點、`nav.edges` 追加 2 條 walk）
- Modify: `data/connectors.json`（追加 8 筆 tptc connectors）
- Modify: `docs/floor-notes/tra-concourse-b1.md`、`docs/floor-notes/tra-platform-b2.md`（判讀紀錄）
- Modify: `public/models/station.glb`（`npm run export:glb` 重新產出）
- Test: `tests/route.integration.test.ts`（檔尾追加 describe）

**Interfaces:**
- Consumes: B2 既有候車點 `n-tp-002` [77.8,26]（第4月台）、`n-tp-004` [76.7,4.5]（第3月台）作為梯群落點；B1 付費島鏈 `n-tc-003` [70,12]、`n-tc-006` [70,21]。
- Produces: B1 新節點 `n-tc-007` [76,26]（第4月台梯頭）、`n-tc-008` [76,6]（第3月台梯頭）；connector ids `c-stair-tptc-1/2`、`c-esc-tptc-1..4`、`c-elv-tptc-1/2`。命名依「低樓層短碼＋高樓層短碼」＝ tp(B2,-14)+tc(B1,-8)；levels 低→高＝[B2 節點, B1 節點]。

**背景（一行）**：connectors.json 現無任何 B1↔B2 設施，「B1 東剪票口→第4月台」被導成先下 B3 再爬回 B2（161.9m）；本 task 以語意推定（conf 2、estimated）補東側梯群，位置對齊候車點、待描圖上修——與 B3 轉乘電梯同等級的既有慣例。

- [ ] **Step 1: 在 `tests/route.integration.test.ts` 檔尾追加測試（先紅）**

```ts
describe('B1↔B2 直達梯群（QA ISSUE-003）', () => {
  it('B1 東剪票口外→第4月台不再繞 B3', () => {
    const path = findPath(graph, 'n-tc-002', 'n-tp-002')!;
    const floors = path.map((e) => graph.nodes.get(e.to)!.floor);
    expect(floors).not.toContain('mrt-r-concourse-b3');
    expect(path.some((e) => e.connector?.includes('tptc'))).toBe(true);
  });

  it('無障礙：B1 付費島→第3月台走 B1 電梯，全程 accessible', () => {
    const path = findPath(graph, 'n-tc-003', 'n-tp-004', { accessibleOnly: true })!;
    expect(path.every((e) => e.accessible)).toBe(true);
    expect(path.some((e) => e.connector === 'c-elv-tptc-2')).toBe(true);
  });
});
```

（`graph` 沿用檔頭既有的完整資料 graph——注意本測試檔在 Task 6 已引用同一 graph。）

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/route.integration.test.ts`
Expected: FAIL——現行路線樓層含 `mrt-r-concourse-b3`、無 tptc connector

- [ ] **Step 3: `data/floors/tra-concourse-b1.json` 的 `nav.nodes` 追加**

```json
      {
        "id": "n-tc-007",
        "xy": [76, 26],
        "area": "a-tc-tra-paid"
      },
      {
        "id": "n-tc-008",
        "xy": [76, 6],
        "area": "a-tc-tra-paid"
      }
```

`nav.edges` 追加：

```json
      {
        "from": "n-tc-006",
        "to": "n-tc-007",
        "kind": "walk"
      },
      {
        "from": "n-tc-003",
        "to": "n-tc-008",
        "kind": "walk"
      }
```

（[76,26]/[76,6] 在付費島 polygon（x 12..82, y -55..55）與 slab 內，y 對齊 B2 候車點；validate 的 in-slab 與 n-tc- 前綴檢查均過。）

- [ ] **Step 4: `data/connectors.json` 的 `connectors` 陣列尾端追加 8 筆**

```json
    {
      "id": "c-stair-tptc-1",
      "kind": "stair",
      "system": "tra",
      "direction": "both",
      "accessible": false,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-002" },
        { "floor": "tra-concourse-b1", "node": "n-tc-007" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "B1 大廳往第4月台樓梯（語意推定，落點沿用候車點，待描圖）"
    },
    {
      "id": "c-esc-tptc-1",
      "kind": "escalator",
      "system": "tra",
      "direction": "up",
      "accessible": false,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-002" },
        { "floor": "tra-concourse-b1", "node": "n-tc-007" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "第4月台↔B1 電扶梯上行（語意推定）"
    },
    {
      "id": "c-esc-tptc-2",
      "kind": "escalator",
      "system": "tra",
      "direction": "down",
      "accessible": false,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-002" },
        { "floor": "tra-concourse-b1", "node": "n-tc-007" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "第4月台↔B1 電扶梯下行（語意推定）"
    },
    {
      "id": "c-elv-tptc-1",
      "kind": "elevator",
      "system": "tra",
      "direction": "both",
      "accessible": true,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-002" },
        { "floor": "tra-concourse-b1", "node": "n-tc-007" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "第4月台↔B1 電梯（語意推定）"
    },
    {
      "id": "c-stair-tptc-2",
      "kind": "stair",
      "system": "tra",
      "direction": "both",
      "accessible": false,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-004" },
        { "floor": "tra-concourse-b1", "node": "n-tc-008" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "B1 大廳往第3月台樓梯（語意推定，落點沿用候車點，待描圖）"
    },
    {
      "id": "c-esc-tptc-3",
      "kind": "escalator",
      "system": "tra",
      "direction": "up",
      "accessible": false,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-004" },
        { "floor": "tra-concourse-b1", "node": "n-tc-008" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "第3月台↔B1 電扶梯上行（語意推定）"
    },
    {
      "id": "c-esc-tptc-4",
      "kind": "escalator",
      "system": "tra",
      "direction": "down",
      "accessible": false,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-004" },
        { "floor": "tra-concourse-b1", "node": "n-tc-008" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "第3月台↔B1 電扶梯下行（語意推定）"
    },
    {
      "id": "c-elv-tptc-2",
      "kind": "elevator",
      "system": "tra",
      "direction": "both",
      "accessible": true,
      "levels": [
        { "floor": "tra-platform-b2", "node": "n-tp-004" },
        { "floor": "tra-concourse-b1", "node": "n-tc-008" }
      ],
      "source": "tra-b1-map",
      "confidence": 2,
      "status": "estimated",
      "note": "第3月台↔B1 電梯（語意推定）"
    }
```

- [ ] **Step 5: 資料驗證＋排版＋測試綠**

Run: `npm run validate && npm run format:data && npx vitest run tests/route.integration.test.ts tests/route.samefloor.test.ts`
Expected: `validate: 0 errors`（levels 低→高 ✓、elevator accessible ✓）；新測試 PASS；samefloor 窮舉維持綠。既有 rctp 斷言（demo 無障礙走 `c-elv-rctp-1/2`）不受影響——B4 起點經 B3 直上 B2 仍遠短於繞 B1。副作用（預期且合理）：第3↔第4月台一般轉乘改走 B1（TRA 自家大廳），不再繞 B3。

- [ ] **Step 6: 全套測試＋型別檢查**

Run: `npm test && npm run typecheck`
Expected: 全綠（builder/glb-roundtrip 為 round-trip 自比對與指名 rprc id，不受新增 connector 影響）、tsc exit 0

- [ ] **Step 7: 重匯 GLB＋驗證**

Run: `npm run export:glb && npm run validate:glb`
Expected: 產出 `public/models/station.glb`（含新梯群量體）；Khronos 驗證 0 errors

- [ ] **Step 8: floor-notes 判讀紀錄**

`docs/floor-notes/tra-concourse-b1.md` 檔尾追加：

```md

## 2026-07-19 B1↔B2 梯群（語意推定）

- 新增 n-tc-007 [76,26]、n-tc-008 [76,6]（東付費島內，y 對齊 B2 第4/第3月台候車點）作為往月台梯頭。
- connectors c-stair-tptc-1/2、c-esc-tptc-1..4、c-elv-tptc-1/2：tra-b1-map 梯群圖示未逐一描圖，
  位置為語意推定（conf 2、estimated）；後續描圖可上修位置與信心。QA ISSUE-003。
```

`docs/floor-notes/tra-platform-b2.md` 檔尾追加：

```md

## 2026-07-19 B1 梯群落點

- B1↔B2 connectors（tptc 系列）落點沿用候車點 n-tp-002／n-tp-004——帶 y 錯位債（8–14m）未解前
  不新增帶內節點，維持單一代表點。QA ISSUE-003。
```

- [ ] **Step 9: 瀏覽器驗證**

http://localhost:5173 → 「B1 東剪票口外（非付費）」→「臺鐵第4月台（候車）」→ 一般路徑。
Expected: 步驟不含「淡水信義線大廳層」，含「搭電扶梯下至『臺鐵/高鐵月台層』」（或樓梯），總步行 < 60m。
`?geom=glb` 模式重載，確認新梯群量體顯示、路線正常。

- [ ] **Step 10: Commit**

```bash
git add data/floors/tra-concourse-b1.json data/connectors.json docs/floor-notes/tra-concourse-b1.md docs/floor-notes/tra-platform-b2.md public/models/station.glb tests/route.integration.test.ts
git commit -m "data: B1↔B2 東側梯群 tptc×8（語意推定 conf2）——臺鐵月台進出不再繞 B3（QA ISSUE-003）"
```

---

## 收尾驗收（全部 task 完成後）

- [ ] `npm run validate && npm test && npm run typecheck` 全綠
- [ ] 手動走一次完整跟隨流程：桌面 1280x800、手機 375x812、`?geom=glb` 三態
- [ ] 對照 `.gstack/qa-reports/qa-report-localhost-5173-2026-07-19.md`：ISSUE-001..005、M1、M2 全數可勾銷；M3（端點按鈕回饋/相機 target）本計畫**刻意不做**——夾停無害、待有使用者回饋再議（YAGNI）
- [ ] 之後可跑 `/qa-only --regression .gstack/qa-reports/baseline.json` 驗證健康分提升
