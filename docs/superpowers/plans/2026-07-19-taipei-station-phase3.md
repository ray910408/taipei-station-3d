# Phase 3：無障礙末段資料 ＋ 導航體驗層 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓無障礙路線真正走到臺鐵月台（B3 轉乘電梯動線），並把靜態路線 demo 升級為可跟隨的導航（地標選起訖、手動節點推進、跟隨相機、手機介面＋大字/高對比）。

**Architecture:** 資料先行（B3 TR 區豎井描圖 → B2 月台 nav ＋ 8 條 connectors → demo 終點延伸），再疊 UI（`nav.ts` 既有 graph/A*/`routeSteps` 不動演算法，新增節點 `name` 欄位與 `listLandmarks`；跟隨模式為純函式狀態機 `follow.ts`，推進事件走單一 `advance()` 介面，Phase 4 PDR 直接掛同一介面）。定位技術（PDR/WiFi/磁力）全數不在本 phase。

**Tech Stack:** three.js + vite + TypeScript、vitest（`environment: 'node'`，UI 邏輯必須純函式化才可測）、tracer 描圖工具、Ajv JSON Schema、GLB 雙軌（export:glb / Khronos 驗證）。

## Global Constraints

- `npm run validate` 必須 0 errors；資料檔一律 `npm run format:data` canonical 排版
- ID 慣例照 `docs/data-conventions.md`：nav node `n-{short}-{三位數}`、connector `c-{esc|stair|elv}-{低short}{高short}-{n}`；短碼 tc/tp/rc/rp
- 每個幾何元素必填 `source`+`confidence`；`status=traced` 僅限經校準底圖以 tracer 重描；推定＝estimated（不標 status）＋`note`
- **不擴充 B1、不建高鐵側轉乘、不做出口/地面層**（盤問決議）
- 資料改動後 GLB 不會自動更新：跑測試前先 `npm run export:glb`
- GLTFExporter 對含旋轉節點寫 `matrix` 而非 `translation`——解析 GLB 驗證位置讀 matrix 第 13–15 元素
- 資料 commit 前送 codex 獨立審（Phase 2 教訓：controller 自審有盲區）
- 直接在 `main` 開發（Phase 2 慣例）；commit 訊息照 repo 風格（`feat:`/`fix:` + 中文摘要），結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 回覆與註解用繁體中文，技術名詞保留英文

## 決策紀錄（2026-07-19 盤問定案）

1. Phase 3 = 先資料範圍擴充，再導航體驗層
2. 資料擴充僅做「無障礙末段」最小集合
3. 末段動線走 B3 轉乘電梯：B4月台→電梯2→B3大廳→捷運閘門→轉乘廊→台鐵轉乘閘門→TR區→轉乘電梯→B2月台；P3/P4 都建，demo 終點預設第 4 月台候車點；B1 完全不動
4. 導航層 UX 完整、定位後補：手動「我到了」推進；PDR→Phase 4、WiFi/磁力→Phase 5（瀏覽器拿不到 WiFi RSSI）
5. 起訖選擇用依樓層分組的地標清單；3D 點選留 Phase 4
6. 跟隨模式採跟隨相機＋當前樓層突顯
7. 無障礙輔助只進大字/高對比（純 CSS）；語音/震動/QR 延後

## 底圖證據（末段動線）

三個官方來源交叉一致——臺鐵 P3/P4 東段「往捷運」梯群含電梯直通 B3 台鐵轉乘區：

- `trtc-section`（refs/trtc-taipei-station/station-section.jpg）：B3 標「台鐵轉乘區 TR Transfer Area」，旁繪含無障礙符號電梯豎井直上臺鐵月台層
- `tra-b2-map`：臺鐵第三/第四月台各有 電扶梯＋電梯＋樓梯 的「往捷運 To MRT」群（高鐵 P1/P2 僅梯，無電梯）
- `tra-b3-map`：B3F 轉乘層平面圖——P3/P4 各一組 樓梯＋電扶梯＋電梯 下至轉乘區、閘門陣列（進站/出站、驗票員位於列端）、自動售票機、台鐵售票區。**注意 N 朝圖右**（旋轉 90°），僅作語意交叉比對、不描圖不校準
- `trtc-info-b3`（已校準 px_per_m 4.08）：西側「台鐵 TR」隔間內繪有兩組梯群紅色梯線——**位置描圖依據**

幾何已知張力：TR 區 polygon 南緣 y≈10.4–12.6，而 P3 月台帶 y −1..10——垂直電梯兩端會有 ~2m 水平錯位，歸因於 tra-b2-map 帶距示意誤差（其校準 basis 已註明「帶距依圖、長寬示意」）。處理方式見 Task 3。

## Task 總覽

| # | 內容 | 型態 |
|---|------|------|
| 1 | nav node `name` 欄位：schema/型別/fixture/`listLandmarks` | code+TDD |
| 2 | B3 TR 區豎井描圖：n-rc-017/018、寬閘門查證 | tracer 手作 |
| 3 | B2 nav ＋ 8 條 rctp connectors ＋ demo 終點 ＋ 整合測試改寫 | data+TDD |
| 4 | 全站地標命名（10 節點） | data |
| 5 | 起訖選擇 UI（地標清單） | code |
| 6 | 跟隨模式：`follow.ts` 狀態機＋marker＋接線 | code+TDD |
| 7 | 跟隨相機＋樓層聚焦 | code |
| 8 | 手機版面＋大字/高對比 | code |
| 9 | 收尾：GLB/文件/codex 獨立審/Blender 驗收/實機檢查 | QA |

---

### Task 1: nav node `name` 欄位（schema/型別/graph 傳遞/地標清單）

**Files:**
- Modify: `schemas/floor.schema.json`（nav nodes properties）
- Modify: `src/types.ts:33`（NavNode）
- Modify: `src/nav.ts`（GraphNode.name、buildGraph 傳遞、新增 `listLandmarks`）
- Modify: `tests/fixtures/mini/data/floors/hall-b1.json`（給 n-ha-002 加 name）
- Test: `tests/nav.test.ts`

**Interfaces:**
- Consumes: 既有 `StationModel`（src/types.ts）、`buildGraph`（src/nav.ts）
- Produces: `NavNode.name?: LocalizedName`；`GraphNode.name?: string`；
  `export interface Landmark { floor: string; floorLabel: string; id: string; label: string }`；
  `export function listLandmarks(model: StationModel): Landmark[]`（依 station.floors 順序，僅列具名節點）——Task 5 的 UI 資料來源

- [ ] **Step 1: 寫失敗測試**（tests/nav.test.ts 檔尾新增；import 行加入 `listLandmarks`）

```ts
import { buildGraph, findPath, routeSteps, listLandmarks } from '../src/nav';
```

```ts
describe('nav node name / listLandmarks', () => {
  it('buildGraph 保留節點中文名', () => {
    expect(graph.nodes.get('n-ha-002')?.name).toBe('測試出口');
    expect(graph.nodes.get('n-pl-001')?.name).toBeUndefined();
  });

  it('listLandmarks 僅列具名節點，依樓層順序', () => {
    const lm = listLandmarks(model);
    expect(lm).toHaveLength(1);
    expect(lm[0]).toMatchObject({ floor: 'hall-b1', id: 'n-ha-002', label: '測試出口' });
    expect(lm[0].floorLabel).toContain('測試大廳');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/nav.test.ts`
Expected: FAIL（`listLandmarks` 不存在 / schema 拒絕 name 造成 assembleModel 丟 LoaderError）

- [ ] **Step 3: schema 擴充**——`schemas/floor.schema.json` nav→nodes→items→properties 加：

```json
"name": { "type": "object", "required": ["zh"], "additionalProperties": false,
  "properties": { "zh": { "type": "string", "minLength": 1 }, "en": { "type": "string" } } }
```

（與 pois 的 name 同形；`additionalProperties: false` 維持）

- [ ] **Step 4: 型別**——`src/types.ts` NavNode 改為：

```ts
export interface NavNode { id: string; xy: Vec2; area?: string; name?: LocalizedName }
```

- [ ] **Step 5: fixture**——`tests/fixtures/mini/data/floors/hall-b1.json` 的節點 `n-ha-002` 加 `"name": { "zh": "測試出口" }`，跑 `npm run format:data` 正規化

- [ ] **Step 6: nav.ts**——GraphNode 加 `name?: string`；buildGraph 節點迴圈改：

```ts
nodes.set(n.id, { id: n.id, floor: meta.id, xy: n.xy, z: meta.elevation, name: n.name?.zh });
```

檔尾新增：

```ts
export interface Landmark { floor: string; floorLabel: string; id: string; label: string }

export function listLandmarks(model: StationModel): Landmark[] {
  const out: Landmark[] = [];
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    for (const n of floor?.nav?.nodes ?? []) {
      if (!n.name) continue;
      out.push({
        floor: meta.id,
        floorLabel: `${meta.labels['complex'] ?? ''} ${meta.name.zh}`.trim(),
        id: n.id,
        label: n.name.zh,
      });
    }
  }
  return out;
}
```

- [ ] **Step 7: 全綠**

Run: `npx vitest run && npm run typecheck && npm run validate`
Expected: 全 PASS、validate 0 errors（真實資料尚無 name，不受影響）

- [ ] **Step 8: Commit**

```bash
git add schemas/floor.schema.json src/types.ts src/nav.ts tests/fixtures/mini/data/floors/hall-b1.json tests/nav.test.ts
git commit -m "feat: nav node 選用中文地標名 name 欄位 + listLandmarks"
```

---

### Task 2: B3 TR 區豎井描圖（tracer 手作）

**Files:**
- Modify: `data/floors/mrt-r-concourse-b3.json`（經 tracer save；nav edges 手改 JSON）
- Modify: `docs/floor-notes/mrt-r-concourse-b3.md`

**Interfaces:**
- Consumes: tracer（`docs/tracer.md`）、已校準底圖 `trtc-info-b3`、語意佐證 `tra-b3-map`/`tra-b2-map`/`trtc-section`
- Produces: nav 節點 `n-rc-017`（P4 轉乘豎井前廳）、`n-rc-018`（P3 轉乘豎井前廳），皆在 `a-rc-tra-paid` 內；walk edges 006↔017、006↔018、017↔018——Task 3 connectors 的 B3 端錨點

- [ ] **Step 1: 開 tracer**——`npm run dev` → `http://localhost:5173/tracer.html` → 樓層 `mrt-r-concourse-b3`、底圖 `trtc-info-b3`（已校準，勿重校）

- [ ] **Step 2: 判讀 TR 隔間**——縮放至西側「台鐵 TR」隔間（local 約 x 75–100、y 10–50）。底圖繪有兩組紅色梯線（北組、中組）。比對 `tra-b3-map`（N 朝圖右）：三月台群與四月台群各含 樓梯+電扶梯+電梯。**對應原則：北組=P4（月台帶 y 20.5–31.5 在北）、中/南組=P3（帶 y −1..10）**，與 trtc-section 剖面一致
- [ ] **Step 3: nav 工具加節點**——各組梯線東側前廳處點擊新增節點（自動序號應為 n-rc-017、n-rc-018，area 自動 `a-rc-tra-paid`；若序號不符，存檔後手改 JSON）。P4 前廳（n-rc-017）預期落在 y≈30–42、P3 前廳（n-rc-018）y≈12–20 一帶，以底圖梯線實際位置為準
- [ ] **Step 4: 寬閘門查證**——縮放 g-rc-tra-acc（線 (95.6,13.3)-(95.2,9.9)，推定於群南端）。tra-b3-map 顯示驗票員崗位於閘門列南端（N 朝圖右→圖左=南），**佐證推定方向正確**。若 trtc-info-b3 可辨識寬閘門專用道：以描繪工具「替換選取元素幾何」重描（自動 status=traced、confidence 表單填 3）；不可辨識則不動幾何，僅把 note 改為「群南端；tra-b3-map 驗票員崗位於列南端佐證」
- [ ] **Step 5: Ctrl+S 儲存**（整批驗證通過才寫檔）
- [ ] **Step 6: edges 手改 JSON**——`data/floors/mrt-r-concourse-b3.json` nav.edges 加三條：

```json
{ "from": "n-rc-006", "to": "n-rc-017", "kind": "walk" },
{ "from": "n-rc-006", "to": "n-rc-018", "kind": "walk" },
{ "from": "n-rc-017", "to": "n-rc-018", "kind": "walk" }
```

- [ ] **Step 7: 正規化＋驗證**

Run: `npm run format:data && npm run validate && npx vitest run`
Expected: validate 0 errors；既有測試全綠

- [ ] **Step 8: floor-notes**——`docs/floor-notes/mrt-r-concourse-b3.md`「重描摘要」補：TR 區兩組轉乘豎井前廳節點（017=P4、018=P3，依 trtc-info-b3 梯線）；「仍未確定」更新：轉乘電梯確切艙位（底圖僅梯線，電梯依 tra-b3-map/trtc-section 語意推定與梯群同組）；記載 tra-b3-map 為平面示意（N 朝圖右）僅語意比對未校準

- [ ] **Step 9: codex 獨立審 → Commit**——附 diff 送 codex 審（重點：節點落點與底圖梯線吻合、area 歸屬、edge 拓撲），修正後：

```bash
git add data/floors/mrt-r-concourse-b3.json docs/floor-notes/mrt-r-concourse-b3.md
git commit -m "feat: B3 TR區轉乘豎井前廳節點 n-rc-017/018 描圖＋寬閘門查證"
```

---

### Task 3: B2 月台 nav ＋ rctp connectors ＋ demo 終點

**Files:**
- Modify: `data/floors/tra-platform-b2.json`（加 nav）
- Modify: `data/connectors.json`（8 條 rctp）
- Modify: `data/station.json`（demo.end）
- Modify: `docs/floor-notes/tra-platform-b2.md`
- Test: `tests/route.integration.test.ts`（改寫）

**Interfaces:**
- Consumes: Task 2 的 `n-rc-017`/`n-rc-018` 實際座標（下記 X4、X3 即其 x 值）
- Produces: B2 節點 `n-tp-001`（P4 落點）、`n-tp-002`（P4 候車，**新 demo 終點**）、`n-tp-003`（P3 落點）、`n-tp-004`（P3 候車）；connectors `c-stair-rctp-1..2`、`c-esc-rctp-1..4`、`c-elv-rctp-1..2`

- [ ] **Step 1: 改寫整合測試（先紅）**——`tests/route.integration.test.ts` 全檔改為：

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, routeSteps } from '../src/nav';
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

describe('真實資料 demo 路徑（Phase 3：終點延伸至臺鐵第4月台）', () => {
  const demo = model.station.demo!;

  it('station.demo 為 B4 月台中段 → B2 第4月台候車點', () => {
    expect(demo).toEqual({ start: 'n-rp-003', end: 'n-tp-002' });
  });

  it('一般路徑存在：出捷運閘門、進臺鐵轉乘閘門、經 rctp 轉乘設施上月台', () => {
    const path = findPath(graph, demo.start, demo.end);
    expect(path).not.toBeNull();
    expect(path!.filter((e) => e.kind === 'gate').length).toBeGreaterThanOrEqual(2);
    expect(path!.some((e) => e.connector?.startsWith('c-') && e.connector.includes('rctp'))).toBe(true);
    expect(path![path!.length - 1].to).toBe('n-tp-002');
  });

  it('無障礙路徑全程 accessible：電梯上月台、走無障礙轉乘閘門', () => {
    const path = findPath(graph, demo.start, demo.end, { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.connector === 'c-elv-rctp-1')).toBe(true);
    expect(path!.some((e) => e.gate === 'g-rc-tra-acc')).toBe(true);
  });

  it('第3月台亦可達（無障礙）', () => {
    const path = findPath(graph, demo.start, 'n-tp-004', { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.some((e) => e.connector === 'c-elv-rctp-2')).toBe(true);
  });

  it('B4 → B1 臺鐵付費區（次要路線）仍可達', () => {
    expect(findPath(graph, 'n-rp-003', 'n-tc-003')).not.toBeNull();
  });

  it('文字步驟含搭電梯至月台層、末步為步行', () => {
    const steps = routeSteps(model, graph, findPath(graph, demo.start, demo.end, { accessibleOnly: true })!);
    expect(steps.some((s) => s.includes('搭電梯至「臺鐵/高鐵月台層」'))).toBe(true);
    expect(steps[steps.length - 1]).toMatch(/^步行約 \d+ 公尺$/);
  });
});
```

Run: `npx vitest run tests/route.integration.test.ts` → Expected: FAIL（n-tp-002 不存在）

- [ ] **Step 2: B2 nav**——`data/floors/tra-platform-b2.json` 檔尾（areas 之後）加 nav。座標規則：
  - `n-tp-001` = [min(X4, 94), clamp(n-rc-017.y, 21.5, 30.5)]（P4 帶內、距帶緣≥1m）
  - `n-tp-002` = [n-tp-001.x − 15, 26]（帶中心線西移 15m 候車點）
  - `n-tp-003` = [min(X3, 94), clamp(n-rc-018.y, 0, 9)]（P3 帶內；與 n-rc-018 的 y 錯位≤3m 屬預期，見 Step 5）
  - `n-tp-004` = [n-tp-003.x − 15, 4.5]

```json
"nav": {
  "nodes": [
    { "id": "n-tp-001", "xy": [<依規則>, <依規則>], "area": "a-tp-plat-4" },
    { "id": "n-tp-002", "xy": [<依規則>, 26], "area": "a-tp-plat-4" },
    { "id": "n-tp-003", "xy": [<依規則>, <依規則>], "area": "a-tp-plat-3" },
    { "id": "n-tp-004", "xy": [<依規則>, 4.5], "area": "a-tp-plat-3" }
  ],
  "edges": [
    { "from": "n-tp-001", "to": "n-tp-002", "kind": "walk" },
    { "from": "n-tp-003", "to": "n-tp-004", "kind": "walk" }
  ]
}
```

（`<依規則>` 於執行時代入上列公式的數值——公式即為完整規格，非留白）

- [ ] **Step 3: connectors**——`data/connectors.json` 陣列尾加 8 條（P4 經 n-rc-017、P3 經 n-rc-018；levels 低→高＝B3(−21)→B2(−14)；電梯 accessible:true、梯/電扶梯 false；system 皆 tra；source 皆 `tra-b3-map`、confidence 2，位置繼承 traced 節點故 connector 本身不標 status）：

```json
{ "id": "c-stair-rctp-1", "kind": "stair", "system": "tra", "direction": "both", "accessible": false,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-017" }, { "floor": "tra-platform-b2", "node": "n-tp-001" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第4月台往捷運轉乘樓梯（B3 TR區↔B2）" },
{ "id": "c-esc-rctp-1", "kind": "escalator", "system": "tra", "direction": "up", "accessible": false,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-017" }, { "floor": "tra-platform-b2", "node": "n-tp-001" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第4月台轉乘電扶梯上行" },
{ "id": "c-esc-rctp-2", "kind": "escalator", "system": "tra", "direction": "down", "accessible": false,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-017" }, { "floor": "tra-platform-b2", "node": "n-tp-001" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第4月台轉乘電扶梯下行" },
{ "id": "c-elv-rctp-1", "kind": "elevator", "system": "tra", "direction": "both", "accessible": true,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-017" }, { "floor": "tra-platform-b2", "node": "n-tp-001" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第4月台轉乘電梯（tra-b2-map 往捷運群含電梯、trtc-section 無障礙符號佐證）" },
{ "id": "c-stair-rctp-2", "kind": "stair", "system": "tra", "direction": "both", "accessible": false,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-018" }, { "floor": "tra-platform-b2", "node": "n-tp-003" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第3月台往捷運轉乘樓梯（B3 TR區↔B2）" },
{ "id": "c-esc-rctp-3", "kind": "escalator", "system": "tra", "direction": "up", "accessible": false,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-018" }, { "floor": "tra-platform-b2", "node": "n-tp-003" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第3月台轉乘電扶梯上行" },
{ "id": "c-esc-rctp-4", "kind": "escalator", "system": "tra", "direction": "down", "accessible": false,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-018" }, { "floor": "tra-platform-b2", "node": "n-tp-003" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第3月台轉乘電扶梯下行" },
{ "id": "c-elv-rctp-2", "kind": "elevator", "system": "tra", "direction": "both", "accessible": true,
  "levels": [ { "floor": "mrt-r-concourse-b3", "node": "n-rc-018" }, { "floor": "tra-platform-b2", "node": "n-tp-003" } ],
  "source": "tra-b3-map", "confidence": 2, "note": "第3月台轉乘電梯（同 P4 佐證）" }
```

- [ ] **Step 4: demo 終點**——`data/station.json`：`"demo": { "start": "n-rp-003", "end": "n-tp-002" }`

- [ ] **Step 5: 正規化＋驗證＋測試綠**

Run: `npm run format:data && npm run validate && npm run export:glb && npx vitest run && npm run typecheck`
Expected: validate 0 errors、整合測試全綠、GLB parity 綠（新 connectors 走既有比對路徑）

- [ ] **Step 6: floor-notes**——`docs/floor-notes/tra-platform-b2.md`：「重描摘要」補 nav 四節點與來源推理；「仍未確定」更新：P3 落點與 B3 前廳 y 錯位 ≤3m（tra-b2-map 帶距示意誤差）、電梯艙位為語意推定；月台實際長度未變仍未定

- [ ] **Step 7: codex 獨立審 → Commit**——附 diff 送審（重點：connector 方向/accessible 語意、節點帶內 clamp、demo 路徑合理性），修正後：

```bash
git add data/floors/tra-platform-b2.json data/connectors.json data/station.json docs/floor-notes/tra-platform-b2.md tests/route.integration.test.ts
git commit -m "feat: B2 月台 nav＋B3↔B2 轉乘 connectors（rctp×8），demo 終點延伸至第4月台"
```

---

### Task 4: 全站地標命名

**Files:**
- Modify: `data/floors/mrt-r-platform-b4.json`、`data/floors/mrt-r-concourse-b3.json`、`data/floors/tra-concourse-b1.json`、`data/floors/tra-platform-b2.json`

**Interfaces:**
- Consumes: Task 1 的 name 欄位
- Produces: 10 個具名節點——Task 5 清單的實際內容

- [ ] **Step 1: 加 name**（各檔對應節點加 `"name": { "zh": "…" }`）：

| 節點 | zh |
|------|----|
| n-rp-003 | 淡水信義線月台（中段） |
| n-rp-001 | 淡水信義線月台（南端） |
| n-rp-005 | 淡水信義線月台（北端） |
| n-rc-001 | R線大廳南段（付費區） |
| n-rc-004 | R線大廳 詢問處1外（非付費） |
| n-rc-006 | 台鐵轉乘區（B3） |
| n-tc-002 | B1 東剪票口外（非付費） |
| n-tc-003 | B1 臺鐵東付費島 |
| n-tp-002 | 臺鐵第4月台（候車） |
| n-tp-004 | 臺鐵第3月台（候車） |

- [ ] **Step 2: 驗證**

Run: `npm run format:data && npm run validate && npx vitest run`
Expected: 0 errors、全綠

- [ ] **Step 3: Commit**

```bash
git add data/floors/
git commit -m "feat: 起訖選擇用地標名——10 個 nav 節點加中文 name"
```

---

### Task 5: 起訖選擇 UI（地標清單）

**Files:**
- Modify: `index.html`（選擇器標記＋樣式）
- Modify: `src/ui.ts`（清單填充、選擇取值）
- Modify: `src/main.ts`（onRoute 帶起訖）

**Interfaces:**
- Consumes: `listLandmarks(model)`（Task 1）、`model.station.demo`（預設值）
- Produces: `setupUI` 新簽名（Task 6 會再擴充）：

```ts
export function setupUI(opts: {
  model: StationModel;
  stationGroup: THREE.Group;
  landmarks: Landmark[];
  onRoute: (start: string, end: string, accessibleOnly: boolean) => void;
  onClear: () => void;
}): UIHandles  // UIHandles 不變：{ setSteps(steps: string[]): void }
```

- [ ] **Step 1: index.html**——`#floors` div 之後、透明度 label 之前插入：

```html
    <label>起點 <select id="sel-start"></select></label>
    <label>終點 <select id="sel-end"></select></label>
```

`<style>` 內 `#panel label` 規則後加：

```css
    #panel select { width: 100%; margin-top: 2px; padding: 4px; background: #14171c;
      color: #e8e8e8; border: 1px solid #3a4250; border-radius: 4px; }
```

- [ ] **Step 2: ui.ts**——簽名照上記 Produces；`setupUI` 內（floors 迴圈後）加：

```ts
  const selStart = document.querySelector<HTMLSelectElement>('#sel-start')!;
  const selEnd = document.querySelector<HTMLSelectElement>('#sel-end')!;
  for (const sel of [selStart, selEnd]) {
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const lm of opts.landmarks) {
      let og = groups.get(lm.floorLabel);
      if (!og) {
        og = document.createElement('optgroup');
        og.label = lm.floorLabel;
        groups.set(lm.floorLabel, og);
        sel.append(og);
      }
      const o = document.createElement('option');
      o.value = lm.id;
      o.textContent = lm.label;
      og.append(o);
    }
  }
  const demo = model.station.demo;
  if (demo) { selStart.value = demo.start; selEnd.value = demo.end; }
```

route 按鈕改叫 `opts.onRoute(selStart.value, selEnd.value, false/true)`；`hasDemo` 判斷改為 `opts.landmarks.length >= 2 || Boolean(model.station.demo)`（清單有內容即可路由），title 文案改「請先於資料加入具名節點」

- [ ] **Step 3: main.ts**——import 加 `listLandmarks`；`setupUI` 呼叫改：

```ts
  const ui = setupUI({
    model, stationGroup,
    landmarks: listLandmarks(model),
    onClear: clearRoute,
    onRoute: (start, end, accessibleOnly) => {
      clearRoute();
      const path = findPath(graph, start, end, { accessibleOnly });
      if (!path) { ui.setSteps(['找不到路徑']); return; }
      routeEdges = path;
      routeObj = buildRouteObject(graph, path);
      scene.add(routeObj);
      ui.setSteps(routeSteps(model, graph, path));
    },
  });
```

（`let routeEdges: GraphEdge[] | null = null;` 先宣告於 graph 之後——Task 6 使用；import type `GraphEdge`）

- [ ] **Step 4: 驗證**

Run: `npm run typecheck && npx vitest run`；Browser pane：`npm run dev` → 首頁選「淡水信義線月台（北端）」→「臺鐵第3月台（候車）」→ 無障礙路徑 → 路線顯示、步驟含「搭電梯」
Expected: 型別/測試綠；手測路線隨選擇改變

- [ ] **Step 5: Commit**

```bash
git add index.html src/ui.ts src/main.ts
git commit -m "feat: 起訖地標清單選擇（依樓層分組，demo 起訖為預設值）"
```

---

### Task 6: 跟隨模式（狀態機＋marker＋接線）

**Files:**
- Create: `src/follow.ts`
- Modify: `index.html`（跟隨面板）
- Modify: `src/ui.ts`（跟隨區塊接線）
- Modify: `src/main.ts`（狀態持有與更新）
- Test: `tests/follow.test.ts`

**Interfaces:**
- Consumes: `GraphEdge`/`NavGraph`（src/nav.ts）、`toWorld`（src/builder.ts）、`routeSteps`
- Produces（src/follow.ts，Phase 4 PDR 掛 `advance` 同一介面）：

```ts
export interface FollowState { nodeIds: string[]; index: number }
export function startFollow(edges: GraphEdge[]): FollowState
export function advance(s: FollowState): FollowState
export function back(s: FollowState): FollowState
export function atEnd(s: FollowState): boolean
export function currentNodeId(s: FollowState): string
export function remainingEdges(edges: GraphEdge[], s: FollowState): GraphEdge[]
export function buildPositionMarker(): THREE.Group
```

- ui.ts `UIHandles` 擴充為：

```ts
export interface UIHandles {
  setSteps(steps: string[]): void;
  showFollow(on: boolean): void;                 // 切換 路線按鈕列 ↔ 跟隨面板
  setFollowInfo(next: string, progress: string): void;
  setFollowReady(on: boolean): void;             // 「開始導航」啟用
}
```

　`setupUI` opts 增加 `onStartFollow: () => void; onAdvance: () => void; onBack: () => void; onExitFollow: () => void;`

- [ ] **Step 1: 寫失敗測試**——`tests/follow.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { startFollow, advance, back, atEnd, currentNodeId, remainingEdges } from '../src/follow';
import type { GraphEdge } from '../src/nav';

const e = (from: string, to: string): GraphEdge =>
  ({ from, to, kind: 'walk', accessible: true, length: 5 });
const edges = [e('a', 'b'), e('b', 'c'), e('c', 'd')];

describe('follow 狀態機', () => {
  it('startFollow 展開節點序列，起點為第 0 節點', () => {
    const s = startFollow(edges);
    expect(s.nodeIds).toEqual(['a', 'b', 'c', 'd']);
    expect(currentNodeId(s)).toBe('a');
    expect(atEnd(s)).toBe(false);
  });

  it('advance 逐節點推進，到終點夾住', () => {
    let s = startFollow(edges);
    s = advance(s); expect(currentNodeId(s)).toBe('b');
    s = advance(advance(s)); expect(currentNodeId(s)).toBe('d');
    expect(atEnd(s)).toBe(true);
    expect(currentNodeId(advance(s))).toBe('d');
  });

  it('back 回退，起點夾住', () => {
    let s = advance(startFollow(edges));
    s = back(s); expect(currentNodeId(s)).toBe('a');
    expect(currentNodeId(back(s))).toBe('a');
  });

  it('remainingEdges 回傳自目前節點起的殘餘邊', () => {
    const s = advance(startFollow(edges));
    expect(remainingEdges(edges, s).map((x) => x.to)).toEqual(['c', 'd']);
  });

  it('空路線丟錯', () => {
    expect(() => startFollow([])).toThrow();
  });
});
```

Run: `npx vitest run tests/follow.test.ts` → Expected: FAIL（模組不存在）

- [ ] **Step 2: src/follow.ts**：

```ts
import * as THREE from 'three';
import type { GraphEdge } from './nav';

// 跟隨模式狀態：路線＝節點序列，index＝目前所在節點。
// 推進事件只走 advance()——Phase 4 PDR 自動推進掛同一介面。
export interface FollowState { nodeIds: string[]; index: number }

export function startFollow(edges: GraphEdge[]): FollowState {
  if (edges.length === 0) throw new Error('空路線無法導航');
  return { nodeIds: [edges[0].from, ...edges.map((e) => e.to)], index: 0 };
}

export const advance = (s: FollowState): FollowState =>
  ({ ...s, index: Math.min(s.index + 1, s.nodeIds.length - 1) });

export const back = (s: FollowState): FollowState =>
  ({ ...s, index: Math.max(s.index - 1, 0) });

export const atEnd = (s: FollowState): boolean => s.index === s.nodeIds.length - 1;

export const currentNodeId = (s: FollowState): string => s.nodeIds[s.index];

export const remainingEdges = (edges: GraphEdge[], s: FollowState): GraphEdge[] =>
  edges.slice(s.index);

export function buildPositionMarker(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'position-marker';
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 2.2, 16),
    new THREE.MeshBasicMaterial({ color: '#ffb020' }),
  );
  cone.rotation.x = Math.PI; // 尖端朝下指樓面
  cone.position.y = 1.1;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.12, 8, 24),
    new THREE.MeshBasicMaterial({ color: '#ffb020' }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.1;
  g.add(cone, ring);
  return g;
}
```

- [ ] **Step 3: 測試綠**

Run: `npx vitest run tests/follow.test.ts` → Expected: PASS

- [ ] **Step 4: index.html**——按鈕列之後、`<ol id="steps">` 之前加：

```html
    <button id="btn-follow" disabled>開始導航</button>
    <div id="follow-panel" style="display:none">
      <div id="follow-next"></div>
      <div id="follow-progress"></div>
      <button id="btn-advance">我到了</button>
      <button id="btn-back">上一步</button>
      <button id="btn-exit-follow">結束導航</button>
    </div>
```

`<style>` 加：

```css
    #follow-next { font-size: 16px; font-weight: 700; margin: 8px 0 2px; }
    #follow-progress { color: #9fb0c4; margin-bottom: 4px; }
    #btn-advance { font-size: 16px; }
```

- [ ] **Step 5: ui.ts**——照 Interfaces 區塊擴充：查 `#btn-follow`、`#follow-panel`、`#follow-next`、`#follow-progress`、`#btn-advance`、`#btn-back`、`#btn-exit-follow`；click 分別呼叫 `opts.onStartFollow/onAdvance/onBack/onExitFollow`；實作：

```ts
  function showFollow(on: boolean): void {
    followPanel.style.display = on ? 'block' : 'none';
    for (const b of [btnRoute, btnAcc, btnClear, btnFollow]) b.style.display = on ? 'none' : '';
    selStart.disabled = on;
    selEnd.disabled = on;
  }
  function setFollowInfo(next: string, progress: string): void {
    followNext.textContent = next;
    followProgress.textContent = progress;
  }
  function setFollowReady(on: boolean): void { btnFollow.disabled = !on; }
```

　`onClear` 既有流程外加 `setFollowReady(false)`；`onRoute` 成功後 main 端會呼叫 `setFollowReady(true)`

- [ ] **Step 6: main.ts 接線**——import 區調整（builder 既有 import 行加 `toWorld`）：

```ts
import { buildStationGroup, toWorld } from './builder';
import {
  startFollow, advance, back, atEnd, currentNodeId, remainingEdges,
  buildPositionMarker, type FollowState,
} from './follow';
```

　狀態與更新函式：

```ts
  let followState: FollowState | null = null;
  let marker: THREE.Group | null = null;

  const nodeWorld = (id: string): THREE.Vector3 => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z);
  };

  function refreshFollow(): void {
    if (!followState || !routeEdges) return;
    marker!.position.copy(nodeWorld(currentNodeId(followState)));
    if (atEnd(followState)) {
      ui.setFollowInfo('已抵達目的地', `節點 ${followState.index + 1}/${followState.nodeIds.length}`);
      return;
    }
    const next = routeSteps(model, graph, remainingEdges(routeEdges, followState))[0] ?? '前往下一節點';
    ui.setFollowInfo(`下一步：${next}`, `節點 ${followState.index + 1}/${followState.nodeIds.length}`);
  }
```

　`onStartFollow`：`followState = startFollow(routeEdges!); marker = buildPositionMarker(); scene.add(marker); ui.showFollow(true); refreshFollow();`
　`onAdvance`：`followState = advance(followState!); refreshFollow();`
　`onBack`：`followState = back(followState!); refreshFollow();`
　`onExitFollow`：移除 marker、`followState = null`、`ui.showFollow(false)`
　`onRoute` 成功分支尾端加 `ui.setFollowReady(true);`（失敗分支 `ui.setFollowReady(false);`）

- [ ] **Step 7: 全綠＋手測**

Run: `npm run typecheck && npx vitest run`；Browser pane：選路線→開始導航→連點「我到了」至抵達、上一步回退、結束導航恢復按鈕列
Expected: 標記逐節點移動跨樓層、「下一步」文字隨位置更新

- [ ] **Step 8: Commit**

```bash
git add src/follow.ts tests/follow.test.ts index.html src/ui.ts src/main.ts
git commit -m "feat: 跟隨模式——節點推進狀態機、位置標記、我到了/上一步"
```

---

### Task 7: 跟隨相機＋樓層聚焦

**Files:**
- Modify: `src/follow.ts`（加 `setFloorEmphasis`）
- Modify: `src/main.ts`（相機 lerp＋樓層切換）

**Interfaces:**
- Consumes: Task 6 的 followState/marker、`GraphNode.floor`
- Produces: `export function setFloorEmphasis(stationGroup: THREE.Group, activeFloorId: string | null): void`（null＝全部還原）

- [ ] **Step 1: setFloorEmphasis**——`src/follow.ts` 檔尾加：

```ts
export function setFloorEmphasis(stationGroup: THREE.Group, activeFloorId: string | null): void {
  for (const child of stationGroup.children) {
    if (child.name === 'connectors') continue;
    const dim = activeFloorId !== null && child.name !== activeFloorId;
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (!m?.isMaterial) return;
      if (mesh.userData.baseOpacity === undefined) {
        // GLB 軌 material 可能跨 mesh 共用——首次調整前 clone，避免調暗洩漏到其他樓層
        mesh.material = m.clone();
        mesh.userData.baseOpacity = (mesh.material as THREE.MeshStandardMaterial).opacity;
      }
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.transparent = true;
      mat.opacity = (mesh.userData.baseOpacity as number) * (dim ? 0.15 : 1);
    });
  }
}
```

- [ ] **Step 2: main.ts**——follow import 行加入 `setFloorEmphasis`；`refreshFollow` 尾端加：

```ts
    setFloorEmphasis(stationGroup, graph.nodes.get(currentNodeId(followState))!.floor);
```

　`onExitFollow` 加 `setFloorEmphasis(stationGroup, null);`
　動畫迴圈改：

```ts
  renderer.setAnimationLoop(() => {
    if (marker && followState) controls.target.lerp(marker.position, 0.08);
    controls.update();
    renderer.render(scene, camera);
  });
```

- [ ] **Step 3: 手測（雙軌）**

Browser pane：`/` 與 `/?geom=glb` 各跑一次跟隨——相機平滑追標記、跨樓層時前樓層淡出且不互相洩漏、結束導航還原、既有透明度 slider 仍作用
Expected: 兩軌行為一致（GLB 軌靠 clone 防共用 material 洩漏）

- [ ] **Step 4: Commit**

```bash
git add src/follow.ts src/main.ts
git commit -m "feat: 跟隨相機 lerp＋當前樓層聚焦（GLB 軌 material clone 防洩漏）"
```

---

### Task 8: 手機版面＋大字/高對比

**Files:**
- Modify: `index.html`（media query、切換鈕、body class 樣式）
- Modify: `src/ui.ts`（兩顆切換鈕接線）

**Interfaces:**
- Consumes: 既有 `#panel` DOM
- Produces: body class `big-text` / `high-contrast`；無新模組介面

- [ ] **Step 1: index.html**——`#panel h1` 旁加兩顆鈕（h1 之後）：

```html
    <div id="a11y-toggles">
      <button id="btn-bigtext" aria-pressed="false">大字</button>
      <button id="btn-contrast" aria-pressed="false">高對比</button>
    </div>
```

`<style>` 尾端加：

```css
    #panel button { min-height: 36px; }
    body.big-text #panel { font-size: 18px; width: 300px; }
    body.big-text #follow-next { font-size: 22px; }
    body.big-text #panel button { font-size: 18px; min-height: 44px; }
    body.high-contrast #panel { background: #000; border-color: #fff; color: #fff; }
    body.high-contrast #panel button { background: #ffd60a; color: #000; font-weight: 700; }
    body.high-contrast #panel button:disabled { background: #555; color: #bbb; }
    body.high-contrast #follow-progress { color: #fff; }
    @media (max-width: 600px) {
      #panel { top: auto; bottom: 0; left: 0; right: 0; width: auto;
        border-radius: 12px 12px 0 0; max-height: 48vh; overflow-y: auto; }
      #panel button { min-height: 44px; padding: 8px 14px; }
      #steps { max-height: 20vh; }
    }
```

- [ ] **Step 2: ui.ts**——setupUI 內加：

```ts
  for (const [btnId, cls] of [['btn-bigtext', 'big-text'], ['btn-contrast', 'high-contrast']] as const) {
    const b = document.querySelector<HTMLButtonElement>(`#${btnId}`)!;
    b.addEventListener('click', () => {
      const on = document.body.classList.toggle(cls);
      b.setAttribute('aria-pressed', String(on));
    });
  }
```

- [ ] **Step 3: 手測**

Browser pane：`resize_window` preset mobile → 面板成底部抽屜、按鈕可點；切大字/高對比各截圖一張
Expected: 三種狀態版面不破

- [ ] **Step 4: Commit**

```bash
git add index.html src/ui.ts
git commit -m "feat: 手機底部面板＋大字/高對比切換"
```

---

### Task 9: 收尾——GLB/文件/獨立審/Blender 驗收/實測

**Files:**
- Modify: `README.md`（範圍句與功能列）
- Modify: `docs/data-conventions.md`（nav node name 慣例一行）
- Test: 全套

- [ ] **Step 1: 全套驗證**

Run: `npm run validate && npm run format:data -- --check && npm run export:glb && npm run validate:glb && npx vitest run && npm run typecheck`
Expected: 全綠、Khronos 0 errors/0 warnings

- [ ] **Step 2: README**——範圍句改為「…→ 臺鐵第3/4月台候車點（B3 轉乘電梯動線）」；指令段後功能列加一行：「導航跟隨模式：地標選起訖、我到了逐節點推進、跟隨相機、大字/高對比」

- [ ] **Step 3: data-conventions**——「Phase 2 增補慣例」後加「Phase 3 增補」小節：nav node 選用 `name.zh` 為起訖清單地標名；具名節點才進選擇器

- [ ] **Step 4: Blender 驗收**——比照 Phase 2：Blender MCP（port 9876）匯入 `public/models/station.glb`，檢查：四樓層命名不變、新 rctp 豎井/斜坡量體存在且無破面、共用錨點群（017/018 各 4 條）側向偏移不重合、B2 月台帶上節點位置合理

- [ ] **Step 5: 外部獨立審**——整包 phase diff（`git diff 618a504..HEAD`，618a504＝Phase 3 起點）送 codex sol 終審；findings 逐項修正或記 floor-notes

- [ ] **Step 6: Browser pane 端到端**——桌面＋mobile 尺寸各一輪：選起訖（B4 北端→P3 候車）→ 無障礙路徑 → 開始導航 → 推進至抵達 → 結束導航；`?geom=glb` 重複跟隨一輪；console 無錯誤

- [ ] **Step 7: Commit**

```bash
git add README.md docs/data-conventions.md
git commit -m "docs: Phase 3 範圍與跟隨模式說明、nav name 慣例"
```

---

## 明確不做（後移路線圖）

- **Phase 4**：PDR（DeviceMotion 步伐偵測沿邊推進、節點 snap；iOS 需 https＋手勢授權）、3D 點選起訖、語音播報、自動播放模擬
- **Phase 5**：WiFi RSSI（瀏覽器無此 API——須 Android 原生＋現場指紋採集，屆時重新評估平台）、磁場定位（現場採集＋月台列車強磁干擾風險）
- B1 擴充、高鐵側轉乘（P1/P2 往捷運無電梯）、出口/地面層、B2 梯群開口 units（connector 斜坡量體已足；Blender 驗收若見穿板疑義記 floor-notes 即可）
