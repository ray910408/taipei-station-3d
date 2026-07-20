# 路網直線化＋Google-Maps 式四模式 UI（Phase 3.5）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉 waypoint graph 缺邊造成的 V 字繞路（同 area 自動視線邊），並把 UI 重寫為 Google-Maps 式四模式（Overview 爆炸圖／Route preview 框路徑／Navigation chase cam／Vertical transition 切層）。

**Architecture:** Stage A 在 `buildGraph` 後段對同 area 節點對做「線段取樣視線測試」（area polygon 內、不穿 units 障礙）自動補 walk 邊，並把 `GraphEdge` 拆成 `length`（真實公尺，顯示用）與 `cost`（A* 用，含轉乘懲罰）。Stage B 以 vanilla TS 重寫呈現層：`mode.ts` 狀態機（transition 為 nav 衍生狀態）、`explode.ts` 連續爆炸係數（樓層 group y 位移＋route/connectors 重建）、`camera.ts`（damped rig＋frameGoal＋chaseGoal）、`ui.ts`/`index.html` 全新 DOM。

**Tech Stack:** TypeScript(strict) + Vite + three.js + Vitest。零新依賴。

**盤問決議（2026-07-20，九題）：** 視線邊（Phase 4 再 navmesh）；vanilla；transition=nav 衍生、結束回 overview、手動推進 `advance()` 唯一入口；preview 與 overview 同全爆炸、等距間隔、動畫內插；chase cam heading-up 可拖曳暫解＋回正；兩段式搜尋＋補地標名；樓層按鈕=聚焦、slider 退場、無障礙=toggle、大字/高對比保留、GLB 藏設定；桌面優先驗收；Stage A 先驗收。

## Global Constraints

- 文件、註解、UI 文案繁體中文，技術詞英文。程式碼註解密度／風格比照現有檔案。
- 座標框架：`toWorld([x,y], elev) = (x, elev, −y)`（Y-up）。樓層高程 tc −8、tp −14、rc −21、rp −28；`station.floors` 陣列順序＝淺→深（B1→B4），explode 依賴此順序。
- 資料變更後必跑 `npm run validate`。每個 task 結尾 commit（沿用 2026-07-17 已授權的分階段 commit 慣例），訊息結尾 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 既有測試斷言若因新路線變紅：**逐條人工確認新路線合理再更新**，不得為過測而遷就。
- `tests/fixtures/mini` 節點也有 `area` → 視線邊會在 fixture 圖生效；fixture 既有斷言為結構性（kind 序列、gate id），預期不紅，紅了先讀路徑再改。
- 已知資料事實（實作時勿「修正」它們）：`n-rp-004` 座落於樓梯開口 unit 內（該節點不獲視線邊、手繪邊保留，行為正確）；B2 月台各 band（plat-3/plat-4）between 無邊（跨月台本來不可走）；B2 帶 y 錯位 8–14m 為既有資料債，不在本期。
- QA Python 復刻圖（qa-route-sweep 技法）與 buildGraph 邏輯不再同步——重掃前需先在該工具複刻視線邊，本期只在 commit 訊息註記。

## File Structure

```
src/visibility.ts   （新）pointInPolygon + segmentClear——Phase 4 navmesh 沿用
src/nav.ts          cost/length 拆分＋視線邊＋routeStats/formatStats
src/mode.ts         （新）Mode、MODE_EXPLODE、verticalStep、transitionLabel
src/explode.ts      （新）floorOffsetY、applyExplode、easeInOutCubic
src/camera.ts       （新）CameraRig、frameGoal、chaseGoal
src/builder.ts      抽出 buildConnectorsGroup(model, offsetY)
src/path.ts         buildRouteObject 增 offsetY 參數
src/follow.ts       setFloorEmphasis 支援多樓層（string | string[] | null）
src/ui.ts           重寫：兩段式搜尋、路線卡、nav banner、樓層按鈕、設定角落
src/main.ts         重寫接線：爆炸動畫、camera rig、模式流、transition 偵測
index.html          重寫 DOM＋CSS（卡片式、深色 Google-Maps 質感）
data/floors/*.json  17 個節點補 name.zh
tests/              新增 visibility / nav-visibility / route-stats / mode / explode / camera；
                    更新 nav.test（懲罰→cost）、route.samefloor（stair→cost）；follow-emphasis 加多樓層
```

---

### Task 0: plan 落地 repo

**Files:**
- Create: `docs/superpowers/plans/2026-07-20-taipei-station-phase3-5.md`

- [ ] **Step 1: 複製本 plan 全文至上述路徑**（repo 慣例：plan 與 spec 入版控）
- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-07-20-taipei-station-phase3-5.md
git commit -m "docs: Phase 3.5 plan——路網視線邊＋四模式 UI（盤問九題定案）"
```

---

## Stage A：路網直線化

### Task 1: visibility.ts 幾何模組

**Files:**
- Create: `src/visibility.ts`
- Test: `tests/visibility.test.ts`

**Interfaces:**
- Produces: `pointInPolygon(pt: Vec2, poly: Vec2[]): boolean`、`segmentClear(a: Vec2, b: Vec2, area: Vec2[], units: Vec2[][]): boolean`（Task 3 的 buildGraph 消費）

- [ ] **Step 1: 寫失敗測試 `tests/visibility.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { pointInPolygon, segmentClear } from '../src/visibility';
import type { Vec2 } from '../src/types';

const square: Vec2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
const ell: Vec2[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]; // L 形（凹）
const box: Vec2[] = [[4, 4], [6, 4], [6, 6], [4, 6]];

describe('pointInPolygon', () => {
  it('方形內/外', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([15, 5], square)).toBe(false);
  });
  it('凹多邊形缺角為外', () => {
    expect(pointInPolygon([8, 8], ell)).toBe(false);
    expect(pointInPolygon([2, 8], ell)).toBe(true);
  });
});

describe('segmentClear', () => {
  it('空曠方形內對角線可走', () => {
    expect(segmentClear([1, 1], [9, 9], square, [])).toBe(true);
  });
  it('穿過 unit 障礙被擋', () => {
    expect(segmentClear([1, 1], [9, 9], square, [box])).toBe(false);
  });
  it('凹多邊形：線段離開 polygon 被擋', () => {
    expect(segmentClear([8, 2], [2, 8], ell, [])).toBe(false);
  });
  it('凹多邊形：沿臂內直線可走', () => {
    expect(segmentClear([2, 2], [2, 9], ell, [])).toBe(true);
  });
  it('零長度線段回 false', () => {
    expect(segmentClear([1, 1], [1, 1], square, [])).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/visibility.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 實作 `src/visibility.ts`**

```ts
import type { Vec2 } from './types';

/** Ray-cast 點在多邊形內（polygon 開環）。邊界上的點結果未定義——呼叫端以取樣容忍。 */
export function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const STEP = 0.5; // 取樣間距（公尺）

/** a→b 是否全程落在 area polygon 內且不進入任何 unit 障礙。
 *  ponytail: 取樣法而非精確線段相交——資料尺度 ~150m、0.5m 取樣誤差可控；
 *  Phase 4 升級 navmesh + funnel 時整組替換。 */
export function segmentClear(a: Vec2, b: Vec2, area: Vec2[], units: Vec2[][]): boolean {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1e-6) return false;
  const n = Math.max(2, Math.ceil(len / STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: Vec2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (!pointInPolygon(p, area)) return false;
    for (const u of units) if (pointInPolygon(p, u)) return false;
  }
  return true;
}
```

- [ ] **Step 4: 跑測試確認綠**

Run: `npx vitest run tests/visibility.test.ts`
Expected: PASS（7 tests）

- [ ] **Step 5: Commit**

```bash
git add src/visibility.ts tests/visibility.test.ts
git commit -m "feat: visibility 幾何模組——pip + 線段取樣視線測試（Phase 4 navmesh 可沿用）"
```

### Task 2: GraphEdge cost/length 拆分

**Files:**
- Modify: `src/nav.ts`（GraphEdge、buildGraph connector 段、findPath）
- Modify: `tests/nav.test.ts:34-39`、`tests/route.samefloor.test.ts:89-92`

**Interfaces:**
- Produces: `GraphEdge.cost: number`（A* 用）；`GraphEdge.length` 改為真實 3D 公尺（顯示用）。Task 3/6 消費。

- [ ] **Step 1: 更新兩處既有斷言為新契約（先紅）**

`tests/nav.test.ts` 原「垂直邊含轉乘懲罰」測試改為：

```ts
  it('垂直邊 cost 含轉乘懲罰、length 為幾何長（cost/length 拆分）', () => {
    const esc = (graph.adj.get('n-pl-001') ?? []).find((e) => e.kind === 'escalator')!;
    expect(esc.cost).toBeCloseTo(5 + 20, 6);
    expect(esc.length).toBeCloseTo(5, 6);
    const elv = (graph.adj.get('n-pl-002') ?? []).find((e) => e.kind === 'elevator')!;
    expect(elv.cost).toBeCloseTo(Math.hypot(5, 3, 5) + 40, 6);
    expect(elv.length).toBeCloseTo(Math.hypot(5, 3, 5), 6);
  });
```

`tests/route.samefloor.test.ts` 原「樓梯轉乘懲罰 +25」測試改為：

```ts
  it('樓梯轉乘懲罰計入 cost、length 為高差 7（c-stair-rprc-1 同 xy）', () => {
    const stair = (graph.adj.get('n-rp-001') ?? []).find((e) => e.kind === 'stair')!;
    expect(stair.cost).toBeCloseTo(7 + 25, 6);
    expect(stair.length).toBeCloseTo(7, 6);
  });
```

- [ ] **Step 2: 跑兩檔確認紅**

Run: `npx vitest run tests/nav.test.ts tests/route.samefloor.test.ts`
Expected: FAIL（cost undefined / length 含懲罰）

- [ ] **Step 3: 實作拆分（src/nav.ts）**

`GraphEdge` 介面加欄位：

```ts
export interface GraphEdge {
  from: string; to: string;
  kind: 'walk' | 'gate' | 'platform-edge' | 'stair' | 'escalator' | 'elevator';
  accessible: boolean;
  length: number;      // 真實 3D 公尺（顯示、統計用）
  cost: number;        // A* 鬆弛用；connector 邊 = length + 轉乘懲罰
  gate?: string; gateSystem?: string; connector?: string;
}
```

樓層邊 `base` 加 `cost: dist3(a, b)`（與 length 同值）。connector 迴圈改：

```ts
      const len = dist3(a, b);
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: c.kind,
        accessible: c.accessible,
        length: len,
        cost: len + TRANSFER_PENALTY[c.kind],
        connector: c.id,
      };
```

`findPath` 鬆弛改用 cost（heuristic dist3 仍 admissible，因 cost ≥ length ≥ dist3）：

```ts
      const tentative = (g.get(current) ?? Infinity) + e.cost;
```

- [ ] **Step 4: 跑全套確認綠**

Run: `npm test`
Expected: PASS（routeSteps 步行文字用 length，數值不變；A* 選線不變因 cost ≡ 舊 length）

- [ ] **Step 5: Commit**

```bash
git add src/nav.ts tests/nav.test.ts tests/route.samefloor.test.ts
git commit -m "refactor: GraphEdge 拆 length/cost——顯示數字不再含轉乘懲罰虛胖"
```

### Task 3: buildGraph 自動視線邊

**Files:**
- Modify: `src/nav.ts`（buildGraph）
- Test: `tests/nav-visibility.test.ts`（新，真實資料）

**Interfaces:**
- Consumes: `segmentClear`（Task 1）、`cost` 欄（Task 2）
- Produces: 同 area 可視節點對之間的自動 `walk` 邊（runtime 生成，不落資料檔）

- [ ] **Step 1: 寫失敗測試 `tests/nav-visibility.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
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
const hasEdge = (a: string, b: string) =>
  (graph.adj.get(a) ?? []).some((e) => e.to === b);

describe('自動視線邊（同 area、不穿障礙）', () => {
  it('rc-014 ↔ rc-008 直線邊存在（V 字繞路根治，直線 15.7m vs 舊 50.7m）', () => {
    expect(hasEdge('n-rc-014', 'n-rc-008')).toBe(true);
    expect(hasEdge('n-rc-008', 'n-rc-014')).toBe(true);
  });

  it('無障礙路線 B3 段走直線：rc-014 下一站即 rc-008', () => {
    const path = findPath(graph, 'n-rp-001', 'n-tp-002', { accessibleOnly: true })!;
    const ids = [path[0].from, ...path.map((e) => e.to)];
    const i = ids.indexOf('n-rc-014');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ids[i + 1]).toBe('n-rc-008');
  });

  it('B4 直線穿越樓梯開口被擋：rp-001 ↛ rp-006（維持繞行 rp-003）', () => {
    expect(hasEdge('n-rp-001', 'n-rp-006')).toBe(false);
  });

  it('跨 area 不自動補邊：rc-005（非付費）↛ rc-008（付費）', () => {
    expect(hasEdge('n-rc-005', 'n-rc-008')).toBe(false);
  });

  it('自動邊為 walk 且 cost=length（無懲罰）', () => {
    const e = (graph.adj.get('n-rc-014') ?? []).find((x) => x.to === 'n-rc-008')!;
    expect(e.kind).toBe('walk');
    expect(e.cost).toBeCloseTo(e.length, 6);
    expect(e.length).toBeLessThan(17);
  });
});
```

- [ ] **Step 2: 跑測試確認紅**

Run: `npx vitest run tests/nav-visibility.test.ts`
Expected: FAIL（rc-014→rc-008 無邊）

- [ ] **Step 3: buildGraph 插入視線邊生成（src/nav.ts，樓層邊迴圈之後、connector 迴圈之前）**

檔頭加 `import { segmentClear } from './visibility';`，然後：

```ts
  // 自動視線邊：同 area 內兩兩節點，直線落在 area polygon 內且不穿 units 障礙
  // → 補 walk 邊。手繪邊優先（已有直接邊者跳過）；跨 area 一律不補（閘門拓撲不動）。
  const hasDirect = (a: string, b: string) => (adj.get(a) ?? []).some((e) => e.to === b);
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor?.nav) continue;
    const areaPoly = new Map((floor.areas ?? []).map((a) => [a.id, a.polygon]));
    const unitPolys = (floor.units ?? []).map((u) => u.polygon);
    const ns = floor.nav.nodes;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const na = ns[i];
        const nb = ns[j];
        if (!na.area || na.area !== nb.area) continue;
        const poly = areaPoly.get(na.area);
        if (!poly || hasDirect(na.id, nb.id) || hasDirect(nb.id, na.id)) continue;
        if (!segmentClear(na.xy, nb.xy, poly, unitPolys)) continue;
        const ga = nodes.get(na.id)!;
        const gb = nodes.get(nb.id)!;
        const len = dist3(ga, gb);
        const base = { kind: 'walk' as const, accessible: true, length: len, cost: len };
        addEdge({ from: na.id, to: nb.id, ...base });
        addEdge({ from: nb.id, to: na.id, ...base });
      }
    }
  }
```

- [ ] **Step 4: 跑全套；受影響斷言逐條校正**

Run: `npm test`
Expected: nav-visibility PASS。若 `route.integration` / `route.samefloor` / `nav.test`（fixture）有紅：印出實際路徑、人工確認新路線合理（更短、不違反閘門/樓層拓撲）後更新斷言；不合理則回頭查 segmentClear。

- [ ] **Step 5: Commit**

```bash
git add src/nav.ts tests/nav-visibility.test.ts
git commit -m "feat: buildGraph 自動視線邊——同 area 直線可走即補邊，V 字繞路根治（盤問 Q1）"
```

### Task 4: 補地標名（資料）

**Files:**
- Modify: `data/floors/mrt-r-platform-b4.json`、`data/floors/mrt-r-concourse-b3.json`、`data/floors/tra-platform-b2.json`、`data/floors/tra-concourse-b1.json`

**Interfaces:**
- Produces: `listLandmarks` 由 10 個增至 27 個——Stage B 搜尋列的內容池。命名循「語意＋樓層雙資訊」慣例。

- [ ] **Step 1: 對下列節點加 `"name": { "zh": "…" }`（僅加欄位，不動座標）**

| 檔 | 節點 | name.zh |
|---|---|---|
| b4 | n-rp-002 | 淡水信義線月台 南端電梯口 |
| b4 | n-rp-004 | 淡水信義線月台 北梯群口 |
| b4 | n-rp-006 | 淡水信義線月台 中段電梯口 |
| b3 | n-rc-002 | R線大廳 北梯群口（付費區） |
| b3 | n-rc-005 | 臺鐵轉乘閘門外（B3 非付費） |
| b3 | n-rc-007 | B3 往B1 長電扶梯口 |
| b3 | n-rc-008 | R線大廳 北寬閘門內（付費區） |
| b3 | n-rc-010 | R線大廳 南端電梯口（付費區） |
| b3 | n-rc-011 | B3 往B1 電梯口 |
| b3 | n-rc-014 | R線大廳 中段電梯口（付費區） |
| b3 | n-rc-017 | B3 臺鐵轉乘區 第4月台梯口 |
| b3 | n-rc-018 | B3 臺鐵轉乘區 第3月台梯口 |
| b2 | n-tp-001 | 臺鐵第4月台（轉乘梯口） |
| b2 | n-tp-003 | 臺鐵第3月台（轉乘梯口） |
| b1 | n-tc-005 | B1 東剪票口 寬閘門外 |
| b1 | n-tc-007 | B1 付費島 第4月台梯口 |
| b1 | n-tc-008 | B1 付費島 第3月台梯口 |

- [ ] **Step 2: 驗證與窮舉回歸**

Run: `npm run validate && npm test`
Expected: validate 0 errors；`route.samefloor` 窮舉（地標對變多）仍全綠。紅了→該對路線離層＝真 bug，回 Task 3 檢查，不改斷言。

- [ ] **Step 3: Commit**

```bash
git add data/floors/
git commit -m "data: 17 個 nav 節點補中文名——搜尋列內容池（盤問 Q6）"
```

### Task 5: Stage A 瀏覽器驗收

**Files:** 無（驗證）

- [ ] **Step 1: 啟動 dev server（preview_start，若無 `.claude/launch.json` 先建）**

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "dev", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 5173 }
  ]
}
```

- [ ] **Step 2: 現行 UI 實測**：起點「淡水信義線月台（南端）」→ 終點「臺鐵第4月台（候車）」，按「無障礙路徑」。
Expected: B3 段步驟不再出現「步行約 51 公尺」，改為 ~16 公尺；3D 路線 B3 段為直線（無 V 字）。「一般路徑」同查無 dogleg。
- [ ] **Step 3: 截圖留證**（computer screenshot），與原截圖對照。
- [ ] **Step 4: `npm run typecheck && npm test && npm run validate` 全綠後結束 Stage A。**

---

## Stage B：四模式 UI

### Task 6: routeStats／formatStats

**Files:**
- Modify: `src/nav.ts`（檔尾加）
- Test: `tests/route-stats.test.ts`

**Interfaces:**
- Produces: `routeStats(edges: GraphEdge[]): { meters: number; seconds: number }`、`formatStats(s): string`（格式「約 X 公尺・約 Y 分鐘」）。Task 13/14 消費。

- [ ] **Step 1: 寫失敗測試 `tests/route-stats.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { routeStats, formatStats } from '../src/nav';
import type { GraphEdge } from '../src/nav';

const e = (kind: GraphEdge['kind'], length: number, cost = length): GraphEdge =>
  ({ from: 'a', to: 'b', kind, accessible: true, length, cost });

describe('routeStats', () => {
  it('公尺=Σlength（不含懲罰）、秒=步行/1.2 + connector 固定秒', () => {
    const edges = [e('walk', 12), e('elevator', 7, 47), e('gate', 2), e('walk', 6)];
    const s = routeStats(edges);
    expect(s.meters).toBeCloseTo(27, 6);
    expect(s.seconds).toBeCloseTo((12 + 2 + 6) / 1.2 + 60, 6);
  });
  it('formatStats 分鐘無條件進位、最少 1 分鐘', () => {
    expect(formatStats({ meters: 27.4, seconds: 76.7 })).toBe('約 27 公尺・約 2 分鐘');
    expect(formatStats({ meters: 5, seconds: 10 })).toBe('約 5 公尺・約 1 分鐘');
  });
});
```

- [ ] **Step 2: 跑確認紅** — `npx vitest run tests/route-stats.test.ts` → FAIL
- [ ] **Step 3: 實作（src/nav.ts 檔尾）**

```ts
export interface RouteStats { meters: number; seconds: number }

const WALK_SPEED = 1.2; // m/s，車站人流保守值
// ponytail: 固定候梯＋乘行秒數；Phase 4 有實測數據再校
const CONNECTOR_SECONDS: Record<'stair' | 'escalator' | 'elevator', number> = {
  escalator: 40, stair: 50, elevator: 60,
};

export function routeStats(edges: GraphEdge[]): RouteStats {
  let meters = 0;
  let seconds = 0;
  for (const e of edges) {
    meters += e.length;
    if (e.kind === 'stair' || e.kind === 'escalator' || e.kind === 'elevator')
      seconds += CONNECTOR_SECONDS[e.kind];
    else seconds += e.length / WALK_SPEED;
  }
  return { meters, seconds };
}

export function formatStats(s: RouteStats): string {
  return `約 ${Math.max(1, Math.round(s.meters))} 公尺・約 ${Math.max(1, Math.ceil(s.seconds / 60))} 分鐘`;
}
```

- [ ] **Step 4: 跑確認綠** — `npx vitest run tests/route-stats.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/nav.ts tests/route-stats.test.ts
git commit -m "feat: routeStats/formatStats——距離用 length、時間=步行1.2m/s+設施固定秒"
```

### Task 7: builder 抽出 buildConnectorsGroup

**Files:**
- Modify: `src/builder.ts`

**Interfaces:**
- Produces: `buildConnectorsGroup(model: StationModel, offsetY?: (floorId: string) => number): THREE.Group`。`buildStationGroup` 內部改呼叫它（offsetY 預設 `() => 0`，輸出不變）。Task 14 以爆炸位移重建 connectors。

- [ ] **Step 1: 純抽取重構**——把 `buildStationGroup` 的 connectors 區塊（`connGroup` 建立至 `root.add(connGroup)` 前）搬成獨立 export function；`nodePos` 改為：

```ts
export function buildConnectorsGroup(
  model: StationModel,
  offsetY: (floorId: string) => number = () => 0,
): THREE.Group {
  const connGroup = new THREE.Group();
  connGroup.name = 'connectors';
  const nodePos = new Map<string, THREE.Vector3>();
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    for (const n of floor?.nav?.nodes ?? [])
      nodePos.set(n.id, toWorld(n.xy, meta.elevation + offsetY(meta.id)));
  }
  // …以下與原區塊逐行相同（SPACING、groups、mesh 建立、lateral 錯開）…
  return connGroup;
}
```

`buildStationGroup` 尾端改為 `root.add(buildConnectorsGroup(model));`。

- [ ] **Step 2: 跑既有測試確認重構零行為變化**

Run: `npx vitest run tests/builder.test.ts tests/glb-roundtrip.test.ts tests/follow-emphasis.test.ts`
Expected: PASS（輸出結構不變）

- [ ] **Step 3: Commit**

```bash
git add src/builder.ts
git commit -m "refactor: 抽出 buildConnectorsGroup(offsetY)——爆炸圖重建 connectors 的接口"
```

### Task 8: explode.ts＋path.ts offsetY

**Files:**
- Create: `src/explode.ts`
- Modify: `src/path.ts`
- Test: `tests/explode.test.ts`

**Interfaces:**
- Produces: `EXPLODE_GAP = 24`、`floorOffsetY(model, floorId, factor): number`、`applyExplode(stationGroup, model, factor): void`、`easeInOutCubic(t): number`；`buildRouteObject(graph, edges, offsetY?: (floorId: string) => number)`。Task 14 消費。

- [ ] **Step 1: 寫失敗測試 `tests/explode.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { floorOffsetY, easeInOutCubic, EXPLODE_GAP } from '../src/explode';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat }, connectorsDoc);
const elevOf = (id: string) => model.station.floors.find((f) => f.id === id)!.elevation;

describe('floorOffsetY', () => {
  it('factor 0 = 實高（位移 0）', () => {
    expect(floorOffsetY(model, 'hall-b1', 0)).toBe(0);
    expect(floorOffsetY(model, 'plat-b2', 0)).toBe(0);
  });
  it('factor 1 = 最深層不動、往上等距 EXPLODE_GAP', () => {
    const deepest = model.station.floors[model.station.floors.length - 1];
    expect(floorOffsetY(model, deepest.id, 1)).toBe(0);
    // 上一層：目標高 = 最深高程 + GAP，位移 = 目標 − 實高
    const upper = model.station.floors[0];
    expect(floorOffsetY(model, upper.id, 1))
      .toBeCloseTo(deepest.elevation + EXPLODE_GAP - elevOf(upper.id), 6);
  });
  it('未知樓層回 0', () => {
    expect(floorOffsetY(model, 'no-such', 1)).toBe(0);
  });
});

describe('easeInOutCubic', () => {
  it('端點與中點', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });
});
```

- [ ] **Step 2: 跑確認紅** — `npx vitest run tests/explode.test.ts` → FAIL
- [ ] **Step 3: 實作 `src/explode.ts`**

```ts
import type * as THREE from 'three';
import type { StationModel } from './types';

export const EXPLODE_GAP = 24; // 爆炸時相鄰樓層間距（公尺）；真實層距 6–7m 近等距，取等距最簡

/** factor 0=實高、1=全爆炸。最深層不動，往上每層墊高到等距 GAP；回傳加在實高上的 y 位移。 */
export function floorOffsetY(model: StationModel, floorId: string, factor: number): number {
  const floors = model.station.floors; // station.json 順序＝淺→深
  const i = floors.findIndex((f) => f.id === floorId);
  if (i < 0) return 0;
  const deepest = floors[floors.length - 1].elevation;
  const target = deepest + (floors.length - 1 - i) * EXPLODE_GAP;
  return (target - floors[i].elevation) * factor;
}

export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

/** 樓層 group y 位移；connectors 需拉伸、由呼叫端以 buildConnectorsGroup(offsetY) 重建。 */
export function applyExplode(stationGroup: THREE.Group, model: StationModel, factor: number): void {
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') continue;
    child.position.y = floorOffsetY(model, child.name, factor);
  }
}
```

`src/path.ts` 的 `buildRouteObject` 簽名與取點改為：

```ts
export function buildRouteObject(
  graph: NavGraph,
  edges: GraphEdge[],
  offsetY: (floorId: string) => number = () => 0,
): THREE.Group {
  // …group 建立不變…
  const pts = ids.map((id) => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z + offsetY(n.floor) + 1.2); // 浮在（可能爆炸位移後的）樓面上方
  });
  // …其餘不變…
```

- [ ] **Step 4: 跑確認綠＋全套不紅** — `npm test` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/explode.ts src/path.ts tests/explode.test.ts
git commit -m "feat: explode 模組——等距爆炸位移＋route 隨層位移（盤問 Q4）"
```

### Task 9: setFloorEmphasis 多樓層

**Files:**
- Modify: `src/follow.ts:56`
- Test: `tests/follow-emphasis.test.ts`（檔尾追加一測試）

**Interfaces:**
- Produces: `setFloorEmphasis(stationGroup, active: string | readonly string[] | null)`——傳陣列時多層同時保持基準（transition 雙層用）。既有 string／null 呼叫行為不變。

- [ ] **Step 1: 追加失敗測試（follow-emphasis.test.ts 檔尾、describe 內）**

```ts
  it('陣列參數：兩樓層同時保持基準、其餘調暗（transition 雙層）', () => {
    const g = new THREE.Group();
    const mk = (name: string) => {
      const f = new THREE.Group();
      f.name = name;
      f.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ opacity: 0.8, transparent: true })));
      g.add(f);
      return f.children[0] as THREE.Mesh;
    };
    const a = mk('floor-a');
    const b = mk('floor-b');
    const c = mk('floor-c');
    setFloorEmphasis(g, ['floor-a', 'floor-b']);
    expect((a.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
    expect((b.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
    expect((c.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8 * 0.15, 5);
    setFloorEmphasis(g, null);
    expect((c.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
  });
```

- [ ] **Step 2: 跑確認紅** — `npx vitest run tests/follow-emphasis.test.ts` → FAIL（型別/行為）
- [ ] **Step 3: 實作（follow.ts，只動簽名與 dim 判斷，其餘快照邏輯不動）**

```ts
export function setFloorEmphasis(
  stationGroup: THREE.Group,
  active: string | readonly string[] | null,
): void {
  const activeSet = active === null ? null
    : new Set(typeof active === 'string' ? [active] : active);
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') continue;
    const dim = activeSet !== null && !activeSet.has(child.name);
    child.traverse((obj) => {
      // …原函數體不變，僅原 activeFloorId === null 判斷改為 activeSet === null…
```

- [ ] **Step 4: 跑確認綠** — `npx vitest run tests/follow-emphasis.test.ts` → PASS（全部既有測試含新測試）
- [ ] **Step 5: Commit**

```bash
git add src/follow.ts tests/follow-emphasis.test.ts
git commit -m "feat: setFloorEmphasis 支援多樓層——vertical transition 雙層強調（盤問 Q3）"
```

### Task 10: mode.ts 狀態機

**Files:**
- Create: `src/mode.ts`
- Test: `tests/mode.test.ts`

**Interfaces:**
- Consumes: `GraphEdge`／`NavGraph`（nav.ts）、`FollowState`（follow.ts）、`StationModel`
- Produces: `type Mode = 'overview' | 'preview' | 'nav'`；`MODE_EXPLODE: Record<Mode, number>`；`verticalStep(edges, s): GraphEdge | null`；`transitionLabel(model, graph, e): string`

- [ ] **Step 1: 寫失敗測試 `tests/mode.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import { MODE_EXPLODE, verticalStep, transitionLabel } from '../src/mode';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat }, connectorsDoc);
const graph = buildGraph(model);
const path = findPath(graph, 'n-pl-001', 'n-ha-002')!; // ['escalator', 'gate']

describe('MODE_EXPLODE', () => {
  it('overview/preview 全爆炸、nav 實高', () => {
    expect(MODE_EXPLODE).toEqual({ overview: 1, preview: 1, nav: 0 });
  });
});

describe('verticalStep', () => {
  it('站在垂直邊前回傳該邊；否則 null；終點 null', () => {
    expect(verticalStep(path, { nodeIds: [], index: 0 })?.kind).toBe('escalator');
    expect(verticalStep(path, { nodeIds: [], index: 1 })).toBeNull(); // gate
    expect(verticalStep(path, { nodeIds: [], index: 2 })).toBeNull(); // 越界＝抵達
  });
});

describe('transitionLabel', () => {
  it('電扶梯上行文案含目的樓層', () => {
    expect(transitionLabel(model, graph, path[0])).toBe('搭電扶梯上行，前往「B1 測試大廳」');
  });
});
```

（fixture 樓層 label 若非「B1 測試大廳」，以 `labels.complex + ' ' + name.zh` 實值校正字串——先 `console.log` 一次取實值，不改邏輯。）

- [ ] **Step 2: 跑確認紅** — `npx vitest run tests/mode.test.ts` → FAIL
- [ ] **Step 3: 實作 `src/mode.ts`**

```ts
import type { GraphEdge, NavGraph } from './nav';
import type { FollowState } from './follow';
import type { StationModel } from './types';

export type Mode = 'overview' | 'preview' | 'nav';

/** 各模式目標爆炸係數（盤問 Q4：preview 與 overview 同全爆炸） */
export const MODE_EXPLODE: Record<Mode, number> = { overview: 1, preview: 1, nav: 0 };

/** nav 中站在垂直設施前（下一條邊是 connector）→ 回傳該邊，觸發 transition 呈現。 */
export function verticalStep(edges: GraphEdge[], s: FollowState): GraphEdge | null {
  const e = edges[s.index];
  return e && (e.kind === 'stair' || e.kind === 'escalator' || e.kind === 'elevator') ? e : null;
}

/** transition 橫幅文案：「搭電梯上行，前往「B2 臺鐵/高鐵月台層」」 */
export function transitionLabel(model: StationModel, graph: NavGraph, e: GraphEdge): string {
  const src = graph.nodes.get(e.from)!;
  const dst = graph.nodes.get(e.to)!;
  const up = dst.z > src.z;
  const meta = model.station.floors.find((f) => f.id === dst.floor)!;
  const floorLabel = `${meta.labels['complex'] ?? ''} ${meta.name.zh}`.trim();
  const verb = e.kind === 'elevator' ? `搭電梯${up ? '上' : '下'}行`
    : e.kind === 'escalator' ? `搭電扶梯${up ? '上' : '下'}行`
    : `走樓梯${up ? '上' : '下'}樓`;
  return `${verb}，前往「${floorLabel}」`;
}
```

- [ ] **Step 4: 跑確認綠** — `npx vitest run tests/mode.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/mode.ts tests/mode.test.ts
git commit -m "feat: mode 狀態機——MODE_EXPLODE/verticalStep/transitionLabel（盤問 Q3）"
```

### Task 11: camera.ts

**Files:**
- Create: `src/camera.ts`
- Test: `tests/camera.test.ts`

**Interfaces:**
- Produces: `CameraRig`（`goal` 目標、`tick()` 每幀 damped lerp、`cancel()`）；`frameGoal(pts, aspect, fovDeg=55): CameraGoal`；`chaseGoal(markerPos, nextPos): CameraGoal`；`CHASE_BACK=22`、`CHASE_UP=16`

- [ ] **Step 1: 寫失敗測試 `tests/camera.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { frameGoal, chaseGoal, CHASE_BACK, CHASE_UP } from '../src/camera';

describe('frameGoal', () => {
  it('target=點集中心、距離=半徑*1.3/tan(fov/2)（含最小半徑 12）', () => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
    const g = frameGoal(pts, 1, 55);
    expect(g.target.x).toBeCloseTo(5, 5);
    // r=5 < 最小 12 → 用 12
    const expected = (12 * 1.3) / Math.tan(THREE.MathUtils.degToRad(55) / 2);
    expect(g.pos.distanceTo(g.target)).toBeCloseTo(expected, 3);
  });
  it('寬 aspect 用垂直 fov、窄 aspect 用水平 fov（取較小者）', () => {
    const pts = [new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)];
    expect(frameGoal(pts, 0.5, 55).pos.distanceTo(new THREE.Vector3(0, 0, 0)))
      .toBeGreaterThan(frameGoal(pts, 2, 55).pos.distanceTo(new THREE.Vector3(0, 0, 0)));
  });
});

describe('chaseGoal', () => {
  it('相機在 marker 後上方、注視前方 8m', () => {
    const g = chaseGoal(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
    expect(g.pos.x).toBeCloseTo(-CHASE_BACK, 5);
    expect(g.pos.y).toBeCloseTo(CHASE_UP, 5);
    expect(g.target.x).toBeCloseTo(8, 5);
  });
  it('下一點與 marker 重合時朝 -z 保底', () => {
    const g = chaseGoal(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, 3));
    expect(g.pos.z).toBeCloseTo(3 + CHASE_BACK, 5);
  });
});
```

- [ ] **Step 2: 跑確認紅** — `npx vitest run tests/camera.test.ts` → FAIL
- [ ] **Step 3: 實作 `src/camera.ts`**

```ts
import * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export interface CameraGoal { pos: THREE.Vector3; target: THREE.Vector3 }

export const CHASE_BACK = 22; // chase cam 後方水平距離（公尺）
export const CHASE_UP = 16;   // chase cam 高度

const FIT_MARGIN = 1.3;
const MIN_RADIUS = 12; // 兩點很近（如單一豎井）時仍拉出能看清兩層的距離

/** 目標相機狀態；每幀 tick() damped lerp 逼近，到位自動釋放（回使用者控制）。 */
export class CameraRig {
  goal: CameraGoal | null = null;
  private k = 0.08;
  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls) {}
  tick(): void {
    if (!this.goal) return;
    this.camera.position.lerp(this.goal.pos, this.k);
    this.controls.target.lerp(this.goal.target, this.k);
    if (this.camera.position.distanceTo(this.goal.pos) < 0.5 &&
        this.controls.target.distanceTo(this.goal.target) < 0.5) this.goal = null;
  }
  cancel(): void { this.goal = null; }
}

/** 對點集做 bounding-sphere fit：固定斜俯視方向框住全部點。 */
export function frameGoal(pts: THREE.Vector3[], aspect: number, fovDeg = 55): CameraGoal {
  const sphere = new THREE.Box3().setFromPoints(pts).getBoundingSphere(new THREE.Sphere());
  const r = Math.max(sphere.radius, MIN_RADIUS);
  const vFov = THREE.MathUtils.degToRad(fovDeg);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  const dist = (r * FIT_MARGIN) / Math.tan(Math.min(vFov, hFov) / 2);
  const dir = new THREE.Vector3(0.47, 0.46, 0.76).normalize(); // 與初始視角同側的斜俯視
  return { pos: sphere.center.clone().addScaledVector(dir, dist), target: sphere.center.clone() };
}

/** heading-up 跟隨：相機在 marker 後上方、朝前進方向（盤問 Q5）。 */
export function chaseGoal(markerPos: THREE.Vector3, nextPos: THREE.Vector3): CameraGoal {
  const fwd = nextPos.clone().sub(markerPos);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  else fwd.normalize();
  return {
    pos: markerPos.clone().addScaledVector(fwd, -CHASE_BACK).add(new THREE.Vector3(0, CHASE_UP, 0)),
    target: markerPos.clone().addScaledVector(fwd, 8),
  };
}
```

- [ ] **Step 4: 跑確認綠** — `npx vitest run tests/camera.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/camera.ts tests/camera.test.ts
git commit -m "feat: camera rig——frameGoal 框路徑 + chaseGoal heading-up（盤問 Q5）"
```

### Task 12: index.html 重寫（DOM＋CSS）

**Files:**
- Modify: `index.html`（`<style>` 與 `<body>` 全量替換；`<head>` meta/title 不變）

**Interfaces:**
- Produces: Task 13 ui.ts 依賴的所有 DOM id：`#searchbar #end-input #end-results #floor-buttons #route-card #start-input #start-results #route-dest #acc-toggle #route-stats #steps #btn-start-nav #btn-cancel-route #btn-swap #nav-banner #nav-next #nav-remain #nav-progress #btn-advance #btn-back #btn-recenter #btn-exit-nav #transition-banner #arrive-card #btn-finish #settings #btn-settings #settings-menu #btn-bigtext #btn-contrast #geom-mode #overlay #app`

- [ ] **Step 1: 全量替換為以下內容**

```html
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>台北車站室內 3D 導航</title>
  <style>
    :root { --bg: #1e232bea; --line: #3a4250; --fg: #e8e8e8; --muted: #9fb0c4; --primary: #2b5ea7; }
    html, body { margin: 0; height: 100%; background: #14171c; color: var(--fg);
      font-family: "Noto Sans TC", system-ui, sans-serif; }
    #app { position: fixed; inset: 0; }
    [hidden] { display: none !important; }
    .card { position: fixed; z-index: 10; background: var(--bg); border: 1px solid var(--line);
      border-radius: 12px; padding: 12px; font-size: 14px; backdrop-filter: blur(6px);
      box-shadow: 0 4px 16px #0008; }
    button { padding: 6px 12px; min-height: 36px; background: #2a313c; color: var(--fg);
      border: 1px solid var(--line); border-radius: 8px; cursor: pointer; font-size: 14px; }
    button.primary { background: var(--primary); border-color: transparent; color: #fff; }
    button:disabled { opacity: 0.45; cursor: not-allowed; }
    .row { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
    input[type="search"] { flex: 1; padding: 8px 10px; background: #14171c; color: var(--fg);
      border: 1px solid var(--line); border-radius: 8px; font-size: 14px; }
    .results { list-style: none; margin: 6px 0 0; padding: 0; max-height: 40vh; overflow-y: auto; }
    .results li { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
    .results li:hover { background: #2a313c; }

    #searchbar { top: 12px; left: 12px; width: 300px; }
    #route-card { top: 12px; left: 12px; width: 320px; }
    #route-dest { color: var(--muted); margin: 4px 0; }
    #route-stats { font-size: 16px; font-weight: 700; margin: 6px 0; }
    #steps { margin: 6px 0 0; padding-left: 20px; max-height: 30vh; overflow-y: auto; }

    #floor-buttons { position: fixed; right: 12px; top: 50%; transform: translateY(-50%);
      display: flex; flex-direction: column; gap: 8px; z-index: 10; }
    #floor-buttons button { width: 44px; height: 44px; border-radius: 50%; padding: 0; }
    #floor-buttons button[aria-pressed="true"] { background: var(--primary); color: #fff; }

    #nav-banner { top: 12px; left: 50%; transform: translateX(-50%); min-width: 340px; text-align: center; }
    #nav-next { font-size: 18px; font-weight: 700; }
    #nav-remain { color: var(--muted); margin: 4px 0; }
    #nav-progress { color: var(--muted); font-size: 12px; }

    #transition-banner { position: fixed; z-index: 11; top: 130px; left: 50%; transform: translateX(-50%);
      background: var(--primary); color: #fff; font-size: 18px; font-weight: 700;
      padding: 12px 20px; border-radius: 999px; box-shadow: 0 4px 16px #0008; }

    #arrive-card { top: 40%; left: 50%; transform: translate(-50%, -50%); text-align: center;
      font-size: 18px; font-weight: 700; }
    #arrive-card button { margin-top: 10px; }

    #settings { position: fixed; left: 12px; bottom: 12px; z-index: 10; }
    #settings-menu { position: absolute; bottom: 48px; left: 0; background: var(--bg);
      border: 1px solid var(--line); border-radius: 12px; padding: 10px; width: 190px; }
    #settings-menu button { display: block; width: 100%; margin: 4px 0; }
    #geom-mode { color: var(--muted); font-size: 12px; margin-top: 6px; }
    #geom-mode a { color: #7fb3ff; }

    #overlay { position: fixed; inset: 0; background: #000c; color: #ff8080; padding: 24px;
      white-space: pre-wrap; font-family: monospace; display: none; z-index: 99; overflow: auto; }

    body.big-text .card { font-size: 18px; }
    body.big-text #nav-next { font-size: 24px; }
    body.big-text button { font-size: 18px; min-height: 44px; }
    body.high-contrast .card, body.high-contrast #settings-menu { background: #000; border-color: #fff; }
    body.high-contrast button.primary { background: #ffd60a; color: #000; font-weight: 700; }
    body.high-contrast #nav-remain, body.high-contrast #nav-progress,
    body.high-contrast #route-dest { color: #fff; }

    @media (max-width: 600px) {
      #searchbar { left: 12px; right: 12px; width: auto; }
      #route-card, #nav-banner { top: auto; bottom: 0; left: 0; right: 0; width: auto;
        min-width: 0; transform: none; border-radius: 12px 12px 0 0; max-height: 55vh; overflow-y: auto; }
      #transition-banner { top: 12px; }
      button { min-height: 44px; }
    }
  </style>
</head>
<body data-mode="overview">
  <div id="app"></div>

  <div id="searchbar" class="card">
    <input id="end-input" type="search" placeholder="搜尋目的地…" autocomplete="off" />
    <ul id="end-results" class="results" hidden></ul>
  </div>

  <div id="floor-buttons"></div>

  <div id="route-card" class="card" hidden>
    <div class="row">
      <input id="start-input" type="search" placeholder="選擇起點…" autocomplete="off" />
      <button id="btn-swap" title="交換起訖">⇅</button>
    </div>
    <ul id="start-results" class="results" hidden></ul>
    <div id="route-dest"></div>
    <label class="row"><input id="acc-toggle" type="checkbox" /> 無障礙路線</label>
    <div id="route-stats"></div>
    <details><summary>路線步驟</summary><ol id="steps"></ol></details>
    <div class="row">
      <button id="btn-start-nav" class="primary" disabled>開始導航</button>
      <button id="btn-cancel-route">返回</button>
    </div>
  </div>

  <div id="nav-banner" class="card" hidden aria-live="polite">
    <div id="nav-next"></div>
    <div id="nav-remain"></div>
    <div id="nav-progress"></div>
    <div class="row" style="justify-content: center">
      <button id="btn-advance" class="primary">我到了</button>
      <button id="btn-back">上一步</button>
      <button id="btn-recenter">回正</button>
      <button id="btn-exit-nav">結束導航</button>
    </div>
  </div>

  <div id="transition-banner" hidden></div>

  <div id="arrive-card" class="card" hidden>
    <div>已抵達目的地</div>
    <button id="btn-finish" class="primary">結束</button>
  </div>

  <div id="settings">
    <button id="btn-settings" title="設定" aria-expanded="false">⚙</button>
    <div id="settings-menu" hidden>
      <button id="btn-bigtext" aria-pressed="false">大字</button>
      <button id="btn-contrast" aria-pressed="false">高對比</button>
      <div id="geom-mode"></div>
    </div>
  </div>

  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: 確認舊 id 已無殘留引用**——`#opacity`、`#floors`、`#sel-start`、`#sel-end`、`#btn-route`、`#btn-route-acc`、`#btn-clear`、`#btn-follow`、`#follow-panel` 只剩 ui.ts/main.ts 舊碼引用（Task 13/14 一併重寫）。此刻 `npm run typecheck` 允許紅。
- [ ] **Step 3: Commit（與 Task 13 合併亦可，若 typecheck 紅則順延至 Task 14 末一起 commit）**

### Task 13: ui.ts 重寫

**Files:**
- Modify: `src/ui.ts`（全量重寫）

**Interfaces:**
- Consumes: Task 12 DOM id、`Landmark`（nav.ts）、`Mode`（mode.ts）
- Produces: `setupUI(opts): UIHandles`，其中
  `UIHandles = { setMode(mode); setPreview(stats: string, steps: string[], ready: boolean); setNavInfo(next, remain, progress); setTransition(label: string | null); showArrive(on: boolean) }`；
  opts callbacks：`onRoute(start, end, accessibleOnly)`、`onCancelRoute()`、`onStartNav()`、`onAdvance()`、`onBack()`、`onRecenter()`、`onExitNav()`、`onFloorFocus(id: string | null)`

- [ ] **Step 1: 全量重寫 `src/ui.ts`**

```ts
import type { Landmark } from './nav';
import type { Mode } from './mode';
import type { StationModel } from './types';

export interface UIHandles {
  setMode(mode: Mode): void;
  setPreview(stats: string, steps: string[], ready: boolean): void;
  setNavInfo(next: string, remain: string, progress: string): void;
  setTransition(label: string | null): void;
  showArrive(on: boolean): void;
}

/** 搜尋欄＋過濾清單：focus/input 顯示符合項，pointerdown 選取（先於 blur）。 */
function attachSearch(
  input: HTMLInputElement, list: HTMLUListElement,
  landmarks: Landmark[], onPick: (lm: Landmark) => void,
): void {
  const render = (q: string): void => {
    const items = q
      ? landmarks.filter((l) => (l.label + l.floorLabel).includes(q))
      : landmarks;
    list.replaceChildren(...items.slice(0, 12).map((lm) => {
      const li = document.createElement('li');
      li.textContent = `${lm.label}（${lm.floorLabel}）`;
      li.addEventListener('pointerdown', (ev) => { ev.preventDefault(); list.hidden = true; onPick(lm); });
      return li;
    }));
    list.hidden = items.length === 0;
  };
  input.addEventListener('focus', () => render(input.value.trim()));
  input.addEventListener('input', () => render(input.value.trim()));
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
}

export function setupUI(opts: {
  model: StationModel;
  landmarks: Landmark[];
  onRoute(start: string, end: string, accessibleOnly: boolean): void;
  onCancelRoute(): void;
  onStartNav(): void;
  onAdvance(): void;
  onBack(): void;
  onRecenter(): void;
  onExitNav(): void;
  onFloorFocus(id: string | null): void;
}): UIHandles {
  const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
  const searchbar = $('#searchbar');
  const routeCard = $('#route-card');
  const navBanner = $('#nav-banner');
  const transitionBanner = $('#transition-banner');
  const arriveCard = $('#arrive-card');
  const floorButtons = $('#floor-buttons');
  const endInput = $<HTMLInputElement>('#end-input');
  const startInput = $<HTMLInputElement>('#start-input');
  const accToggle = $<HTMLInputElement>('#acc-toggle');
  const routeDest = $('#route-dest');
  const routeStatsDiv = $('#route-stats');
  const stepsOl = $<HTMLOListElement>('#steps');
  const btnStartNav = $<HTMLButtonElement>('#btn-start-nav');

  // a11y 切換（沿用 Phase 3）
  for (const [btnId, cls] of [['btn-bigtext', 'big-text'], ['btn-contrast', 'high-contrast']] as const) {
    const b = $<HTMLButtonElement>(`#${btnId}`);
    b.addEventListener('click', () => {
      const on = document.body.classList.toggle(cls);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // 設定角落
  const settingsMenu = $('#settings-menu');
  $('#btn-settings').addEventListener('click', () => {
    settingsMenu.hidden = !settingsMenu.hidden;
    $('#btn-settings').setAttribute('aria-expanded', String(!settingsMenu.hidden));
  });

  // 樓層按鈕：點=聚焦、再點=取消（盤問 Q7；overview 限定，setMode 時隱藏並重置）
  let focusedFloor: string | null = null;
  const resetFloorFocus = (): void => {
    focusedFloor = null;
    for (const b of floorButtons.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
  };
  for (const meta of opts.model.station.floors) {
    const b = document.createElement('button');
    b.textContent = meta.labels['complex'] ?? meta.id;
    b.dataset.floorId = meta.id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      focusedFloor = focusedFloor === meta.id ? null : meta.id;
      for (const other of floorButtons.querySelectorAll('button'))
        other.setAttribute('aria-pressed', String(other.dataset.floorId === focusedFloor));
      opts.onFloorFocus(focusedFloor);
    });
    floorButtons.append(b);
  }

  // 兩段式搜尋（盤問 Q6）：先終點、後起點，齊了自動算路線
  let startId: string | null = null;
  let endId: string | null = null;
  const labelOf = (id: string | null): string =>
    opts.landmarks.find((l) => l.id === id)?.label ?? '';
  const tryRoute = (): void => {
    if (startId && endId) opts.onRoute(startId, endId, accToggle.checked);
  };
  attachSearch(endInput, $<HTMLUListElement>('#end-results'), opts.landmarks, (lm) => {
    endId = lm.id;
    endInput.value = lm.label;
    routeDest.textContent = `終點：${lm.label}（${lm.floorLabel}）`;
    searchbar.hidden = true;
    routeCard.hidden = false;
    if (!startId) startInput.focus();
    else tryRoute();
  });
  attachSearch(startInput, $<HTMLUListElement>('#start-results'), opts.landmarks, (lm) => {
    startId = lm.id;
    startInput.value = lm.label;
    tryRoute();
  });
  accToggle.addEventListener('change', tryRoute);
  $('#btn-swap').addEventListener('click', () => {
    [startId, endId] = [endId, startId];
    startInput.value = labelOf(startId);
    endInput.value = labelOf(endId);
    routeDest.textContent = endId ? `終點：${labelOf(endId)}` : '';
    tryRoute();
  });

  const resetEndpoints = (): void => {
    startId = null;
    endId = null;
    startInput.value = '';
    endInput.value = '';
    routeDest.textContent = '';
    routeStatsDiv.textContent = '';
    stepsOl.replaceChildren();
    btnStartNav.disabled = true;
  };

  $('#btn-cancel-route').addEventListener('click', () => opts.onCancelRoute());
  btnStartNav.addEventListener('click', () => opts.onStartNav());
  $('#btn-advance').addEventListener('click', () => opts.onAdvance());
  $('#btn-back').addEventListener('click', () => opts.onBack());
  $('#btn-recenter').addEventListener('click', () => opts.onRecenter());
  $('#btn-exit-nav').addEventListener('click', () => opts.onExitNav());
  $('#btn-finish').addEventListener('click', () => opts.onExitNav());

  function setMode(mode: Mode): void {
    document.body.dataset.mode = mode;
    searchbar.hidden = mode !== 'overview';
    floorButtons.hidden = mode !== 'overview';
    routeCard.hidden = mode !== 'preview';
    navBanner.hidden = mode !== 'nav';
    if (mode !== 'nav') { transitionBanner.hidden = true; arriveCard.hidden = true; }
    if (mode !== 'overview') resetFloorFocus();
    if (mode === 'overview') resetEndpoints();
  }
  function setPreview(stats: string, steps: string[], ready: boolean): void {
    routeStatsDiv.textContent = stats;
    stepsOl.replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
    btnStartNav.disabled = !ready;
  }
  function setNavInfo(next: string, remain: string, progress: string): void {
    $('#nav-next').textContent = next;
    $('#nav-remain').textContent = remain;
    $('#nav-progress').textContent = progress;
  }
  function setTransition(label: string | null): void {
    transitionBanner.hidden = label === null;
    if (label !== null) transitionBanner.textContent = label;
  }
  function showArrive(on: boolean): void { arriveCard.hidden = !on; }

  return { setMode, setPreview, setNavInfo, setTransition, showArrive };
}
```

- [ ] **Step 2: typecheck（main.ts 仍紅，屬預期；ui.ts 自身無錯）** — `npx tsc --noEmit` 只允許 main.ts 相關錯誤
- [ ] **Step 3: 與 Task 14 一併 commit**

### Task 14: main.ts 接線

**Files:**
- Modify: `src/main.ts`（全量重寫）

**Interfaces:**
- Consumes: 前述所有模組。`stationGroup` 兩軌（runtime／GLB）同名 children，位移/重建邏輯共用。

- [ ] **Step 1: 全量重寫 `src/main.ts`**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup, buildConnectorsGroup, toWorld } from './builder';
import {
  buildGraph, findPath, routeSteps, routeStats, formatStats,
  listLandmarks, sameEndpointMessage,
} from './nav';
import type { GraphEdge } from './nav';
import { buildRouteObject } from './path';
import { setupUI } from './ui';
import { MODE_EXPLODE, verticalStep, transitionLabel, type Mode } from './mode';
import { floorOffsetY, applyExplode, easeInOutCubic } from './explode';
import { CameraRig, frameGoal, chaseGoal } from './camera';
import {
  startFollow, advance, back, atEnd, currentNodeId, remainingEdges,
  buildPositionMarker, setFloorEmphasis, type FollowState,
} from './follow';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';

function showOverlay(text: string): void {
  const el = document.querySelector<HTMLDivElement>('#overlay')!;
  el.textContent = text;
  el.style.display = 'block';
}

const floorModules = import.meta.glob('../data/floors/*.json', { eager: true });
const floorDocsByFile: Record<string, unknown> = {};
for (const [p, mod] of Object.entries(floorModules)) {
  floorDocsByFile[p.replace('../data/', '')] = (mod as { default: unknown }).default;
}

const EXPLODE_MS = 800;

async function boot(): Promise<void> {
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14171c');
  scene.add(new THREE.HemisphereLight('#cfd8e3', '#2a2f38', 1.1));
  const dirLight = new THREE.DirectionalLight('#ffffff', 0.9);
  dirLight.position.set(150, 200, 120);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(500, 50, '#2c333d', '#232830'));

  // 幾何雙軌：預設 runtime extrude；?geom=glb 載入離線匯出檔
  const geomMode = new URLSearchParams(location.search).get('geom') === 'glb' ? 'glb' : 'json';
  let stationGroup: THREE.Group;
  if (geomMode === 'glb') {
    const gltf = await new GLTFLoader().loadAsync('models/station.glb').catch(() => {
      throw new Error('載入 models/station.glb 失敗——請先執行 npm run export:glb');
    });
    const found = gltf.scene.getObjectByName('station');
    if (!found) throw new Error('station.glb 內找不到名為 station 的節點');
    stationGroup = found as THREE.Group;
  } else {
    stationGroup = buildStationGroup(model);
  }
  scene.add(stationGroup);

  document.querySelector<HTMLDivElement>('#geom-mode')!.innerHTML = geomMode === 'glb'
    ? '幾何：GLB <a href="./">切回 runtime</a>'
    : '幾何：runtime <a href="?geom=glb">切至 GLB</a>';

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(220, 140, 260);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.querySelector('#app')!.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(60, -18, 0);
  controls.enableDamping = true;
  const rig = new CameraRig(camera, controls);

  const graph = buildGraph(model);
  const landmarks = listLandmarks(model);

  let mode: Mode = 'overview';
  let explodeFactor = 0; // boot 時由實高動畫展開至 overview 爆炸
  let explodeAnim: { from: number; to: number; t0: number } | null = null;
  let routeEdges: GraphEdge[] | null = null;
  let followState: FollowState | null = null;
  let marker: THREE.Group | null = null;
  let routeObj: THREE.Object3D | null = null;
  let chaseAuto = true;

  const offsetAt = (factor: number) => (floorId: string) => floorOffsetY(model, floorId, factor);
  const nodeWorldAt = (id: string, factor: number): THREE.Vector3 => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z + floorOffsetY(model, n.floor, factor));
  };
  const nodeWorld = (id: string): THREE.Vector3 => nodeWorldAt(id, explodeFactor);
  const disposeDeep = (obj: THREE.Object3D): void =>
    obj.traverse((o) => (o as THREE.Mesh).geometry?.dispose());

  function refreshRoute(): void {
    if (routeObj) { scene.remove(routeObj); disposeDeep(routeObj); routeObj = null; }
    if (routeEdges?.length) {
      routeObj = buildRouteObject(graph, routeEdges, offsetAt(explodeFactor));
      scene.add(routeObj);
    }
  }

  let connObj: THREE.Object3D = stationGroup.getObjectByName('connectors')!;
  function refreshScene(): void {
    applyExplode(stationGroup, model, explodeFactor);
    // connectors 豎井/斜坡需隨層距拉伸——重建（幾何小、便宜；舊物件釋放 GPU 資源）
    stationGroup.remove(connObj);
    disposeDeep(connObj);
    connObj = buildConnectorsGroup(model, offsetAt(explodeFactor));
    stationGroup.add(connObj);
    refreshRoute();
    if (marker && followState) marker.position.copy(nodeWorld(currentNodeId(followState)));
  }

  function setExplode(target: number): void {
    if (Math.abs(target - explodeFactor) > 1e-3)
      explodeAnim = { from: explodeFactor, to: target, t0: performance.now() };
  }

  function routePoints(factor: number): THREE.Vector3[] {
    if (!routeEdges?.length) return [];
    const ids = [routeEdges[0].from, ...routeEdges.map((e) => e.to)];
    return ids.map((id) => nodeWorldAt(id, factor));
  }

  function exitNav(): void {
    if (marker) scene.remove(marker); // marker 建一次重用（Phase 3 慣例）
    followState = null;
    ui.setTransition(null);
    ui.showArrive(false);
  }

  function clearRoute(): void {
    exitNav();
    routeEdges = null;
    refreshRoute();
  }

  function setMode(m: Mode): void {
    mode = m;
    ui.setMode(m);
    setExplode(MODE_EXPLODE[m]);
    if (m === 'overview') {
      clearRoute();
      setFloorEmphasis(stationGroup, null);
    }
    if (m === 'preview') {
      setFloorEmphasis(stationGroup, null); // 跨樓層路線需全樓層可見
      rig.goal = frameGoal(routePoints(MODE_EXPLODE[m]), camera.aspect); // 以目標爆炸係數框路徑
    }
    if (m === 'nav') chaseAuto = true;
  }

  function refreshNav(): void {
    if (!followState || !routeEdges || !marker) return;
    marker.position.copy(nodeWorld(currentNodeId(followState)));
    const cur = graph.nodes.get(currentNodeId(followState))!;
    const vEdge = verticalStep(routeEdges, followState);
    if (vEdge) {
      // vertical transition 呈現：雙層強調＋橫幅＋同框兩端（盤問 Q3）
      setFloorEmphasis(stationGroup, [cur.floor, graph.nodes.get(vEdge.to)!.floor]);
      ui.setTransition(transitionLabel(model, graph, vEdge));
      chaseAuto = false;
      rig.goal = frameGoal([nodeWorld(vEdge.from), nodeWorld(vEdge.to)], camera.aspect);
    } else {
      setFloorEmphasis(stationGroup, cur.floor);
      ui.setTransition(null);
      chaseAuto = true;
    }
    const remain = remainingEdges(routeEdges, followState);
    const progress = `節點 ${followState.index + 1}/${followState.nodeIds.length}`;
    if (atEnd(followState)) {
      ui.setNavInfo('已抵達目的地', '', progress);
      ui.showArrive(true);
      return;
    }
    ui.showArrive(false);
    const next = routeSteps(model, graph, remain)[0] ?? '前往下一節點';
    ui.setNavInfo(`下一步：${next}`, `剩餘 ${formatStats(routeStats(remain))}`, progress);
  }

  const ui = setupUI({
    model, landmarks,
    onRoute: (start, end, accessibleOnly) => {
      const sameMsg = sameEndpointMessage(start, end);
      const path = sameMsg ? null : findPath(graph, start, end, { accessibleOnly });
      if (!path || path.length === 0) {
        routeEdges = null;
        refreshRoute();
        ui.setPreview(sameMsg ?? '找不到路徑', [], false);
        return;
      }
      routeEdges = path;
      refreshRoute();
      ui.setPreview(formatStats(routeStats(path)), routeSteps(model, graph, path), true);
      setMode('preview');
    },
    onCancelRoute: () => setMode('overview'),
    onStartNav: () => {
      if (!routeEdges?.length) return;
      followState = startFollow(routeEdges);
      if (!marker) marker = buildPositionMarker();
      scene.add(marker);
      setMode('nav');
      refreshNav();
    },
    onAdvance: () => {
      if (!followState) return;
      followState = advance(followState);
      chaseAuto = true; // 推進恢復跟隨；transition 中 refreshNav 會再關
      refreshNav();
    },
    onBack: () => { if (followState) { followState = back(followState); refreshNav(); } },
    onRecenter: () => { chaseAuto = true; },
    onExitNav: () => setMode('overview'),
    onFloorFocus: (id) => setFloorEmphasis(stationGroup, id),
  });

  // nav 中拖曳＝暫停自動跟隨（回正鈕/推進恢復）
  renderer.domElement.addEventListener('pointerdown', () => {
    if (mode === 'nav') { chaseAuto = false; rig.cancel(); }
  });

  setMode('overview'); // boot：實高 → 爆炸圖展開動畫

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop(() => {
    if (explodeAnim) {
      const t = Math.min(1, (performance.now() - explodeAnim.t0) / EXPLODE_MS);
      explodeFactor = explodeAnim.from + (explodeAnim.to - explodeAnim.from) * easeInOutCubic(t);
      refreshScene();
      if (t >= 1) explodeAnim = null;
    }
    if (mode === 'nav' && followState && marker && chaseAuto && !atEnd(followState)) {
      const nextId = followState.nodeIds[Math.min(followState.index + 1, followState.nodeIds.length - 1)];
      rig.goal = chaseGoal(marker.position, nodeWorld(nextId));
    }
    rig.tick();
    controls.update();
    renderer.render(scene, camera);
  });
}

boot().catch((e) => {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
});
```

- [ ] **Step 2: typecheck 與全套測試**

Run: `npm run typecheck && npm test`
Expected: 全綠（ui/main 無單元測試，靠 typecheck＋Task 15 瀏覽器驗證）

- [ ] **Step 3: Commit（含 Task 12/13）**

```bash
git add index.html src/ui.ts src/main.ts
git commit -m "feat: 四模式 UI——搜尋/路線卡/nav banner/transition/爆炸動畫/chase cam 接線（盤問 Q2-Q8）"
```

### Task 15: 全流程瀏覽器驗證

**Files:** 無（驗證；發現 bug 則修於對應模組並補測試）

- [ ] **Step 1: dev server 起動**（preview_start `dev`），read_console_messages 無錯誤。
- [ ] **Step 2: Overview**：載入即見爆炸圖展開動畫；orbit 可自由旋轉；樓層按鈕 B3 點選→他層變暗、再點→還原；搜尋列輸入「第4」出現過濾清單。
- [ ] **Step 3: Preview**：終點選「臺鐵第4月台（候車）」→起點欄聚焦→選「淡水信義線月台（南端）」→相機自動框住跨樓層路線；卡片顯示「約 X 公尺・約 Y 分鐘」；勾「無障礙路線」→重算，B3 段步驟 ~16 公尺（Stage A 成果在新 UI 的複驗）；展開步驟清單。
- [ ] **Step 4: Navigation**：開始導航→收合至實高、當前樓層實體、他層半透明；chase cam 在 marker 後上方朝前進方向；拖曳→跟隨暫停；「回正」→恢復。
- [ ] **Step 5: Vertical transition**：推進至電梯前節點→雙層強調＋橫幅「搭電梯上行，前往「…」」＋相機同框兩層；「我到了」→相機平滑滑至目標層、恢復 chase。
- [ ] **Step 6: 抵達與返回**：推進至終點→「已抵達」卡→「結束」→回 overview 爆炸圖、路線清除、輸入清空。
- [ ] **Step 7: 回歸**：`?geom=glb` 軌全流程重跑一遍（爆炸位移對 GLB children 同樣生效）；大字/高對比切換；resize_window mobile → 卡片變 bottom sheet、可完成整個流程。
- [ ] **Step 8: 截圖留證**：四模式各一張＋B3 直線化對照一張。
- [ ] **Step 9: 最終驗證與收尾**

Run: `npm run typecheck && npm test && npm run validate`
Expected: 全綠。發現的修正各自 commit 後結束。

---

## Verification（總表）

- `npm test`（新增 6 測試檔全綠、既有 17 檔無不明紅）；`npm run typecheck`；`npm run validate`。
- 瀏覽器四模式全流程（Task 15 步驟 2–7）＋截圖佐證。
- 繞路修復數字：無障礙路線 B3 段 51m → ~16m（Task 3 斷言＋Task 5/15 目視）。

## 風險註記

- 視線邊改變既有路線：更新斷言時逐條人工確認（防測試遷就 bug）。
- 爆炸動畫每幀重建 route tube／connectors：幾何小（<30 mesh）可負擔，但**必須 dispose 舊 geometry**（main.ts `disposeDeep`），否則 GPU 記憶體洩漏。
- GLB 軌爆炸後 connectors 以 runtime 材質重建，與 GLB 原件視覺可能有微差——同色系可接受，Task 15 Step 7 目視確認。
- CatmullRom 對直角的圓滑：直線化後轉角變少；若出現視覺穿牆再調 tension（path.ts）。
- QA Python 復刻圖未同步前不可重掃（工具在 QA 流程側，非本 repo）。
