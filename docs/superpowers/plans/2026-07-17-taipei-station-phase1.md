# 台北車站室內 3D 導航 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立四層樓層 JSON 資料模型（唯一真相）+ three.js viewer，demo「R 線月台(B4) → R 線大廳(B3) → 臺鐵轉乘閘門」路徑（含無障礙模式）。

**Architecture:** 資料層（`data/` 每樓一檔 + station 索引 + connectors）由 JSON Schema + validator 把關；viewer（Vite + TS + three.js）以 Vite JSON import 載入、執行期 extrude 成 3D；nav graph 由各層 nav + connectors 合成有向圖跑 A*。程式先行（以 fixture 測試），資料後行（viewer 熱重載目視）。

**Tech Stack:** TypeScript(strict) + Vite + three.js + Ajv(2020-12) + Vitest。無 UI framework。runtime deps 僅 `three` 與 `ajv`。

**Spec:** `docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md`（以下簡稱 spec，衝突時以 spec 為準）

## Global Constraints

- 座標：站內 local 公尺，`|x|,|y| < 500`；polygon 開環（不重複首點）；`outline`/`polygon` 逆時針、`holes` 順時針。
- 所有幾何元素必填 `source`（存在於 `refs/sources.json`）與 `confidence`(1–5)；選填 `status`(`estimated`|`traced`|`verified`，預設 estimated)、`note`。
- 樓層檔名 = `floors/{語意名}-{複合體樓層}.json`，樓層 `id` 與主檔名一致；floor `short` 為 2 小寫字母。
- 元素 ID：`{類別字母}-{short}-{描述或序號}`；nav node `n-{short}-{序號}`；connector `c-{esc|stair|elv}-{低樓short}{高樓short}-{序號}`。validator 強制前綴與所屬樓層一致、全域唯一。
- `gates[]`/`connectors[]` 必填 `accessible: boolean`。gate `connects` 固定 `[付費側, 非付費側]`；`direction: in`=僅進（非付費→付費）、`out`=僅出、`both`=雙向。
- `system` 欄位為字串，validator 檢查 ∈ station.json `systems` 鍵 ∪ `{"shared"}`（schema 不寫死 enum，fixture 與未來擴充系統均適用——此為 spec 字彙表的一般化）。
- 樓層高程：tc −8(h5)、tp −14(h4.5)、rc −21(h4.5)、rp −28(h4.5)，全部 `estimated: true`。
- 座標框架：+X 沿臺鐵站體長軸約東向、+Y 約北向、原點站體中心；three.js 對映 `toWorld([x,y], elev) = (x, elev, −y)`（Y-up）。
- R 線站體斜向：長軸方位約 N20°E，方向向量 `u=(0.342, 0.940)`、法向 `p=(0.940, −0.342)`（官方 B4 資訊圖判讀）。
- 文件、註解、UI 文案繁體中文，技術詞英文。
- 每個 task 結尾 commit（使用者 2026-07-17 已授權分階段 commit），訊息結尾加 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`。
- 任何資料變更後必跑 `npm run validate`。幾何為示意等級，疑點寫入 `docs/floor-notes/`，不假裝實測。

---

### Task 1: 專案 scaffold（Vite + TS + Vitest 可跑）

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `tests/smoke.test.ts`, `README.md`

**Interfaces:**
- Produces: `npm run dev`（Vite dev server）、`npm test`（Vitest）、`npm run typecheck`、`npm run validate`（Task 2 實作，先留 script）。後續所有 task 依賴這些 script。

- [ ] **Step 1: 建立 package.json**

```json
{
  "name": "taipei-station-3d-2",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "validate": "node tools/validate.mjs"
  },
  "dependencies": {
    "ajv": "^8.17.0",
    "three": "^0.180.0"
  },
  "devDependencies": {
    "@types/three": "^0.180.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: 建立 vite.config.ts 與 tsconfig.json**

`vite.config.ts`：

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: { environment: 'node' },
});
```

`tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src", "tests", "tools"]
}
```

- [ ] **Step 3: 建立 index.html（含 UI 骨架與深色樣式）**

```html
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>台北車站室內 3D 導航 — Phase 1</title>
  <style>
    html, body { margin: 0; height: 100%; background: #14171c; color: #e8e8e8;
      font-family: "Noto Sans TC", system-ui, sans-serif; }
    #app { position: fixed; inset: 0; }
    #panel { position: fixed; top: 12px; right: 12px; width: 260px; background: #1e232bcc;
      border: 1px solid #3a4250; border-radius: 8px; padding: 12px; font-size: 14px; z-index: 10; }
    #panel h1 { font-size: 15px; margin: 0 0 8px; }
    #panel label { display: block; margin: 4px 0; cursor: pointer; }
    #panel button { margin: 6px 6px 0 0; padding: 5px 10px; background: #2b5ea7; color: #fff;
      border: 0; border-radius: 5px; cursor: pointer; }
    #panel button:disabled { background: #444; cursor: not-allowed; }
    #steps { margin: 8px 0 0; padding-left: 20px; max-height: 40vh; overflow-y: auto; }
    #overlay { position: fixed; inset: 0; background: #000c; color: #ff8080; padding: 24px;
      white-space: pre-wrap; font-family: monospace; display: none; z-index: 99; overflow: auto; }
  </style>
</head>
<body>
  <div id="app"></div>
  <div id="panel">
    <h1>台北車站 Phase 1</h1>
    <div id="floors"></div>
    <label>樓層透明度 <input id="opacity" type="range" min="10" max="100" value="60" /></label>
    <button id="btn-route">一般路徑</button>
    <button id="btn-route-acc">無障礙路徑</button>
    <button id="btn-clear">清除</button>
    <ol id="steps"></ol>
  </div>
  <div id="overlay"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 4: 建立 smoke test 並安裝依賴**

`tests/smoke.test.ts`：

```ts
import { describe, it, expect } from 'vitest';

describe('scaffold', () => {
  it('vitest 可執行', () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run: `npm install`
Expected: 安裝成功，無 error（warning 可忽略）。

- [ ] **Step 5: 驗證 test 與 typecheck 通過**

Run: `npm test`
Expected: `1 passed`。

Run: `npm run typecheck`
Expected: exit 0，無輸出。

- [ ] **Step 6: 建立最小 README.md**

```markdown
# 台北車站室內 3D 導航（Phase 1）

樓層 JSON 為唯一資料真相的室內 3D 導航實驗。範圍：淡水信義線月台(B4) → R 線大廳(B3) → 臺鐵轉乘閘門，含無障礙路徑。

- 設計 spec：`docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md`
- `npm run dev` 啟動 viewer；`npm run validate` 驗證資料；`npm test` 跑測試。
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: Vite + TypeScript + Vitest scaffold

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: JSON Schemas + validator + mini fixture

**Files:**
- Create: `schemas/station.schema.json`, `schemas/floor.schema.json`, `schemas/connectors.schema.json`, `schemas/sources.schema.json`
- Create: `tools/validate.mjs`
- Create: `tests/fixtures/mini/data/station.json`, `tests/fixtures/mini/data/floors/hall-b1.json`, `tests/fixtures/mini/data/floors/plat-b2.json`, `tests/fixtures/mini/data/connectors.json`, `tests/fixtures/mini/refs/sources.json`
- Test: `tests/validate.test.ts`

**Interfaces:**
- Produces: `tools/validate.mjs` exports `loadRepoDocs(rootDir: string)` → `{ station, floors: Map<string, object>, connectors, sources }`；`validateDocs(docs)` → `{ errors: string[], warnings: string[] }`；CLI `node tools/validate.mjs [rootDir]`（預設 `.`，errors 非空時 exit 1）。
- Produces: mini fixture（兩層、電扶梯+電梯、單向閘門+無障礙閘門）供 Task 3/4/5 測試共用。fixture 樓層：`hall-b1`(short `ha`, elev −4) 與 `plat-b2`(short `pl`, elev −9)；系統 `test`；demo 起訖 `n-pl-001` → `n-ha-002`。

- [ ] **Step 1: 寫四份 JSON Schema（draft 2020-12）**

`schemas/station.schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "station.schema.json",
  "type": "object",
  "required": ["schema", "id", "name", "frame", "systems", "floors"],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": "station@1" },
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "name": { "$ref": "#/$defs/lname" },
    "frame": {
      "type": "object",
      "required": ["units", "origin_note", "axis_note"],
      "additionalProperties": false,
      "properties": {
        "units": { "const": "m" },
        "origin_note": { "type": "string" },
        "axis_note": { "type": "string" },
        "bearing_deg": { "type": "number" },
        "bearing_status": { "enum": ["estimated", "surveyed"] }
      }
    },
    "systems": {
      "type": "object",
      "minProperties": 1,
      "additionalProperties": {
        "type": "object",
        "required": ["name", "color"],
        "additionalProperties": false,
        "properties": {
          "name": { "$ref": "#/$defs/lname" },
          "color": { "type": "string", "pattern": "^#[0-9a-fA-F]{6}$" }
        }
      }
    },
    "floors": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "short", "file", "name", "labels", "elevation", "height", "estimated"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "short": { "type": "string", "pattern": "^[a-z]{2}$" },
          "file": { "type": "string", "pattern": "^floors/[a-z0-9-]+\\.json$" },
          "name": { "$ref": "#/$defs/lname" },
          "labels": { "type": "object", "additionalProperties": { "type": "string" } },
          "elevation": { "type": "number" },
          "height": { "type": "number", "exclusiveMinimum": 0 },
          "estimated": { "type": "boolean" }
        }
      }
    },
    "demo": {
      "type": "object",
      "required": ["start", "end"],
      "additionalProperties": false,
      "properties": { "start": { "type": "string" }, "end": { "type": "string" } }
    }
  },
  "$defs": {
    "lname": {
      "type": "object",
      "required": ["zh"],
      "additionalProperties": false,
      "properties": { "zh": { "type": "string", "minLength": 1 }, "en": { "type": "string" } }
    }
  }
}
```

`schemas/floor.schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "floor.schema.json",
  "type": "object",
  "required": ["schema", "id", "slab"],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": "floor@1" },
    "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
    "slab": {
      "type": "object",
      "required": ["outline", "source", "confidence"],
      "unevaluatedProperties": false,
      "allOf": [{ "$ref": "#/$defs/prov" }],
      "properties": {
        "outline": { "$ref": "#/$defs/ring" },
        "holes": { "type": "array", "items": { "$ref": "#/$defs/ring" } }
      }
    },
    "areas": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "system", "polygon", "source", "confidence"],
        "unevaluatedProperties": false,
        "allOf": [{ "$ref": "#/$defs/prov" }],
        "properties": {
          "id": { "$ref": "#/$defs/eid" },
          "kind": { "enum": ["platform", "paid", "unpaid", "corridor", "track", "restricted"] },
          "system": { "type": "string", "minLength": 1 },
          "polygon": { "$ref": "#/$defs/ring" }
        }
      }
    },
    "walls": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "polyline", "height", "source", "confidence"],
        "unevaluatedProperties": false,
        "allOf": [{ "$ref": "#/$defs/prov" }],
        "properties": {
          "id": { "$ref": "#/$defs/eid" },
          "polyline": { "type": "array", "minItems": 2, "items": { "$ref": "#/$defs/vec2" } },
          "height": { "type": "number", "exclusiveMinimum": 0 },
          "width": { "type": "number", "exclusiveMinimum": 0 }
        }
      }
    },
    "units": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "polygon", "height", "source", "confidence"],
        "unevaluatedProperties": false,
        "allOf": [{ "$ref": "#/$defs/prov" }],
        "properties": {
          "id": { "$ref": "#/$defs/eid" },
          "kind": { "enum": ["column", "shop", "room", "machine", "stair-void"] },
          "polygon": { "$ref": "#/$defs/ring" },
          "height": { "type": "number", "exclusiveMinimum": 0 }
        }
      }
    },
    "gates": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "system", "direction", "accessible", "line", "connects", "source", "confidence"],
        "unevaluatedProperties": false,
        "allOf": [{ "$ref": "#/$defs/prov" }],
        "properties": {
          "id": { "$ref": "#/$defs/eid" },
          "kind": { "const": "faregate" },
          "system": { "type": "string", "minLength": 1 },
          "direction": { "enum": ["in", "out", "both"] },
          "accessible": { "type": "boolean" },
          "line": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "$ref": "#/$defs/vec2" } },
          "connects": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "string" } }
        }
      }
    },
    "pois": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "position", "source", "confidence"],
        "unevaluatedProperties": false,
        "allOf": [{ "$ref": "#/$defs/prov" }],
        "properties": {
          "id": { "$ref": "#/$defs/eid" },
          "kind": { "enum": ["tvm", "info", "toilet", "exit", "sign"] },
          "system": { "type": "string" },
          "position": { "$ref": "#/$defs/vec2" },
          "name": { "type": "object", "required": ["zh"], "additionalProperties": false,
            "properties": { "zh": { "type": "string" }, "en": { "type": "string" } } }
        }
      }
    },
    "nav": {
      "type": "object",
      "required": ["nodes", "edges"],
      "additionalProperties": false,
      "properties": {
        "nodes": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "xy"],
            "additionalProperties": false,
            "properties": {
              "id": { "type": "string", "pattern": "^n-[a-z]{2}-[a-z0-9-]+$" },
              "xy": { "$ref": "#/$defs/vec2" },
              "area": { "type": "string" }
            }
          }
        },
        "edges": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["from", "to", "kind"],
            "additionalProperties": false,
            "properties": {
              "from": { "type": "string" },
              "to": { "type": "string" },
              "kind": { "enum": ["walk", "gate", "platform-edge"] },
              "gate": { "type": "string" },
              "bidir": { "type": "boolean" }
            }
          }
        }
      }
    }
  },
  "$defs": {
    "vec2": { "type": "array", "minItems": 2, "maxItems": 2, "items": { "type": "number" } },
    "ring": { "type": "array", "minItems": 3, "items": { "$ref": "#/$defs/vec2" } },
    "eid": { "type": "string", "pattern": "^[a-z]+-[a-z]{2}-[a-z0-9-]+$" },
    "prov": {
      "type": "object",
      "properties": {
        "source": { "type": "string", "minLength": 1 },
        "confidence": { "type": "integer", "minimum": 1, "maximum": 5 },
        "status": { "enum": ["estimated", "traced", "verified"] },
        "note": { "type": "string" }
      },
      "required": ["source", "confidence"]
    }
  }
}
```

`schemas/connectors.schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "connectors.schema.json",
  "type": "object",
  "required": ["schema", "connectors"],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": "connectors@1" },
    "connectors": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "kind", "system", "direction", "accessible", "levels", "source", "confidence"],
        "unevaluatedProperties": false,
        "allOf": [{ "$ref": "#/$defs/prov" }],
        "properties": {
          "id": { "type": "string", "pattern": "^c-(esc|stair|elv)-[a-z]{4}-[0-9]+$" },
          "kind": { "enum": ["stair", "escalator", "elevator"] },
          "system": { "type": "string", "minLength": 1 },
          "direction": { "enum": ["up", "down", "both"] },
          "accessible": { "type": "boolean" },
          "levels": {
            "type": "array",
            "minItems": 2,
            "items": {
              "type": "object",
              "required": ["floor", "node"],
              "additionalProperties": false,
              "properties": { "floor": { "type": "string" }, "node": { "type": "string" } }
            }
          }
        }
      }
    }
  },
  "$defs": {
    "prov": {
      "type": "object",
      "properties": {
        "source": { "type": "string", "minLength": 1 },
        "confidence": { "type": "integer", "minimum": 1, "maximum": 5 },
        "status": { "enum": ["estimated", "traced", "verified"] },
        "note": { "type": "string" }
      },
      "required": ["source", "confidence"]
    }
  }
}
```

`schemas/sources.schema.json`：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "sources.schema.json",
  "type": "object",
  "required": ["schema", "sources"],
  "additionalProperties": false,
  "properties": {
    "schema": { "const": "sources@1" },
    "sources": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "title", "file"],
        "additionalProperties": false,
        "properties": {
          "id": { "type": "string", "pattern": "^[a-z0-9-]+$" },
          "title": { "type": "string", "minLength": 1 },
          "file": { "type": "string", "minLength": 1 },
          "url": { "type": "string" },
          "captured": { "type": "string" },
          "license_note": { "type": "string" },
          "calibration": {
            "type": "object",
            "required": ["px_per_m", "basis", "status"],
            "additionalProperties": false,
            "properties": {
              "px_per_m": { "type": "number", "exclusiveMinimum": 0 },
              "basis": { "type": "string" },
              "status": { "enum": ["estimated", "surveyed"] }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: 建立 mini fixture（合法資料）**

`tests/fixtures/mini/data/station.json`：

```json
{
  "schema": "station@1",
  "id": "mini-station",
  "name": { "zh": "迷你測試站" },
  "frame": { "units": "m", "origin_note": "測試原點", "axis_note": "+X 東 +Y 北" },
  "systems": { "test": { "name": { "zh": "測試系統" }, "color": "#888888" } },
  "floors": [
    { "id": "hall-b1", "short": "ha", "file": "floors/hall-b1.json",
      "name": { "zh": "測試大廳" }, "labels": { "complex": "B1" },
      "elevation": -4, "height": 3, "estimated": true },
    { "id": "plat-b2", "short": "pl", "file": "floors/plat-b2.json",
      "name": { "zh": "測試月台" }, "labels": { "complex": "B2" },
      "elevation": -9, "height": 3, "estimated": true }
  ],
  "demo": { "start": "n-pl-001", "end": "n-ha-002" }
}
```

`tests/fixtures/mini/data/floors/hall-b1.json`：

```json
{
  "schema": "floor@1",
  "id": "hall-b1",
  "slab": { "outline": [[-10, -5], [10, -5], [10, 5], [-10, 5]], "source": "test-src", "confidence": 5 },
  "areas": [
    { "id": "a-ha-paid", "kind": "paid", "system": "test",
      "polygon": [[-10, -5], [0, -5], [0, 5], [-10, 5]], "source": "test-src", "confidence": 5 },
    { "id": "a-ha-unpaid", "kind": "unpaid", "system": "test",
      "polygon": [[0, -5], [10, -5], [10, 5], [0, 5]], "source": "test-src", "confidence": 5 }
  ],
  "gates": [
    { "id": "g-ha-out", "kind": "faregate", "system": "test", "direction": "out", "accessible": false,
      "line": [[0, -1], [0, 1]], "connects": ["a-ha-paid", "a-ha-unpaid"], "source": "test-src", "confidence": 5 },
    { "id": "g-ha-acc", "kind": "faregate", "system": "test", "direction": "both", "accessible": true,
      "line": [[0, 2], [0, 4]], "connects": ["a-ha-paid", "a-ha-unpaid"], "source": "test-src", "confidence": 5 }
  ],
  "nav": {
    "nodes": [
      { "id": "n-ha-001", "xy": [-5, 0], "area": "a-ha-paid" },
      { "id": "n-ha-002", "xy": [2, 0], "area": "a-ha-unpaid" },
      { "id": "n-ha-003", "xy": [-5, 3], "area": "a-ha-paid" },
      { "id": "n-ha-004", "xy": [2, 3], "area": "a-ha-unpaid" }
    ],
    "edges": [
      { "from": "n-ha-001", "to": "n-ha-002", "kind": "gate", "gate": "g-ha-out", "bidir": false },
      { "from": "n-ha-003", "to": "n-ha-004", "kind": "gate", "gate": "g-ha-acc", "bidir": true },
      { "from": "n-ha-001", "to": "n-ha-003", "kind": "walk" },
      { "from": "n-ha-002", "to": "n-ha-004", "kind": "walk" }
    ]
  }
}
```

`tests/fixtures/mini/data/floors/plat-b2.json`：

```json
{
  "schema": "floor@1",
  "id": "plat-b2",
  "slab": { "outline": [[-10, -5], [10, -5], [10, 5], [-10, 5]], "source": "test-src", "confidence": 5 },
  "areas": [
    { "id": "a-pl-platform", "kind": "platform", "system": "test",
      "polygon": [[-10, -5], [10, -5], [10, 5], [-10, 5]], "source": "test-src", "confidence": 5 }
  ],
  "nav": {
    "nodes": [
      { "id": "n-pl-001", "xy": [-5, 0], "area": "a-pl-platform" },
      { "id": "n-pl-002", "xy": [0, 0], "area": "a-pl-platform" }
    ],
    "edges": [{ "from": "n-pl-001", "to": "n-pl-002", "kind": "walk" }]
  }
}
```

`tests/fixtures/mini/data/connectors.json`：

```json
{
  "schema": "connectors@1",
  "connectors": [
    { "id": "c-esc-plha-1", "kind": "escalator", "system": "test", "direction": "up", "accessible": false,
      "levels": [{ "floor": "plat-b2", "node": "n-pl-001" }, { "floor": "hall-b1", "node": "n-ha-001" }],
      "source": "test-src", "confidence": 5 },
    { "id": "c-elv-plha-1", "kind": "elevator", "system": "test", "direction": "both", "accessible": true,
      "levels": [{ "floor": "plat-b2", "node": "n-pl-002" }, { "floor": "hall-b1", "node": "n-ha-003" }],
      "source": "test-src", "confidence": 5 }
  ]
}
```

`tests/fixtures/mini/refs/sources.json`：

```json
{
  "schema": "sources@1",
  "sources": [{ "id": "test-src", "title": "測試來源", "file": "refs/none.png" }]
}
```

（注意 connector id 樓層對 `plha` = 低樓 short `pl` + 高樓 short `ha`，符合 pattern `^c-(esc|stair|elv)-[a-z]{4}-[0-9]+$`。）

- [ ] **Step 3: 寫 validator 失敗測試**

`tests/validate.test.ts`：

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { loadRepoDocs, validateDocs } from '../tools/validate.mjs';

const FIXTURE = 'tests/fixtures/mini';

function freshDocs() {
  return loadRepoDocs(FIXTURE);
}

describe('validateDocs', () => {
  it('合法 fixture 無 errors', () => {
    const { errors } = validateDocs(freshDocs());
    expect(errors).toEqual([]);
  });

  it('schema 違規：station.schema 版本錯誤', () => {
    const docs = freshDocs();
    (docs.station as any).schema = 'station@2';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('station.json'))).toBe(true);
  });

  it('參照：element source 不存在於 sources.json', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).slab.source = 'nope';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('nope'))).toBe(true);
  });

  it('參照：connector 指到不存在的 node', () => {
    const docs = freshDocs();
    (docs.connectors as any).connectors[0].levels[0].node = 'n-pl-999';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('n-pl-999'))).toBe(true);
  });

  it('ID 前綴與樓層 short 不符', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).areas[0].id = 'a-xx-paid';
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('a-xx-paid'))).toBe(true);
  });

  it('幾何：outline 順時針（應為逆時針）', () => {
    const docs = freshDocs();
    (docs.floors.get('plat-b2') as any).slab.outline.reverse();
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('逆時針'))).toBe(true);
  });

  it('幾何：node 落在 slab 外', () => {
    const docs = freshDocs();
    (docs.floors.get('plat-b2') as any).nav.nodes[0].xy = [99, 99];
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('n-pl-001'))).toBe(true);
  });

  it('語意：非 both 閘門的 gate edge 不可 bidir', () => {
    const docs = freshDocs();
    (docs.floors.get('hall-b1') as any).nav.edges[0].bidir = true;
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('g-ha-out'))).toBe(true);
  });

  it('語意：connector levels 高程須遞增', () => {
    const docs = freshDocs();
    (docs.connectors as any).connectors[0].levels.reverse();
    const { errors } = validateDocs(docs);
    expect(errors.some((e) => e.includes('c-esc-plha-1'))).toBe(true);
  });
});
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `npx vitest run tests/validate.test.ts`
Expected: FAIL（`Cannot find module '../tools/validate.mjs'`）。

- [ ] **Step 5: 實作 tools/validate.mjs**

```js
// 樓層 JSON 資料驗證：schema、參照完整性、ID 慣例、幾何 sanity、語意規則。
// 用法：node tools/validate.mjs [rootDir]（rootDir 需含 data/ 與 refs/sources.json）
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';

const Ajv2020 = AjvModule.default ?? AjvModule;
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

function readJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function loadRepoDocs(rootDir) {
  const station = readJson(path.join(rootDir, 'data', 'station.json'));
  const floors = new Map();
  for (const f of station.floors ?? []) {
    floors.set(f.id, readJson(path.join(rootDir, 'data', f.file)));
  }
  const connectors = readJson(path.join(rootDir, 'data', 'connectors.json'));
  const sources = readJson(path.join(rootDir, 'refs', 'sources.json'));
  return { station, floors, connectors, sources };
}

// ---- 幾何工具 ----
function ringArea(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

function pointInRing(pt, ring) {
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function* iterRings(floor) {
  yield ['slab.outline', floor.slab.outline, 'ccw'];
  for (const [hi, h] of (floor.slab.holes ?? []).entries()) yield [`slab.holes[${hi}]`, h, 'cw'];
  for (const a of floor.areas ?? []) yield [`area ${a.id}`, a.polygon, 'ccw'];
  for (const u of floor.units ?? []) yield [`unit ${u.id}`, u.polygon, 'ccw'];
}

export function validateDocs(docs) {
  const errors = [];
  const warnings = [];
  const { station, floors, connectors, sources } = docs;

  // 1. Schema 驗證
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemas = {
    station: ajv.compile(readJson(path.join(SCHEMA_DIR, 'station.schema.json'))),
    floor: ajv.compile(readJson(path.join(SCHEMA_DIR, 'floor.schema.json'))),
    connectors: ajv.compile(readJson(path.join(SCHEMA_DIR, 'connectors.schema.json'))),
    sources: ajv.compile(readJson(path.join(SCHEMA_DIR, 'sources.schema.json'))),
  };
  const schemaCheck = (validate, doc, label) => {
    if (!validate(doc)) {
      for (const e of validate.errors ?? []) errors.push(`[schema] ${label}${e.instancePath} ${e.message}`);
    }
  };
  schemaCheck(schemas.station, station, 'data/station.json');
  for (const [fid, fdoc] of floors) schemaCheck(schemas.floor, fdoc, `data floor ${fid}`);
  schemaCheck(schemas.connectors, connectors, 'data/connectors.json');
  schemaCheck(schemas.sources, sources, 'refs/sources.json');
  if (errors.length) return { errors, warnings }; // schema 壞了就不做後續檢查

  const sourceIds = new Set(sources.sources.map((s) => s.id));
  const systemIds = new Set([...Object.keys(station.systems), 'shared']);
  const floorMeta = new Map(station.floors.map((f) => [f.id, f]));
  const allIds = new Map(); // id -> 所在描述，全域唯一檢查

  const claimId = (id, where) => {
    if (allIds.has(id)) errors.push(`[id] ${id} 重複（${allIds.get(id)} 與 ${where}）`);
    else allIds.set(id, where);
  };

  const checkProv = (obj, where) => {
    if (!sourceIds.has(obj.source)) errors.push(`[ref] ${where} source "${obj.source}" 不存在於 refs/sources.json`);
  };

  // 2–4. 各樓層檢查
  for (const [fid, floor] of floors) {
    const meta = floorMeta.get(fid);
    if (!meta) { errors.push(`[ref] 樓層檔 id "${fid}" 不在 station.json floors`); continue; }
    if (floor.id !== fid) errors.push(`[ref] ${meta.file} 的 id "${floor.id}" 與 station.json 不一致`);
    const short = meta.short;
    const where = meta.file;

    checkProv(floor.slab, `${where} slab`);
    const elements = [
      ...(floor.areas ?? []), ...(floor.walls ?? []), ...(floor.units ?? []),
      ...(floor.gates ?? []), ...(floor.pois ?? []),
    ];
    for (const el of elements) {
      claimId(el.id, where);
      checkProv(el, `${where} ${el.id}`);
      const m = /^[a-z]+-([a-z]{2})-/.exec(el.id);
      if (!m || m[1] !== short) errors.push(`[id] ${where} ${el.id} 前綴應為 -${short}-`);
      if (el.system !== undefined && !systemIds.has(el.system))
        errors.push(`[ref] ${where} ${el.id} system "${el.system}" 不在 station.systems`);
    }

    // 幾何 sanity
    for (const [label, ring, wind] of iterRings(floor)) {
      if (ring.some((p) => p.some((v) => !Number.isFinite(v) || Math.abs(v) >= 500)))
        errors.push(`[geom] ${where} ${label} 座標非有限值或超出 ±500`);
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx === lx && fy === ly) errors.push(`[geom] ${where} ${label} 首尾點重複（應為開環）`);
      const area = ringArea(ring);
      if (wind === 'ccw' && area <= 0) errors.push(`[geom] ${where} ${label} 應為逆時針`);
      if (wind === 'cw' && area >= 0) errors.push(`[geom] ${where} ${label} 應為順時針（hole）`);
    }

    // nav
    const areaById = new Map((floor.areas ?? []).map((a) => [a.id, a]));
    const gateById = new Map((floor.gates ?? []).map((g) => [g.id, g]));
    for (const g of floor.gates ?? []) {
      for (const aid of g.connects) {
        if (!areaById.has(aid)) errors.push(`[ref] ${where} ${g.id} connects "${aid}" 不存在`);
      }
    }
    const nodeById = new Map();
    for (const n of floor.nav?.nodes ?? []) {
      claimId(n.id, where);
      nodeById.set(n.id, n);
      const m = /^n-([a-z]{2})-/.exec(n.id);
      if (!m || m[1] !== short) errors.push(`[id] ${where} ${n.id} 前綴應為 n-${short}-`);
      const inOutline = pointInRing(n.xy, floor.slab.outline);
      const inHole = (floor.slab.holes ?? []).some((h) => pointInRing(n.xy, h));
      if (!inOutline || inHole) errors.push(`[geom] ${where} ${n.id} 不在 slab 範圍內`);
    }
    for (const e of floor.nav?.edges ?? []) {
      if (!nodeById.has(e.from)) errors.push(`[ref] ${where} edge from "${e.from}" 不存在`);
      if (!nodeById.has(e.to)) errors.push(`[ref] ${where} edge to "${e.to}" 不存在`);
      if (e.kind === 'gate') {
        const g = gateById.get(e.gate ?? '');
        if (!g) { errors.push(`[ref] ${where} gate edge 引用不存在的 gate "${e.gate}"`); continue; }
        if (g.direction !== 'both' && e.bidir === true)
          errors.push(`[sem] ${where} ${g.id} 非雙向閘門，gate edge 必須 bidir:false`);
        const fromN = nodeById.get(e.from);
        const toN = nodeById.get(e.to);
        const paidRing = areaById.get(g.connects[0])?.polygon;
        const unpaidRing = areaById.get(g.connects[1])?.polygon;
        if (fromN && toN && paidRing && unpaidRing) {
          const fromPaid = pointInRing(fromN.xy, paidRing);
          const toUnpaid = pointInRing(toN.xy, unpaidRing);
          const fromUnpaid = pointInRing(fromN.xy, unpaidRing);
          const toPaid = pointInRing(toN.xy, paidRing);
          const outDir = fromPaid && toUnpaid;
          const inDir = fromUnpaid && toPaid;
          if (!outDir && !inDir)
            errors.push(`[sem] ${where} ${g.id} 的 gate edge 端點未分別落在 connects 兩側 area`);
          else if (g.direction === 'out' && !outDir)
            errors.push(`[sem] ${where} ${g.id} direction=out 但 edge 方向為進站`);
          else if (g.direction === 'in' && !inDir)
            errors.push(`[sem] ${where} ${g.id} direction=in 但 edge 方向為出站`);
        }
      }
    }
  }

  // connectors
  const nodeFloor = new Map(); // node id -> floor id
  for (const [fid, floor] of floors) for (const n of floor.nav?.nodes ?? []) nodeFloor.set(n.id, fid);
  for (const c of connectors.connectors) {
    claimId(c.id, 'data/connectors.json');
    checkProv(c, `connector ${c.id}`);
    if (!systemIds.has(c.system)) errors.push(`[ref] ${c.id} system "${c.system}" 不在 station.systems`);
    let prevElev = -Infinity;
    for (const lv of c.levels) {
      const meta = floorMeta.get(lv.floor);
      if (!meta) { errors.push(`[ref] ${c.id} floor "${lv.floor}" 不存在`); continue; }
      if (nodeFloor.get(lv.node) !== lv.floor)
        errors.push(`[ref] ${c.id} node "${lv.node}" 不存在於樓層 ${lv.floor}`);
      if (meta.elevation <= prevElev) errors.push(`[sem] ${c.id} levels 高程須嚴格遞增`);
      prevElev = meta.elevation;
    }
    if (c.kind === 'elevator' && !c.accessible) warnings.push(`[sem] ${c.id} elevator 通常 accessible:true`);
    if (c.kind !== 'elevator' && c.accessible) warnings.push(`[sem] ${c.id} ${c.kind} 通常 accessible:false`);
  }

  // demo 節點存在性
  if (station.demo) {
    for (const key of ['start', 'end']) {
      if (!nodeFloor.has(station.demo[key]))
        errors.push(`[ref] station.demo.${key} "${station.demo[key]}" 不存在`);
    }
  }

  return { errors, warnings };
}

// ---- CLI ----
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.argv[2] ?? '.';
  let docs;
  try {
    docs = loadRepoDocs(root);
  } catch (e) {
    console.error(`讀取資料失敗：${e.message}`);
    process.exit(1);
  }
  const { errors, warnings } = validateDocs(docs);
  for (const w of warnings) console.warn(`WARN  ${w}`);
  for (const e of errors) console.error(`ERROR ${e}`);
  console.log(`validate: ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run tests/validate.test.ts`
Expected: PASS（9 tests）。

Run: `node tools/validate.mjs tests/fixtures/mini`
Expected: `validate: 0 errors, 0 warnings`，exit 0。

- [ ] **Step 7: typecheck 與 commit**

Run: `npm run typecheck` — Expected: exit 0。（`validate.mjs` 為 JS 不受 tsc 檢查；`validate.test.ts` import `.mjs` 需要型別——建立與它同目錄同名的宣告檔 `tools/validate.d.mts`，TS 會自動配對：）

`tools/validate.d.mts`：

```ts
export interface RepoDocs {
  station: any;
  floors: Map<string, any>;
  connectors: any;
  sources: any;
}
export declare function loadRepoDocs(rootDir: string): RepoDocs;
export declare function validateDocs(docs: RepoDocs): { errors: string[]; warnings: string[] };
```

```bash
git add -A
git commit -m "feat: JSON Schemas + 資料 validator + mini fixture（TDD）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: types.ts + loader.ts（ajv 驗證 + StationModel 組裝）

**Files:**
- Create: `src/types.ts`, `src/loader.ts`
- Test: `tests/loader.test.ts`

**Interfaces:**
- Consumes: Task 2 的 schemas 與 mini fixture。
- Produces: `types.ts` 匯出 `Vec2, LocalizedName, Provenance, Slab, Area, Wall, Unit, Gate, Poi, NavNode, NavEdge, FloorDoc, FloorMeta, StationDoc, Connector, ConnectorsDoc, StationModel`；`loader.ts` 匯出 `class LoaderError extends Error { details: string[] }` 與 `assembleModel(stationDoc, floorDocsByFile, connectorsDoc, opts?) : StationModel`（`floorDocsByFile` 以 station.floors[].file 為 key；`opts.validate` 預設 true 跑 ajv）。

- [ ] **Step 1: 寫失敗測試**

`tests/loader.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel, LoaderError } from '../src/loader';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const floorDocs = { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat };

describe('assembleModel', () => {
  it('合法資料組成 StationModel', () => {
    const model = assembleModel(stationDoc, floorDocs, connectorsDoc);
    expect(model.station.id).toBe('mini-station');
    expect(model.floors.size).toBe(2);
    expect(model.floors.get('hall-b1')?.gates?.length).toBe(2);
    expect(model.connectors.length).toBe(2);
  });

  it('schema 違規 throw LoaderError 且 details 指出檔案', () => {
    const bad = structuredClone(stationDoc) as any;
    bad.schema = 'station@9';
    expect(() => assembleModel(bad, floorDocs, connectorsDoc)).toThrowError(LoaderError);
    try {
      assembleModel(bad, floorDocs, connectorsDoc);
    } catch (e) {
      expect((e as LoaderError).details.some((d) => d.includes('station'))).toBe(true);
    }
  });

  it('缺少樓層檔 throw LoaderError', () => {
    expect(() => assembleModel(stationDoc, { 'floors/hall-b1.json': hall }, connectorsDoc))
      .toThrowError(LoaderError);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/loader.test.ts`
Expected: FAIL（`Cannot find module '../src/loader'`）。

- [ ] **Step 3: 實作 src/types.ts**

```ts
export type Vec2 = [number, number];

export interface LocalizedName { zh: string; en?: string }

export interface Provenance {
  source: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  status?: 'estimated' | 'traced' | 'verified';
  note?: string;
}

export interface Slab extends Provenance { outline: Vec2[]; holes?: Vec2[][] }

export type AreaKind = 'platform' | 'paid' | 'unpaid' | 'corridor' | 'track' | 'restricted';
export interface Area extends Provenance { id: string; kind: AreaKind; system: string; polygon: Vec2[] }

export interface Wall extends Provenance { id: string; polyline: Vec2[]; height: number; width?: number }

export type UnitKind = 'column' | 'shop' | 'room' | 'machine' | 'stair-void';
export interface Unit extends Provenance { id: string; kind: UnitKind; polygon: Vec2[]; height: number }

export interface Gate extends Provenance {
  id: string; kind: 'faregate'; system: string;
  direction: 'in' | 'out' | 'both'; accessible: boolean;
  line: [Vec2, Vec2]; connects: [string, string];
}

export type PoiKind = 'tvm' | 'info' | 'toilet' | 'exit' | 'sign';
export interface Poi extends Provenance {
  id: string; kind: PoiKind; system?: string; position: Vec2; name?: LocalizedName;
}

export interface NavNode { id: string; xy: Vec2; area?: string }
export interface NavEdge {
  from: string; to: string; kind: 'walk' | 'gate' | 'platform-edge'; gate?: string; bidir?: boolean;
}

export interface FloorDoc {
  schema: 'floor@1'; id: string; slab: Slab;
  areas?: Area[]; walls?: Wall[]; units?: Unit[]; gates?: Gate[]; pois?: Poi[];
  nav?: { nodes: NavNode[]; edges: NavEdge[] };
}

export interface FloorMeta {
  id: string; short: string; file: string; name: LocalizedName;
  labels: Record<string, string>; elevation: number; height: number; estimated: boolean;
}

export interface StationDoc {
  schema: 'station@1'; id: string; name: LocalizedName;
  frame: { units: 'm'; origin_note: string; axis_note: string; bearing_deg?: number; bearing_status?: string };
  systems: Record<string, { name: LocalizedName; color: string }>;
  floors: FloorMeta[];
  demo?: { start: string; end: string };
}

export interface ConnectorLevel { floor: string; node: string }
export interface Connector extends Provenance {
  id: string; kind: 'stair' | 'escalator' | 'elevator'; system: string;
  direction: 'up' | 'down' | 'both'; accessible: boolean; levels: ConnectorLevel[];
}
export interface ConnectorsDoc { schema: 'connectors@1'; connectors: Connector[] }

export interface StationModel {
  station: StationDoc;
  floors: Map<string, FloorDoc>;
  connectors: Connector[];
}
```

- [ ] **Step 4: 實作 src/loader.ts**

```ts
import AjvModule from 'ajv/dist/2020.js';
import stationSchema from '../schemas/station.schema.json';
import floorSchema from '../schemas/floor.schema.json';
import connectorsSchema from '../schemas/connectors.schema.json';
import type { ConnectorsDoc, FloorDoc, StationDoc, StationModel } from './types';

const Ajv2020 = (AjvModule as any).default ?? AjvModule;

export class LoaderError extends Error {
  constructor(message: string, public details: string[]) {
    super(message);
    this.name = 'LoaderError';
  }
}

export function assembleModel(
  stationDoc: unknown,
  floorDocsByFile: Record<string, unknown>,
  connectorsDoc: unknown,
  opts: { validate?: boolean } = {},
): StationModel {
  const details: string[] = [];
  if (opts.validate !== false) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const check = (schema: object, doc: unknown, label: string) => {
      const validate = ajv.compile(schema);
      if (!validate(doc)) {
        for (const e of validate.errors ?? []) details.push(`${label}${e.instancePath} ${e.message}`);
      }
    };
    check(stationSchema, stationDoc, 'data/station.json');
    for (const [file, doc] of Object.entries(floorDocsByFile)) check(floorSchema, doc, `data/${file}`);
    check(connectorsSchema, connectorsDoc, 'data/connectors.json');
    if (details.length) throw new LoaderError('資料 schema 驗證失敗', details);
  }

  const station = stationDoc as StationDoc;
  const floors = new Map<string, FloorDoc>();
  for (const meta of station.floors) {
    const doc = floorDocsByFile[meta.file];
    if (!doc) throw new LoaderError('缺少樓層檔', [`station.json 指到 ${meta.file}，但未載入`]);
    floors.set(meta.id, doc as FloorDoc);
  }
  return { station, floors, connectors: (connectorsDoc as ConnectorsDoc).connectors };
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run tests/loader.test.ts`
Expected: PASS（3 tests）。

Run: `npm run typecheck` — Expected: exit 0（`ajv/dist/2020.js` 若報型別錯誤，改為 `import AjvModule from 'ajv/dist/2020'` 或在檔頭加 `// @ts-expect-error ajv cjs interop` 於該 import 行上方）。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: types + loader（ajv 驗證與 StationModel 組裝）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: nav.ts（全站有向圖 + A* + 無障礙過濾 + 文字步驟）

**Files:**
- Create: `src/nav.ts`
- Test: `tests/nav.test.ts`

**Interfaces:**
- Consumes: `assembleModel`（Task 3）、mini fixture。
- Produces: `nav.ts` 匯出：
  - `interface GraphNode { id: string; floor: string; xy: Vec2; z: number }`
  - `interface GraphEdge { from: string; to: string; kind: 'walk'|'gate'|'platform-edge'|'stair'|'escalator'|'elevator'; accessible: boolean; length: number; gate?: string; gateSystem?: string; connector?: string }`
  - `interface NavGraph { nodes: Map<string, GraphNode>; adj: Map<string, GraphEdge[]> }`
  - `buildGraph(model: StationModel): NavGraph`
  - `findPath(graph: NavGraph, start: string, goal: string, opts?: { accessibleOnly?: boolean }): GraphEdge[] | null`
  - `routeSteps(model: StationModel, graph: NavGraph, edges: GraphEdge[]): string[]`
- 文字步驟格式（固定，供測試與 UI）：連續 walk/platform-edge 合併為 `步行約 N 公尺`（N = round(總長, 最小 1）；gate `通過{系統中文名}閘門`；escalator `搭電扶梯上至「{樓層zh}」`/`搭電扶梯下至「{樓層zh}」`；stair `走樓梯上至…`/`走樓梯下至…`；elevator `搭電梯至「{樓層zh}」`。

- [ ] **Step 1: 寫失敗測試**

`tests/nav.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, routeSteps } from '../src/nav';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);
const graph = buildGraph(model);

describe('buildGraph', () => {
  it('節點含樓層與高程', () => {
    expect(graph.nodes.get('n-pl-001')).toMatchObject({ floor: 'plat-b2', z: -9 });
    expect(graph.nodes.get('n-ha-001')).toMatchObject({ floor: 'hall-b1', z: -4 });
  });

  it('單向 gate edge 不產生反向', () => {
    const back = (graph.adj.get('n-ha-002') ?? []).filter((e) => e.to === 'n-ha-001');
    expect(back).toEqual([]);
  });

  it('direction:up 的電扶梯只有低→高', () => {
    const up = (graph.adj.get('n-pl-001') ?? []).find((e) => e.kind === 'escalator');
    expect(up?.to).toBe('n-ha-001');
    const down = (graph.adj.get('n-ha-001') ?? []).find((e) => e.kind === 'escalator');
    expect(down).toBeUndefined();
  });
});

describe('findPath', () => {
  it('一般模式走電扶梯 + 單向閘門', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.kind)).toEqual(['escalator', 'gate']);
    expect(path![1].gate).toBe('g-ha-out');
  });

  it('無障礙模式改走電梯 + 無障礙閘門', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002', { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.kind === 'elevator')).toBe(true);
    expect(path!.some((e) => e.gate === 'g-ha-acc')).toBe(true);
  });

  it('無路可達回傳 null', () => {
    const path = findPath(graph, 'n-ha-002', 'n-pl-001', { accessibleOnly: true });
    // 反向：ha-002 →(walk) ha-004 →(acc gate) ha-003 →(電梯 both) pl-002 →(walk) pl-001，其實可達
    expect(path).not.toBeNull();
    // 真正不可達：從 unpaid 回 paid 只有 acc gate（both）可走；把起點設為孤立節點測 null
    expect(findPath(graph, 'n-ha-002', 'n-zz-none')).toBeNull();
  });
});

describe('routeSteps', () => {
  it('一般路徑步驟文字', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002')!;
    expect(routeSteps(model, graph, path)).toEqual([
      '搭電扶梯上至「測試大廳」',
      '通過測試系統閘門',
    ]);
  });

  it('無障礙路徑步驟文字（含步行合併）', () => {
    const path = findPath(graph, 'n-pl-001', 'n-ha-002', { accessibleOnly: true })!;
    expect(routeSteps(model, graph, path)).toEqual([
      '步行約 5 公尺',
      '搭電梯至「測試大廳」',
      '通過測試系統閘門',
      '步行約 3 公尺',
    ]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/nav.test.ts`
Expected: FAIL（`Cannot find module '../src/nav'`）。

- [ ] **Step 3: 實作 src/nav.ts**

```ts
import type { StationModel, Vec2 } from './types';

export interface GraphNode { id: string; floor: string; xy: Vec2; z: number }
export interface GraphEdge {
  from: string; to: string;
  kind: 'walk' | 'gate' | 'platform-edge' | 'stair' | 'escalator' | 'elevator';
  accessible: boolean; length: number; gate?: string; gateSystem?: string; connector?: string;
}
export interface NavGraph { nodes: Map<string, GraphNode>; adj: Map<string, GraphEdge[]> }

const dist3 = (a: GraphNode, b: GraphNode) =>
  Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1], a.z - b.z);

export function buildGraph(model: StationModel): NavGraph {
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, GraphEdge[]>();
  const addEdge = (e: GraphEdge) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  };

  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor?.nav) continue;
    for (const n of floor.nav.nodes) {
      nodes.set(n.id, { id: n.id, floor: meta.id, xy: n.xy, z: meta.elevation });
    }
  }

  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor?.nav) continue;
    const gateById = new Map((floor.gates ?? []).map((g) => [g.id, g]));
    for (const e of floor.nav.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b) continue;
      const gate = e.kind === 'gate' ? gateById.get(e.gate ?? '') : undefined;
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: e.kind,
        accessible: gate ? gate.accessible : true,
        length: dist3(a, b),
        gate: gate?.id,
        gateSystem: gate?.system,
      };
      addEdge({ from: e.from, to: e.to, ...base });
      if (e.bidir !== false) addEdge({ from: e.to, to: e.from, ...base });
    }
  }

  for (const c of model.connectors) {
    for (let i = 0; i < c.levels.length - 1; i++) {
      const lo = c.levels[i];
      const hi = c.levels[i + 1];
      const a = nodes.get(lo.node);
      const b = nodes.get(hi.node);
      if (!a || !b) continue;
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: c.kind, accessible: c.accessible, length: dist3(a, b), connector: c.id,
      };
      if (c.direction === 'up' || c.direction === 'both') addEdge({ from: lo.node, to: hi.node, ...base });
      if (c.direction === 'down' || c.direction === 'both') addEdge({ from: hi.node, to: lo.node, ...base });
    }
  }
  return { nodes, adj };
}

export function findPath(
  graph: NavGraph, start: string, goal: string,
  opts: { accessibleOnly?: boolean } = {},
): GraphEdge[] | null {
  const startN = graph.nodes.get(start);
  const goalN = graph.nodes.get(goal);
  if (!startN || !goalN) return null;

  const g = new Map<string, number>([[start, 0]]);
  const cameFrom = new Map<string, GraphEdge>();
  const open = new Set<string>([start]);
  const h = (id: string) => dist3(graph.nodes.get(id)!, goalN);

  while (open.size) {
    let current = '';
    let best = Infinity;
    for (const id of open) {
      const f = (g.get(id) ?? Infinity) + h(id);
      if (f < best || (f === best && id < current)) { best = f; current = id; }
    }
    if (current === goal) {
      const edges: GraphEdge[] = [];
      let cur = goal;
      while (cur !== start) {
        const e = cameFrom.get(cur)!;
        edges.unshift(e);
        cur = e.from;
      }
      return edges;
    }
    open.delete(current);
    for (const e of graph.adj.get(current) ?? []) {
      if (opts.accessibleOnly && !e.accessible) continue;
      const tentative = (g.get(current) ?? Infinity) + e.length;
      if (tentative < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, tentative);
        cameFrom.set(e.to, e);
        open.add(e.to);
      }
    }
  }
  return null;
}

export function routeSteps(model: StationModel, graph: NavGraph, edges: GraphEdge[]): string[] {
  const steps: string[] = [];
  let walk = 0;
  const flushWalk = () => {
    if (walk > 0) {
      steps.push(`步行約 ${Math.max(1, Math.round(walk))} 公尺`);
      walk = 0;
    }
  };
  const floorZh = (floorId: string) =>
    model.station.floors.find((f) => f.id === floorId)?.name.zh ?? floorId;

  for (const e of edges) {
    if (e.kind === 'walk' || e.kind === 'platform-edge') {
      walk += e.length;
      continue;
    }
    flushWalk();
    if (e.kind === 'gate') {
      const sys = e.gateSystem ? model.station.systems[e.gateSystem]?.name.zh ?? e.gateSystem : '';
      steps.push(`通過${sys}閘門`);
    } else {
      const dest = graph.nodes.get(e.to)!;
      const src = graph.nodes.get(e.from)!;
      const goingUp = dest.z > src.z;
      const name = floorZh(dest.floor);
      if (e.kind === 'escalator') steps.push(`搭電扶梯${goingUp ? '上' : '下'}至「${name}」`);
      else if (e.kind === 'stair') steps.push(`走樓梯${goingUp ? '上' : '下'}至「${name}」`);
      else steps.push(`搭電梯至「${name}」`);
    }
  }
  flushWalk();
  return steps;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/nav.test.ts`
Expected: PASS（8 tests）。

- [ ] **Step 5: 全部測試 + typecheck + commit**

Run: `npm test && npm run typecheck` — Expected: 全 PASS。

```bash
git add -A
git commit -m "feat: nav graph 合成 + A* + 無障礙過濾 + 文字步驟

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: builder.ts + path.ts（three.js 場景生成，headless 可測）

**Files:**
- Create: `src/builder.ts`, `src/path.ts`
- Test: `tests/builder.test.ts`

**Interfaces:**
- Consumes: `StationModel`（Task 3）、`NavGraph`/`GraphEdge`（Task 4）。
- Produces:
  - `builder.ts`：`toWorld(xy: Vec2, y: number): THREE.Vector3`（`(x, y, −xy[1])`）；`buildStationGroup(model): THREE.Group`——每樓一個 `THREE.Group`（`name = floor.id`、`userData.floorId`、`userData.kind = 'floor'`），另有 `name = 'connectors'` 的 group；區域 mesh `userData.kind = area.kind`；track 面下沉 1.1 m。
  - `path.ts`：`buildRouteObject(graph: NavGraph, edges: GraphEdge[]): THREE.Group`（`name = 'route'`，路徑管線 + 起終點球）。
- 建模規則（spec §6）：slab 厚 0.3 m 向下、areas 薄面（+0.01 避免 z-fight）、slab 輪廓自動外殼、walls/units extrude、gates 兩柱一橫桿、connectors 斜坡（stair/escalator）或豎井（elevator）。

- [ ] **Step 1: 寫失敗測試**

`tests/builder.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import { buildStationGroup, toWorld } from '../src/builder';
import { buildRouteObject } from '../src/path';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);

describe('toWorld', () => {
  it('local (x,y) 對映 three (x, elev, -y)', () => {
    const v = toWorld([3, 7], -4);
    expect([v.x, v.y, v.z]).toEqual([3, -4, -7]);
  });
});

describe('buildStationGroup', () => {
  const group = buildStationGroup(model);

  it('每樓一個 group + connectors group', () => {
    const names = group.children.map((c) => c.name);
    expect(names).toContain('hall-b1');
    expect(names).toContain('plat-b2');
    expect(names).toContain('connectors');
  });

  it('樓層 group 帶 userData.floorId 且含 slab 與 area meshes', () => {
    const hallGroup = group.children.find((c) => c.name === 'hall-b1') as THREE.Group;
    expect(hallGroup.userData.floorId).toBe('hall-b1');
    const kinds = hallGroup.children.map((c) => c.userData.kind).filter(Boolean);
    expect(kinds).toContain('slab');
    expect(kinds).toContain('paid');
    expect(kinds).toContain('unpaid');
  });

  it('connectors group 含 2 個量體（電扶梯斜坡 + 電梯豎井）', () => {
    const conns = group.children.find((c) => c.name === 'connectors') as THREE.Group;
    expect(conns.children.length).toBe(2);
  });
});

describe('buildRouteObject', () => {
  it('路徑物件含管線與起終點', () => {
    const graph = buildGraph(model);
    const path = findPath(graph, 'n-pl-001', 'n-ha-002')!;
    const route = buildRouteObject(graph, path);
    expect(route.name).toBe('route');
    expect(route.children.length).toBeGreaterThanOrEqual(3); // tube + 2 spheres
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/builder.test.ts`
Expected: FAIL（`Cannot find module '../src/builder'`）。

- [ ] **Step 3: 實作 src/builder.ts**

```ts
import * as THREE from 'three';
import type { StationModel, Vec2 } from './types';

export function toWorld(xy: Vec2, y: number): THREE.Vector3 {
  return new THREE.Vector3(xy[0], y, -xy[1]);
}

const AREA_COLORS: Record<string, string> = {
  platform: '#e8c060', paid: '#e3547a', unpaid: '#4a90d9',
  corridor: '#7bc47f', track: '#333a45', restricted: '#777777',
};

function ringToShape(outline: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return shape;
}

// shape 的 (x,y) 即 local 座標；extrude 沿 +z 再 rotateX(-90°) → +z 變 three 的 +y（向上）、
// (x, y, 0) → (x, 0, -y)，與 toWorld 一致。
function extrudeMesh(
  outline: Vec2[], holes: Vec2[][], depth: number, baseY: number,
  material: THREE.Material, kind: string,
): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(ringToShape(outline, holes), { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = baseY;
  mesh.userData.kind = kind;
  return mesh;
}

function mat(color: string, opacity: number): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color, transparent: opacity < 1, opacity, side: THREE.DoubleSide,
  });
}

export function buildStationGroup(model: StationModel): THREE.Group {
  const root = new THREE.Group();
  root.name = 'station';

  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor) continue;
    const g = new THREE.Group();
    g.name = meta.id;
    g.userData = { floorId: meta.id, kind: 'floor' };

    // slab：厚 0.3 m、頂面在 elevation
    g.add(extrudeMesh(floor.slab.outline, floor.slab.holes ?? [], 0.3, meta.elevation - 0.3,
      mat('#d9d9d9', 0.9), 'slab'));

    // 外殼：沿 slab 輪廓的半透明立面
    const shellPts = [...floor.slab.outline, floor.slab.outline[0]];
    for (let i = 0; i < shellPts.length - 1; i++) {
      const a = toWorld(shellPts[i], meta.elevation);
      const b = toWorld(shellPts[i + 1], meta.elevation);
      const len = a.distanceTo(b);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, meta.height, 0.05), mat('#aab4c4', 0.08));
      wall.position.copy(a.clone().add(b).multiplyScalar(0.5));
      wall.position.y = meta.elevation + meta.height / 2;
      wall.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      wall.userData.kind = 'shell';
      g.add(wall);
    }

    for (const [i, a] of (floor.areas ?? []).entries()) {
      // 每個 area 疊加微小高度差，避免重疊區域 z-fight（如 B3 臺鐵轉乘區疊在非付費區上）
      const sunk = a.kind === 'track' ? -1.1 : 0.01 + i * 0.01;
      g.add(extrudeMesh(a.polygon, [], 0.05, meta.elevation + sunk, mat(AREA_COLORS[a.kind], 0.35), a.kind));
    }
    for (const u of floor.units ?? []) {
      g.add(extrudeMesh(u.polygon, [], u.height, meta.elevation, mat('#9aa5b1', 0.85), `unit-${u.kind}`));
    }
    for (const w of floor.walls ?? []) {
      for (let i = 0; i < w.polyline.length - 1; i++) {
        const a = toWorld(w.polyline[i], meta.elevation);
        const b = toWorld(w.polyline[i + 1], meta.elevation);
        const len = a.distanceTo(b);
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(len, w.height, w.width ?? 0.3), mat('#8895a3', 0.9));
        wallMesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
        wallMesh.position.y = meta.elevation + w.height / 2;
        wallMesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
        wallMesh.userData.kind = 'wall';
        g.add(wallMesh);
      }
    }
    for (const gate of floor.gates ?? []) {
      const color = gate.accessible ? '#2bb3a3' : '#c05050';
      const [p1, p2] = gate.line.map((p) => toWorld(p, meta.elevation));
      for (const p of [p1, p2]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.1, 0.25), mat(color, 1));
        post.position.copy(p);
        post.position.y = meta.elevation + 0.55;
        post.userData.kind = 'gate';
        g.add(post);
      }
      const len = p1.distanceTo(p2);
      const bar = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.08), mat(color, 1));
      bar.position.copy(p1.clone().add(p2).multiplyScalar(0.5));
      bar.position.y = meta.elevation + 1.0;
      bar.rotation.y = Math.atan2(-(p2.z - p1.z), p2.x - p1.x);
      bar.userData.kind = 'gate';
      g.add(bar);
    }
    for (const poi of floor.pois ?? []) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 8), mat('#f0e050', 1));
      marker.position.copy(toWorld(poi.position, meta.elevation + 1.2));
      marker.userData.kind = `poi-${poi.kind}`;
      g.add(marker);
    }
    root.add(g);
  }

  // connectors：斜坡（stair/escalator）與豎井（elevator）
  const connGroup = new THREE.Group();
  connGroup.name = 'connectors';
  const nodePos = new Map<string, THREE.Vector3>();
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    for (const n of floor?.nav?.nodes ?? []) nodePos.set(n.id, toWorld(n.xy, meta.elevation));
  }
  for (const c of model.connectors) {
    for (let i = 0; i < c.levels.length - 1; i++) {
      const a = nodePos.get(c.levels[i].node);
      const b = nodePos.get(c.levels[i + 1].node);
      if (!a || !b) continue;
      const color = c.kind === 'elevator' ? '#2bb3a3' : '#c8a468';
      let mesh: THREE.Mesh;
      if (c.kind === 'elevator') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2, b.y - a.y, 2), mat(color, 0.7));
        mesh.position.set(a.x, (a.y + b.y) / 2, a.z);
      } else {
        const len = a.distanceTo(b);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 1.4), mat(color, 0.9));
        mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
        mesh.lookAt(b);
        mesh.rotateY(Math.PI / 2); // BoxGeometry 長軸為 x，lookAt 對齊 z 後轉回
      }
      mesh.userData = { kind: `connector-${c.kind}`, connectorId: c.id };
      connGroup.add(mesh);
    }
  }
  root.add(connGroup);
  return root;
}
```

- [ ] **Step 4: 實作 src/path.ts**

```ts
import * as THREE from 'three';
import type { GraphEdge, NavGraph } from './nav';
import { toWorld } from './builder';

export function buildRouteObject(graph: NavGraph, edges: GraphEdge[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'route';
  if (edges.length === 0) return group;

  const ids = [edges[0].from, ...edges.map((e) => e.to)];
  const pts = ids.map((id) => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z + 1.2); // 浮在樓面上方
  });

  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(16, pts.length * 8), 0.45, 8, false),
    new THREE.MeshBasicMaterial({ color: '#00d0ff' }),
  );
  group.add(tube);

  const endpoint = (p: THREE.Vector3, color: string) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 12), new THREE.MeshBasicMaterial({ color }));
    s.position.copy(p);
    return s;
  };
  group.add(endpoint(pts[0], '#40ff90'));
  group.add(endpoint(pts[pts.length - 1], '#ff5060'));
  return group;
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run tests/builder.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 6: 全測試 + typecheck + commit**

Run: `npm test && npm run typecheck` — Expected: 全 PASS。

```bash
git add -A
git commit -m "feat: three.js builder（樓層/閘門/connector 量體）與路徑物件

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: 參考圖整理 + refs/sources.json

**Files:**
- Create: `refs/sources.json`, `refs/trtc-taipei-station/*`（複製）、`refs/tra-taipei-station/*`（複製）、`refs/site/*`（搬移根目錄兩張圖）
- Create: `docs/data-conventions.md`

**Interfaces:**
- Produces: `refs/sources.json` 的 source id（`trtc-info-b1`…`trtc-info-b4`、`trtc-section`、`tra-b1-map`、`tra-b2-map`、`tra-b3-map`、`site-guide-photo`、`site-isometric-2014`）——後續所有資料元素的 `source` 值域。

- [ ] **Step 1: 複製舊專案參考圖與搬移根目錄圖檔**

```powershell
New-Item -ItemType Directory -Force refs\trtc-taipei-station, refs\tra-taipei-station, refs\site
Copy-Item D:\taipei-station-3d\data\sources\raw\trtc-taipei-station\floor-1.jpg, `
  D:\taipei-station-3d\data\sources\raw\trtc-taipei-station\floor-2.jpg, `
  D:\taipei-station-3d\data\sources\raw\trtc-taipei-station\floor-3.jpg, `
  D:\taipei-station-3d\data\sources\raw\trtc-taipei-station\floor-4.jpg, `
  D:\taipei-station-3d\data\sources\raw\trtc-taipei-station\station-section.jpg refs\trtc-taipei-station\
Copy-Item D:\taipei-station-3d\data\sources\raw\tra-taipei-station\b1-to-2f-map.jpg, `
  D:\taipei-station-3d\data\sources\raw\tra-taipei-station\b2-map.jpg, `
  D:\taipei-station-3d\data\sources\raw\tra-taipei-station\b3-map.jpg refs\tra-taipei-station\
Move-Item "e58fb0e58c97e8bb8ae7ab99e7ab8be9ab94e5b08ee8a6bde59c96.png" refs\site\isometric-guide-2014.png
Move-Item "image_f65689.png" refs\site\station-guide-photo.png
```

Expected: `refs/` 下 10 個圖檔就位，專案根目錄不再有散圖。

- [ ] **Step 2: 建立 refs/sources.json**

```json
{
  "schema": "sources@1",
  "sources": [
    { "id": "trtc-info-b1", "title": "北捷台北車站資訊圖 B1（BL12R10-SW 25.12）",
      "file": "refs/trtc-taipei-station/floor-1.jpg",
      "url": "https://web.metro.taipei/img/ALL/INFOPDF/JPG/051-1.jpg", "captured": "2026-07-14",
      "license_note": "北捷公開站圖，僅作描圖參考" },
    { "id": "trtc-info-b2", "title": "北捷台北車站資訊圖 B2（板南線大廳層）",
      "file": "refs/trtc-taipei-station/floor-2.jpg",
      "url": "https://web.metro.taipei/img/ALL/INFOPDF/JPG/051-2.jpg", "captured": "2026-07-14",
      "license_note": "北捷公開站圖，僅作描圖參考" },
    { "id": "trtc-info-b3", "title": "北捷台北車站資訊圖 B3（板南線月台/淡水信義線大廳層）",
      "file": "refs/trtc-taipei-station/floor-3.jpg",
      "url": "https://web.metro.taipei/img/ALL/INFOPDF/JPG/051-3.jpg", "captured": "2026-07-14",
      "license_note": "北捷公開站圖，僅作描圖參考" },
    { "id": "trtc-info-b4", "title": "北捷台北車站資訊圖 B4（淡水信義線月台層）",
      "file": "refs/trtc-taipei-station/floor-4.jpg",
      "url": "https://web.metro.taipei/img/ALL/INFOPDF/JPG/051-4.jpg", "captured": "2026-07-14",
      "license_note": "北捷公開站圖，僅作描圖參考" },
    { "id": "trtc-section", "title": "北捷台北車站剖面相關位置圖（BL12/R10-SP 25.12）",
      "file": "refs/trtc-taipei-station/station-section.jpg",
      "url": "https://web.metro.taipei/img/ALL/stationprofile/051.jpg", "captured": "2026-07-14",
      "license_note": "官方標示僅供參考；垂直動線判讀依據" },
    { "id": "tra-b1-map", "title": "臺鐵臺北車站 B1–2F 位置圖",
      "file": "refs/tra-taipei-station/b1-to-2f-map.jpg",
      "url": "https://tip.railway.gov.tw/tra-tip-web/tip/img/869f5722-348f-4de2-89ef-0cc727940cb9/1140x900",
      "captured": "2026-07-14", "license_note": "臺鐵公開站圖" },
    { "id": "tra-b2-map", "title": "臺鐵臺北車站 B2 月台層圖（含高鐵月台）",
      "file": "refs/tra-taipei-station/b2-map.jpg",
      "url": "https://tip.railway.gov.tw/tra-tip-web/tip/img/0a00114c-3667-4e2f-a897-78b2864d8eba/1140x900",
      "captured": "2026-07-14", "license_note": "臺鐵公開站圖" },
    { "id": "tra-b3-map", "title": "臺鐵臺北車站 B3 轉乘層圖（往北捷）",
      "file": "refs/tra-taipei-station/b3-map.jpg",
      "url": "https://tip.railway.gov.tw/tra-tip-web/tip/img/09409b37-5bdf-4b04-9837-f9964c5cad44/1140x900",
      "captured": "2026-07-14", "license_note": "臺鐵公開站圖；臺鐵轉乘閘門判讀依據" },
    { "id": "site-guide-photo", "title": "台北車站資訊圖＋車站配置圖（現場照片/截圖）",
      "file": "refs/site/station-guide-photo.png", "captured": "2026-07-17",
      "license_note": "使用者提供，交叉比對用" },
    { "id": "site-isometric-2014", "title": "台北車站立體導覽圖（2014.11 wei 製作）",
      "file": "refs/site/isometric-guide-2014.png", "captured": "2026-07-17",
      "license_note": "第三方作品：僅交叉比對，不直接描圖" }
  ]
}
```

- [ ] **Step 3: 建立 docs/data-conventions.md**

```markdown
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
```

- [ ] **Step 4: 檢查 sources.json 語法**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('refs/sources.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`。（完整 schema 驗證由 Task 7 的 `npm run validate` 涵蓋——sources.json 是其中一環。）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "data: 參考圖整理（北捷/臺鐵官方圖 + 現場圖）與 sources.json、資料慣例文件

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: station.json + 四樓層 stub + ui.ts + main.ts（app 開機）

**Files:**
- Create: `data/station.json`, `data/connectors.json`（空清單）, `data/floors/tra-concourse-b1.json`, `data/floors/tra-platform-b2.json`, `data/floors/mrt-r-concourse-b3.json`, `data/floors/mrt-r-platform-b4.json`（stub：slab only）
- Create: `src/ui.ts`, `src/main.ts`

**Interfaces:**
- Consumes: Task 3–6 全部模組與 source ids。
- Produces: 可開機的 viewer：`npm run dev` 顯示四層樓板堆疊。`ui.ts` 匯出 `setupUI(opts: { model: StationModel; stationGroup: THREE.Group; onRoute: (accessibleOnly: boolean) => void; onClear: () => void }): { setSteps(steps: string[]): void }`。`main.ts` 以 `import.meta.glob('../data/floors/*.json', { eager: true })` 載入樓層檔並呼叫 `assembleModel`。

- [ ] **Step 1: 建立 data/station.json**

```json
{
  "schema": "station@1",
  "id": "taipei-main-station",
  "name": { "zh": "台北車站", "en": "Taipei Main Station" },
  "frame": {
    "units": "m",
    "origin_note": "臺鐵站體中心",
    "axis_note": "+X 沿臺鐵站體長軸約東向，+Y 約北向；R 線站體長軸約 N20°E",
    "bearing_deg": 90,
    "bearing_status": "estimated"
  },
  "systems": {
    "trtc": { "name": { "zh": "台北捷運" }, "color": "#e3002c" },
    "tra":  { "name": { "zh": "臺鐵" },    "color": "#0070bd" }
  },
  "floors": [
    { "id": "tra-concourse-b1", "short": "tc", "file": "floors/tra-concourse-b1.json",
      "name": { "zh": "臺鐵穿堂層", "en": "TRA Concourse" },
      "labels": { "complex": "B1", "trtc": "B1", "tra": "B1" },
      "elevation": -8, "height": 5, "estimated": true },
    { "id": "tra-platform-b2", "short": "tp", "file": "floors/tra-platform-b2.json",
      "name": { "zh": "臺鐵/高鐵月台層", "en": "TRA/HSR Platforms" },
      "labels": { "complex": "B2", "tra": "B2 月台層", "trtc": "B2 板南線大廳層" },
      "elevation": -14, "height": 4.5, "estimated": true },
    { "id": "mrt-r-concourse-b3", "short": "rc", "file": "floors/mrt-r-concourse-b3.json",
      "name": { "zh": "淡水信義線大廳層", "en": "Tamsui-Xinyi Concourse" },
      "labels": { "complex": "B3", "trtc": "B3 淡水信義線大廳層", "tra": "B3 轉乘層" },
      "elevation": -21, "height": 4.5, "estimated": true },
    { "id": "mrt-r-platform-b4", "short": "rp", "file": "floors/mrt-r-platform-b4.json",
      "name": { "zh": "淡水信義線月台層", "en": "Tamsui-Xinyi Platform" },
      "labels": { "complex": "B4", "trtc": "B4 淡水信義線月台層" },
      "elevation": -28, "height": 4.5, "estimated": true }
  ]
}
```

（`demo` 欄位到 Task 11 補上。）

- [ ] **Step 2: 建立四個 stub 樓層檔與空 connectors**

`data/connectors.json`：

```json
{ "schema": "connectors@1", "connectors": [] }
```

`data/floors/tra-concourse-b1.json`（stub：站體矩形 + 東翼，涵蓋 B3 梯降落區）：

```json
{
  "schema": "floor@1",
  "id": "tra-concourse-b1",
  "slab": {
    "outline": [[-105, -75], [105, -75], [105, -10], [151, 2], [140, 55], [105, 46], [105, 75], [-105, 75]],
    "source": "trtc-info-b1", "confidence": 2,
    "note": "站體矩形＋東翼（R 線站體北段上方的 B1 通廊）粗估，待 Task 10 對照 floor-1.jpg 修正"
  }
}
```

`data/floors/tra-platform-b2.json`：

```json
{
  "schema": "floor@1",
  "id": "tra-platform-b2",
  "slab": {
    "outline": [[-105, -75], [105, -75], [105, 75], [-105, 75]],
    "source": "tra-b2-map", "confidence": 2,
    "note": "站體矩形粗估；R 線站體豎井位於站體東側之外，不需開洞"
  }
}
```

`data/floors/mrt-r-concourse-b3.json`（stub：R 線站體斜矩形）：

```json
{
  "schema": "floor@1",
  "id": "mrt-r-concourse-b3",
  "slab": {
    "outline": [[101.9, -94.3], [156.7, 56.1], [134.1, 64.3], [79.3, -86.1]],
    "source": "trtc-info-b3", "confidence": 2,
    "note": "R 線站體 N20°E 斜矩形（長 160 寬 24）粗估"
  }
}
```

`data/floors/mrt-r-platform-b4.json`（stub：同站體範圍）：

```json
{
  "schema": "floor@1",
  "id": "mrt-r-platform-b4",
  "slab": {
    "outline": [[101.9, -94.3], [156.7, 56.1], [134.1, 64.3], [79.3, -86.1]],
    "source": "trtc-info-b4", "confidence": 2,
    "note": "與 B3 同站體範圍粗估"
  }
}
```

- [ ] **Step 3: 跑 validate 確認 stub 資料合法**

Run: `npm run validate`
Expected: `validate: 0 errors, 0 warnings`。

- [ ] **Step 4: 實作 src/ui.ts**

```ts
import type * as THREE from 'three';
import type { StationModel } from './types';

export interface UIHandles { setSteps(steps: string[]): void }

export function setupUI(opts: {
  model: StationModel;
  stationGroup: THREE.Group;
  onRoute: (accessibleOnly: boolean) => void;
  onClear: () => void;
}): UIHandles {
  const { model, stationGroup } = opts;
  const floorsDiv = document.querySelector<HTMLDivElement>('#floors')!;
  const stepsOl = document.querySelector<HTMLOListElement>('#steps')!;

  for (const meta of model.station.floors) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      const g = stationGroup.children.find((c) => c.name === meta.id);
      if (g) g.visible = cb.checked;
    });
    label.append(cb, ` ${meta.labels['complex'] ?? ''} ${meta.name.zh}`);
    floorsDiv.append(label);
  }

  const opacity = document.querySelector<HTMLInputElement>('#opacity')!;
  opacity.addEventListener('input', () => {
    const k = Number(opacity.value) / 100;
    stationGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const m = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (m && (mesh.userData.kind === 'slab' || mesh.userData.kind === 'shell')) {
        m.opacity = (mesh.userData.kind === 'slab' ? 0.9 : 0.08) * k * (1 / 0.6);
        m.transparent = true;
      }
    });
  });

  const btnRoute = document.querySelector<HTMLButtonElement>('#btn-route')!;
  const btnAcc = document.querySelector<HTMLButtonElement>('#btn-route-acc')!;
  const btnClear = document.querySelector<HTMLButtonElement>('#btn-clear')!;
  const hasDemo = Boolean(model.station.demo);
  btnRoute.disabled = !hasDemo;
  btnAcc.disabled = !hasDemo;
  if (!hasDemo) btnRoute.title = btnAcc.title = 'station.json 尚未設定 demo 起訖';
  btnRoute.addEventListener('click', () => opts.onRoute(false));
  btnAcc.addEventListener('click', () => opts.onRoute(true));
  btnClear.addEventListener('click', () => { opts.onClear(); setSteps([]); });

  function setSteps(steps: string[]): void {
    stepsOl.replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
  }
  return { setSteps };
}
```

- [ ] **Step 5: 實作 src/main.ts**

```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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

try {
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14171c');
  scene.add(new THREE.HemisphereLight('#cfd8e3', '#2a2f38', 1.1));
  const dir = new THREE.DirectionalLight('#ffffff', 0.9);
  dir.position.set(150, 200, 120);
  scene.add(dir);
  scene.add(new THREE.GridHelper(500, 50, '#2c333d', '#232830'));

  const stationGroup = buildStationGroup(model);
  scene.add(stationGroup);

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
} catch (e) {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
}
```

- [ ] **Step 6: 開機驗證（瀏覽器目視）**

Run: `npm run dev`，開瀏覽器（或 preview 工具）到 dev URL。
Expected: 深色場景中四片樓板依高程堆疊（上方 L 形站體＋東翼、下方兩片斜矩形），右側 panel 有四個樓層 checkbox、透明度滑桿、三顆按鈕（路徑鈕 disabled）。console 無紅字 error。

Run: `npm test && npm run typecheck` — Expected: 全 PASS。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: station.json + 四樓層 stub + viewer 開機（ui/main）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: mrt-r-platform-b4 粗版幾何 + nav

**Files:**
- Modify: `data/floors/mrt-r-platform-b4.json`（stub → 完整粗版）
- Create: `docs/floor-notes/mrt-r-platform-b4.md`

**Interfaces:**
- Consumes: 參考圖 `refs/trtc-taipei-station/floor-4.jpg`（必先以 Read 檢視）、`refs/site/station-guide-photo.png`。
- Produces: nav nodes `n-rp-001`…`n-rp-005`（Task 11 connectors 錨點：`n-rp-001` 南梯群、`n-rp-002` 電梯1、`n-rp-004` 北梯群；demo 起點 `n-rp-003`）。

R 線站體幾何參數（Global Constraints 的 u/p，中心 `(118, −15)`，沿線參數 t、橫向參數 s：`點 = (118 + 0.342t + 0.940s, −15 + 0.940t − 0.342s)`）：

- [ ] **Step 1: 檢視參考圖**

以 Read 檢視 `refs/trtc-taipei-station/floor-4.jpg`，確認：島式月台、一月台（東側，淡水·北投方向）、二月台（西側，象山方向）、梯群約 3–4 組、電梯 2 部（中段與南端）。

- [ ] **Step 2: 撰寫完整樓層檔**

以下座標為 t/s 公式代入後四捨五入一位的種子值（月台 141×11、軌道各寬 5.5）；對照圖面覺得明顯不符時可微調，改完必跑 validate：

```json
{
  "schema": "floor@1",
  "id": "mrt-r-platform-b4",
  "slab": {
    "outline": [[101.9, -94.3], [156.7, 56.1], [134.1, 64.3], [79.3, -86.1]],
    "source": "trtc-info-b4", "confidence": 3
  },
  "areas": [
    { "id": "a-rp-platform", "kind": "platform", "system": "trtc",
      "polygon": [[99.1, -79.4], [147.3, 49.4], [137.0, 53.2], [88.8, -83.2]],
      "source": "trtc-info-b4", "confidence": 3,
      "note": "島式月台，長 141m 為比例基準（高運量 6 節）" },
    { "id": "a-rp-track-e", "kind": "track", "system": "trtc",
      "polygon": [[104.2, -85.1], [152.4, 47.5], [147.3, 49.4], [99.1, -79.4]],
      "source": "trtc-info-b4", "confidence": 3, "note": "一月台側軌道（往淡水·北投）" },
    { "id": "a-rp-track-w", "kind": "track", "system": "trtc",
      "polygon": [[83.6, -77.5], [88.8, -83.2], [137.0, 53.2], [131.8, 55.1]],
      "source": "trtc-info-b4", "confidence": 3, "note": "二月台側軌道（往象山）" }
  ],
  "nav": {
    "nodes": [
      { "id": "n-rp-001", "xy": [97.6, -71.4], "area": "a-rp-platform" },
      { "id": "n-rp-002", "xy": [106.0, -47.9], "area": "a-rp-platform" },
      { "id": "n-rp-003", "xy": [118.0, -15.0], "area": "a-rp-platform" },
      { "id": "n-rp-004", "xy": [128.3, 13.2], "area": "a-rp-platform" },
      { "id": "n-rp-005", "xy": [139.2, 43.3], "area": "a-rp-platform" }
    ],
    "edges": [
      { "from": "n-rp-001", "to": "n-rp-002", "kind": "walk" },
      { "from": "n-rp-002", "to": "n-rp-003", "kind": "walk" },
      { "from": "n-rp-003", "to": "n-rp-004", "kind": "walk" },
      { "from": "n-rp-004", "to": "n-rp-005", "kind": "walk" }
    ]
  }
}
```

- [ ] **Step 3: validate + viewer 目視**

Run: `npm run validate` — Expected: 0 errors。
Viewer（dev server 熱重載）：B4 層出現月台面（黃）與兩側下沉軌道槽（深灰）。

- [ ] **Step 4: 撰寫 floor-note**

`docs/floor-notes/mrt-r-platform-b4.md`：

```markdown
# mrt-r-platform-b4 判讀筆記

- 來源：trtc-info-b4（BL12R10-SW 25.12）；交叉比對 site-guide-photo。
- 站體長軸約 N20°E（自 floor-4.jpg 圖面量測，北箭頭朝上）；一月台=東側（淡水·北投）、二月台=西側（象山）。
- 比例基準：月台長 141 m（高運量 6 節編組）→ 全圖等比推算。confidence 3。
- 電梯：圖示 2 部——「淡水信義線 2」中段、「淡水信義線 1」南端（往大廳·出口）。Phase 1 只建南端電梯1
  （connector `c-elv-rprc-1`，錨 `n-rp-002`）；電梯2 待補。
- 梯群：圖示 3–4 組；粗版以南（n-rp-001）、北（n-rp-004）兩組錨點代表。confidence 2。
- 未確定：月台寬度（粗估 11 m）、梯群精確位置、月台門。
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "data: B4 淡水信義線月台層粗版幾何與 nav

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: mrt-r-concourse-b3 粗版幾何 + nav（含臺鐵轉乘閘門）

**Files:**
- Modify: `data/floors/mrt-r-concourse-b3.json`
- Create: `docs/floor-notes/mrt-r-concourse-b3.md`

**Interfaces:**
- Consumes: `refs/trtc-taipei-station/floor-3.jpg`、`refs/tra-taipei-station/b3-map.jpg`、`refs/trtc-taipei-station/station-section.jpg`（必先 Read 檢視）。
- Produces: nav nodes（Task 11 錨點：`n-rc-001` 南梯降落、`n-rc-002` 北梯降落、`n-rc-010` 電梯1 降落、`n-rc-007` 往 B1 梯口、`n-rc-011` 往 B1 電梯；demo 終點 `n-rc-006`）。gates：`g-rc-out-n`/`g-rc-in-n`/`g-rc-acc-n`（捷運北閘門群）、`g-rc-tra-in`/`g-rc-tra-acc`（臺鐵轉乘閘門）。

- [ ] **Step 1: 檢視參考圖**

Read `floor-3.jpg`（R 大廳配置、臺鐵售票處/轉乘區位置、閘門群、電梯 1/2/3）、`b3-map.jpg`（臺鐵視角的轉乘層）、`station-section.jpg`（B3↔B1 與 B3↔臺鐵月台的梯向）。

- [ ] **Step 2: 撰寫完整樓層檔**

結構與必要元素（座標用 t/s 公式，付費區 t∈[−65,22]、北非付費區 t∈[22,80]、南非付費區 t∈[−80,−65]、臺鐵轉乘付費區在北非付費區內西側 t∈[35,55]、s∈[−12,−4]）：

```json
{
  "schema": "floor@1",
  "id": "mrt-r-concourse-b3",
  "slab": {
    "outline": [[101.9, -94.3], [156.7, 56.1], [134.1, 64.3], [79.3, -86.1]],
    "source": "trtc-info-b3", "confidence": 3
  },
  "areas": [
    { "id": "a-rc-paid", "kind": "paid", "system": "trtc",
      "polygon": [[106.1, -79.9], [135.8, 1.9], [115.2, 9.5], [85.5, -72.3]],
      "source": "trtc-info-b3", "confidence": 2,
      "note": "捷運付費區帶 t∈[-65,22]、s∈[-11,11]（自 slab 內縮 1m）" },
    { "id": "a-rc-unpaid-n", "kind": "unpaid", "system": "trtc",
      "polygon": [[135.8, 1.9], [155.0, 54.5], [134.4, 62.1], [115.2, 9.5]],
      "source": "trtc-info-b3", "confidence": 2, "note": "北非付費區 t∈[22,78]" },
    { "id": "a-rc-tra-paid", "kind": "paid", "system": "tra",
      "polygon": [[126.2, 19.3], [133.0, 38.1], [126.5, 40.5], [119.7, 21.7]],
      "source": "tra-b3-map", "confidence": 2,
      "note": "臺鐵轉乘付費梯區 t∈[35,55]、s∈[-11,-4]；與 a-rc-unpaid-n 重疊屬預期（畫在其上）" }
  ],
  "units": [
    { "id": "u-rc-tra-ticket", "kind": "room",
      "polygon": [[131.0, 55.0], [138.0, 57.5], [136.5, 61.5], [129.5, 59.0]],
      "height": 3, "source": "tra-b3-map", "confidence": 2, "note": "臺鐵售票處（示意量體）" }
  ],
  "gates": [ "…五個 gate 見下表…" ],
  "nav": { "nodes": [ "…13 個 node 見下表…" ], "edges": [ "…15 條 edge 見下表…" ] }
}
```

> 上方 JSON 的 `gates`/`nav` 以下表為準逐筆展開（表中座標直接使用；`…見下表…` 字串不得出現在實際檔案）：

**gates（5 筆，全部 `kind:"faregate"`、`source:"trtc-info-b3"`；臺鐵兩筆 `source:"tra-b3-map"`；confidence 2）**

| id | system | direction | accessible | line | connects |
|---|---|---|---|---|---|
| `g-rc-out-n` | trtc | out | false | `[[123.0,4.5],[128.6,2.5]]` | `["a-rc-paid","a-rc-unpaid-n"]` |
| `g-rc-in-n` | trtc | in | false | `[[129.5,5.0],[133.2,3.7]]` | `["a-rc-paid","a-rc-unpaid-n"]` |
| `g-rc-acc-n` | trtc | both | true | `[[134.0,6.5],[137.0,5.4]]` | `["a-rc-paid","a-rc-unpaid-n"]` |
| `g-rc-tra-in` | tra | in | false | `[[133.0,62.0],[137.5,60.4]]` | `["a-rc-tra-paid","a-rc-unpaid-n"]` |
| `g-rc-tra-acc` | tra | both | true | `[[138.5,60.0],[141.0,59.1]]` | `["a-rc-tra-paid","a-rc-unpaid-n"]` |

**nav.nodes（13 筆；`area` 欄照填）**

| id | xy | area | 用途 |
|---|---|---|---|
| `n-rc-001` | `[99.2,-66.7]` | a-rc-paid | 南梯群降落（B4 來） |
| `n-rc-002` | `[123.1,-0.9]` | a-rc-paid | 北梯群降落（B4 來） |
| `n-rc-003` | `[124.5,2.9]` | a-rc-paid | 出站閘門前 |
| `n-rc-004` | `[126.9,9.4]` | a-rc-unpaid-n | 出站閘門後 |
| `n-rc-005` | `[130.5,25.2]` | a-rc-unpaid-n | 轉乘通道中點/臺鐵閘門前 |
| `n-rc-006` | `[124.9,27.2]` | a-rc-tra-paid | **demo 終點**（臺鐵轉乘閘門內）|
| `n-rc-007` | `[141.3,48.9]` | a-rc-unpaid-n | 往 B1 長梯梯口 |
| `n-rc-008` | `[130.1,0.8]` | a-rc-paid | 無障礙閘門付費側 |
| `n-rc-009` | `[132.5,7.3]` | a-rc-unpaid-n | 無障礙閘門非付費側 |
| `n-rc-010` | `[106.0,-47.9]` | a-rc-paid | 電梯1 降落（與 n-rp-002 同 xy）|
| `n-rc-011` | `[142.3,40.0]` | a-rc-unpaid-n | 往 B1 電梯口 |
| `n-rc-012` | `[127.3,1.9]` | a-rc-paid | 進站閘門付費側 |
| `n-rc-013` | `[129.7,8.4]` | a-rc-unpaid-n | 進站閘門非付費側 |

**nav.edges（15 筆；未註明者 `kind:"walk"`，walk 不填 bidir＝雙向）**

| from | to | 備註 |
|---|---|---|
| n-rc-001 | n-rc-010 | |
| n-rc-010 | n-rc-002 | |
| n-rc-002 | n-rc-003 | |
| n-rc-002 | n-rc-008 | |
| n-rc-002 | n-rc-012 | |
| n-rc-003 | n-rc-004 | `kind:"gate", gate:"g-rc-out-n", bidir:false` |
| n-rc-013 | n-rc-012 | `kind:"gate", gate:"g-rc-in-n", bidir:false` |
| n-rc-008 | n-rc-009 | `kind:"gate", gate:"g-rc-acc-n", bidir:true` |
| n-rc-004 | n-rc-005 | |
| n-rc-009 | n-rc-005 | |
| n-rc-013 | n-rc-005 | |
| n-rc-005 | n-rc-007 | |
| n-rc-007 | n-rc-011 | |
| n-rc-005 | n-rc-006 | `kind:"gate", gate:"g-rc-tra-in", bidir:false` |
| n-rc-005 | n-rc-006 | `kind:"gate", gate:"g-rc-tra-acc", bidir:true` |

注意：所有 node 必須落在 slab 與所屬 area 內、gate edge 端點必須分別落在 `connects` 兩側 area 內——validate 會抓，報錯就依訊息修座標。

- [ ] **Step 3: validate + viewer 目視**

Run: `npm run validate` — Expected: 0 errors（若 winding/在外錯誤，依訊息修座標）。
Viewer：B3 層可見付費區（紅粉）、北非付費區（藍）、臺鐵轉乘小付費區（紅粉）、五組閘門柱（紅=一般、青=無障礙）、臺鐵售票處量體。

- [ ] **Step 4: 撰寫 floor-note**

`docs/floor-notes/mrt-r-concourse-b3.md`：

```markdown
# mrt-r-concourse-b3 判讀筆記

- 來源：trtc-info-b3 + tra-b3-map + trtc-section。
- 證據：B3 大廳北段設臺鐵售票處與臺鐵轉乘區（剖面圖「台鐵轉乘區」「高鐵轉乘區」）；轉乘閘門進閘後
  搭梯直上臺鐵月台層（複合體 B2）。demo 終點即此閘門內側（n-rc-006）。
- 假設（confidence 2）：閘門群精確位置與數量、付費區邊界 t=22/−65、臺鐵轉乘付費區範圍。
- 簡化：南閘門群（往忠孝西路/板南線）未建，付費區南端目前為端點；高鐵轉乘區未建（YAGNI）。
- 未確定：北端 B1 梯口正確位置（n-rc-007）、電梯 2/3 的服務樓層。
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "data: B3 R線大廳層粗版幾何（捷運閘門群＋臺鐵轉乘閘門）與 nav

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: tra-concourse-b1 + tra-platform-b2 粗版幾何

**Files:**
- Modify: `data/floors/tra-concourse-b1.json`, `data/floors/tra-platform-b2.json`
- Create: `docs/floor-notes/tra-concourse-b1.md`, `docs/floor-notes/tra-platform-b2.md`

**Interfaces:**
- Consumes: `refs/trtc-taipei-station/floor-1.jpg`、`refs/tra-taipei-station/b1-to-2f-map.jpg`、`refs/tra-taipei-station/b2-map.jpg`（必先 Read 檢視）。
- Produces: tc nav nodes（Task 11 錨點：`n-tc-001` B3 長梯降落、`n-tc-004` B3 電梯降落）；gates `g-tc-tra-in-e`/`g-tc-tra-acc-e`。

- [ ] **Step 1: 檢視參考圖並修正 tc slab**

Read 三張圖。依 floor-1.jpg 修正 Task 7 的 tc slab 東翼形狀（保持 8 點內外）；東翼必須涵蓋 `n-tc-001 (128,30)` 與 `n-tc-004 (120,38)`。

- [ ] **Step 2: 撰寫 tra-concourse-b1.json**

```json
{
  "schema": "floor@1",
  "id": "tra-concourse-b1",
  "slab": {
    "outline": [[-105, -75], [105, -75], [105, -10], [151, 2], [140, 55], [105, 46], [105, 75], [-105, 75]],
    "source": "trtc-info-b1", "confidence": 2,
    "note": "站體矩形＋東翼粗估"
  },
  "areas": [
    { "id": "a-tc-corridor", "kind": "corridor", "system": "shared",
      "polygon": [[105, -8], [149, 3], [139, 53], [105, 44]],
      "source": "trtc-info-b1", "confidence": 2, "note": "東翼通廊：B3 長梯與電梯降落區" },
    { "id": "a-tc-unpaid-e", "kind": "unpaid", "system": "tra",
      "polygon": [[80, -40], [105, -40], [105, 60], [80, 60]],
      "source": "tra-b1-map", "confidence": 2, "note": "站體東側非付費帶" },
    { "id": "a-tc-tra-paid", "kind": "paid", "system": "tra",
      "polygon": [[-60, -50], [80, -50], [80, 55], [-60, 55]],
      "source": "tra-b1-map", "confidence": 2, "note": "臺鐵付費區（局部；西側未建）" }
  ],
  "units": [
    { "id": "u-tc-ticket-office", "kind": "room",
      "polygon": [[30, -45], [60, -45], [60, -30], [30, -30]],
      "height": 3.5, "source": "tra-b1-map", "confidence": 2, "note": "售票處示意量體" },
    { "id": "u-tc-col-1", "kind": "column", "polygon": [[-40, -1], [-38, -1], [-38, 1], [-40, 1]],
      "height": 5, "source": "tra-b1-map", "confidence": 2 },
    { "id": "u-tc-col-2", "kind": "column", "polygon": [[0, -1], [2, -1], [2, 1], [0, 1]],
      "height": 5, "source": "tra-b1-map", "confidence": 2 },
    { "id": "u-tc-col-3", "kind": "column", "polygon": [[40, -1], [42, -1], [42, 1], [40, 1]],
      "height": 5, "source": "tra-b1-map", "confidence": 2 }
  ],
  "gates": [
    { "id": "g-tc-tra-in-e", "kind": "faregate", "system": "tra", "direction": "in", "accessible": false,
      "line": [[80, 5], [80, 15]], "connects": ["a-tc-tra-paid", "a-tc-unpaid-e"],
      "source": "tra-b1-map", "confidence": 2, "note": "東側剪票口（離捷運最近閘口群，粗估）" },
    { "id": "g-tc-tra-acc-e", "kind": "faregate", "system": "tra", "direction": "both", "accessible": true,
      "line": [[80, 18], [80, 24]], "connects": ["a-tc-tra-paid", "a-tc-unpaid-e"],
      "source": "tra-b1-map", "confidence": 2 }
  ],
  "nav": {
    "nodes": [
      { "id": "n-tc-001", "xy": [128, 30], "area": "a-tc-corridor" },
      { "id": "n-tc-002", "xy": [92, 12], "area": "a-tc-unpaid-e" },
      { "id": "n-tc-003", "xy": [70, 12], "area": "a-tc-tra-paid" },
      { "id": "n-tc-004", "xy": [120, 38], "area": "a-tc-corridor" },
      { "id": "n-tc-005", "xy": [92, 21], "area": "a-tc-unpaid-e" },
      { "id": "n-tc-006", "xy": [70, 21], "area": "a-tc-tra-paid" }
    ],
    "edges": [
      { "from": "n-tc-001", "to": "n-tc-002", "kind": "walk" },
      { "from": "n-tc-001", "to": "n-tc-004", "kind": "walk" },
      { "from": "n-tc-004", "to": "n-tc-005", "kind": "walk" },
      { "from": "n-tc-002", "to": "n-tc-005", "kind": "walk" },
      { "from": "n-tc-002", "to": "n-tc-003", "kind": "gate", "gate": "g-tc-tra-in-e", "bidir": false },
      { "from": "n-tc-005", "to": "n-tc-006", "kind": "gate", "gate": "g-tc-tra-acc-e", "bidir": true }
    ]
  }
}
```

- [ ] **Step 3: 撰寫 tra-platform-b2.json**

```json
{
  "schema": "floor@1",
  "id": "tra-platform-b2",
  "slab": {
    "outline": [[-105, -75], [105, -75], [105, 75], [-105, 75]],
    "source": "tra-b2-map", "confidence": 2,
    "note": "站體矩形；R 線站體豎井在站體之外，不開洞"
  },
  "areas": [
    { "id": "a-tp-plat-1", "kind": "platform", "system": "tra",
      "polygon": [[-95, -52], [95, -52], [95, -40], [-95, -40]],
      "source": "tra-b2-map", "confidence": 2, "note": "月台帶示意；西段實為高鐵月台（簡化為 tra）" },
    { "id": "a-tp-plat-2", "kind": "platform", "system": "tra",
      "polygon": [[-95, -28], [95, -28], [95, -16], [-95, -16]],
      "source": "tra-b2-map", "confidence": 2 },
    { "id": "a-tp-plat-3", "kind": "platform", "system": "tra",
      "polygon": [[-95, -4], [95, -4], [95, 8], [-95, 8]],
      "source": "tra-b2-map", "confidence": 2 },
    { "id": "a-tp-plat-4", "kind": "platform", "system": "tra",
      "polygon": [[-95, 20], [95, 20], [95, 32], [-95, 32]],
      "source": "tra-b2-map", "confidence": 2 }
  ]
}
```

- [ ] **Step 4: validate + viewer 目視 + floor-notes**

Run: `npm run validate` — Expected: 0 errors。
Viewer：B1 出現三塊區域與閘門、B2 出現四條月台帶。

`docs/floor-notes/tra-concourse-b1.md`：

```markdown
# tra-concourse-b1 判讀筆記

- 來源：trtc-info-b1 + tra-b1-map。
- 範圍：僅建「東側局部」——東翼通廊（B3 梯/電梯降落）→ 東側非付費帶 → 東剪票口 → 付費區局部。
  西半站體（售票大廳全貌、K/Z/Y 區連通）不在 Phase 1。
- 假設（confidence 2）：東翼形狀、剪票口位於 x=80 線、付費區邊界。
- 未確定：實際剪票口名稱與位置（南/北/東西向配置）、柱網間距。
```

`docs/floor-notes/tra-platform-b2.md`：

```markdown
# tra-platform-b2 判讀筆記

- 來源：tra-b2-map。僅垂直穿越與視覺脈絡用：四條月台帶示意，無 nav。
- 簡化：西段高鐵月台以 system:"tra" 概括；軌道未畫。
- R 線站體（B3→B1 梯、電梯）位於本層樓板東緣外側，故無開洞。
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "data: B1 臺鐵穿堂局部與 B2 月台層粗版幾何

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: connectors.json + demo 起訖 + 真實資料整合測試

**Files:**
- Modify: `data/connectors.json`, `data/station.json`（加 `demo`）
- Test: `tests/route.integration.test.ts`

**Interfaces:**
- Consumes: Task 8–10 的 nav 錨點節點。
- Produces: 完整跨樓 graph；`station.demo = { start: "n-rp-003", end: "n-rc-006" }`。

- [ ] **Step 1: 寫失敗整合測試**

`tests/route.integration.test.ts`：

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

describe('真實資料 demo 路徑', () => {
  const demo = model.station.demo!;

  it('station.demo 已設定為 B4 月台中段 → B3 臺鐵轉乘閘門內', () => {
    expect(demo).toEqual({ start: 'n-rp-003', end: 'n-rc-006' });
  });

  it('一般路徑存在：電扶梯上樓、出捷運閘門、進臺鐵轉乘閘門', () => {
    const path = findPath(graph, demo.start, demo.end);
    expect(path).not.toBeNull();
    expect(path!.some((e) => e.kind === 'escalator')).toBe(true);
    expect(path!.filter((e) => e.kind === 'gate').length).toBeGreaterThanOrEqual(2);
    expect(path![path!.length - 1].to).toBe('n-rc-006');
  });

  it('無障礙路徑存在且全程 accessible（電梯 + 無障礙閘門）', () => {
    const path = findPath(graph, demo.start, demo.end, { accessibleOnly: true });
    expect(path).not.toBeNull();
    expect(path!.every((e) => e.accessible)).toBe(true);
    expect(path!.some((e) => e.kind === 'elevator')).toBe(true);
  });

  it('B4 → B1 臺鐵付費區（次要路線）可達', () => {
    const path = findPath(graph, 'n-rp-003', 'n-tc-003');
    expect(path).not.toBeNull();
  });

  it('文字步驟數量合理且首步為步行', () => {
    const steps = routeSteps(model, graph, findPath(graph, demo.start, demo.end)!);
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0]).toMatch(/^步行約 \d+ 公尺$/);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/route.integration.test.ts`
Expected: FAIL（demo 未設定、connectors 空 → 無路徑）。

- [ ] **Step 3: 撰寫 connectors.json**

```json
{
  "schema": "connectors@1",
  "connectors": [
    { "id": "c-esc-rprc-1", "kind": "escalator", "system": "trtc", "direction": "up", "accessible": false,
      "levels": [{ "floor": "mrt-r-platform-b4", "node": "n-rp-004" },
                 { "floor": "mrt-r-concourse-b3", "node": "n-rc-002" }],
      "source": "trtc-info-b4", "confidence": 2, "note": "北梯群上行" },
    { "id": "c-esc-rprc-2", "kind": "escalator", "system": "trtc", "direction": "down", "accessible": false,
      "levels": [{ "floor": "mrt-r-platform-b4", "node": "n-rp-004" },
                 { "floor": "mrt-r-concourse-b3", "node": "n-rc-002" }],
      "source": "trtc-info-b4", "confidence": 2, "note": "北梯群下行" },
    { "id": "c-esc-rprc-3", "kind": "escalator", "system": "trtc", "direction": "up", "accessible": false,
      "levels": [{ "floor": "mrt-r-platform-b4", "node": "n-rp-001" },
                 { "floor": "mrt-r-concourse-b3", "node": "n-rc-001" }],
      "source": "trtc-info-b4", "confidence": 2, "note": "南梯群上行" },
    { "id": "c-esc-rprc-4", "kind": "escalator", "system": "trtc", "direction": "down", "accessible": false,
      "levels": [{ "floor": "mrt-r-platform-b4", "node": "n-rp-001" },
                 { "floor": "mrt-r-concourse-b3", "node": "n-rc-001" }],
      "source": "trtc-info-b4", "confidence": 2, "note": "南梯群下行" },
    { "id": "c-stair-rprc-1", "kind": "stair", "system": "trtc", "direction": "both", "accessible": false,
      "levels": [{ "floor": "mrt-r-platform-b4", "node": "n-rp-001" },
                 { "floor": "mrt-r-concourse-b3", "node": "n-rc-001" }],
      "source": "trtc-info-b4", "confidence": 2 },
    { "id": "c-elv-rprc-1", "kind": "elevator", "system": "trtc", "direction": "both", "accessible": true,
      "levels": [{ "floor": "mrt-r-platform-b4", "node": "n-rp-002" },
                 { "floor": "mrt-r-concourse-b3", "node": "n-rc-010" }],
      "source": "trtc-info-b4", "confidence": 2, "note": "淡水信義線電梯1（月台南中段—大廳）" },
    { "id": "c-esc-rctc-1", "kind": "escalator", "system": "shared", "direction": "up", "accessible": false,
      "levels": [{ "floor": "mrt-r-concourse-b3", "node": "n-rc-007" },
                 { "floor": "tra-concourse-b1", "node": "n-tc-001" }],
      "source": "trtc-section", "confidence": 3, "note": "B3→B1 長電扶梯（穿越 B2 東側外）" },
    { "id": "c-esc-rctc-2", "kind": "escalator", "system": "shared", "direction": "down", "accessible": false,
      "levels": [{ "floor": "mrt-r-concourse-b3", "node": "n-rc-007" },
                 { "floor": "tra-concourse-b1", "node": "n-tc-001" }],
      "source": "trtc-section", "confidence": 3 },
    { "id": "c-elv-rctc-1", "kind": "elevator", "system": "shared", "direction": "both", "accessible": true,
      "levels": [{ "floor": "mrt-r-concourse-b3", "node": "n-rc-011" },
                 { "floor": "tra-concourse-b1", "node": "n-tc-004" }],
      "source": "trtc-section", "confidence": 2, "note": "B3↔B1 電梯（位置粗估）" }
  ]
}
```

- [ ] **Step 4: station.json 加 demo**

在 `data/station.json` 頂層（`floors` 之後）加入：

```json
"demo": { "start": "n-rp-003", "end": "n-rc-006" }
```

- [ ] **Step 5: validate + 測試通過**

Run: `npm run validate` — Expected: 0 errors（可能有 elevator/escalator accessible 警告以外的 0 warnings）。
Run: `npx vitest run tests/route.integration.test.ts` — Expected: PASS（5 tests）。
Run: `npm test` — Expected: 全 PASS。

- [ ] **Step 6: viewer 目視 demo**

Dev server：按「一般路徑」→ 藍色管線從 B4 月台中段 → 北梯群斜上 B3 → 出捷運閘門 → 臺鐵轉乘閘門內（綠球起點、紅球終點），步驟列表顯示；按「無障礙路徑」→ 改走電梯（青色豎井）與無障礙閘門。

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "data: 垂直設施 connectors + demo 起訖 + 真實資料路徑整合測試

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: 最終 QA + README + 收尾

**Files:**
- Modify: `README.md`
- Verify: 全部

- [ ] **Step 1: 全量驗證**

Run: `npm run validate && npm test && npm run typecheck`
Expected: 三者全過（validate 0 errors；vitest 全 PASS；tsc 無錯）。

- [ ] **Step 2: 瀏覽器煙霧測試**

Dev server 逐項確認並截圖留存：
1. 四層堆疊顯示、樓層 checkbox 開關、透明度滑桿有效。
2. 一般路徑與無障礙路徑 demo 均正確畫出且步驟列表合理（無障礙不含電扶梯步驟）。
3. console 無未捕捉錯誤。
4. 故意改壞 `data/station.json`（如 `"schema": "station@9"`）→ 錯誤 overlay 顯示檔名與訊息，改回後恢復。

- [ ] **Step 3: 更新 README.md**

```markdown
# 台北車站室內 3D 導航（Phase 1）

樓層 JSON 為唯一資料真相的室內 3D 導航實驗。
Phase 1 範圍：淡水信義線月台(B4) → R 線大廳(B3) → 臺鐵轉乘閘門（demo 終點），
含 B1 臺鐵穿堂局部、B2 月台層脈絡與無障礙路徑模式。

## 指令

- `npm run dev`——viewer（Vite dev server，資料熱重載）
- `npm run validate`——資料驗證（schema/參照/幾何/語意）
- `npm test`——單元與整合測試；`npm run typecheck`——TS 檢查

## 目錄

- `data/`——樓層 JSON（唯一真相）：station 索引、floors/ 每樓一檔、connectors 垂直設施
- `schemas/`——JSON Schema（draft 2020-12）；`tools/validate.mjs` 驗證器
- `refs/`——參考圖與來源清單（sources.json）；`docs/floor-notes/`——各層判讀筆記
- `src/`——viewer（three.js）：loader / builder / nav / path / ui / main
- 設計 spec：`docs/superpowers/specs/2026-07-17-taipei-station-phase1-design.md`
- 實作計畫：`docs/superpowers/plans/2026-07-17-taipei-station-phase1.md`

## 資料信心

幾何為公開示意圖描繪（confidence 1–5 標註於每個元素），非測量資料；
高程全部估計。已知疑點見 `docs/floor-notes/`。
```

- [ ] **Step 4: 檢查無殘留 stub/TODO**

Run: `git grep -n "見下表\|TODO\|FIXME" -- data src tools tests`（PowerShell 用 `git grep -n "見下表" -- data` 等分次）
Expected: 無輸出（資料檔中不得殘留計畫用的佔位字串）。

- [ ] **Step 5: 最終 commit**

```bash
git add -A
git commit -m "docs: README 與 Phase 1 收尾 QA

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Spec 覆蓋對照（自查）

| Spec 需求 | Task |
|---|---|
| 成功標準 1（validate 全過） | 2, 7–11, 12 |
| 成功標準 2（四層 3D + 開關/透明度） | 5, 7, 12 |
| 成功標準 3（demo 路徑 + 文字步驟） | 4, 11, 12 |
| 成功標準 4（無障礙模式） | 4, 9, 11, 12 |
| 成功標準 5（vitest） | 2, 3, 4, 5, 11 |
| §3 座標框架 / §4 樓層定義 | 7（station.json）、Global Constraints |
| §5.1–5.5 資料架構與 ID 慣例 | 2（schemas/validator）、6（sources）、7–11（資料） |
| §6 viewer 模組 | 3（loader）、5（builder/path）、4（nav）、7（ui/main） |
| §7 驗證與測試 | 2（validator+tests）、11（整合測試） |
| §8 工作流（data-conventions、floor-notes） | 6、8–10 |
| §9 待考證追蹤 | 8–10 floor-notes |
