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
