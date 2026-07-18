# 台北車站室內 3D 導航 Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立網頁描圖工具（tracer）、以校準底圖將四層幾何全面重描到 `status: traced`，並建立 GLB 雙軌（離線匯出 + viewer 載入），三者皆有自動化驗證。

**Architecture:** tracer 是同 repo 的第二個 Vite 頁（`tracer.html`），canvas 2D 疊「校準後的參考圖 + 樓層 JSON 幾何」，描完經 dev server 的 save API「整批驗證通過才寫檔」，viewer 熱重載即時看 3D 結果。校準以每張圖 2 個控制點求相似變換（縮放+旋轉+平移），寫入 `refs/sources.json` 的 `calibration.control_points`。GLB 軌把既有純函式 `buildStationGroup` 在 node 以 GLTFExporter 離線匯出 `station.glb`，viewer 以 `?geom=glb` 切換 GLTFLoader 載入，round-trip parity 測試 + Khronos gltf-validator 把關。

**Tech Stack:** 沿用 TypeScript(strict) + Vite 6 + three.js 0.180 + Ajv(2020-12) + Vitest 3。新增 devDeps 僅 `vite-node`（node 跑 TS 匯出腳本）與 `gltf-validator`（Khronos 驗證器）。無 UI framework。

**Spec:** Phase 1 spec `docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md` 的資料規則全部沿用；Phase 2 設計決策內嵌本計畫（下節），無獨立 spec。

## 決策紀錄（2026-07-18 與使用者確認）

| 決策 | 結論 | 理由 |
|---|---|---|
| tracer 存檔方式 | dev server 直接寫回：Vite plugin 提供 `POST /__tracer/save`，整批驗證通過才寫檔 | 描圖↔3D 驗證迴圈最短；validator 前置把關，不會寫入壞資料 |
| 幾何精修範圍 | 四層全面重描到 `traced`，補明顯缺漏（梯群開口、月台電梯2、B3 南閘門群、B1 柱列） | 樓層間精度一致；工作量中等、成果完整 |
| GLB 驗收 | 內外雙驗：viewer 雙軌視覺一致 + 自動 parity 測試 + Khronos validator 0 errors + 外部工具（Blender/線上 viewer）人工開檔 | GLB 本來就是為了可攜 |
| tracer nav 支援 | 先含 nav node（放置/拖移/自動序號與 area），edge 仍手寫 JSON；架構預留完整 nav 編輯擴充 | 重描時 node 幾乎都要跟著搬是剛需；edge 數量少手寫可承受 |

## 範圍與明確不做（YAGNI）

- tracer 不做：多選、複製貼上、量測工具、nav edge 編輯（工具物件架構已預留擴充點）、影像亮度對比調整、元素級刪除 UI（避免懸空引用，nav node 除外）、行動裝置支援。
- 資料不做：B1 西半站體（售票大廳全貌）、高鐵轉乘區、板南線、月台門、B2 軌道面與 nav。
- GLB 不做：Draco 壓縮、貼圖、LOD、逐樓層分檔匯出。
- 不動既有元素/節點 id（nav 錨點是 connectors 的契約）；不改 demo 起訖（`n-rp-003` → `n-rc-006`）。

## Global Constraints

- 沿用 Phase 1 全部資料規則（`docs/data-conventions.md`）：local 公尺座標、`|x|,|y| < 500`、polygon 開環、outline/polygon 逆時針、holes 順時針、每幾何元素必填 `source` + `confidence`、ID 前綴含 floor short（tc/tp/rc/rp）。
- **status 規則（Phase 2 新增）**：經校準底圖以 tracer 重描 → `status: "traced"`（其來源必須有 `calibration`，validator 會警告）；未重描或推測補充 → 維持 `estimated`（不標）。`verified` 本階段不用。
- **confidence 基準**：官方站圖上清晰可辨並描繪 = 3；圖上判讀含糊 = 2；1 不使用；4–5 保留給實測。`calibration.status` 一律 `"estimated"`。
- 座標一律取 0.1 m（tracer 自動 round）；控制點 px 取整數。
- **資料檔唯一序列化格式** = `tools/format-data.mjs`（Task 2）；任何資料變更後跑 `npm run validate` 與 `npm run format:data`。
- tracer 為 dev-only 工具：save API 只在 `npm run dev` 存在；tracer 是獨立 entry，不進 viewer bundle。
- 既有樓層/元素/節點 id 一律不改名；新 id 依 data-conventions 慣例。
- 依賴新增僅限 devDeps：`vite-node`、`gltf-validator`（Task 10）。禁止引入 UI framework。
- 程式任務 TDD（先寫失敗測試）；資料任務以 `npm run validate` + integration test + viewer 目視驗證。
- 每個 task 結尾 commit，訊息繁體中文、結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- Windows/PowerShell 環境（codex 執行時）：命令用 `npm.cmd` / `npx.cmd`，不可用 `&&` 串接；非互動執行，遇阻回報 `BLOCKED` 不亂猜；同一測試修兩次仍敗即停。
- three.js 對映不變：`toWorld([x,y], elev) = (x, elev, −y)`（Y-up）。樓層高程：tc −8(h5)、tp −14(h4.5)、rc −21(h4.5)、rp −28(h4.5)。

## Task 總覽

| # | 工作流 | 內容 | 產出 |
|---|---|---|---|
| 1 | 基礎 | 校準變換數學 + calibration schema 擴充 + validator 警告 | `src/tracer/transform.ts`、schema/型別、validator 增檢 |
| 2 | 基礎 | canonical JSON 序列化器 + 全資料正規化 | `tools/format-data.mjs`、`npm run format:data` |
| 3 | 基礎 | 整批 save API（驗證通過才寫檔） | `tools/save-handler.mjs`、vite plugin |
| 4 | 描圖工具 | tracer 頁骨架：檢視/渲染/幾何存取/狀態（唯讀） | `tracer.html`、`src/tracer/{view,geom,render,store,main}.ts`、`src/palette.ts` |
| 5 | 描圖工具 | 校準模式 + B4 底圖實際校準 | `src/tracer/tool-calibrate.ts`、`trtc-info-b4` calibration |
| 6 | 描圖工具 | 編輯核心：描繪/頂點編輯/nav node/undo/save | `src/tracer/{edit,tool-edit}.ts` |
| 7 | 幾何精修 | B4 月台層全面重描 + 電梯2 節點 | `mrt-r-platform-b4.json`、floor-note |
| 8 | 幾何精修 | B3 大廳層重描 + 南閘門群 + 電梯2 connector | `mrt-r-concourse-b3.json`、`connectors.json`、floor-note |
| 9 | 幾何精修 | B1/B2 重描 + 柱列 + 全站回歸 | `tra-*.json`、floor-notes |
| 10 | GLB | 材質 Standard 化 + 離線匯出 + Khronos 驗證 | `tools/export-glb.ts`、`tools/validate-glb.mjs`、scripts |
| 11 | GLB | viewer GLB 軌（`?geom=glb`）+ round-trip parity 測試 | `src/main.ts`、`tests/glb-roundtrip.test.ts` |
| 12 | 收尾 | 文件（tracer 使用說明/conventions/README）+ 外部開檔 QA | `docs/tracer.md` 等 |

依賴關係：1→(2,3 可並行)→4→5→6→7→8→9；10→11 可在 6 之後任何時點插入（建議照序，讓 GLB 匯出的是精修後幾何）；12 收尾。

---

### Task 1: 校準變換數學 + calibration schema 擴充

**Files:**
- Create: `src/tracer/transform.ts`
- Test: `tests/tracer-transform.test.ts`
- Modify: `schemas/sources.schema.json`（calibration 加 `control_points`）
- Modify: `src/types.ts`（追加 Calibration/SourceRef/SourcesDoc 型別）
- Modify: `tools/validate.mjs`（calibration 一致性 + traced 需校準來源，兩類警告）
- Modify: `tests/validate.test.ts`（新增 3 個 case）

**Interfaces:**
- Produces: `fitSimilarity(cps: [CalibrationControlPoint, CalibrationControlPoint]): PxTransform`、`pxToLocal(t, px): Vec2`、`localToPx(t, xy): Vec2`、`pxPerM(t): number`；型別 `PxTransform { c; d; u0; v0; x0; y0 }`、`CalibrationControlPoint { px: Vec2; local: Vec2 }`、`Calibration`、`SourceRef`、`SourcesDoc`。Task 3–6 全部依賴。
- 數學模型：`x = c·Δu + d·Δv + x0`、`y = d·Δu − c·Δv + y0`（Δu=u−u0、Δv=v−v0）。影像 u 向右、v 向下，local x 向東、y 向北——v 軸翻轉內建於係數，兩個控制點閉式解。

- [ ] **Step 1: 寫失敗測試**

`tests/tracer-transform.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { fitSimilarity, localToPx, pxPerM, pxToLocal } from '../src/tracer/transform';
import type { CalibrationControlPoint } from '../src/types';

const cp = (px: [number, number], local: [number, number]): CalibrationControlPoint => ({ px, local });

describe('fitSimilarity / pxToLocal / localToPx', () => {
  it('軸對齊：100px=10m、影像向下為南', () => {
    const t = fitSimilarity([cp([100, 200], [0, 0]), cp([300, 200], [20, 0])]);
    expect(pxToLocal(t, [100, 200])).toEqual([0, 0]);
    expect(pxToLocal(t, [300, 200])).toEqual([20, 0]);
    const p = pxToLocal(t, [100, 300]);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(-10, 9); // 影像往下 100px = local 往南 10m
    expect(pxPerM(t)).toBeCloseTo(10, 9);
  });

  it('旋轉 90°：影像向下對應 local 東、影像向右對應 local 北', () => {
    const t = fitSimilarity([cp([0, 0], [0, 0]), cp([0, 100], [10, 0])]);
    const p = pxToLocal(t, [100, 0]);
    expect(p[0]).toBeCloseTo(0, 9);
    expect(p[1]).toBeCloseTo(10, 9);
  });

  it('roundtrip：localToPx ∘ pxToLocal ≈ 恆等，控制點精確命中', () => {
    const t = fitSimilarity([cp([50, 80], [-3.2, 7.5]), cp([400, 300], [55.4, -20.1])]);
    for (const px of [[0, 0], [123.4, 567.8], [999, 1]] as [number, number][]) {
      const back = localToPx(t, pxToLocal(t, px));
      expect(back[0]).toBeCloseTo(px[0], 6);
      expect(back[1]).toBeCloseTo(px[1], 6);
    }
    expect(pxToLocal(t, [400, 300])[0]).toBeCloseTo(55.4, 9);
    expect(pxToLocal(t, [400, 300])[1]).toBeCloseTo(-20.1, 9);
  });

  it('退化控制點拋錯', () => {
    expect(() => fitSimilarity([cp([5, 5], [0, 0]), cp([5, 5], [10, 0])])).toThrow();
    expect(() => fitSimilarity([cp([0, 0], [3, 3]), cp([100, 0], [3, 3])])).toThrow();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/tracer-transform.test.ts`
Expected: FAIL（`Cannot find module '../src/tracer/transform'`）。

- [ ] **Step 3: 追加 src/types.ts 型別（檔尾）**

```ts
export interface CalibrationControlPoint { px: Vec2; local: Vec2 }

export interface Calibration {
  px_per_m: number;
  basis: string;
  status: 'estimated' | 'surveyed';
  control_points?: [CalibrationControlPoint, CalibrationControlPoint];
}

export interface SourceRef {
  id: string; title: string; file: string;
  url?: string; captured?: string; license_note?: string;
  calibration?: Calibration;
}

export interface SourcesDoc { schema: 'sources@1'; sources: SourceRef[] }
```

- [ ] **Step 4: 實作 src/tracer/transform.ts**

```ts
import type { CalibrationControlPoint, Vec2 } from '../types';

/** 影像像素 → 站內 local 公尺的相似變換（等比縮放＋旋轉＋平移）。
 *  影像 u 向右、v 向下；local x 向東、y 向北——v 軸翻轉內建於係數：
 *  x = c·Δu + d·Δv + x0；y = d·Δu − c·Δv + y0（Δu=u−u0、Δv=v−v0） */
export interface PxTransform {
  c: number; d: number;
  u0: number; v0: number;
  x0: number; y0: number;
}

export function fitSimilarity(cps: [CalibrationControlPoint, CalibrationControlPoint]): PxTransform {
  const [p, q] = cps;
  const du = q.px[0] - p.px[0];
  const dv = q.px[1] - p.px[1];
  const dx = q.local[0] - p.local[0];
  const dy = q.local[1] - p.local[1];
  const det = du * du + dv * dv;
  if (det === 0) throw new Error('兩個控制點的像素座標相同');
  if (dx * dx + dy * dy === 0) throw new Error('兩個控制點的 local 座標相同');
  const c = (dx * du - dy * dv) / det;
  const d = (dy * du + dx * dv) / det;
  return { c, d, u0: p.px[0], v0: p.px[1], x0: p.local[0], y0: p.local[1] };
}

export function pxToLocal(t: PxTransform, px: Vec2): Vec2 {
  const du = px[0] - t.u0;
  const dv = px[1] - t.v0;
  return [t.x0 + t.c * du + t.d * dv, t.y0 + t.d * du - t.c * dv];
}

export function localToPx(t: PxTransform, xy: Vec2): Vec2 {
  const dx = xy[0] - t.x0;
  const dy = xy[1] - t.y0;
  const s2 = t.c * t.c + t.d * t.d;
  return [t.u0 + (t.c * dx + t.d * dy) / s2, t.v0 + (t.d * dx - t.c * dy) / s2];
}

/** 由變換推導比例尺（px/m），供寫回 calibration.px_per_m 與一致性檢查 */
export function pxPerM(t: PxTransform): number {
  return 1 / Math.hypot(t.c, t.d);
}
```

Run: `npx vitest run tests/tracer-transform.test.ts` — Expected: PASS（4 tests）。

- [ ] **Step 5: 擴充 schemas/sources.schema.json**

`calibration.properties` 內（`status` 之後）加入：

```json
"control_points": {
  "type": "array",
  "minItems": 2,
  "maxItems": 2,
  "items": {
    "type": "object",
    "required": ["px", "local"],
    "additionalProperties": false,
    "properties": {
      "px": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "number" } },
      "local": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "number" } }
    }
  }
}
```

- [ ] **Step 6: validator 增檢（tools/validate.mjs）**

(a) 在 `const sourceIds = new Set(sources.sources.map((s) => s.id));` 之後加一行：

```js
const sourceHasCalib = new Set(sources.sources.filter((s) => s.calibration).map((s) => s.id));
```

(b) 找到 `checkProv` 定義，整段替換為：

```js
const checkProv = (obj, where) => {
  if (!sourceIds.has(obj.source)) errors.push(`[ref] ${where} source "${obj.source}" 不存在於 refs/sources.json`);
  else if (obj.status === 'traced' && !sourceHasCalib.has(obj.source))
    warnings.push(`[sem] ${where} status=traced 但來源 "${obj.source}" 無 calibration`);
};
```

(c) 在 connectors 檢查段之前加入：

```js
// sources：calibration 控制點與 px_per_m 一致性
for (const s of sources.sources) {
  const cal = s.calibration;
  if (!cal?.control_points) continue;
  const [p, q] = cal.control_points;
  const dpx = Math.hypot(q.px[0] - p.px[0], q.px[1] - p.px[1]);
  const dloc = Math.hypot(q.local[0] - p.local[0], q.local[1] - p.local[1]);
  if (dpx === 0 || dloc === 0) { errors.push(`[geom] source ${s.id} calibration 控制點重複`); continue; }
  const derived = dpx / dloc;
  if (Math.abs(derived - cal.px_per_m) / derived > 0.02)
    warnings.push(`[sem] source ${s.id} px_per_m ${cal.px_per_m} 與控制點推導值 ${derived.toFixed(2)} 差逾 2%`);
}
```

- [ ] **Step 7: validate.test.ts 追加 3 個 case（describe 內）**

```ts
it('calibration：px_per_m 與控制點不一致 → warning', () => {
  const docs = freshDocs();
  (docs.sources as any).sources[0].calibration = {
    px_per_m: 99, basis: '測試', status: 'estimated',
    control_points: [
      { px: [0, 0], local: [0, 0] },
      { px: [100, 0], local: [10, 0] },
    ],
  };
  const { errors, warnings } = validateDocs(docs);
  expect(errors).toEqual([]);
  expect(warnings.some((w) => w.includes('test-src') && w.includes('px_per_m'))).toBe(true);
});

it('calibration：控制點重複 → error', () => {
  const docs = freshDocs();
  (docs.sources as any).sources[0].calibration = {
    px_per_m: 10, basis: '測試', status: 'estimated',
    control_points: [{ px: [5, 5], local: [0, 0] }, { px: [5, 5], local: [10, 0] }],
  };
  const { errors } = validateDocs(docs);
  expect(errors.some((e) => e.includes('控制點重複'))).toBe(true);
});

it('status=traced 但來源無 calibration → warning', () => {
  const docs = freshDocs();
  (docs.floors.get('hall-b1') as any).slab.status = 'traced';
  const { warnings } = validateDocs(docs);
  expect(warnings.some((w) => w.includes('traced') && w.includes('test-src'))).toBe(true);
});
```

- [ ] **Step 8: 全套驗證**

Run: `npm test` — Expected: 全數 PASS（含既有 6 個測試檔）。
Run: `npm run typecheck` — Expected: exit 0。
Run: `npm run validate` — Expected: `0 errors`（真實資料尚無 calibration/status，無新警告）。

- [ ] **Step 9: Commit（含本計畫文件）**

```bash
git add -A
git commit -m "feat: 校準相似變換 + calibration control_points schema 與 validator 警告

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: canonical JSON 序列化器 + 全資料正規化

**Files:**
- Create: `tools/format-data.mjs`, `tools/format-data.d.mts`
- Test: `tests/format-data.test.ts`
- Modify: `package.json`（加 script `format:data`）
- Modify: `data/*.json`, `data/floors/*.json`, `refs/sources.json`（跑正規化，一次性排版變更）

**Interfaces:**
- Produces: `formatDataJson(value: unknown): string`（2 空格縮排、**純數字陣列單行**、結尾換行）；`dataFiles(rootDir: string): string[]`；CLI `node tools/format-data.mjs [--check] [rootDir]`（`--check` 模式不寫檔、有不合格檔案時 exit 1）。Task 3 的 save-handler 與 QA 檢查依賴。
- 排版效果：座標對 `[101.9, -94.3]` 單行、環的外層陣列一點一行——tracer 寫檔與手工編修產生穩定 diff。

- [ ] **Step 1: 寫失敗測試**

`tests/format-data.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatDataJson } from '../tools/format-data.mjs';

describe('formatDataJson', () => {
  it('純數字陣列單行、物件多行縮排', () => {
    expect(formatDataJson({ a: [1, 2.5], b: 'x' })).toBe('{\n  "a": [1, 2.5],\n  "b": "x"\n}\n');
  });

  it('座標環：外層多行、每個座標對單行', () => {
    const out = formatDataJson({ outline: [[0, 0], [10, 0], [10, 5]] });
    expect(out).toBe('{\n  "outline": [\n    [0, 0],\n    [10, 0],\n    [10, 5]\n  ]\n}\n');
  });

  it('roundtrip 與冪等', () => {
    const v = { schema: 'floor@1', slab: { outline: [[-1.5, 2], [3, 4], [0, 9]], holes: [] }, n: null, empty: {} };
    const once = formatDataJson(v);
    expect(JSON.parse(once)).toEqual(v);
    expect(formatDataJson(JSON.parse(once))).toBe(once);
  });

  it('真實資料 roundtrip 不失真', () => {
    const raw = JSON.parse(readFileSync('data/station.json', 'utf8'));
    expect(JSON.parse(formatDataJson(raw))).toEqual(raw);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/format-data.test.ts`
Expected: FAIL（`Cannot find module '../tools/format-data.mjs'`）。

- [ ] **Step 3: 實作 tools/format-data.mjs**

```js
// data/*.json 與 refs/sources.json 的唯一序列化格式：2 空格縮排、純數字陣列（座標對等）單行。
// tracer 存檔與人工編修共用，確保 diff 穩定。
// 用法：node tools/format-data.mjs [--check] [rootDir]（--check 只檢查不寫檔，違規 exit 1）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function formatDataJson(value) {
  return fmt(value, 0) + '\n';
}

function fmt(v, indent) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'number')) {
      if (!v.every((x) => Number.isFinite(x))) throw new Error('JSON 不允許非有限數值');
      return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
    }
    return `[\n${v.map((x) => padIn + fmt(x, indent + 1)).join(',\n')}\n${pad}]`;
  }
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${padIn}${JSON.stringify(k)}: ${fmt(v[k], indent + 1)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
}

export function dataFiles(rootDir) {
  const floorDir = path.join(rootDir, 'data', 'floors');
  const floors = readdirSync(floorDir).filter((f) => f.endsWith('.json'))
    .map((f) => `data/floors/${f}`).sort();
  return ['data/station.json', 'data/connectors.json', ...floors, 'refs/sources.json'];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const root = process.argv.filter((a) => !a.startsWith('--'))[2] ?? '.';
  let changed = 0;
  for (const rel of dataFiles(root)) {
    const p = path.join(root, rel);
    const current = readFileSync(p, 'utf8');
    const canonical = formatDataJson(JSON.parse(current));
    if (current === canonical) continue;
    changed++;
    if (check) console.error(`非 canonical 格式：${rel}`);
    else { writeFileSync(p, canonical, 'utf8'); console.log(`已重排：${rel}`); }
  }
  console.log(`format-data: ${changed} 檔${check ? '需重排' : '已重排'}，共 ${dataFiles(root).length} 檔`);
  if (check && changed) process.exit(1);
}
```

`tools/format-data.d.mts`：

```ts
export declare function formatDataJson(value: unknown): string;
export declare function dataFiles(rootDir: string): string[];
```

Run: `npx vitest run tests/format-data.test.ts` — Expected: PASS（4 tests）。

- [ ] **Step 4: 加 npm script**

`package.json` scripts 加：

```json
"format:data": "node tools/format-data.mjs"
```

- [ ] **Step 5: 正規化全部資料檔並驗證無失真**

Run: `npm run format:data`
Expected: 列出重排的檔案（多數檔案會被重排——座標環改為一點一行）。

Run: `npm run format:data -- --check` — Expected: `0 檔需重排`，exit 0。
Run: `npm run validate` — Expected: `0 errors`。
Run: `npm test` — Expected: 全 PASS。
Run: `git diff --numstat` — 確認只有 `data/` 與 `refs/sources.json` 的排版變更，無其他檔案。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: canonical JSON 序列化器與全資料正規化（tracer 寫檔前置）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: tracer 整批 save API（驗證通過才寫檔）

**Files:**
- Create: `tools/save-handler.mjs`, `tools/save-handler.d.mts`
- Test: `tests/save-handler.test.ts`
- Modify: `vite.config.ts`（加 dev-only plugin `tracer-save`）

**Interfaces:**
- Consumes: Task 2 `formatDataJson`；既有 `tools/validate.mjs` 的 `loadRepoDocs`/`validateDocs`。
- Produces: `applySave(rootDir: string, files: Array<{ file: string; doc: unknown }>): { ok: boolean; errors: string[]; written: string[] }`——整批換入 → 全站驗證 → 全過才逐檔寫入 canonical 格式（原子性：任一檔壞則全部不寫）。HTTP 端點 `POST /__tracer/save`，body `{ files: [{ file, doc }] }`，回同構 JSON（成功 200 / 驗證失敗 422 / 格式錯誤 400）。Task 5/6 的 tracer 儲存依賴。
- 路徑白名單：`data/floors/<id>.json`、`data/connectors.json`、`data/station.json`、`refs/sources.json`（regex 擋 traversal）。

- [ ] **Step 1: 寫失敗測試**

`tests/save-handler.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applySave } from '../tools/save-handler.mjs';
import { formatDataJson } from '../tools/format-data.mjs';

let root: string;
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const readDoc = (rel: string) => JSON.parse(read(rel));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tracer-save-'));
  cpSync('tests/fixtures/mini', root, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('applySave', () => {
  it('合法修改：寫入且為 canonical 格式', () => {
    const hall = readDoc('data/floors/hall-b1.json');
    hall.slab.outline[0] = [-11, -5];
    const r = applySave(root, [{ file: 'data/floors/hall-b1.json', doc: hall }]);
    expect(r).toEqual({ ok: true, errors: [], written: ['data/floors/hall-b1.json'] });
    const after = read('data/floors/hall-b1.json');
    expect(JSON.parse(after).slab.outline[0]).toEqual([-11, -5]);
    expect(after).toBe(formatDataJson(JSON.parse(after)));
  });

  it('驗證失敗不寫檔（outline 反繞向）', () => {
    const before = read('data/floors/plat-b2.json');
    const plat = JSON.parse(before);
    plat.slab.outline.reverse();
    const r = applySave(root, [{ file: 'data/floors/plat-b2.json', doc: plat }]);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e: string) => e.includes('逆時針'))).toBe(true);
    expect(read('data/floors/plat-b2.json')).toBe(before);
  });

  it('多檔整批：任一檔壞 → 全部不寫', () => {
    const hall = readDoc('data/floors/hall-b1.json');
    hall.slab.outline[0] = [-12, -5];
    const plat = readDoc('data/floors/plat-b2.json');
    plat.slab.outline.reverse();
    const before = read('data/floors/hall-b1.json');
    const r = applySave(root, [
      { file: 'data/floors/hall-b1.json', doc: hall },
      { file: 'data/floors/plat-b2.json', doc: plat },
    ]);
    expect(r.ok).toBe(false);
    expect(read('data/floors/hall-b1.json')).toBe(before);
  });

  it('路徑白名單：repo 外與非資料檔一律拒絕', () => {
    for (const file of ['package.json', '../evil.json', 'data/../package.json', 'data/floors/../../package.json']) {
      const r = applySave(root, [{ file, doc: {} }]);
      expect(r.ok, file).toBe(false);
      expect(r.errors[0], file).toContain('不允許');
    }
  });

  it('不在 station floors 清單的樓層檔拒絕', () => {
    const r = applySave(root, [{ file: 'data/floors/nope.json', doc: { schema: 'floor@1' } }]);
    expect(r.ok).toBe(false);
  });

  it('sources.json 可寫（含 calibration）', () => {
    const sources = readDoc('refs/sources.json');
    sources.sources[0].calibration = {
      px_per_m: 10, basis: '測試基準', status: 'estimated',
      control_points: [{ px: [0, 0], local: [0, 0] }, { px: [100, 0], local: [10, 0] }],
    };
    const r = applySave(root, [{ file: 'refs/sources.json', doc: sources }]);
    expect(r.ok).toBe(true);
    expect(readDoc('refs/sources.json').sources[0].calibration.px_per_m).toBe(10);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/save-handler.test.ts`
Expected: FAIL（`Cannot find module '../tools/save-handler.mjs'`）。

- [ ] **Step 3: 實作 tools/save-handler.mjs**

```js
// tracer 存檔核心：整批（多檔）換入 → 全站驗證 → 全過才寫檔（canonical 格式）。
// 由 vite dev plugin 的 POST /__tracer/save 呼叫；可單獨測試。
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatDataJson } from './format-data.mjs';
import { loadRepoDocs, validateDocs } from './validate.mjs';

const SAVABLE = /^(data\/floors\/[a-z0-9-]+\.json|data\/connectors\.json|data\/station\.json|refs\/sources\.json)$/;

/** files: Array<{ file, doc }> → { ok, errors, written } */
export function applySave(rootDir, files) {
  if (!Array.isArray(files) || files.length === 0) return fail(['payload 必須是非空 files 陣列']);
  for (const f of files) {
    if (!f || typeof f.file !== 'string' || !SAVABLE.test(f.file)) return fail([`不允許寫入的路徑：${f?.file}`]);
    if (f.doc === null || typeof f.doc !== 'object') return fail([`${f.file}: doc 必須是物件`]);
  }
  let docs;
  try { docs = loadRepoDocs(rootDir); } catch (e) { return fail([`讀取現有資料失敗：${e.message}`]); }
  for (const { file, doc } of files) {
    if (file === 'data/station.json') docs.station = doc; // 注意：floors map 仍依載入時清單（tracer 不新增樓層）
    else if (file === 'data/connectors.json') docs.connectors = doc;
    else if (file === 'refs/sources.json') docs.sources = doc;
    else {
      const meta = (docs.station.floors ?? []).find((fl) => `data/${fl.file}` === file);
      if (!meta) return fail([`${file} 不在 station.json floors 清單`]);
      docs.floors.set(meta.id, doc);
    }
  }
  const { errors } = validateDocs(docs);
  if (errors.length) return fail(errors);
  const written = [];
  for (const { file, doc } of files) {
    writeFileSync(path.join(rootDir, file), formatDataJson(doc), 'utf8');
    written.push(file);
  }
  return { ok: true, errors: [], written };
}

function fail(errors) {
  return { ok: false, errors, written: [] };
}
```

`tools/save-handler.d.mts`：

```ts
export interface SaveResult { ok: boolean; errors: string[]; written: string[] }
export declare function applySave(
  rootDir: string,
  files: Array<{ file: string; doc: unknown }>,
): SaveResult;
```

Run: `npx vitest run tests/save-handler.test.ts` — Expected: PASS（6 tests）。

- [ ] **Step 4: vite.config.ts 加 dev plugin（整檔替換）**

```ts
/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import { applySave } from './tools/save-handler.mjs';

// 描圖工具 dev-only 存檔端點：POST /__tracer/save {files:[{file,doc}]} → 全站驗證通過才寫檔
function tracerSavePlugin(): Plugin {
  return {
    name: 'tracer-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__tracer/save', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('POST only'); return; }
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk; });
        req.on('end', () => {
          res.setHeader('content-type', 'application/json');
          try {
            const { files } = JSON.parse(body) as { files: Array<{ file: string; doc: unknown }> };
            const result = applySave(process.cwd(), files);
            res.statusCode = result.ok ? 200 : 422;
            res.end(JSON.stringify(result));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, errors: [String(e)], written: [] }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [tracerSavePlugin()],
  test: { environment: 'node' },
});
```

- [ ] **Step 5: dev server 冒煙測試（PowerShell）**

先啟動 `npm run dev`（背景或另一終端），再：

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:5173/__tracer/save -ContentType 'application/json' -Body '{"files":[{"file":"package.json","doc":{}}]}' -SkipHttpErrorCheck
```

Expected: 回應 `ok=False`、`errors` 含「不允許寫入的路徑：package.json」（HTTP 422）。驗證後停掉 dev server。

- [ ] **Step 6: 全套驗證 + Commit**

Run: `npm test`、`npm run typecheck` — Expected: 全 PASS / exit 0。

```bash
git add -A
git commit -m "feat: tracer 整批 save API（驗證通過才寫檔）與 vite dev plugin

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: tracer 頁面骨架（檢視/渲染/幾何存取，唯讀）

**Files:**
- Create: `tracer.html`, `src/palette.ts`, `src/tracer/view.ts`, `src/tracer/geom.ts`, `src/tracer/render.ts`, `src/tracer/store.ts`, `src/tracer/main.ts`
- Test: `tests/tracer-view.test.ts`, `tests/tracer-geom.test.ts`
- Modify: `src/builder.ts`（AREA_COLORS/閘門色改自 palette import）
- Modify: `vite.config.ts`（build 多頁 input）

**Interfaces:**
- Consumes: Task 1 `transform.ts`、Task 3 save API（main 的 `save()` 已接上，Task 5 起實際觸發）。
- Produces（Task 5/6 依賴，簽名固定）：
  - `view.ts`：`ViewState { zoom; panX; panY }`（zoom = px/m）、`localToScreen(v, xy)`、`screenToLocal(v, s)`、`zoomAt(v, screenPt, factor)`、`fitView(vw, vh, min, max)`。
  - `geom.ts`：`GeomRef`（slab-outline | slab-hole(index) | area/unit/wall/gate/poi/nav-node(id)）、`VertexRef { ref; vi }`、`refKey`、`round1`/`roundPt`、`ringArea`、`ensureWinding`、`pointInRing`、`distPointSeg`、`getRing`（回傳**活引用**）、`setRing`（round+繞向，mutates）、`geomKind`（'ccw'|'cw'|'open'|'line2'|'point'）、`minPoints`、`allRefs(doc, layers)`、`hitVertex(doc, refs, pt, tolM)`、`hitGeom(doc, refs, pt, tolM)`（由上而下：nav→poi→gate→wall→unit→area→hole→slab 邊線）、`findArea(doc, pt)`。
  - `store.ts`：`TracerStore`、`createStore`、`ToolName('select'|'draw'|'nav'|'calibrate')`、`Layers`、`ToolHandler { activate?; deactivate?; down?(local, ev): boolean; move?; up?; dblclick?; key?(ev): boolean }`、`ToolContext { store; invalidate; setStatus; setBanner; pushUndo; markDirty; floorFile; floorShort; floorDoc; save; currentTransform }`。
  - `main.ts`：`toolFactories` 註冊表（Task 5/6 各加一行 import＋一行註冊）；pan/zoom、樓層/底圖/圖層切換、undo/save 骨架、sessionStorage 工作狀態（存檔後頁面因資料熱重載刷新，靠它接回）。

- [ ] **Step 1: 寫失敗測試**

`tests/tracer-view.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { fitView, localToScreen, screenToLocal, zoomAt } from '../src/tracer/view';

describe('view transform', () => {
  const v = { zoom: 2, panX: 100, panY: 50 };

  it('local↔screen roundtrip、y 軸翻轉', () => {
    expect(localToScreen(v, [0, 0])).toEqual([100, 50]);
    expect(localToScreen(v, [10, 5])).toEqual([120, 40]); // y 北 → 螢幕上方
    const back = screenToLocal(v, localToScreen(v, [-3.5, 7.25]));
    expect(back[0]).toBeCloseTo(-3.5, 9);
    expect(back[1]).toBeCloseTo(7.25, 9);
  });

  it('zoomAt 保持游標下的 local 點不動', () => {
    const cursor: [number, number] = [140, 30];
    const before = screenToLocal(v, cursor);
    const zoomed = zoomAt(v, cursor, 1.5);
    const after = screenToLocal(zoomed, cursor);
    expect(zoomed.zoom).toBeCloseTo(3, 9);
    expect(after[0]).toBeCloseTo(before[0], 9);
    expect(after[1]).toBeCloseTo(before[1], 9);
  });

  it('fitView 讓範圍置中且完整可見', () => {
    const fitted = fitView(800, 600, [-100, -50], [100, 50]);
    const tl = localToScreen(fitted, [-100, 50]);
    const br = localToScreen(fitted, [100, -50]);
    expect(tl[0]).toBeGreaterThanOrEqual(0);
    expect(tl[1]).toBeGreaterThanOrEqual(0);
    expect(br[0]).toBeLessThanOrEqual(800);
    expect(br[1]).toBeLessThanOrEqual(600);
    const c = localToScreen(fitted, [0, 0]);
    expect(c[0]).toBeCloseTo(400, 6);
    expect(c[1]).toBeCloseTo(300, 6);
  });
});
```

`tests/tracer-geom.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { FloorDoc } from '../src/types';
import {
  allRefs, ensureWinding, findArea, getRing, hitGeom, hitVertex, pointInRing, ringArea, roundPt, setRing,
} from '../src/tracer/geom';

const LAYERS = { areas: true, units: true, walls: true, gates: true, pois: true, nav: true };

const doc = (): FloorDoc => structuredClone({
  schema: 'floor@1', id: 'hall-b1',
  slab: {
    outline: [[0, 0], [20, 0], [20, 10], [0, 10]],
    holes: [[[5, 5], [5, 7], [7, 7], [7, 5]]],
    source: 's', confidence: 3,
  },
  areas: [{ id: 'a-ha-paid', kind: 'paid', system: 'test', polygon: [[1, 1], [9, 1], [9, 9], [1, 9]], source: 's', confidence: 3 }],
  walls: [{ id: 'w-ha-1', polyline: [[0, 5], [10, 5]], height: 3, source: 's', confidence: 3 }],
  gates: [{ id: 'g-ha-1', kind: 'faregate', system: 'test', direction: 'both', accessible: true, line: [[12, 1], [12, 3]], connects: ['a-ha-paid', 'a-ha-paid'], source: 's', confidence: 3 }],
  pois: [{ id: 'p-ha-1', kind: 'info', position: [15, 5], source: 's', confidence: 3 }],
  nav: { nodes: [{ id: 'n-ha-001', xy: [3, 3] }], edges: [] },
} as unknown as FloorDoc);

describe('geom 基礎', () => {
  it('ringArea 符號＝繞向；ensureWinding 正規化', () => {
    const ccw: [number, number][] = [[0, 0], [4, 0], [4, 4]];
    expect(ringArea(ccw)).toBeGreaterThan(0);
    expect(ensureWinding([...ccw].reverse(), 'ccw')).toEqual(ccw);
    expect(ringArea(ensureWinding(ccw, 'cw'))).toBeLessThan(0);
  });

  it('pointInRing / roundPt', () => {
    expect(pointInRing([2, 2], [[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(true);
    expect(pointInRing([5, 5], [[0, 0], [4, 0], [4, 4], [0, 4]])).toBe(false);
    expect(roundPt([1.234, -5.678])).toEqual([1.2, -5.7]);
  });
});

describe('getRing / setRing', () => {
  it('各類 ref 取得座標序列', () => {
    const d = doc();
    expect(getRing(d, { kind: 'slab-outline' })!.length).toBe(4);
    expect(getRing(d, { kind: 'slab-hole', index: 0 })!.length).toBe(4);
    expect(getRing(d, { kind: 'area', id: 'a-ha-paid' })!.length).toBe(4);
    expect(getRing(d, { kind: 'wall', id: 'w-ha-1' })!.length).toBe(2);
    expect(getRing(d, { kind: 'gate', id: 'g-ha-1' })!.length).toBe(2);
    expect(getRing(d, { kind: 'poi', id: 'p-ha-1' })).toEqual([[15, 5]]);
    expect(getRing(d, { kind: 'nav-node', id: 'n-ha-001' })).toEqual([[3, 3]]);
    expect(getRing(d, { kind: 'area', id: 'nope' })).toBeNull();
  });

  it('setRing：round、繞向正規化、點數守衛', () => {
    const d = doc();
    setRing(d, { kind: 'area', id: 'a-ha-paid' }, [[1, 9.04], [9, 9], [9, 1], [1, 1]]); // cw 輸入
    expect(ringArea(d.areas![0].polygon)).toBeGreaterThan(0); // 已轉 ccw
    expect(d.areas![0].polygon.some((p) => p[0] === 1 && p[1] === 9)).toBe(true); // 9.04 → 9
    setRing(d, { kind: 'slab-hole', index: 0 }, [[5, 5], [7, 5], [7, 7], [5, 7]]); // ccw 輸入
    expect(ringArea(d.slab.holes![0])).toBeLessThan(0); // 已轉 cw
    expect(() => setRing(d, { kind: 'area', id: 'a-ha-paid' }, [[0, 0], [1, 1]])).toThrow();
    expect(() => setRing(d, { kind: 'gate', id: 'g-ha-1' }, [[0, 0], [1, 1], [2, 2]])).toThrow();
    setRing(d, { kind: 'poi', id: 'p-ha-1' }, [[15.55, 5]]);
    expect(d.pois![0].position).toEqual([15.6, 5]);
  });
});

describe('hit-testing', () => {
  it('hitVertex：容差內取最近，容差外 null', () => {
    const d = doc();
    const refs = allRefs(d, LAYERS);
    expect(hitVertex(d, refs, [3.1, 3.1], 0.5)?.ref).toEqual({ kind: 'nav-node', id: 'n-ha-001' });
    expect(hitVertex(d, refs, [3.1, 3.1], 0.05)).toBeNull();
    expect(hitVertex(d, refs, [0.1, 0.1], 0.3)?.ref).toEqual({ kind: 'slab-outline' });
  });

  it('hitGeom：上層優先；關圖層可選到下層', () => {
    const d = doc();
    expect(hitGeom(d, allRefs(d, LAYERS), [2, 5], 0.2)).toEqual({ kind: 'wall', id: 'w-ha-1' }); // wall 蓋在 area 上
    expect(hitGeom(d, allRefs(d, LAYERS), [12, 2], 0.3)).toEqual({ kind: 'gate', id: 'g-ha-1' });
    expect(hitGeom(d, allRefs(d, LAYERS), [5.5, 5.5], 0.2)).toEqual({ kind: 'area', id: 'a-ha-paid' });
    const noAreas = allRefs(d, { ...LAYERS, areas: false, walls: false });
    expect(hitGeom(d, noAreas, [5.5, 5.5], 0.2)).toEqual({ kind: 'slab-hole', index: 0 });
    expect(hitGeom(d, allRefs(d, LAYERS), [15, 5], 0.3)).toEqual({ kind: 'poi', id: 'p-ha-1' });
    expect(hitGeom(d, allRefs(d, LAYERS), [19.9, 0.1], 0.3)).toEqual({ kind: 'slab-outline' }); // slab 只吃邊線
    expect(hitGeom(d, allRefs(d, LAYERS), [15, 8], 0.2)).toBeNull(); // slab 內部空白不選 slab
  });

  it('findArea', () => {
    const d = doc();
    expect(findArea(d, [2, 2])).toBe('a-ha-paid');
    expect(findArea(d, [15, 5])).toBeUndefined();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/tracer-view.test.ts tests/tracer-geom.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 抽出 src/palette.ts 並改 builder.ts**

`src/palette.ts`：

```ts
/** 元素配色唯一來源：viewer(3D) 與 tracer(2D) 共用 */
export const AREA_COLORS: Record<string, string> = {
  platform: '#e8c060', paid: '#e3547a', unpaid: '#4a90d9',
  corridor: '#7bc47f', track: '#333a45', restricted: '#777777',
};

export const GATE_COLORS = { accessible: '#2bb3a3', standard: '#c05050' } as const;
```

`src/builder.ts` 修改兩處：

1. 刪掉檔內 `const AREA_COLORS: Record<string, string> = {...};` 區塊，並在 import 區加：

```ts
import { AREA_COLORS, GATE_COLORS } from './palette';
```

2. gates 迴圈內 `const color = gate.accessible ? '#2bb3a3' : '#c05050';` 改為：

```ts
const color = gate.accessible ? GATE_COLORS.accessible : GATE_COLORS.standard;
```

Run: `npx vitest run tests/builder.test.ts` — Expected: PASS（行為不變）。

- [ ] **Step 4: 實作 src/tracer/view.ts 與 src/tracer/geom.ts**

`src/tracer/view.ts`：

```ts
import type { Vec2 } from '../types';

/** local(m，y 向北) ↔ 螢幕(px，y 向下) 檢視變換；zoom = px/m */
export interface ViewState { zoom: number; panX: number; panY: number }

export function localToScreen(v: ViewState, xy: Vec2): Vec2 {
  return [xy[0] * v.zoom + v.panX, -xy[1] * v.zoom + v.panY];
}

export function screenToLocal(v: ViewState, s: Vec2): Vec2 {
  return [(s[0] - v.panX) / v.zoom, -(s[1] - v.panY) / v.zoom];
}

/** 以螢幕點為中心縮放（游標下的 local 點不動） */
export function zoomAt(v: ViewState, s: Vec2, factor: number): ViewState {
  const zoom = Math.min(200, Math.max(0.5, v.zoom * factor));
  const k = zoom / v.zoom;
  return { zoom, panX: s[0] - (s[0] - v.panX) * k, panY: s[1] - (s[1] - v.panY) * k };
}

/** 讓 [min,max]（local）置中塞進 vw×vh 的 90% */
export function fitView(vw: number, vh: number, min: Vec2, max: Vec2): ViewState {
  const w = Math.max(1, max[0] - min[0]);
  const h = Math.max(1, max[1] - min[1]);
  const zoom = Math.min((vw * 0.9) / w, (vh * 0.9) / h);
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  return { zoom, panX: vw / 2 - cx * zoom, panY: vh / 2 + cy * zoom };
}
```

`src/tracer/geom.ts`：

```ts
import type { FloorDoc, Vec2 } from '../types';

/** tracer 幾何目標參照：指向樓層檔內某段座標序列 */
export type GeomRef =
  | { kind: 'slab-outline' }
  | { kind: 'slab-hole'; index: number }
  | { kind: 'area'; id: string }
  | { kind: 'unit'; id: string }
  | { kind: 'wall'; id: string }
  | { kind: 'gate'; id: string }
  | { kind: 'poi'; id: string }
  | { kind: 'nav-node'; id: string };

export interface VertexRef { ref: GeomRef; vi: number }

export function refKey(ref: GeomRef): string {
  if ('id' in ref) return `${ref.kind}:${ref.id}`;
  return ref.kind === 'slab-hole' ? `slab-hole:${ref.index}` : ref.kind;
}

export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const roundPt = (p: Vec2): Vec2 => [round1(p[0]), round1(p[1])];

export function ringArea(ring: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

export function ensureWinding(ring: Vec2[], wind: 'ccw' | 'cw'): Vec2[] {
  const a = ringArea(ring);
  const ok = wind === 'ccw' ? a > 0 : a < 0;
  return ok ? ring : [...ring].reverse();
}

export function pointInRing(pt: Vec2, ring: Vec2[]): boolean {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function distPointSeg(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** ref 的座標序列（活引用；poi/nav-node 包成單點陣列）；找不到回 null */
export function getRing(doc: FloorDoc, ref: GeomRef): Vec2[] | null {
  switch (ref.kind) {
    case 'slab-outline': return doc.slab.outline;
    case 'slab-hole': return doc.slab.holes?.[ref.index] ?? null;
    case 'area': return doc.areas?.find((a) => a.id === ref.id)?.polygon ?? null;
    case 'unit': return doc.units?.find((u) => u.id === ref.id)?.polygon ?? null;
    case 'wall': return doc.walls?.find((w) => w.id === ref.id)?.polyline ?? null;
    case 'gate': return doc.gates?.find((g) => g.id === ref.id)?.line ?? null;
    case 'poi': { const p = doc.pois?.find((x) => x.id === ref.id); return p ? [p.position] : null; }
    case 'nav-node': { const n = doc.nav?.nodes.find((x) => x.id === ref.id); return n ? [n.xy] : null; }
  }
}

/** ref 的幾何約束：閉環繞向 / 開放線 / 固定兩點 / 單點 */
export function geomKind(ref: GeomRef): 'ccw' | 'cw' | 'open' | 'line2' | 'point' {
  switch (ref.kind) {
    case 'slab-outline': case 'area': case 'unit': return 'ccw';
    case 'slab-hole': return 'cw';
    case 'wall': return 'open';
    case 'gate': return 'line2';
    case 'poi': case 'nav-node': return 'point';
  }
}

export function minPoints(ref: GeomRef): number {
  const k = geomKind(ref);
  return k === 'ccw' || k === 'cw' ? 3 : k === 'open' || k === 'line2' ? 2 : 1;
}

/** 寫回座標序列（round + 繞向正規化；mutates doc）。點數不符時丟錯。 */
export function setRing(doc: FloorDoc, ref: GeomRef, pts: Vec2[]): void {
  const k = geomKind(ref);
  const bad = pts.length < minPoints(ref) || (k === 'line2' && pts.length !== 2) || (k === 'point' && pts.length !== 1);
  if (bad) throw new Error(`點數不符：${refKey(ref)}`);
  let out = pts.map(roundPt);
  if (k === 'ccw' || k === 'cw') out = ensureWinding(out, k);
  switch (ref.kind) {
    case 'slab-outline': doc.slab.outline = out; break;
    case 'slab-hole': doc.slab.holes![ref.index] = out; break;
    case 'area': doc.areas!.find((a) => a.id === ref.id)!.polygon = out; break;
    case 'unit': doc.units!.find((u) => u.id === ref.id)!.polygon = out; break;
    case 'wall': doc.walls!.find((w) => w.id === ref.id)!.polyline = out; break;
    case 'gate': doc.gates!.find((g) => g.id === ref.id)!.line = out as [Vec2, Vec2]; break;
    case 'poi': doc.pois!.find((p) => p.id === ref.id)!.position = out[0]; break;
    case 'nav-node': doc.nav!.nodes.find((n) => n.id === ref.id)!.xy = out[0]; break;
  }
}

export interface LayerFlags {
  areas: boolean; units: boolean; walls: boolean; gates: boolean; pois: boolean; nav: boolean;
}

/** 可見圖層內全部 ref，依繪製順序（低→高）；slab 一律包含 */
export function allRefs(doc: FloorDoc, layers: LayerFlags): GeomRef[] {
  const refs: GeomRef[] = [{ kind: 'slab-outline' }];
  (doc.slab.holes ?? []).forEach((_, i) => refs.push({ kind: 'slab-hole', index: i }));
  if (layers.areas) for (const a of doc.areas ?? []) refs.push({ kind: 'area', id: a.id });
  if (layers.units) for (const u of doc.units ?? []) refs.push({ kind: 'unit', id: u.id });
  if (layers.walls) for (const w of doc.walls ?? []) refs.push({ kind: 'wall', id: w.id });
  if (layers.gates) for (const g of doc.gates ?? []) refs.push({ kind: 'gate', id: g.id });
  if (layers.pois) for (const p of doc.pois ?? []) refs.push({ kind: 'poi', id: p.id });
  if (layers.nav) for (const n of doc.nav?.nodes ?? []) refs.push({ kind: 'nav-node', id: n.id });
  return refs;
}

/** 最近頂點（tolM 公尺內），上層優先（refs 由低到高，後者覆蓋同距離前者） */
export function hitVertex(doc: FloorDoc, refs: GeomRef[], pt: Vec2, tolM: number): VertexRef | null {
  let best: VertexRef | null = null;
  let bestD = tolM;
  for (const ref of refs) {
    const ring = getRing(doc, ref);
    if (!ring) continue;
    ring.forEach((v, vi) => {
      const d = Math.hypot(v[0] - pt[0], v[1] - pt[1]);
      if (d <= bestD) { bestD = d; best = { ref, vi }; }
    });
  }
  return best;
}

/** 元素命中：由上而下掃描；面元素吃內部、線元素吃鄰近、slab outline 只吃邊線 */
export function hitGeom(doc: FloorDoc, refs: GeomRef[], pt: Vec2, tolM: number): GeomRef | null {
  for (const ref of [...refs].reverse()) {
    const ring = getRing(doc, ref);
    if (!ring) continue;
    const k = geomKind(ref);
    if (k === 'point') {
      if (Math.hypot(ring[0][0] - pt[0], ring[0][1] - pt[1]) <= tolM) return ref;
    } else if (k === 'open' || k === 'line2') {
      for (let i = 0; i < ring.length - 1; i++)
        if (distPointSeg(pt, ring[i], ring[i + 1]) <= tolM) return ref;
    } else if (ref.kind === 'slab-outline') {
      for (let i = 0; i < ring.length; i++)
        if (distPointSeg(pt, ring[i], ring[(i + 1) % ring.length]) <= tolM) return ref;
    } else if (pointInRing(pt, ring)) {
      return ref;
    }
  }
  return null;
}

export function findArea(doc: FloorDoc, pt: Vec2): string | undefined {
  return (doc.areas ?? []).find((a) => pointInRing(pt, a.polygon))?.id;
}
```

Run: `npx vitest run tests/tracer-view.test.ts tests/tracer-geom.test.ts` — Expected: PASS。

- [ ] **Step 5: 實作 src/tracer/store.ts**

```ts
import type { FloorDoc, SourcesDoc, StationDoc, Vec2 } from '../types';
import type { GeomRef, VertexRef } from './geom';
import type { PxTransform } from './transform';
import type { ViewState } from './view';

export type ToolName = 'select' | 'draw' | 'nav' | 'calibrate';

export interface Layers {
  image: boolean; areas: boolean; units: boolean; walls: boolean;
  gates: boolean; pois: boolean; nav: boolean; labels: boolean;
}

export interface TracerStore {
  station: StationDoc;
  floorDocs: Map<string, FloorDoc>;   // 編輯用工作副本（deep clone）
  sourcesDoc: SourcesDoc;             // 同上（校準寫入）
  floorId: string;
  sourceId: string;
  tool: ToolName;
  layers: Layers;
  imageOpacity: number;
  view: ViewState;
  views: Record<string, ViewState>;   // 各樓層各自記住視角
  transformOverride: Map<string, PxTransform>; // 校準預覽（未存檔前）
  selection: GeomRef | null;
  hoverVertex: VertexRef | null;
  draft: Vec2[];                      // 描繪中的點列
  calibMarkers: Vec2[];               // 校準控制點顯示（local）
  dirty: Set<string>;                 // 未儲存的檔案 relPath
  undo: { floorId: string; snap: string }[]; // 目前樓層的 JSON snapshots
}

export interface ToolHandler {
  activate?(): void;
  deactivate?(): void;
  /** 回傳 true 表示已處理（main 不做平移） */
  down?(local: Vec2, ev: PointerEvent): boolean;
  move?(local: Vec2, ev: PointerEvent): void;
  up?(local: Vec2, ev: PointerEvent): void;
  dblclick?(local: Vec2): void;
  /** 回傳 true 表示已處理 */
  key?(ev: KeyboardEvent): boolean;
}

export interface ToolContext {
  store: TracerStore;
  invalidate(): void;
  setStatus(text: string): void;
  setBanner(text: string, kind: 'ok' | 'err'): void;
  pushUndo(): void;
  markDirty(file: string): void;
  floorFile(): string;   // 'data/floors/<id>.json'
  floorShort(): string;  // 'rp' 等
  floorDoc(): FloorDoc;
  save(): Promise<void>;
  currentTransform(): PxTransform | null;
}

export function createStore(args: {
  station: StationDoc; floors: Map<string, FloorDoc>; sources: SourcesDoc;
}): TracerStore {
  return {
    station: args.station,
    floorDocs: args.floors,
    sourcesDoc: args.sources,
    floorId: args.station.floors[0]?.id ?? '',
    sourceId: '',
    tool: 'select',
    layers: { image: true, areas: true, units: true, walls: true, gates: true, pois: true, nav: true, labels: true },
    imageOpacity: 0.7,
    view: { zoom: 3, panX: 0, panY: 0 },
    views: {},
    transformOverride: new Map(),
    selection: null,
    hoverVertex: null,
    draft: [],
    calibMarkers: [],
    dirty: new Set(),
    undo: [],
  };
}
```

- [ ] **Step 6: 實作 src/tracer/render.ts**

```ts
import type { FloorDoc, Vec2 } from '../types';
import { AREA_COLORS, GATE_COLORS } from '../palette';
import { getRing, refKey, type GeomRef, type VertexRef } from './geom';
import { localToScreen, type ViewState } from './view';
import type { PxTransform } from './transform';
import type { Layers } from './store';

export interface RenderInput {
  view: ViewState;
  floor: FloorDoc;
  image: HTMLImageElement | null;
  imageTransform: PxTransform | null;
  imageOpacity: number;
  layers: Layers;
  selection: GeomRef | null;
  hoverVertex: VertexRef | null;
  draft: Vec2[];
  calibMarkers: Vec2[];
}

export function render(ctx: CanvasRenderingContext2D, s: RenderInput): void {
  const { width, height } = ctx.canvas;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#14171c';
  ctx.fillRect(0, 0, width, height);
  if (s.image?.complete && s.image.naturalWidth > 0 && s.imageTransform) drawImageLayer(ctx, s);
  drawAxes(ctx, s.view, width, height);

  const f = s.floor;
  strokePath(ctx, s, f.slab.outline, true, { stroke: '#d9d9d9', width: 1.5 });
  for (const h of f.slab.holes ?? []) strokePath(ctx, s, h, true, { stroke: '#d9d9d9', width: 1, dash: [6, 4] });

  if (s.layers.areas) for (const a of f.areas ?? []) {
    const c = AREA_COLORS[a.kind] ?? '#888888';
    fillPath(ctx, s, a.polygon, c + '4d');
    strokePath(ctx, s, a.polygon, true, { stroke: c + 'aa', width: 1 });
    if (s.layers.labels) label(ctx, s, centroid(a.polygon), a.id);
  }
  if (s.layers.units) for (const u of f.units ?? []) {
    fillPath(ctx, s, u.polygon, '#9aa5b166');
    strokePath(ctx, s, u.polygon, true, { stroke: '#9aa5b1', width: 1 });
  }
  if (s.layers.walls) for (const w of f.walls ?? [])
    strokePath(ctx, s, w.polyline, false, { stroke: '#8895a3', width: Math.max(2, (w.width ?? 0.3) * s.view.zoom) });
  if (s.layers.gates) for (const g of f.gates ?? []) {
    const c = g.accessible ? GATE_COLORS.accessible : GATE_COLORS.standard;
    strokePath(ctx, s, g.line, false, { stroke: c, width: 3 });
    for (const p of g.line) dot(ctx, s, p, 4, c);
    if (s.layers.labels) label(ctx, s, mid(g.line[0], g.line[1]), `${g.id}(${g.direction})`);
  }
  if (s.layers.pois) for (const p of f.pois ?? []) {
    dot(ctx, s, p.position, 4, '#f0e050');
    if (s.layers.labels) label(ctx, s, p.position, p.id);
  }
  if (s.layers.nav) {
    const nodeXy = new Map((f.nav?.nodes ?? []).map((n) => [n.id, n.xy]));
    for (const e of f.nav?.edges ?? []) {
      const a = nodeXy.get(e.from);
      const b = nodeXy.get(e.to);
      if (a && b) strokePath(ctx, s, [a, b], false, { stroke: '#ffffff55', width: 1 });
    }
    for (const n of f.nav?.nodes ?? []) {
      dot(ctx, s, n.xy, 5, '#ffd54a');
      if (s.layers.labels) label(ctx, s, n.xy, n.id);
    }
  }

  if (s.selection) drawSelection(ctx, s, s.selection);
  if (s.draft.length) {
    strokePath(ctx, s, s.draft, false, { stroke: '#4ade80', width: 1.5, dash: [5, 3] });
    for (const p of s.draft) dot(ctx, s, p, 3, '#4ade80');
  }
  for (const m of s.calibMarkers) cross(ctx, s, m, '#ff5f5f');
}

function drawImageLayer(ctx: CanvasRenderingContext2D, s: RenderInput): void {
  const t = s.imageTransform!;
  const z = s.view.zoom;
  ctx.save();
  ctx.globalAlpha = s.imageOpacity;
  // 合成 px→local→screen 仿射矩陣（模型見 transform.ts 註解）
  ctx.setTransform(
    z * t.c, -z * t.d, z * t.d, z * t.c,
    z * (t.x0 - t.c * t.u0 - t.d * t.v0) + s.view.panX,
    -z * (t.y0 - t.d * t.u0 + t.c * t.v0) + s.view.panY,
  );
  ctx.drawImage(s.image!, 0, 0);
  ctx.restore();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawAxes(ctx: CanvasRenderingContext2D, view: ViewState, w: number, h: number): void {
  const o = localToScreen(view, [0, 0]);
  ctx.strokeStyle = '#2c333d';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, o[1]); ctx.lineTo(w, o[1]);
  ctx.moveTo(o[0], 0); ctx.lineTo(o[0], h);
  ctx.stroke();
  ctx.strokeStyle = '#8895a3';
  ctx.beginPath();
  ctx.moveTo(12, h - 20); ctx.lineTo(12 + 50 * view.zoom, h - 20);
  ctx.stroke();
  ctx.fillStyle = '#8895a3';
  ctx.font = '11px monospace';
  ctx.fillText('50 m', 14, h - 26);
}

interface StrokeOpts { stroke: string; width: number; dash?: number[] }

function pathOf(ctx: CanvasRenderingContext2D, s: RenderInput, pts: Vec2[], close: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => {
    const sp = localToScreen(s.view, p);
    if (i === 0) ctx.moveTo(sp[0], sp[1]);
    else ctx.lineTo(sp[0], sp[1]);
  });
  if (close) ctx.closePath();
}

function strokePath(ctx: CanvasRenderingContext2D, s: RenderInput, pts: Vec2[], close: boolean, o: StrokeOpts): void {
  pathOf(ctx, s, pts, close);
  ctx.strokeStyle = o.stroke;
  ctx.lineWidth = o.width;
  ctx.setLineDash(o.dash ?? []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function fillPath(ctx: CanvasRenderingContext2D, s: RenderInput, pts: Vec2[], fill: string): void {
  pathOf(ctx, s, pts, true);
  ctx.fillStyle = fill;
  ctx.fill();
}

function dot(ctx: CanvasRenderingContext2D, s: RenderInput, p: Vec2, r: number, color: string): void {
  const sp = localToScreen(s.view, p);
  ctx.beginPath();
  ctx.arc(sp[0], sp[1], r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function cross(ctx: CanvasRenderingContext2D, s: RenderInput, p: Vec2, color: string): void {
  const [x, y] = localToScreen(s.view, p);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y);
  ctx.moveTo(x, y - 8); ctx.lineTo(x, y + 8);
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, s: RenderInput, p: Vec2, text: string): void {
  if (s.view.zoom < 5) return; // 縮太小不畫標籤
  const sp = localToScreen(s.view, p);
  ctx.fillStyle = '#e8e8e8';
  ctx.font = '11px monospace';
  ctx.fillText(text, sp[0] + 5, sp[1] - 4);
}

function centroid(pts: Vec2[]): Vec2 {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

function mid(a: Vec2, b: Vec2): Vec2 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function drawSelection(ctx: CanvasRenderingContext2D, s: RenderInput, sel: GeomRef): void {
  const ring = getRing(s.floor, sel);
  if (!ring) return;
  const closed = sel.kind === 'slab-outline' || sel.kind === 'slab-hole' || sel.kind === 'area' || sel.kind === 'unit';
  if (ring.length > 1) strokePath(ctx, s, ring, closed, { stroke: '#4ade80', width: 2 });
  ring.forEach((p, vi) => {
    const sp = localToScreen(s.view, p);
    const hovered = s.hoverVertex && refKey(s.hoverVertex.ref) === refKey(sel) && s.hoverVertex.vi === vi;
    const r = hovered ? 5 : 3;
    ctx.fillStyle = hovered ? '#ffffff' : '#4ade80';
    ctx.fillRect(sp[0] - r, sp[1] - r, r * 2, r * 2);
  });
}
```

- [ ] **Step 7: 建立 tracer.html**

```html
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>台北車站 描圖工具</title>
  <style>
    html, body { margin: 0; height: 100%; background: #14171c; color: #e8e8e8;
      font-family: "Noto Sans TC", system-ui, sans-serif; font-size: 13px; }
    #wrap { display: flex; height: 100vh; }
    #side { width: 300px; flex: none; overflow-y: auto; background: #1e232b;
      border-right: 1px solid #3a4250; padding: 10px 12px; box-sizing: border-box; }
    #side h1 { font-size: 15px; margin: 0 0 8px; }
    #side section { margin-bottom: 8px; border-top: 1px solid #2c333d; padding-top: 8px; }
    #side label { display: block; margin: 3px 0; cursor: pointer; }
    #side select, #side input[type="text"], #side input[type="number"] {
      width: 100%; box-sizing: border-box; background: #14171c; color: #e8e8e8;
      border: 1px solid #3a4250; border-radius: 4px; padding: 3px 6px; margin: 2px 0; }
    #side button { margin: 4px 4px 0 0; padding: 4px 10px; background: #2b5ea7; color: #fff;
      border: 0; border-radius: 5px; cursor: pointer; }
    #side button:disabled { background: #444; cursor: not-allowed; }
    #main { flex: 1; position: relative; min-width: 0; }
    #cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; }
    #status { position: absolute; left: 8px; bottom: 8px; background: #1e232bcc; padding: 2px 8px;
      border-radius: 4px; font-family: monospace; pointer-events: none; }
    #banner { position: absolute; left: 8px; top: 8px; right: 8px; padding: 4px 8px; border-radius: 4px;
      white-space: pre-wrap; display: none; }
    #banner.ok { display: block; background: #16402a; color: #7fe3a8; }
    #banner.err { display: block; background: #4a1f24; color: #ff9c9c; }
    #overlay { position: fixed; inset: 0; background: #000c; color: #ff8080; padding: 24px;
      white-space: pre-wrap; font-family: monospace; display: none; z-index: 99; overflow: auto; }
    fieldset { border: 1px solid #3a4250; border-radius: 5px; margin: 6px 0; }
  </style>
</head>
<body>
  <div id="wrap">
    <div id="side">
      <h1>描圖工具</h1>
      <section>
        <label>樓層 <select id="floor"></select></label>
        <label>底圖 <select id="source"></select></label>
        <label>底圖透明度 <input id="img-opacity" type="range" min="0" max="100" value="70" /></label>
      </section>
      <section id="layers">
        圖層：
        <label><input id="layer-image" type="checkbox" checked /> 底圖</label>
        <label><input id="layer-areas" type="checkbox" checked /> areas</label>
        <label><input id="layer-units" type="checkbox" checked /> units</label>
        <label><input id="layer-walls" type="checkbox" checked /> walls</label>
        <label><input id="layer-gates" type="checkbox" checked /> gates</label>
        <label><input id="layer-pois" type="checkbox" checked /> pois</label>
        <label><input id="layer-nav" type="checkbox" checked /> nav</label>
        <label><input id="layer-labels" type="checkbox" checked /> 標籤</label>
      </section>
      <section id="toolbox">
        工具：
        <label><input type="radio" name="tool" value="select" checked /> 選取／編輯</label>
        <label><input type="radio" name="tool" value="draw" /> 描繪</label>
        <label><input type="radio" name="tool" value="nav" /> nav node</label>
        <label><input type="radio" name="tool" value="calibrate" /> 校準底圖</label>
      </section>
      <fieldset id="draw-form" hidden>
        <legend>描繪目標</legend>
        <select id="draw-target">
          <option value="new-area">新增 area</option>
          <option value="new-unit">新增 unit</option>
          <option value="new-wall">新增 wall</option>
          <option value="new-gate">新增 gate（2 點）</option>
          <option value="new-poi">新增 poi（1 點）</option>
          <option value="slab-hole">新增 slab hole</option>
          <option value="slab-outline">重描 slab outline</option>
          <option value="replace">替換選取元素幾何</option>
        </select>
        <select id="draw-kind"></select>
        <input id="draw-id" type="text" placeholder="id 描述段（如 paid-s、stairs-n）" />
        <label>system <select id="draw-system"><option>trtc</option><option>tra</option><option>shared</option></select></label>
        <label>confidence <select id="draw-conf"><option>3</option><option>2</option></select></label>
        <label>height(m) <input id="draw-height" type="number" value="2.5" step="0.1" /></label>
        <label>gate direction <select id="draw-dir"><option>both</option><option>in</option><option>out</option></select></label>
        <label><input id="draw-acc" type="checkbox" /> gate accessible</label>
        <input id="draw-connects" type="text" placeholder="gate connects：付費側,非付費側" />
      </fieldset>
      <div id="calib-panel" hidden>
        <div id="calib-info">—</div>
        <button id="btn-calib-save" disabled>儲存校準</button>
        <button id="btn-calib-reset">重來</button>
      </div>
      <section>
        <button id="btn-save">儲存（Ctrl+S）</button>
        <button id="btn-undo">復原（Ctrl+Z）</button>
      </section>
      <section>
        操作：左鍵＝工具動作、空白處拖曳/中鍵＝平移、滾輪＝縮放。<br />
        描繪：Enter/雙擊完成、Esc 取消、Backspace 退點、Shift＝正交。
      </section>
    </div>
    <div id="main">
      <canvas id="cv"></canvas>
      <div id="banner"></div>
      <div id="status">—</div>
    </div>
  </div>
  <div id="overlay"></div>
  <script type="module" src="/src/tracer/main.ts"></script>
</body>
</html>
```

- [ ] **Step 8: 實作 src/tracer/main.ts（最終版；Task 5/6 只加 import 與註冊行）**

```ts
import { assembleModel, LoaderError } from '../loader';
import type { FloorDoc, SourceRef, SourcesDoc, Vec2 } from '../types';
import { fitSimilarity, localToPx, type PxTransform } from './transform';
import { fitView, screenToLocal, zoomAt, type ViewState } from './view';
import { render, type RenderInput } from './render';
import { createStore, type ToolContext, type ToolHandler, type ToolName, type TracerStore } from './store';
import stationJson from '../../data/station.json';
import connectorsJson from '../../data/connectors.json';
import sourcesJson from '../../refs/sources.json';

// 工具於後續任務註冊：Task 5 → calibrate；Task 6 → select/draw/nav
const toolFactories: Partial<Record<ToolName, (ctx: ToolContext) => ToolHandler>> = {};

const DEFAULT_SOURCE: Record<string, string> = {
  'mrt-r-platform-b4': 'trtc-info-b4',
  'mrt-r-concourse-b3': 'trtc-info-b3',
  'tra-concourse-b1': 'tra-b1-map',
  'tra-platform-b2': 'tra-b2-map',
};

function el<T extends HTMLElement>(sel: string): T {
  const found = document.querySelector<T>(sel);
  if (!found) throw new Error(`找不到元素 ${sel}`);
  return found;
}

function showOverlay(text: string): void {
  const overlay = el<HTMLDivElement>('#overlay');
  overlay.textContent = text;
  overlay.style.display = 'block';
}

interface SessionUI {
  floorId?: string; sourceId?: string; layers?: TracerStore['layers'];
  imageOpacity?: number; views?: Record<string, ViewState>;
}

function boot(store: TracerStore): void {
  const cv = el<HTMLCanvasElement>('#cv');
  const ctx2d = cv.getContext('2d')!;
  const statusEl = el<HTMLDivElement>('#status');
  const bannerEl = el<HTMLDivElement>('#banner');
  const btnSave = el<HTMLButtonElement>('#btn-save');
  const btnUndo = el<HTMLButtonElement>('#btn-undo');

  // ---- session 還原（存檔會觸發資料熱重載整頁刷新，靠這裡接回工作狀態）----
  const saved: SessionUI = JSON.parse(sessionStorage.getItem('tracer-ui') ?? 'null') ?? {};
  if (saved.floorId && store.floorDocs.has(saved.floorId)) store.floorId = saved.floorId;
  if (saved.layers) store.layers = { ...store.layers, ...saved.layers };
  if (saved.imageOpacity !== undefined) store.imageOpacity = saved.imageOpacity;
  if (saved.views) store.views = saved.views;
  store.sourceId = saved.sourceId ?? DEFAULT_SOURCE[store.floorId] ?? store.sourcesDoc.sources[0].id;

  function persistSession(): void {
    store.views[store.floorId] = store.view;
    const s: SessionUI = {
      floorId: store.floorId, sourceId: store.sourceId, layers: store.layers,
      imageOpacity: store.imageOpacity, views: store.views,
    };
    sessionStorage.setItem('tracer-ui', JSON.stringify(s));
  }
  addEventListener('beforeunload', persistSession);

  // ---- 影像與校準變換 ----
  const imageCache = new Map<string, HTMLImageElement>();
  function currentSource(): SourceRef | undefined {
    return store.sourcesDoc.sources.find((s) => s.id === store.sourceId);
  }
  function currentImage(): HTMLImageElement | null {
    const src = currentSource();
    if (!src) return null;
    let img = imageCache.get(src.id);
    if (!img) {
      img = new Image();
      img.src = '/' + src.file; // dev server 直接供應 repo 根下的 refs/**
      img.onload = invalidate;
      imageCache.set(src.id, img);
    }
    return img;
  }
  function currentTransform(): PxTransform | null {
    const src = currentSource();
    if (!src) return null;
    const override = store.transformOverride.get(src.id);
    if (override) return override;
    const cp = src.calibration?.control_points;
    if (cp) return fitSimilarity(cp);
    const img = currentImage();
    if (!img || img.naturalWidth === 0) return null;
    // 未校準：暫定 10 px/m、圖中心對 local 原點，讓圖可見以便校準
    return { c: 0.1, d: 0, u0: img.naturalWidth / 2, v0: img.naturalHeight / 2, x0: 0, y0: 0 };
  }

  // ---- 重繪 ----
  let rafPending = false;
  function invalidate(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderNow(); });
  }
  function renderNow(): void {
    const input: RenderInput = {
      view: store.view,
      floor: store.floorDocs.get(store.floorId)!,
      image: store.layers.image ? currentImage() : null,
      imageTransform: currentTransform(),
      imageOpacity: store.imageOpacity,
      layers: store.layers,
      selection: store.selection,
      hoverVertex: store.hoverVertex,
      draft: store.draft,
      calibMarkers: store.calibMarkers,
    };
    render(ctx2d, input);
  }
  function resize(): void {
    cv.width = cv.clientWidth;
    cv.height = cv.clientHeight;
    invalidate();
  }
  addEventListener('resize', resize);

  // ---- ToolContext 與 undo/save ----
  function setBanner(text: string, kind: 'ok' | 'err'): void {
    bannerEl.textContent = text;
    bannerEl.className = kind;
  }
  function floorMeta() {
    return store.station.floors.find((f) => f.id === store.floorId)!;
  }
  const toolCtx: ToolContext = {
    store,
    invalidate,
    setStatus: (t) => { statusEl.textContent = t; },
    setBanner,
    pushUndo: () => {
      const doc = store.floorDocs.get(store.floorId)!;
      store.undo.push({ floorId: store.floorId, snap: JSON.stringify(doc) });
      if (store.undo.length > 50) store.undo.shift();
    },
    markDirty: (file) => { store.dirty.add(file); btnSave.textContent = '儲存*（Ctrl+S）'; },
    floorFile: () => `data/${floorMeta().file}`,
    floorShort: () => floorMeta().short,
    floorDoc: () => store.floorDocs.get(store.floorId)!,
    save,
    currentTransform,
  };
  function undo(): void {
    const top = store.undo[store.undo.length - 1];
    if (!top) { setBanner('沒有可復原的步驟', 'err'); return; }
    if (top.floorId !== store.floorId) { setBanner('復原堆疊屬於其他樓層，先切回該樓層', 'err'); return; }
    store.undo.pop();
    store.floorDocs.set(store.floorId, JSON.parse(top.snap) as FloorDoc);
    toolCtx.markDirty(toolCtx.floorFile());
    store.selection = null;
    store.hoverVertex = null;
    invalidate();
  }
  async function save(): Promise<void> {
    if (store.dirty.size === 0) { setBanner('沒有未儲存的變更', 'ok'); return; }
    const files = [...store.dirty].map((file) => ({ file, doc: docFor(file) }));
    persistSession();
    const res = await fetch('/__tracer/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, errors: [String(e)], written: [] }));
    if (res.ok) {
      store.dirty.clear();
      btnSave.textContent = '儲存（Ctrl+S）';
      setBanner(`已儲存 ${res.written.join('、')}（資料熱重載將刷新頁面）`, 'ok');
    } else {
      setBanner(res.errors.join('\n'), 'err');
    }
  }
  function docFor(file: string): unknown {
    if (file === 'refs/sources.json') return store.sourcesDoc;
    const meta = store.station.floors.find((f) => `data/${f.file}` === file)!;
    return store.floorDocs.get(meta.id);
  }

  // ---- 工具註冊與切換 ----
  const tools: Partial<Record<ToolName, ToolHandler>> = {};
  for (const [name, make] of Object.entries(toolFactories)) tools[name as ToolName] = make(toolCtx);
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="tool"]')];
  for (const r of radios) {
    r.disabled = r.value !== 'select' && !(r.value in tools);
    r.addEventListener('change', () => { if (r.checked) switchTool(r.value as ToolName); });
  }
  function switchTool(name: ToolName): void {
    tools[store.tool]?.deactivate?.();
    store.tool = name;
    store.draft = [];
    store.calibMarkers = [];
    el<HTMLElement>('#draw-form').hidden = name !== 'draw';
    el<HTMLElement>('#calib-panel').hidden = name !== 'calibrate';
    tools[name]?.activate?.();
    invalidate();
  }

  // ---- 指標事件（工具未處理的左鍵拖曳與中鍵拖曳＝平移）----
  let panFrom: { x: number; y: number; view: ViewState } | null = null;
  function localOf(ev: MouseEvent): Vec2 {
    const rect = cv.getBoundingClientRect();
    return screenToLocal(store.view, [ev.clientX - rect.left, ev.clientY - rect.top]);
  }
  cv.addEventListener('pointerdown', (ev) => {
    cv.setPointerCapture(ev.pointerId);
    const handled = ev.button === 0 && tools[store.tool]?.down?.(localOf(ev), ev);
    if (!handled) panFrom = { x: ev.clientX, y: ev.clientY, view: { ...store.view } };
  });
  cv.addEventListener('pointermove', (ev) => {
    const local = localOf(ev);
    toolCtx.setStatus(`x=${local[0].toFixed(1)}, y=${local[1].toFixed(1)}${store.tool === 'calibrate' ? pxStatus(local) : ''}`);
    if (panFrom) {
      store.view = {
        ...panFrom.view,
        panX: panFrom.view.panX + (ev.clientX - panFrom.x),
        panY: panFrom.view.panY + (ev.clientY - panFrom.y),
      };
      invalidate();
      return;
    }
    tools[store.tool]?.move?.(local, ev);
  });
  cv.addEventListener('pointerup', (ev) => {
    if (panFrom) { panFrom = null; return; }
    tools[store.tool]?.up?.(localOf(ev), ev);
  });
  cv.addEventListener('dblclick', (ev) => {
    tools[store.tool]?.dblclick?.(localOf(ev));
  });
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = cv.getBoundingClientRect();
    store.view = zoomAt(store.view, [ev.clientX - rect.left, ev.clientY - rect.top], ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    invalidate();
  }, { passive: false });
  function pxStatus(local: Vec2): string {
    const t = currentTransform();
    if (!t) return '';
    const [u, v] = localToPx(t, local);
    return ` | px=(${u.toFixed(0)}, ${v.toFixed(0)})`;
  }

  // ---- 鍵盤 ----
  addEventListener('keydown', (ev) => {
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.ctrlKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (ev.ctrlKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); void save(); return; }
    if (tools[store.tool]?.key?.(ev)) ev.preventDefault();
  });
  btnSave.addEventListener('click', () => void save());
  btnUndo.addEventListener('click', undo);

  // ---- 樓層/底圖/圖層/透明度 ----
  const floorSel = el<HTMLSelectElement>('#floor');
  for (const f of store.station.floors) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.labels['complex'] ?? ''} ${f.name.zh}（${f.id}）`;
    floorSel.append(opt);
  }
  const sourceSel = el<HTMLSelectElement>('#source');
  for (const s of store.sourcesDoc.sources) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.id + (s.calibration ? '（已校準）' : '');
    sourceSel.append(opt);
  }
  floorSel.value = store.floorId;
  sourceSel.value = store.sourceId;
  floorSel.addEventListener('change', () => {
    store.views[store.floorId] = store.view;
    store.floorId = floorSel.value;
    store.sourceId = DEFAULT_SOURCE[store.floorId] ?? store.sourceId;
    sourceSel.value = store.sourceId;
    store.selection = null;
    store.hoverVertex = null;
    store.draft = [];
    store.view = store.views[store.floorId] ?? fitToFloor();
    invalidate();
  });
  sourceSel.addEventListener('change', () => { store.sourceId = sourceSel.value; invalidate(); });
  for (const key of ['image', 'areas', 'units', 'walls', 'gates', 'pois', 'nav', 'labels'] as const) {
    const cb = el<HTMLInputElement>(`#layer-${key}`);
    cb.checked = store.layers[key];
    cb.addEventListener('change', () => { store.layers[key] = cb.checked; invalidate(); });
  }
  const opacityEl = el<HTMLInputElement>('#img-opacity');
  opacityEl.value = String(Math.round(store.imageOpacity * 100));
  opacityEl.addEventListener('input', () => { store.imageOpacity = Number(opacityEl.value) / 100; invalidate(); });

  function fitToFloor(): ViewState {
    const outline = store.floorDocs.get(store.floorId)!.slab.outline;
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    return fitView(cv.clientWidth, cv.clientHeight, [Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]);
  }

  resize();
  if (!store.views[store.floorId]) store.view = fitToFloor();
  invalidate();
}

// ---- 資料載入（與 viewer 相同來源；編輯用深拷貝工作副本）----
try {
  const floorModules = import.meta.glob('../../data/floors/*.json', { eager: true });
  const floorDocsByFile: Record<string, unknown> = {};
  for (const [p, mod] of Object.entries(floorModules))
    floorDocsByFile[p.replace('../../data/', '')] = (mod as { default: unknown }).default;
  const model = assembleModel(stationJson, floorDocsByFile, connectorsJson);
  const store = createStore({
    station: model.station,
    floors: new Map([...model.floors].map(([id, doc]) => [id, structuredClone(doc)])),
    sources: structuredClone(sourcesJson) as SourcesDoc,
  });
  boot(store);
} catch (e) {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
}
```

- [ ] **Step 9: vite.config.ts 加 build 多頁 input**

`defineConfig` 物件內、`plugins` 之後加：

```ts
build: {
  rollupOptions: {
    input: {
      main: fileURLToPath(new URL('./index.html', import.meta.url)),
      tracer: fileURLToPath(new URL('./tracer.html', import.meta.url)),
    },
  },
},
```

並在檔頭加 `import { fileURLToPath } from 'node:url';`。

- [ ] **Step 10: 全套驗證與瀏覽器目視**

Run: `npm test` — Expected: 全 PASS。
Run: `npm run typecheck` — Expected: exit 0。
Run: `npm run build` — Expected: 成功，`dist/` 含 `index.html` 與 `tracer.html`。

啟動 `npm run dev`，開 `http://localhost:5173/tracer.html` 檢查：

1. 預設顯示第一層（或 session 記憶樓層）幾何線框＋B4 底圖（未校準 → 以暫定比例顯示於原點附近，屬預期）。
2. 拖曳平移、滾輪縮放（游標為中心）、比例尺與原點軸線顯示。
3. 樓層切換：四層都能顯示、各層視角分開記憶；底圖跟隨 DEFAULT_SOURCE 切換。
4. 圖層開關與底圖透明度即時生效；zoom 拉近後出現元素 id 標籤。
5. 工具列只有「選取／編輯」可選（其餘 disabled——後續任務啟用）；儲存按鈕回「沒有未儲存的變更」。
6. `http://localhost:5173/` viewer 不受影響。

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: tracer 頁骨架——canvas 檢視/渲染/幾何存取/狀態與多頁 build

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 校準模式 + B4 底圖實際校準

**Files:**
- Create: `src/tracer/tool-calibrate.ts`
- Modify: `src/tracer/main.ts`（1 行 import + 1 行註冊）
- Modify: `refs/sources.json`（`trtc-info-b4` 取得 calibration——由工具寫入，非手改）

**Interfaces:**
- Consumes: Task 1 `fitSimilarity`/`localToPx`/`pxToLocal`/`pxPerM`、Task 4 `ToolContext`/`hitVertex`、Task 3 save API。
- Produces: `makeCalibrateTool(ctx: ToolContext): ToolHandler`；校準後 `refs/sources.json` 內該 source 有 `calibration { px_per_m, basis, status: "estimated", control_points }`。Task 6–9 的描圖以此為底。
- 流程：點擊順序「底圖點 A → A 的 local 位置 → 底圖點 B → B 的 local 位置」；local 點磁吸既有頂點（8px），或按 Enter 文字輸入；集滿即時套用預覽（`transformOverride`），按「儲存校準」寫回。

- [ ] **Step 1: 實作 src/tracer/tool-calibrate.ts**

```ts
import type { CalibrationControlPoint, Vec2 } from '../types';
import { fitSimilarity, localToPx, pxPerM, pxToLocal } from './transform';
import { allRefs, getRing, hitVertex, roundPt } from './geom';
import type { ToolContext, ToolHandler } from './store';

/** 校準：兩對「底圖 px ↔ local」控制點 → 相似變換。預覽滿意後寫回 sources.json。 */
export function makeCalibrateTool(ctx: ToolContext): ToolHandler {
  const info = document.querySelector<HTMLDivElement>('#calib-info')!;
  const btnSave = document.querySelector<HTMLButtonElement>('#btn-calib-save')!;
  const btnReset = document.querySelector<HTMLButtonElement>('#btn-calib-reset')!;
  let pts: { px: Vec2; local?: Vec2 }[] = [];

  function need(): 'px' | 'local' | 'done' {
    if (pts.length === 0) return 'px';
    if (!pts[pts.length - 1].local) return 'local';
    return pts.length === 1 ? 'px' : 'done';
  }

  function controlPoints(): [CalibrationControlPoint, CalibrationControlPoint] {
    return [
      { px: [Math.round(pts[0].px[0]), Math.round(pts[0].px[1])], local: roundPt(pts[0].local!) },
      { px: [Math.round(pts[1].px[0]), Math.round(pts[1].px[1])], local: roundPt(pts[1].local!) },
    ];
  }

  function refresh(): void {
    const t = ctx.currentTransform();
    ctx.store.calibMarkers = t ? pts.map((p) => p.local ?? pxToLocal(t, p.px)) : [];
    if (need() === 'done') { preview(); ctx.invalidate(); return; }
    const stepIdx = pts.length === 0 ? 0 : !pts[pts.length - 1].local ? pts.length * 2 - 1 : pts.length * 2;
    info.textContent = [
      '步驟 1/4：點擊底圖上的基準點 A',
      '步驟 2/4：點擊 A 對應的 local 位置（磁吸既有頂點；Enter 改輸入座標）',
      '步驟 3/4：點擊底圖上的基準點 B',
      '步驟 4/4：點擊 B 對應的 local 位置（磁吸既有頂點；Enter 改輸入座標）',
    ][stepIdx];
    btnSave.disabled = true;
    ctx.invalidate();
  }

  function preview(): void {
    try {
      const t = fitSimilarity(controlPoints());
      ctx.store.transformOverride.set(ctx.store.sourceId, t);
      info.textContent = `px_per_m ≈ ${pxPerM(t).toFixed(2)}——檢查底圖對位，滿意後按「儲存校準」`;
      btnSave.disabled = false;
    } catch (e) {
      ctx.setBanner(String(e), 'err');
      reset();
    }
  }

  function reset(): void {
    pts = [];
    ctx.store.transformOverride.delete(ctx.store.sourceId);
    btnSave.disabled = true;
    refresh();
  }

  btnReset.addEventListener('click', reset);
  btnSave.addEventListener('click', () => {
    const src = ctx.store.sourcesDoc.sources.find((s) => s.id === ctx.store.sourceId);
    const t = ctx.store.transformOverride.get(ctx.store.sourceId);
    if (!src || !t) return;
    const basis = prompt('校準依據（basis：控制點對到什麼）', src.calibration?.basis ?? '');
    if (!basis) { ctx.setBanner('需填 basis 才能儲存', 'err'); return; }
    src.calibration = {
      px_per_m: Number(pxPerM(t).toFixed(2)),
      basis,
      status: 'estimated',
      control_points: controlPoints(),
    };
    ctx.markDirty('refs/sources.json');
    void ctx.save();
  });

  return {
    activate: reset,
    deactivate: () => { ctx.store.transformOverride.delete(ctx.store.sourceId); pts = []; },
    down(local) {
      const t = ctx.currentTransform();
      if (!t) { ctx.setBanner('底圖尚未載入，無法校準', 'err'); return true; }
      const n = need();
      if (n === 'px') pts.push({ px: localToPx(t, local) });
      else if (n === 'local') {
        const doc = ctx.floorDoc();
        const hit = hitVertex(doc, allRefs(doc, ctx.store.layers), local, 8 / ctx.store.view.zoom);
        pts[pts.length - 1].local = hit ? ([...getRing(doc, hit.ref)![hit.vi]] as Vec2) : roundPt(local);
      }
      refresh();
      return true;
    },
    key(ev) {
      if (ev.key === 'Escape') { reset(); return true; }
      if (ev.key === 'Enter' && need() === 'local') {
        const input = prompt('local 座標「x,y」（公尺）');
        const m = input?.split(',').map((s) => Number(s.trim()));
        if (m && m.length === 2 && m.every(Number.isFinite)) {
          pts[pts.length - 1].local = [m[0], m[1]];
          refresh();
        } else {
          ctx.setBanner('座標格式錯誤，需「x,y」', 'err');
        }
        return true;
      }
      return false;
    },
  };
}
```

- [ ] **Step 2: main.ts 註冊工具（兩處小改）**

import 區加：

```ts
import { makeCalibrateTool } from './tool-calibrate';
```

`const toolFactories ... = {};` 的下一行加：

```ts
toolFactories.calibrate = makeCalibrateTool;
```

Run: `npm run typecheck` — Expected: exit 0。

- [ ] **Step 3: 瀏覽器功能驗證（mini 流程）**

`npm run dev` → `http://localhost:5173/tracer.html` → 樓層 B4、底圖 `trtc-info-b4`、切「校準底圖」工具：

1. 面板顯示步驟 1/4；點底圖任一點出現紅十字。
2. 步驟 2/4 點既有幾何頂點附近 → 磁吸；Enter 可改輸入座標。
3. 四步完成後底圖即時重新對位、顯示推導 px_per_m；「重來」可重置；Esc 重置。

- [ ] **Step 4: 實際校準 trtc-info-b4 並存檔**

控制點選擇（對角基線最長最穩）：

- A = 底圖上月台面「南端角」 ↔ local 磁吸 `a-rp-platform` 南端對應頂點。
- B = 底圖上月台面「北端角」 ↔ local 磁吸 `a-rp-platform` 北端對應頂點（取對角）。
- basis 填：`月台面南北兩角對齊 Phase 1 幾何（月台長 141m 基準）`。

按「儲存校準」→ 應出現綠色 banner、頁面隨資料熱重載刷新、底圖對位保持。

說明：Phase 1 幾何本身是估計值，此校準的意義是把底圖錨進**既有模型座標框架**（維持 141m 基準與 N20°E 軸向），之後 Task 7 再依底圖修幾何細節——先定框架、再修內容。

- [ ] **Step 5: 驗證輸出**

Run: `git diff refs/sources.json` — Expected: `trtc-info-b4` 多出 `calibration`（px_per_m 約 3–12 之間、control_points 兩點、status estimated）。
Run: `npm run validate` — Expected: `0 errors`（px_per_m 與控制點一致，無 warning）。
Run: `npm run format:data -- --check` — Expected: exit 0（save API 寫出即 canonical）。
Run: `npm test` — Expected: 全 PASS。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: tracer 校準模式（2 控制點相似變換）＋ trtc-info-b4 校準

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 描圖編輯核心（描繪/頂點編輯/nav node/undo/save）

**Files:**
- Create: `src/tracer/edit.ts`, `src/tracer/tool-edit.ts`
- Test: `tests/tracer-edit.test.ts`
- Modify: `src/tracer/main.ts`（1 行 import + 3 行註冊）

**Interfaces:**
- Consumes: Task 4 `geom.ts`（getRing/setRing/hit*/findArea）、`ToolContext`；Task 5 已可校準底圖。
- Produces: `edit.ts` 純函式（都 mutate 傳入 doc；main 的 pushUndo 先拍快照）：
  `addArea/addUnit/addWall/addGate/addPoi(doc, id, ..., p: ProvInput)`（provenance 自動 `{source, confidence, status:'traced'}`、繞向與 round 正規化、id 格式/唯一性檢查）、`addSlabHole(doc, ring)`、`replaceGeom(doc, ref, pts, p)`（換幾何＋蓋 provenance）、`moveVertex(doc, vref, xy)`（拖曳中不改繞向；nav-node 轉呼叫 moveNavNode）、`insertVertex(doc, ref, segIndex, xy)`、`deleteVertex(doc, vref)`（守最少點數）、`segIndexNear(ring, pt, closed)`、`nextNodeId(doc, short)`（`n-{short}-NNN` 接續補零）、`addNavNode(doc, short, xy)`（自動 id + area 判定）、`moveNavNode`（area 重判）、`deleteNavNode`（被 edge 引用則拒絕）、`elementIds(doc)`。
  `tool-edit.ts`：`makeSelectTool/makeDrawTool/makeNavTool(ctx): ToolHandler`。
- nav edge 本階段不做 UI（手寫 JSON）；工具物件架構（ToolHandler 註冊表）即完整 nav 編輯的擴充點。

- [ ] **Step 1: 寫失敗測試**

`tests/tracer-edit.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import type { FloorDoc } from '../src/types';
import { ringArea } from '../src/tracer/geom';
import {
  addArea, addGate, addNavNode, addSlabHole, deleteNavNode, deleteVertex, insertVertex,
  moveVertex, nextNodeId, replaceGeom, segIndexNear,
} from '../src/tracer/edit';

const doc = (): FloorDoc => structuredClone({
  schema: 'floor@1', id: 'hall-b1',
  slab: { outline: [[0, 0], [20, 0], [20, 10], [0, 10]], source: 's', confidence: 2 },
  areas: [{ id: 'a-ha-paid', kind: 'paid', system: 'test', polygon: [[1, 1], [9, 1], [9, 9], [1, 9]], source: 's', confidence: 2 }],
  nav: {
    nodes: [{ id: 'n-ha-001', xy: [3, 3], area: 'a-ha-paid' }, { id: 'n-ha-002', xy: [8, 8], area: 'a-ha-paid' }],
    edges: [{ from: 'n-ha-001', to: 'n-ha-002', kind: 'walk' }],
  },
} as unknown as FloorDoc);

const P = { source: 'img-1', confidence: 3 };

describe('新增元素', () => {
  it('addArea：cw 輸入轉 ccw、round 0.1、provenance 蓋 traced', () => {
    const d = doc();
    addArea(d, 'a-ha-hall', 'unpaid', 'test', [[10, 9.96], [18, 10], [18, 2], [10, 2]], P);
    const a = d.areas!.find((x) => x.id === 'a-ha-hall')!;
    expect(ringArea(a.polygon)).toBeGreaterThan(0);
    expect(a.polygon.some((p) => p[1] === 10)).toBe(true); // 9.96 → 10
    expect(a.status).toBe('traced');
    expect(a.source).toBe('img-1');
    expect(a.confidence).toBe(3);
  });

  it('addArea：id 重複或格式錯拋錯', () => {
    expect(() => addArea(doc(), 'a-ha-paid', 'paid', 'test', [[0, 0], [1, 0], [1, 1]], P)).toThrow('已存在');
    expect(() => addArea(doc(), 'Bad_ID', 'paid', 'test', [[0, 0], [1, 0], [1, 1]], P)).toThrow('格式');
  });

  it('addGate：connects 檢查與恰 2 點', () => {
    const d = doc();
    expect(() => addGate(d, 'g-ha-x', 'test', 'both', true, ['a-ha-paid', 'nope'], [[1, 1], [2, 2]], P)).toThrow('不存在');
    expect(() => addGate(d, 'g-ha-x', 'test', 'both', true, ['a-ha-paid', 'a-ha-paid'], [[1, 1]], P)).toThrow('2 點');
    addGate(d, 'g-ha-x', 'test', 'in', false, ['a-ha-paid', 'a-ha-paid'], [[2, 8], [4, 8]], P);
    expect(d.gates![0].direction).toBe('in');
  });

  it('addSlabHole：ccw 輸入轉 cw', () => {
    const d = doc();
    addSlabHole(d, [[12, 2], [15, 2], [15, 5], [12, 5]]);
    expect(ringArea(d.slab.holes![0])).toBeLessThan(0);
  });
});

describe('幾何編修', () => {
  it('replaceGeom：換幾何並蓋 provenance', () => {
    const d = doc();
    replaceGeom(d, { kind: 'area', id: 'a-ha-paid' }, [[1, 1], [8, 1], [8, 8], [1, 8]], P);
    const a = d.areas![0];
    expect(a.polygon.length).toBe(4);
    expect(a.status).toBe('traced');
    expect(a.source).toBe('img-1');
  });

  it('moveVertex：round；nav-node 移動重判 area', () => {
    const d = doc();
    moveVertex(d, { ref: { kind: 'area', id: 'a-ha-paid' }, vi: 0 }, [1.26, 1.24]);
    expect(d.areas![0].polygon[0]).toEqual([1.3, 1.2]);
    moveVertex(d, { ref: { kind: 'nav-node', id: 'n-ha-001' }, vi: 0 }, [15, 5]); // area 外
    const n = d.nav!.nodes[0];
    expect(n.xy).toEqual([15, 5]);
    expect(n.area).toBeUndefined();
  });

  it('insertVertex / deleteVertex / segIndexNear', () => {
    const d = doc();
    const ref = { kind: 'area', id: 'a-ha-paid' } as const;
    expect(segIndexNear(d.areas![0].polygon, [5, 1], true)).toBe(0);
    expect(segIndexNear(d.areas![0].polygon, [1, 5], true)).toBe(3); // 尾→首段
    expect(insertVertex(d, ref, 0, [5, 1])).toBe(true);
    expect(d.areas![0].polygon[1]).toEqual([5, 1]);
    expect(deleteVertex(d, { ref, vi: 1 })).toBe(true);
    expect(deleteVertex(d, { ref: { kind: 'gate', id: 'nope' }, vi: 0 })).toBe(false);
    const tri = doc();
    tri.areas![0].polygon = [[0, 0], [4, 0], [4, 4]];
    expect(deleteVertex(tri, { ref, vi: 0 })).toBe(false); // 守最少 3 點
  });
});

describe('nav node', () => {
  it('nextNodeId 接續補零；addNavNode 自動 id 與 area', () => {
    const d = doc();
    expect(nextNodeId(d, 'ha')).toBe('n-ha-003');
    const n = addNavNode(d, 'ha', [2.04, 2]);
    expect(n.id).toBe('n-ha-003');
    expect(n.xy).toEqual([2, 2]);
    expect(n.area).toBe('a-ha-paid');
    const outside = addNavNode(d, 'ha', [19, 9]);
    expect(outside.id).toBe('n-ha-004');
    expect(outside.area).toBeUndefined();
  });

  it('deleteNavNode：被 edge 引用拒絕，否則刪除', () => {
    const d = doc();
    expect(deleteNavNode(d, 'n-ha-001').ok).toBe(false);
    addNavNode(d, 'ha', [2, 2]);
    expect(deleteNavNode(d, 'n-ha-003').ok).toBe(true);
    expect(d.nav!.nodes.length).toBe(2);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/tracer-edit.test.ts`
Expected: FAIL（`Cannot find module '../src/tracer/edit'`）。

- [ ] **Step 3: 實作 src/tracer/edit.ts**

```ts
import type { Area, FloorDoc, Gate, NavNode, Poi, Unit, Vec2 } from '../types';
import {
  distPointSeg, ensureWinding, findArea, geomKind, getRing, minPoints, roundPt, setRing,
  type GeomRef, type VertexRef,
} from './geom';

export interface ProvInput { source: string; confidence: number }

function prov(p: ProvInput): { source: string; confidence: 1 | 2 | 3 | 4 | 5; status: 'traced' } {
  const c = Math.min(5, Math.max(1, Math.round(p.confidence))) as 1 | 2 | 3 | 4 | 5;
  return { source: p.source, confidence: c, status: 'traced' };
}

export function elementIds(doc: FloorDoc): Set<string> {
  const ids = new Set<string>();
  for (const arr of [doc.areas, doc.walls, doc.units, doc.gates, doc.pois] as Array<Array<{ id: string }> | undefined>)
    for (const e of arr ?? []) ids.add(e.id);
  for (const n of doc.nav?.nodes ?? []) ids.add(n.id);
  return ids;
}

function assertNewId(doc: FloorDoc, id: string): void {
  if (!/^[a-z]+-[a-z]{2}-[a-z0-9-]+$/.test(id)) throw new Error(`id 格式不符：${id}`);
  if (elementIds(doc).has(id)) throw new Error(`id 已存在：${id}`);
}

export function addArea(doc: FloorDoc, id: string, kind: Area['kind'], system: string, polygon: Vec2[], p: ProvInput): GeomRef {
  if (polygon.length < 3) throw new Error('area 需至少 3 點');
  assertNewId(doc, id);
  (doc.areas ??= []).push({ id, kind, system, polygon: ensureWinding(polygon.map(roundPt), 'ccw'), ...prov(p) });
  return { kind: 'area', id };
}

export function addUnit(doc: FloorDoc, id: string, kind: Unit['kind'], height: number, polygon: Vec2[], p: ProvInput): GeomRef {
  if (polygon.length < 3) throw new Error('unit 需至少 3 點');
  if (!(height > 0)) throw new Error('unit height 需 > 0');
  assertNewId(doc, id);
  (doc.units ??= []).push({ id, kind, height, polygon: ensureWinding(polygon.map(roundPt), 'ccw'), ...prov(p) });
  return { kind: 'unit', id };
}

export function addWall(doc: FloorDoc, id: string, height: number, polyline: Vec2[], p: ProvInput): GeomRef {
  if (polyline.length < 2) throw new Error('wall 需至少 2 點');
  if (!(height > 0)) throw new Error('wall height 需 > 0');
  assertNewId(doc, id);
  (doc.walls ??= []).push({ id, height, polyline: polyline.map(roundPt), ...prov(p) });
  return { kind: 'wall', id };
}

export function addGate(
  doc: FloorDoc, id: string, system: string, direction: Gate['direction'],
  accessible: boolean, connects: [string, string], line: Vec2[], p: ProvInput,
): GeomRef {
  if (line.length !== 2) throw new Error('gate 需恰 2 點');
  const areaIds = new Set((doc.areas ?? []).map((a) => a.id));
  if (!areaIds.has(connects[0]) || !areaIds.has(connects[1])) throw new Error(`connects 的 area 不存在：${connects.join(',')}`);
  assertNewId(doc, id);
  (doc.gates ??= []).push({
    id, kind: 'faregate', system, direction, accessible,
    line: [roundPt(line[0]), roundPt(line[1])], connects, ...prov(p),
  });
  return { kind: 'gate', id };
}

export function addPoi(doc: FloorDoc, id: string, kind: Poi['kind'], position: Vec2, p: ProvInput): GeomRef {
  assertNewId(doc, id);
  (doc.pois ??= []).push({ id, kind, position: roundPt(position), ...prov(p) });
  return { kind: 'poi', id };
}

export function addSlabHole(doc: FloorDoc, ring: Vec2[]): GeomRef {
  if (ring.length < 3) throw new Error('hole 需至少 3 點');
  (doc.slab.holes ??= []).push(ensureWinding(ring.map(roundPt), 'cw'));
  return { kind: 'slab-hole', index: doc.slab.holes.length - 1 };
}

/** 替換既有元素幾何並蓋 provenance（status: traced）。point 類請用拖曳。 */
export function replaceGeom(doc: FloorDoc, ref: GeomRef, pts: Vec2[], p: ProvInput): void {
  if (geomKind(ref) === 'point') throw new Error('point 元素請用拖曳移動');
  setRing(doc, ref, pts);
  const target =
    ref.kind === 'slab-outline' || ref.kind === 'slab-hole' ? doc.slab :
    ref.kind === 'area' ? doc.areas?.find((a) => a.id === ref.id) :
    ref.kind === 'unit' ? doc.units?.find((u) => u.id === ref.id) :
    ref.kind === 'wall' ? doc.walls?.find((w) => w.id === ref.id) :
    ref.kind === 'gate' ? doc.gates?.find((g) => g.id === ref.id) : undefined;
  if (target) Object.assign(target, prov(p));
}

export function moveVertex(doc: FloorDoc, v: VertexRef, xy: Vec2): void {
  if (geomKind(v.ref) === 'point') {
    if (v.ref.kind === 'nav-node') { moveNavNode(doc, v.ref.id, xy); return; }
    setRing(doc, v.ref, [xy]);
    return;
  }
  const ring = getRing(doc, v.ref);
  if (ring) ring[v.vi] = roundPt(xy); // 拖曳中不做繞向正規化，避免頂點索引翻轉
}

export function insertVertex(doc: FloorDoc, ref: GeomRef, segIndex: number, xy: Vec2): boolean {
  const k = geomKind(ref);
  if (k === 'line2' || k === 'point') return false;
  const ring = getRing(doc, ref);
  if (!ring) return false;
  ring.splice(segIndex + 1, 0, roundPt(xy));
  return true;
}

export function deleteVertex(doc: FloorDoc, v: VertexRef): boolean {
  const k = geomKind(v.ref);
  if (k === 'point' || k === 'line2') return false;
  const ring = getRing(doc, v.ref);
  if (!ring || ring.length <= minPoints(v.ref)) return false;
  ring.splice(v.vi, 1);
  return true;
}

/** 最近線段索引（closed 時含尾→首段），供插入頂點 */
export function segIndexNear(ring: Vec2[], pt: Vec2, closed: boolean): number {
  let best = 0;
  let bestD = Infinity;
  const n = closed ? ring.length : ring.length - 1;
  for (let i = 0; i < n; i++) {
    const d = distPointSeg(pt, ring[i], ring[(i + 1) % ring.length]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

export function nextNodeId(doc: FloorDoc, short: string): string {
  let max = 0;
  const re = new RegExp(`^n-${short}-(\\d{3})$`);
  for (const n of doc.nav?.nodes ?? []) {
    const m = re.exec(n.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `n-${short}-${String(max + 1).padStart(3, '0')}`;
}

export function addNavNode(doc: FloorDoc, short: string, xy: Vec2): NavNode {
  const node: NavNode = { id: nextNodeId(doc, short), xy: roundPt(xy) };
  const area = findArea(doc, node.xy);
  if (area) node.area = area;
  (doc.nav ??= { nodes: [], edges: [] }).nodes.push(node);
  return node;
}

export function moveNavNode(doc: FloorDoc, id: string, xy: Vec2): void {
  const n = doc.nav?.nodes.find((x) => x.id === id);
  if (!n) return;
  n.xy = roundPt(xy);
  const area = findArea(doc, n.xy);
  if (area) n.area = area;
  else delete n.area;
}

export function deleteNavNode(doc: FloorDoc, id: string): { ok: boolean; reason?: string } {
  if ((doc.nav?.edges ?? []).some((e) => e.from === id || e.to === id))
    return { ok: false, reason: `${id} 仍被 edge 引用，請先修 JSON` };
  const idx = doc.nav?.nodes.findIndex((n) => n.id === id) ?? -1;
  if (idx < 0) return { ok: false, reason: `${id} 不存在` };
  doc.nav!.nodes.splice(idx, 1);
  return { ok: true };
}
```

Run: `npx vitest run tests/tracer-edit.test.ts` — Expected: PASS。

- [ ] **Step 4: 實作 src/tracer/tool-edit.ts**

```ts
import type { Area, Gate, Poi, Unit, Vec2 } from '../types';
import { allRefs, geomKind, getRing, hitGeom, hitVertex, type GeomRef, type VertexRef } from './geom';
import {
  addArea, addGate, addNavNode, addPoi, addSlabHole, addUnit, addWall, deleteNavNode,
  deleteVertex, insertVertex, moveNavNode, moveVertex, replaceGeom, segIndexNear, type ProvInput,
} from './edit';
import type { ToolContext, ToolHandler } from './store';

const AREA_KINDS: Area['kind'][] = ['platform', 'paid', 'unpaid', 'corridor', 'track', 'restricted'];
const UNIT_KINDS: Unit['kind'][] = ['column', 'shop', 'room', 'machine', 'stair-void'];
const POI_KINDS: Poi['kind'][] = ['tvm', 'info', 'toilet', 'exit', 'sign'];

function q<T extends HTMLElement>(sel: string): T {
  return document.querySelector<T>(sel)!;
}

function tol(ctx: ToolContext): number {
  return 8 / ctx.store.view.zoom;
}

/** 選取／編輯：點選元素、拖頂點、Alt+點刪頂點、雙擊選取元素邊上插點、Esc 取消選取 */
export function makeSelectTool(ctx: ToolContext): ToolHandler {
  let dragging: VertexRef | null = null;
  return {
    down(local, ev) {
      const doc = ctx.floorDoc();
      const refs = allRefs(doc, ctx.store.layers);
      const v = hitVertex(doc, refs, local, tol(ctx));
      if (v && ev.altKey) {
        ctx.pushUndo();
        if (deleteVertex(doc, v)) { ctx.markDirty(ctx.floorFile()); ctx.invalidate(); }
        else { ctx.store.undo.pop(); ctx.setBanner('已達最少點數或此類元素不可刪點', 'err'); }
        return true;
      }
      if (v) {
        dragging = v;
        ctx.pushUndo();
        ctx.store.selection = v.ref;
        ctx.invalidate();
        return true;
      }
      const g = hitGeom(doc, refs, local, tol(ctx));
      ctx.store.selection = g;
      ctx.store.hoverVertex = null;
      ctx.invalidate();
      return Boolean(g); // 點空白 → 交還平移
    },
    move(local) {
      const doc = ctx.floorDoc();
      if (dragging) {
        moveVertex(doc, dragging, local);
        ctx.markDirty(ctx.floorFile());
        ctx.invalidate();
        return;
      }
      const sel = ctx.store.selection;
      if (!sel) return;
      const hv = hitVertex(doc, [sel], local, tol(ctx));
      const prev = ctx.store.hoverVertex;
      if ((hv?.vi ?? -1) !== (prev?.vi ?? -1)) {
        ctx.store.hoverVertex = hv;
        ctx.invalidate();
      }
    },
    up() { dragging = null; },
    dblclick(local) {
      const sel = ctx.store.selection;
      if (!sel) return;
      const doc = ctx.floorDoc();
      const ring = getRing(doc, sel);
      const k = geomKind(sel);
      if (!ring || k === 'point' || k === 'line2') return;
      ctx.pushUndo();
      const si = segIndexNear(ring, local, k === 'ccw' || k === 'cw');
      if (insertVertex(doc, sel, si, local)) { ctx.markDirty(ctx.floorFile()); ctx.invalidate(); }
      else ctx.store.undo.pop();
    },
    key(ev) {
      if (ev.key === 'Escape') {
        ctx.store.selection = null;
        ctx.store.hoverVertex = null;
        ctx.invalidate();
        return true;
      }
      return false;
    },
  };
}

/** 描繪：點擊加點（磁吸頂點；Shift 正交）、Enter/雙擊完成、Esc 取消、Backspace 退點。
 *  poi 1 點、gate 2 點自動完成。 */
export function makeDrawTool(ctx: ToolContext): ToolHandler {
  const targetSel = q<HTMLSelectElement>('#draw-target');
  const kindSel = q<HTMLSelectElement>('#draw-kind');
  const idEl = q<HTMLInputElement>('#draw-id');
  const systemSel = q<HTMLSelectElement>('#draw-system');
  const confSel = q<HTMLSelectElement>('#draw-conf');
  const heightEl = q<HTMLInputElement>('#draw-height');
  const dirSel = q<HTMLSelectElement>('#draw-dir');
  const accEl = q<HTMLInputElement>('#draw-acc');
  const connectsEl = q<HTMLInputElement>('#draw-connects');

  function fillKinds(): void {
    const t = targetSel.value;
    const kinds: string[] = t === 'new-area' ? AREA_KINDS : t === 'new-unit' ? UNIT_KINDS : t === 'new-poi' ? POI_KINDS : [];
    kindSel.replaceChildren(...kinds.map((k) => new Option(k, k)));
    kindSel.disabled = kinds.length === 0;
  }
  targetSel.addEventListener('change', fillKinds);
  fillKinds();

  function provInput(): ProvInput {
    return { source: ctx.store.sourceId, confidence: Number(confSel.value) };
  }

  function snap(local: Vec2, ev: PointerEvent): Vec2 {
    const doc = ctx.floorDoc();
    const hit = hitVertex(doc, allRefs(doc, ctx.store.layers), local, tol(ctx));
    if (hit) return [...getRing(doc, hit.ref)![hit.vi]] as Vec2;
    const draft = ctx.store.draft;
    if (ev.shiftKey && draft.length) {
      const prev = draft[draft.length - 1];
      return Math.abs(local[0] - prev[0]) > Math.abs(local[1] - prev[1])
        ? [local[0], prev[1]]
        : [prev[0], local[1]];
    }
    return local;
  }

  function finish(): void {
    const store = ctx.store;
    const doc = ctx.floorDoc();
    const pts = store.draft;
    if (!pts.length) return;
    const t = targetSel.value;
    const short = ctx.floorShort();
    const idDesc = idEl.value.trim();
    try {
      ctx.pushUndo();
      try {
        if (t === 'replace') {
          if (!store.selection) throw new Error('先用選取工具選要替換的元素');
          replaceGeom(doc, store.selection, pts, provInput());
        } else if (t === 'slab-outline') {
          replaceGeom(doc, { kind: 'slab-outline' }, pts, provInput());
        } else if (t === 'slab-hole') {
          store.selection = addSlabHole(doc, pts);
        } else {
          if (!idDesc) throw new Error('請填 id 描述段');
          if (t === 'new-area') store.selection = addArea(doc, `a-${short}-${idDesc}`, kindSel.value as Area['kind'], systemSel.value, pts, provInput());
          else if (t === 'new-unit') store.selection = addUnit(doc, `u-${short}-${idDesc}`, kindSel.value as Unit['kind'], Number(heightEl.value), pts, provInput());
          else if (t === 'new-wall') store.selection = addWall(doc, `w-${short}-${idDesc}`, Number(heightEl.value), pts, provInput());
          else if (t === 'new-poi') store.selection = addPoi(doc, `p-${short}-${idDesc}`, kindSel.value as Poi['kind'], pts[0], provInput());
          else if (t === 'new-gate') {
            const connects = connectsEl.value.split(',').map((s) => s.trim());
            if (connects.length !== 2 || !connects[0] || !connects[1]) throw new Error('connects 需「付費側,非付費側」兩個 area id');
            store.selection = addGate(doc, `g-${short}-${idDesc}`, systemSel.value, dirSel.value as Gate['direction'], accEl.checked, connects as [string, string], pts, provInput());
          }
        }
      } catch (e) {
        store.undo.pop();
        throw e;
      }
      store.draft = [];
      ctx.markDirty(ctx.floorFile());
      ctx.setBanner('已加入（Ctrl+S 儲存後生效）', 'ok');
      ctx.invalidate();
    } catch (e) {
      ctx.setBanner(String(e), 'err');
    }
  }

  return {
    activate: () => { ctx.store.draft = []; },
    down(local, ev) {
      const t = targetSel.value;
      ctx.store.draft = [...ctx.store.draft, snap(local, ev)];
      if (t === 'new-poi' && ctx.store.draft.length === 1) finish();
      else if (t === 'new-gate' && ctx.store.draft.length === 2) finish();
      ctx.invalidate();
      return true;
    },
    dblclick() { finish(); },
    key(ev) {
      if (ev.key === 'Enter') { finish(); return true; }
      if (ev.key === 'Escape') { ctx.store.draft = []; ctx.invalidate(); return true; }
      if (ev.key === 'Backspace') { ctx.store.draft = ctx.store.draft.slice(0, -1); ctx.invalidate(); return true; }
      return false;
    },
  };
}

/** nav node：點擊新增（自動序號/area）、拖移、Alt+點刪除（未被 edge 引用才可） */
export function makeNavTool(ctx: ToolContext): ToolHandler {
  let dragging: string | null = null;
  return {
    down(local, ev) {
      const doc = ctx.floorDoc();
      const navRefs = (doc.nav?.nodes ?? []).map((n) => ({ kind: 'nav-node', id: n.id }) as GeomRef);
      const hit = hitVertex(doc, navRefs, local, tol(ctx));
      if (hit && hit.ref.kind === 'nav-node') {
        if (ev.altKey) {
          ctx.pushUndo();
          const r = deleteNavNode(doc, hit.ref.id);
          if (r.ok) { ctx.markDirty(ctx.floorFile()); ctx.store.selection = null; }
          else { ctx.store.undo.pop(); ctx.setBanner(r.reason!, 'err'); }
          ctx.invalidate();
          return true;
        }
        dragging = hit.ref.id;
        ctx.pushUndo();
        ctx.store.selection = hit.ref;
        ctx.invalidate();
        return true;
      }
      ctx.pushUndo();
      const node = addNavNode(doc, ctx.floorShort(), local);
      ctx.store.selection = { kind: 'nav-node', id: node.id };
      ctx.markDirty(ctx.floorFile());
      ctx.setBanner(`已新增 ${node.id}${node.area ? `（area: ${node.area}）` : ''}——edge 請手動編修 JSON`, 'ok');
      ctx.invalidate();
      return true;
    },
    move(local) {
      if (!dragging) return;
      moveNavNode(ctx.floorDoc(), dragging, local);
      ctx.markDirty(ctx.floorFile());
      ctx.invalidate();
    },
    up() { dragging = null; },
    key(ev) {
      if (ev.key === 'Escape') { ctx.store.selection = null; ctx.invalidate(); return true; }
      return false;
    },
  };
}
```

- [ ] **Step 5: main.ts 註冊三個工具**

import 區加：

```ts
import { makeDrawTool, makeNavTool, makeSelectTool } from './tool-edit';
```

`toolFactories.calibrate = makeCalibrateTool;` 之後加：

```ts
toolFactories.select = makeSelectTool;
toolFactories.draw = makeDrawTool;
toolFactories.nav = makeNavTool;
```

Run: `npm run typecheck`、`npm test` — Expected: 通過。

- [ ] **Step 6: 端到端驗證（描一個拋棄式元素）**

`npm run dev` → tracer → B4（已校準底圖）：

1. 「描繪」工具、目標 `新增 area`、kind `corridor`、id 描述段 `tmp-e2e`、confidence 2 → 畫一個四邊形 → Enter → 綠 banner。
2. Ctrl+S → 儲存成功、頁面刷新後元素仍在（讀自檔案）；`http://localhost:5173/` viewer 熱重載後 B4 出現淡綠色面。
3. 「選取」工具點該元素 → 拖頂點、雙擊插點、Alt+點刪點、Ctrl+Z 復原皆正常；再存一次。
4. 「nav node」工具點擊月台面 → 新增 `n-rp-006`（或接續序號）並自動帶 area；拖移正常；Alt+點刪除成功（無 edge 引用）。
5. `npm run validate` — Expected: 0 errors（tmp 元素 status=traced 且來源已校準，無 warning）。
6. 清除拋棄式測試資料：`git checkout -- data/floors/mrt-r-platform-b4.json`，viewer/tracer 熱重載回乾淨狀態。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: tracer 編輯核心——描繪/頂點編修/nav node/undo/整批儲存

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: B4 淡水信義線月台層精修

**Files:**
- Modify: `data/floors/mrt-r-platform-b4.json`（tracer 重描；直接手改僅限 nav edges）
- Modify: `docs/floor-notes/mrt-r-platform-b4.md`

**Interfaces:**
- Consumes: Task 5 已校準的 `trtc-info-b4`、Task 6 編輯工具。
- Produces: B4 全元素 `status: traced`；新增 nav node `n-rp-006`（月台中段電梯2 錨點，**Task 8 的 connector `c-elv-rprc-2` 依賴此 id**）。既有 node id `n-rp-001..005` 不變（connectors 契約）。

精修方法（各樓層任務通用）：底圖透明度調 50–80% 對照，逐元素用「描繪→替換選取元素幾何」重描（provenance 自動蓋 `status: traced`、source=當前底圖、confidence 依判讀清晰度 3 或 2）；nav node 用 nav 工具拖到圖示位置；每存一批就看 viewer 3D 結果；座標微調用「選取」工具拖頂點。

- [ ] **Step 1: 重描清單（全部完成，status 全 traced）**

| 對象 | 動作 | 依據與要求 |
|---|---|---|
| slab.outline | 依圖重描站體實形（4–8 點，維持 N20°E 軸向） | conf 3 |
| `a-rp-platform` | 重描實寬與端點形狀（島式月台，長軸 141m 基準已由校準錨定） | conf 3；note 保留 141m 基準說明 |
| `a-rp-track-e` / `a-rp-track-w` | 依圖重描兩側軌道帶 | conf 3 |
| 新增 `u-rp-stairs-s` / `u-rp-stairs-c` / `u-rp-stairs-n`（圖示 4 組則加 `u-rp-stairs-c2`） | kind `stair-void`、height 依 slab 厚 0.3（開口示意） | 位置依圖示梯群，conf 3 |
| nav `n-rp-001..005` | 拖到梯群/電梯圖示實際位置（id 不變；001 南梯群、002 南端電梯1、004 北梯群） | conf 概念不適用（node 無 prov） |
| 新增 nav `n-rp-006` | 月台中段「淡水信義線 2」電梯位置 | 供 Task 8 connector 錨定 |

- [ ] **Step 2: 手改 nav edges 接入 n-rp-006**

用編輯器開 `data/floors/mrt-r-platform-b4.json`，在 `nav.edges` 加一條（接最近的既有鏈節點，依實際位置選 `n-rp-003` 或 `n-rp-002`）：

```json
{ "from": "n-rp-003", "to": "n-rp-006", "kind": "walk" }
```

改完跑 `npm run format:data`。

- [ ] **Step 3: 驗證**

Run: `npm run validate` — Expected: 0 errors、0 warnings（traced 元素來源已有 calibration）。
Run: `npm test` — Expected: 全 PASS（`route.integration` 的 demo 路徑仍通——node id 未變，只有座標移動）。
Viewer 目視 checklist：月台寬窄與圖相符、梯群開口（灰色量體）位於圖示處、兩側軌道槽下沉、demo 一般/無障礙路徑仍可畫出。

- [ ] **Step 4: 更新 floor-note**

`docs/floor-notes/mrt-r-platform-b4.md` 全檔改寫，需涵蓋（實際數值依描圖結果填入，不留空格）：

```markdown
# mrt-r-platform-b4 判讀筆記

## 校準（Phase 2）
- trtc-info-b4：control points＝月台面南/北角 ↔ Phase 1 幾何對應頂點；px_per_m＝（sources.json 實值）；
  意義：底圖錨進既有模型框架（141m 基準、N20°E 軸向不變）。

## 重描摘要（Phase 2，status=traced）
- slab / platform / track-e / track-w：依 trtc-info-b4 重描，conf 3。與粗版的主要差異：（描述實際修了什麼，如月台寬 xx→yy m）。
- 梯群開口 u-rp-stairs-*：圖示 N 組全數建入，conf 3。
- 電梯：南端電梯1（既有 c-elv-rprc-1 錨 n-rp-002）＋中段電梯2（新增 n-rp-006，connector 於 B3 精修時建）。

## 仍未確定
- 月台門（未建模，Phase 2 範圍外）。
- （其餘實際遇到的疑點逐條列出）
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "data: B4 月台層描圖精修（traced）＋電梯2 節點

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: B3 R 線大廳層精修 + 南閘門群 + 電梯2 connector

**Files:**
- Modify: `data/floors/mrt-r-concourse-b3.json`（tracer 重描 + 手改 nav edges）
- Modify: `data/connectors.json`（新增 `c-elv-rprc-2`）
- Modify: `refs/sources.json`（`trtc-info-b3` calibration——由工具寫入）
- Modify: `docs/floor-notes/mrt-r-concourse-b3.md`

**Interfaces:**
- Consumes: Task 7 的 `n-rp-006`；Task 5/6 工具。
- Produces: B3 全元素 traced；新閘門群與 nav；`c-elv-rprc-2` 完整無障礙鏈第二部電梯。demo 終點 `n-rc-006` id 不變。

- [ ] **Step 1: 校準 trtc-info-b3**

tracer → B3 → 底圖 `trtc-info-b3` → 校準工具。控制點建議：R 線站體在 B3 圖上的兩個對角特徵（如大廳 slab 南/北端角 ↔ 既有 slab 頂點），basis 填「B3 大廳輪廓對齊 Phase 1 幾何（R 線站體軸向）」。儲存後 `npm run validate` 確認無 warning。

- [ ] **Step 2: 重描清單**

| 對象 | 動作 | 依據與要求 |
|---|---|---|
| slab.outline | 依圖重描大廳實形（粗版是 4 點平行四邊形，改為實際輪廓） | conf 3 |
| 既有 3 個 areas（付費區、北非付費區、臺鐵轉乘區——以檔內實際 id 為準） | 逐一重描實界；付費區邊界、臺鐵轉乘付費區範圍依圖 | conf 3；含糊處 2＋note |
| 既有 5 個 gates | 位置/朝向精確化（含 demo 終點閘門 `g-rc-*`——重描幾何但 **id 不變**） | conf 3 |
| 新增南側非付費區 `a-rc-unpaid-s` | 大廳南端非付費帶（往忠孝西路/板南線方向） | conf 3；kind `unpaid` |
| 新增南閘門群 `g-rc-s-1`（in）、`g-rc-s-2`（out）、`g-rc-s-acc`（both、accessible）——實際組數依圖增減 | connects `[付費區 id, a-rc-unpaid-s]` | conf 2–3 |
| 新增 nav：南閘門兩側 node（付費側/非付費側各一）＋ gate edges | edge 方向遵守 gate direction（in：非付費→付費；out 反向；acc 雙向 bidir） | 手改 JSON |
| nav `n-rc-001..013` | 依圖拖到實際位置；特別修正 `n-rc-007`（往 B1 長電扶梯口，依剖面圖與 B3 圖） | id 全部不變 |
| 新增 nav `n-rc-014` | 電梯2 的 B3 端錨點（對應 B4 `n-rp-006` 的豎井位置）＋ walk edge 接入大廳鏈 | — |

- [ ] **Step 3: 手改 nav edges 與 connectors.json**

B3 `nav.edges` 新增（實際鄰接節點依位置選）：

```json
{ "from": "n-rc-001", "to": "n-rc-014", "kind": "walk" }
```

南閘門 gate edges 範例（node id 依實際新增序號）：

```json
{ "from": "n-rc-015", "to": "n-rc-016", "kind": "gate", "gate": "g-rc-s-2", "bidir": false }
```

`data/connectors.json` 的 `connectors` 陣列新增：

```json
{
  "id": "c-elv-rprc-2",
  "kind": "elevator",
  "system": "trtc",
  "direction": "both",
  "accessible": true,
  "levels": [
    { "floor": "mrt-r-platform-b4", "node": "n-rp-006" },
    { "floor": "mrt-r-concourse-b3", "node": "n-rc-014" }
  ],
  "source": "trtc-info-b4",
  "confidence": 3,
  "status": "traced",
  "note": "月台中段電梯（淡水信義線2），B4↔B3"
}
```

（node id 以實際檔案為準——上面是預期序號；`levels` 低樓在前。）改完跑 `npm run format:data`。

- [ ] **Step 4: 電梯服務樓層核對**

對照 trtc-info-b3 與剖面圖，核對既有 `c-elv-rctc-1`（B3→B1）與兩部月台電梯的 note 描述是否與圖一致；只更新 `note`/`confidence`，不改結構。

- [ ] **Step 5: 驗證**

Run: `npm run validate` — Expected: 0 errors（gate edge 方向與 direction 相容性由 validator 把關；新閘門若報錯即修）。
Run: `npm test` — Expected: 全 PASS（demo 一般/無障礙路徑仍通）。
Viewer 目視：大廳輪廓與圖相符、南北閘門群位置正確、無障礙 demo 改走電梯鏈仍成立；tracer 中電梯2 豎井位置上下層對齊（B4/B3 切換比對）。

- [ ] **Step 6: 更新 floor-note 並 Commit**

`docs/floor-notes/mrt-r-concourse-b3.md` 全檔改寫（結構同 Task 7 Step 4：校準／重描摘要含南閘門群與電梯2／仍未確定——高鐵轉乘區未建、南閘門實際組數等疑點逐條列）。

```bash
git add -A
git commit -m "data: B3 大廳層描圖精修＋南閘門群＋電梯2 connector

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: B1/B2 臺鐵樓層精修 + 柱列 + 全站回歸

**Files:**
- Modify: `data/floors/tra-concourse-b1.json`, `data/floors/tra-platform-b2.json`
- Modify: `refs/sources.json`（`tra-b1-map`、`tra-b2-map` calibration）
- Modify: `docs/floor-notes/tra-concourse-b1.md`, `docs/floor-notes/tra-platform-b2.md`

**Interfaces:**
- Consumes: Task 5/6 工具；B1 既有 nav node（`c-esc-rctc-1/2`、`c-elv-rctc-1` 的錨點）id 不變。
- Produces: 四層全 traced 收斂；Phase 2 資料精修完成的回歸基準。

- [ ] **Step 1: 校準 tra-b1-map 與 tra-b2-map**

- `tra-b1-map`：控制點錨定既有 B1 slab 東翼兩個對角頂點（與 Phase 1 框架對齊），basis 填「臺鐵 B1 圖東翼輪廓對齊 Phase 1 幾何」。
- `tra-b2-map`：控制點錨定 B2 slab 對角（臺鐵站體與 B1 同軸），basis 同理。
- 各自儲存後 `npm run validate` 無 warning。

- [ ] **Step 2: B1 重描清單（維持「東側局部」範圍——西半站體仍不建）**

| 對象 | 動作 | 依據與要求 |
|---|---|---|
| slab.outline（8 點） | 依圖重描東翼實形 | conf 3 |
| 既有 3 areas | 東翼通廊/非付費帶/付費區局部重描；付費區邊界依圖 | conf 3，含糊 2＋note |
| 既有 2 gates | 東剪票口實際位置/長度重描；note 記官方名稱（依圖判讀，如「東剪票口」） | conf 3 |
| 既有 4 units（柱） | 拖到圖示柱位 | conf 3 |
| 新增柱列 `u-tc-col-*` | 依圖補東翼範圍內柱網（kind `column`、height 依樓高 5、尺寸依圖約 1–2m 方柱），數量以圖示為準 | conf 3；僅建模範圍內 |
| nav `n-tc-*`（6 個） | 依圖修位；**三個 connector 錨點 id 不變** | — |

- [ ] **Step 3: B2 重描清單（維持垂直脈絡用途——無 nav、無軌道）**

| 對象 | 動作 | 依據與要求 |
|---|---|---|
| slab.outline | 依 tra-b2-map 重描站體實形 | conf 3 |
| 4 條月台帶 areas | 依圖重描各月台位置與寬度；note 標明高鐵月台範圍（system 仍概括為 tra） | conf 3 |

- [ ] **Step 4: connectors 錨點一致性檢查**

B1 節點移位後，tracer 切 B3/B1 比對 `c-esc-rctc-1/2` 與 `c-elv-rctc-1` 兩端位置在圖上是否上下合理（長電扶梯沿站體東緣）；必要時微調 B1/B3 端 node 位置（id 不變）、更新 connector note。

- [ ] **Step 5: 全站回歸**

Run: `npm run validate` — Expected: 0 errors 0 warnings。
Run: `npm test` — Expected: 全 PASS。
Run: `npm run format:data -- --check` — Expected: exit 0。
Run: `npm run typecheck` — Expected: exit 0。
Viewer 目視：四層疊層整體檢視（樓層開關逐層看）、demo 一般路徑（電扶梯下行 B4→B3？不對——B4 月台在最下層，路徑是 B4 往上到 B3；確認文字步驟方向詞正確）、無障礙路徑走兩部電梯鏈、B1 柱列與東翼形狀合理、B2 月台帶與上層對位。
最後 grep 檢查：`data/` 內不應再有可重描而未標 `status` 的元素——四層 slab/areas/units/gates 均應含 `"status": "traced"`（B2 亦然）。

- [ ] **Step 6: 更新兩份 floor-notes 並 Commit**

兩份 floor-note 全檔改寫（結構同 Task 7 Step 4；B1 記柱網間距判讀依據與西半未建、B2 記高鐵月台概括與無軌道簡化）。

```bash
git add -A
git commit -m "data: B1/B2 臺鐵樓層描圖精修＋柱列，四層 traced 收斂

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: GLB 離線匯出（材質 Standard 化 + export 工具 + Khronos 驗證）

**Files:**
- Create: `tools/export-glb.ts`, `tools/validate-glb.mjs`
- Modify: `src/builder.ts`（`mat()` 改 MeshStandardMaterial）
- Modify: `src/ui.ts`（材質型別 cast 跟著改）
- Modify: `package.json`（devDeps + scripts）
- Modify: `.gitignore`（`public/models/`）

**Interfaces:**
- Consumes: 既有純函式 `buildStationGroup`（builder 不碰 DOM，node 可跑）、`assembleModel`、`loadRepoDocs`。
- Produces: `npm run export:glb` → `public/models/station.glb`（binary GLB：root 節點 `station`、樓層 group `name = floorId`、`userData` 經 glTF `extras` 保留）；`npm run validate:glb` → Khronos gltf-validator 0 errors 才 exit 0。Task 11 viewer 載入與 parity 測試依賴。
- 材質改 Standard 的原因：MeshLambertMaterial 無法對應 glTF PBR，exporter 會警告且轉換有損；MeshStandardMaterial(roughness 1, metalness 0) 視覺近似且是 glTF 原生模型——**雙軌一致性的關鍵**。

- [ ] **Step 1: builder.ts 材質改 Standard**

`mat()` 整段替換：

```ts
function mat(color: string, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 1, metalness: 0,
    transparent: opacity < 1, opacity, side: THREE.DoubleSide,
  });
}
```

`src/ui.ts` 內 `const m = mesh.material as THREE.MeshLambertMaterial | undefined;` 改為：

```ts
const m = mesh.material as THREE.MeshStandardMaterial | undefined;
```

Run: `npm test` — Expected: 全 PASS。
Viewer 目視：亮度略有差異屬預期；若整體過暗，把 `main.ts` 的 `HemisphereLight` 強度 1.1 微調至 1.3 內（憑目視判斷，可不調）。

- [ ] **Step 2: 安裝 devDeps**

Run: `npm install -D vite-node gltf-validator`
Expected: 安裝成功（vite-node 版本與 vitest 3 同系列；gltf-validator 為 2.0.0-dev.x 系列屬正常）。

- [ ] **Step 3: 實作 tools/export-glb.ts**

```ts
// 離線匯出：data/*.json → public/models/station.glb（以 vite-node 在 node 執行）
// 用法：npm run export:glb [-- rootDir]
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { loadRepoDocs } from './validate.mjs';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';

const root = process.argv[2] ?? '.';
const docs = loadRepoDocs(root);
const floorDocsByFile: Record<string, unknown> = {};
for (const f of docs.station.floors ?? []) floorDocsByFile[f.file] = docs.floors.get(f.id);
const model = assembleModel(docs.station, floorDocsByFile, docs.connectors);
const group = buildStationGroup(model);

const exporter = new GLTFExporter();
const glb = (await exporter.parseAsync(group, { binary: true })) as ArrayBuffer;
const out = path.join(root, 'public', 'models', 'station.glb');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(glb));
console.log(`已匯出 ${out}（${(glb.byteLength / 1024).toFixed(0)} KB）`);
```

備註（stop-loss 規則適用）：無貼圖場景下 GLTFExporter 在 node 不需 DOM；若仍遇 `Blob`/`FileReader` 未定義錯誤，在檔頭加：

```ts
import { Blob } from 'node:buffer';
(globalThis as { Blob?: typeof Blob }).Blob ??= Blob;
```

- [ ] **Step 4: 實作 tools/validate-glb.mjs**

```js
// Khronos glTF-Validator 檢查匯出檔（0 errors 為通過）
// 用法：node tools/validate-glb.mjs [glbPath]
import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';

const file = process.argv[2] ?? 'public/models/station.glb';
const report = await validator.validateBytes(new Uint8Array(readFileSync(file)));
const { numErrors, numWarnings, numInfos } = report.issues;
for (const m of report.issues.messages) {
  const level = ['ERROR', 'WARN', 'INFO', 'HINT'][m.severity];
  console.log(`${level} ${m.pointer ?? ''} ${m.message}`);
}
console.log(`glTF validation: ${numErrors} errors, ${numWarnings} warnings, ${numInfos} infos（${file}）`);
process.exit(numErrors ? 1 : 0);
```

- [ ] **Step 5: scripts 與 .gitignore**

`package.json` scripts 加：

```json
"export:glb": "vite-node tools/export-glb.ts",
"validate:glb": "node tools/validate-glb.mjs"
```

`.gitignore` 加一行：

```
public/models/
```

- [ ] **Step 6: 執行與驗證**

Run: `npm run export:glb`
Expected: `已匯出 public\models\station.glb（NNN KB）`（合理量級：數百 KB～數 MB）。

Run: `npm run validate:glb`
Expected: `0 errors`，exit 0（warnings/infos 印出但容忍——記下內容供 Task 12 判讀）。

Run: `npm run typecheck`、`npm test` — Expected: 通過。
Run: `git status` — Expected: `public/models/` 未出現在未追蹤清單（gitignore 生效）。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: GLB 離線匯出工具與 Khronos 驗證（材質 Standard 化）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: viewer GLB 軌（?geom=glb）+ round-trip parity 測試

**Files:**
- Modify: `src/main.ts`（整檔替換為下列內容）
- Modify: `index.html`（panel 加 `#geom-mode`）
- Test: `tests/glb-roundtrip.test.ts`

**Interfaces:**
- Consumes: Task 10 的 `station.glb` 與 Standard 材質。
- Produces: viewer 預設 runtime extrude；`?geom=glb` 改載 `models/station.glb`。`ui.ts` 零改動——GLB 保留 group `name`（樓層開關）與 `userData.kind`（透明度）的雙軌契約由 parity 測試守住。缺檔時 overlay 提示先跑 `npm run export:glb`。

- [ ] **Step 1: 寫失敗測試**

`tests/glb-roundtrip.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';

const floorDocs = {
  'floors/tra-concourse-b1.json': b1,
  'floors/tra-platform-b2.json': b2,
  'floors/mrt-r-concourse-b3.json': b3,
  'floors/mrt-r-platform-b4.json': b4,
};

function parseGlb(buf: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
}

function meshCount(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((x) => { if ((x as THREE.Mesh).isMesh) n++; });
  return n;
}

describe('GLB round-trip parity（雙軌契約）', () => {
  let built: THREE.Group;
  let loaded: THREE.Object3D;

  beforeAll(async () => {
    const model = assembleModel(stationDoc, floorDocs, connectorsDoc);
    built = buildStationGroup(model);
    const glb = (await new GLTFExporter().parseAsync(built, { binary: true })) as ArrayBuffer;
    const gltf = await parseGlb(glb);
    loaded = gltf.scene.getObjectByName('station')!;
  });

  it('station 節點存在且子節點名稱（樓層/connectors）一致', () => {
    expect(loaded).toBeTruthy();
    const names = (g: THREE.Object3D) => g.children.map((c) => c.name).sort();
    expect(names(loaded)).toEqual(names(built));
  });

  it('各子 group 的 mesh 數量一致', () => {
    for (const child of built.children) {
      const twin = loaded.children.find((c) => c.name === child.name)!;
      expect(twin, child.name).toBeTruthy();
      expect(meshCount(twin), child.name).toBe(meshCount(child));
    }
  });

  it('各樓層 bounding box 一致（誤差 < 1 cm）', () => {
    for (const child of built.children) {
      const twin = loaded.children.find((c) => c.name === child.name)!;
      const a = new THREE.Box3().setFromObject(child);
      const b = new THREE.Box3().setFromObject(twin);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(a.min[k] - b.min[k]), `${child.name} min.${k}`).toBeLessThan(0.01);
        expect(Math.abs(a.max[k] - b.max[k]), `${child.name} max.${k}`).toBeLessThan(0.01);
      }
    }
  });

  it('userData 經 extras 保留（floorId 與 slab/shell kind——ui.ts 的契約）', () => {
    const floor = loaded.children.find((c) => c.name === 'mrt-r-platform-b4')!;
    expect(floor.userData.floorId).toBe('mrt-r-platform-b4');
    let slab = 0;
    let shell = 0;
    floor.traverse((o) => {
      if (o.userData.kind === 'slab') slab++;
      if (o.userData.kind === 'shell') shell++;
    });
    expect(slab).toBe(1);
    expect(shell).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run tests/glb-roundtrip.test.ts`
Expected: 先跑一次確認測試本身可執行。若在 node 環境因缺瀏覽器全域（如 `self`）而失敗，在測試檔 import 區之後加 `(globalThis as { self?: unknown }).self ??= globalThis;` 再試；同錯兩修不過 → BLOCKED 回報。全綠後繼續。

- [ ] **Step 2: src/main.ts 整檔替換（加入 GLB 軌）**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup } from './builder';
import { buildGraph, findPath, routeSteps } from './nav';
import { buildRouteObject } from './path';
import { setupUI } from './ui';
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

async function boot(): Promise<void> {
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14171c');
  scene.add(new THREE.HemisphereLight('#cfd8e3', '#2a2f38', 1.1));
  const dir = new THREE.DirectionalLight('#ffffff', 0.9);
  dir.position.set(150, 200, 120);
  scene.add(dir);
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

  const modeDiv = document.querySelector<HTMLDivElement>('#geom-mode')!;
  modeDiv.innerHTML = geomMode === 'glb'
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

  const graph = buildGraph(model);
  let routeObj: THREE.Object3D | null = null;
  const clearRoute = () => { if (routeObj) { scene.remove(routeObj); routeObj = null; } };

  const ui = setupUI({
    model, stationGroup,
    onClear: clearRoute,
    onRoute: (accessibleOnly) => {
      clearRoute();
      const demo = model.station.demo!;
      const path = findPath(graph, demo.start, demo.end, { accessibleOnly });
      if (!path) { ui.setSteps(['找不到路徑']); return; }
      routeObj = buildRouteObject(graph, path);
      scene.add(routeObj);
      ui.setSteps(routeSteps(model, graph, path));
    },
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

boot().catch((e) => {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
});
```

- [ ] **Step 3: index.html 加雙軌標示**

`<div id="floors"></div>` 的上一行（`<h1>` 之後）插入：

```html
    <div id="geom-mode"></div>
```

- [ ] **Step 4: 全套驗證與雙軌目視比對**

Run: `npm test`、`npm run typecheck`、`npm run build` — Expected: 全過。

`npm run dev`：

1. `http://localhost:5173/` → 顯示「幾何：runtime」，一切如舊。
2. 點「切至 GLB」→ 顯示「幾何：GLB」，四層外觀與 runtime 視覺一致（並排開兩個分頁比對）；樓層開關、透明度 slider、demo 一般/無障礙路徑、文字步驟全部正常（路徑計算走 nav graph，與幾何軌無關）。
3. 刪掉 `public/models/station.glb` 再開 `?geom=glb` → overlay 顯示「請先執行 npm run export:glb」；重新 `npm run export:glb` 恢復。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: viewer GLB 載入軌（?geom=glb）與 round-trip parity 測試

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: 收尾——文件、外部開檔 QA、全套驗證

**Files:**
- Create: `docs/tracer.md`
- Modify: `docs/data-conventions.md`（追加 Phase 2 慣例）
- Modify: `README.md`（整檔替換）
- Modify: `index.html`（title/h1 去掉「Phase 1」）

**Interfaces:**
- Consumes: Task 1–11 全部成果。
- Produces: Phase 2 完成定義（本 task 的 QA 清單全綠）。

- [ ] **Step 1: 撰寫 docs/tracer.md**

```markdown
# 描圖工具（tracer）使用說明

dev-only 工具：`npm run dev` 後開 `http://localhost:5173/tracer.html`。
存檔走 dev server 的 `POST /__tracer/save`——整批驗證（schema/參照/幾何/語意）通過才寫檔，
寫入即 canonical 格式；viewer 同時熱重載，描完立刻看 3D。

## 界面

左欄：樓層/底圖選擇、底圖透明度、圖層開關、工具切換、描繪表單、儲存/復原。
畫布：左鍵＝工具動作；空白處拖曳或中鍵＝平移；滾輪＝縮放（游標為中心）；
左下比例尺與原點軸線；zoom 夠大時顯示元素 id 標籤。

## 校準（每張底圖一次）

1. 選底圖 → 「校準底圖」工具。
2. 依面板指示點四下：底圖點 A → A 的 local 位置 → 底圖點 B → B 的 local 位置。
   local 點磁吸既有頂點（建議錨到既有幾何的對角兩點，基線越長越穩）；Enter 可改輸入座標。
3. 預覽對位滿意後「儲存校準」→ 寫入 refs/sources.json（control_points + px_per_m + basis）。

校準的意義：把底圖錨進既有模型座標框架（141m 月台基準、N20°E 軸向）；先定框架、再修內容。

## 描圖流程（每樓層）

1. 校準底圖 → 圖層透明度 50–80% 對照。
2. 重描既有元素：選取工具選元素 → 描繪工具「替換選取元素幾何」重畫
   （provenance 自動蓋 status=traced、source=當前底圖、confidence 取表單值）。
3. 新元素：描繪工具選目標類別，填 kind/id 描述段/confidence 後描繪。
4. nav node：nav 工具點擊新增（自動序號與 area）、拖移；edge 手動編修 JSON 後跑 npm run format:data。
5. Ctrl+S 儲存 → viewer 熱重載目視 → 疑點記入 docs/floor-notes/。

## 快捷鍵

| 鍵 | 作用 |
|---|---|
| Ctrl+S / Ctrl+Z | 儲存 / 復原（存檔後頁面會隨資料熱重載刷新，undo 歷史清空——已存內容以 git 為回復手段） |
| Enter / 雙擊 | 完成描繪（poi 1 點、gate 2 點自動完成） |
| Esc / Backspace | 取消描繪、清選取 / 退一點 |
| Shift（描繪中） | 與上一點正交 |
| Alt+點 | 刪頂點（選取工具）/ 刪 nav node（nav 工具，被 edge 引用時拒絕） |

## 限制（設計取捨）

- 元素級刪除、nav edge 編輯不在 UI 內——直接改 JSON（避免懸空引用）；工具架構已預留擴充點。
- 命中順序＝圖層順序（上層優先）；要選下層元素先關上層圖層。
- build 出的 tracer.html 頁面可看不可存（save API 僅 dev server 有）。
```

- [ ] **Step 2: docs/data-conventions.md 追加段落（檔尾）**

```markdown
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
```

- [ ] **Step 3: README.md 整檔替換**

```markdown
# 台北車站室內 3D 導航

樓層 JSON 為唯一資料真相的室內 3D 導航實驗。
範圍：淡水信義線月台(B4) → R 線大廳(B3) → 臺鐵轉乘閘門（demo 終點），
含 B1 臺鐵穿堂局部、B2 月台層脈絡與無障礙路徑模式。
Phase 2 起幾何以描圖工具對校準官方站圖重描（status=traced），並支援 GLB 雙軌輸出。

## 指令

- `npm run dev`——viewer（`/`）與描圖工具（`/tracer.html`），資料熱重載
- `npm run validate`——資料驗證（schema/參照/幾何/語意/校準一致性）
- `npm run format:data`——資料檔 canonical 排版（`-- --check` 為檢查模式）
- `npm run export:glb`——離線匯出 `public/models/station.glb`；`npm run validate:glb`——Khronos 驗證
- `npm test`——單元/整合/GLB parity 測試；`npm run typecheck`——TS 檢查

## 目錄

- `data/`——樓層 JSON（唯一真相）：station 索引、floors/ 每樓一檔、connectors 垂直設施
- `schemas/`——JSON Schema；`tools/`——validate / format-data / save-handler / export-glb
- `refs/`——參考圖與來源清單（含描圖校準）；`docs/floor-notes/`——各層判讀筆記
- `src/`——viewer（three.js，`?geom=glb` 切換 GLB 軌）；`src/tracer/`——描圖工具
- 慣例：`docs/data-conventions.md`；描圖工具說明：`docs/tracer.md`
- 設計 spec：`docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md`
- 實作計畫：`docs/superpowers/plans/`（Phase 1、Phase 2）

## 資料信心

幾何為公開站圖描繪（每元素標 source/confidence/status），非測量資料；高程全部估計。
已知疑點見 `docs/floor-notes/`。
```

- [ ] **Step 4: index.html 標題去版號**

`<title>台北車站室內 3D 導航 — Phase 1</title>` → `<title>台北車站室內 3D 導航</title>`
`<h1>台北車站 Phase 1</h1>` → `<h1>台北車站室內 3D 導航</h1>`

- [ ] **Step 5: 外部開檔 QA（GLB 可攜驗收）**

1. Run: `npm run export:glb`，然後 `npm run validate:glb` — Expected: 0 errors。
2. 人工開檔（使用者或 controller 執行其一）：
   - 瀏覽器開 https://gltf-viewer.donmccurdy.com/ 拖入 `public/models/station.glb`，或
   - Blender：File → Import → glTF 2.0 選入。
   檢查：四個樓層節點以 floorId 命名、半透明樓板/外殼正常、無破面或極端變形、connectors 量體在。
   結果記入 commit 訊息或 floor-notes（有問題開回 Task 10/11 修）。

- [ ] **Step 6: 最終 QA 清單（全綠才算 Phase 2 完成）**

```
[ ] npm run typecheck        exit 0
[ ] npm test                 全 PASS（含 tracer 三套、save、format、glb-roundtrip、既有整合）
[ ] npm run validate         0 errors 0 warnings
[ ] npm run format:data -- --check   exit 0
[ ] npm run export:glb && npm run validate:glb   0 errors
[ ] npm run build            成功；dist/ 含 index.html 與 tracer.html
[ ] dev：viewer 兩軌目視一致；樓層開關/透明度/demo 兩模式正常
[ ] dev：tracer 四層皆有校準底圖、可描可存；四層 slab/areas/units/gates 全 status=traced
[ ] 外部開檔（Step 5）通過
[ ] git status 乾淨；floor-notes 與 README 反映現況
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: Phase 2 收尾——tracer 說明、conventions 增補、README 與最終 QA

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## 執行備註

- **實作者交辦**：沿用 Phase 1 codex 工作流——每 task 抽出成 `.superpowers/sdd/` brief（gitignored），`codex exec -m gpt-5.6-sol -c model_reasoning_effort=high -s workspace-write`；機械抄錄類（Task 12 文件）可用 luna+medium。prompt 需註明 PowerShell 環境（npm.cmd/npx.cmd、無 `&&`）與非互動停損（BLOCKED）。
- **審查**：controller 逐 task 嚴審——diff 逐字對 brief、獨立重跑測試、瀏覽器實測（tracer 任務必開瀏覽器操作驗證）。
- **資料任務（7–9）的特殊性**：座標由描圖產出，brief 給的是元素清單、規則與驗收條件而非種子座標；描圖操作由 controller 或使用者在 tracer 完成亦可，codex 負責 JSON 手改部分（edges/connectors）與驗證流程。此分工執行時再定。
- **風險與備援**：
  - GLTFExporter/GLTFLoader 在 node 的環境相容性——Task 10 Step 3 與 Task 11 Step 1 已附 shim 備援；同錯兩修不過即 BLOCKED。
  - tracer 存檔觸發整頁刷新為預期行為（sessionStorage 接回視角）；undo 歷史不跨存檔。
  - 校準品質決定精修上限：控制點取對角長基線；validator 的 2% 一致性與 traced-需-校準警告會兜底。





