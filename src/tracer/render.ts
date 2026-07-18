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
