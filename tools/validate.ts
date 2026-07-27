// 樓層 JSON 資料驗證：schema、參照完整性、ID 慣例、幾何 sanity、語意規則。
// 純函式庫，零頂層副作用——vite.config.ts 會經 save-handler 間接載入本檔，
// 任何頂層動作都會在每次 vite dev/build 載入設定檔時觸發。CLI 進入點在 validate-cli.ts。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AjvModule from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import type { ConnectorsDoc, FloorDoc, Provenance, SourcesDoc, StationDoc, Vec2 } from '../src/types';
import { pointInPolygon, ringArea } from '../src/geometry';

// ajv 2020 進入點在 CJS/ESM 互通下可能包一層 default
const Ajv2020 = (AjvModule as unknown as { default?: typeof AjvModule }).default ?? AjvModule;
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schemas');

/** 磁碟上的資料是待驗對象——先以宣告型別承接，正確性由本檔的 schema 檢查負責。 */
export interface RepoDocs {
  station: StationDoc;
  floors: Map<string, FloorDoc>;
  connectors: ConnectorsDoc;
  sources: SourcesDoc;
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

export function loadRepoDocs(rootDir: string): RepoDocs {
  const station = readJson<StationDoc>(path.join(rootDir, 'data', 'station.json'));
  const floors = new Map<string, FloorDoc>();
  for (const f of station.floors ?? []) {
    floors.set(f.id, readJson<FloorDoc>(path.join(rootDir, 'data', f.file)));
  }
  const connectors = readJson<ConnectorsDoc>(path.join(rootDir, 'data', 'connectors.json'));
  const sources = readJson<SourcesDoc>(path.join(rootDir, 'refs', 'sources.json'));
  return { station, floors, connectors, sources };
}

type Winding = 'ccw' | 'cw';

function* iterRings(floor: FloorDoc): Generator<[string, Vec2[], Winding]> {
  yield ['slab.outline', floor.slab.outline, 'ccw'];
  for (const [hi, h] of (floor.slab.holes ?? []).entries()) yield [`slab.holes[${hi}]`, h, 'cw'];
  for (const a of floor.areas ?? []) yield [`area ${a.id}`, a.polygon, 'ccw'];
  for (const u of floor.units ?? []) yield [`unit ${u.id}`, u.polygon, 'ccw'];
}

export function validateDocs(docs: RepoDocs): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { station, floors, connectors, sources } = docs;

  // 1. Schema 驗證
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const schemas = {
    station: ajv.compile(readJson<object>(path.join(SCHEMA_DIR, 'station.schema.json'))),
    floor: ajv.compile(readJson<object>(path.join(SCHEMA_DIR, 'floor.schema.json'))),
    connectors: ajv.compile(readJson<object>(path.join(SCHEMA_DIR, 'connectors.schema.json'))),
    sources: ajv.compile(readJson<object>(path.join(SCHEMA_DIR, 'sources.schema.json'))),
  };
  const schemaCheck = (validate: ValidateFunction, doc: unknown, label: string): void => {
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
  const sourceHasCalib = new Set(sources.sources.filter((s) => s.calibration).map((s) => s.id));
  const systemIds = new Set([...Object.keys(station.systems), 'shared']);
  const floorMeta = new Map(station.floors.map((f) => [f.id, f]));
  const allIds = new Map<string, string>(); // id -> 所在描述，全域唯一檢查

  const claimId = (id: string, where: string): void => {
    if (allIds.has(id)) errors.push(`[id] ${id} 重複（${allIds.get(id)} 與 ${where}）`);
    else allIds.set(id, where);
  };

  const checkProv = (obj: Provenance, where: string): void => {
    if (!sourceIds.has(obj.source)) errors.push(`[ref] ${where} source "${obj.source}" 不存在於 refs/sources.json`);
    else if (obj.status === 'traced' && !sourceHasCalib.has(obj.source))
      warnings.push(`[sem] ${where} status=traced 但來源 "${obj.source}" 無 calibration`);
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
      // walls/units 的 schema 無 system 欄位——'in' 收斂後對它們恆為 undefined，與原本行為相同
      const system = 'system' in el ? el.system : undefined;
      if (system !== undefined && !systemIds.has(system))
        errors.push(`[ref] ${where} ${el.id} system "${system}" 不在 station.systems`);
    }

    // 幾何 sanity
    for (const [label, ring, wind] of iterRings(floor)) {
      if (ring.some((p) => p.some((v) => !Number.isFinite(v) || Math.abs(v) >= 500)))
        errors.push(`[geom] ${where} ${label} 座標非有限值或超出 ±500`);
      const [fx, fy] = ring[0];
      const [lx, ly] = ring[ring.length - 1];
      if (fx === lx && fy === ly) errors.push(`[geom] ${where} ${label} 首尾點重複（應為開環）`);
      if (ring.some((p, i) => i > 0 && p[0] === ring[i - 1][0] && p[1] === ring[i - 1][1]))
        errors.push(`[geom] ${where} ${label} 相鄰重複點（零長邊）`);
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
      if (g.connects[0] === g.connects[1])
        errors.push(`[sem] ${where} ${g.id} connects 兩側不得相同`);
      const paid = areaById.get(g.connects[0]);
      const unpaid = areaById.get(g.connects[1]);
      if (paid && unpaid && (paid.kind !== 'paid' || unpaid.kind !== 'unpaid'))
        errors.push(`[sem] ${where} ${g.id} connects 需 [付費側, 非付費側]`);
    }
    const nodeById = new Map();
    for (const n of floor.nav?.nodes ?? []) {
      claimId(n.id, where);
      nodeById.set(n.id, n);
      const m = /^n-([a-z]{2})-/.exec(n.id);
      if (!m || m[1] !== short) errors.push(`[id] ${where} ${n.id} 前綴應為 n-${short}-`);
      const inOutline = pointInPolygon(n.xy, floor.slab.outline);
      const inHole = (floor.slab.holes ?? []).some((h) => pointInPolygon(n.xy, h));
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
          const fromPaid = pointInPolygon(fromN.xy, paidRing);
          const toUnpaid = pointInPolygon(toN.xy, unpaidRing);
          const fromUnpaid = pointInPolygon(fromN.xy, unpaidRing);
          const toPaid = pointInPolygon(toN.xy, paidRing);
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

  return { errors, warnings };
}

