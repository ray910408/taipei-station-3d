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
