import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StationModel, Vec2, NavNode, NavEdge } from './types';
import { THEME, mixHex } from './theme';

export function toWorld(xy: Vec2, y: number): THREE.Vector3 {
  return new THREE.Vector3(xy[0], y, -xy[1]);
}

function ringToShape(outline: Vec2[], holes: Vec2[][] = []): THREE.Shape {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  return shape;
}

// shape 的 (x,y) 即 local 座標；extrude 沿 +z 再 rotateX(-90°) → +z 變 three 的 +y（向上）、
// (x, y, 0) → (x, 0, -y)，與 toWorld 一致。
function extrudeMesh(
  outline: Vec2[], holes: Vec2[][], depth: number, baseY: number,
  material: THREE.Material | THREE.Material[], kind: string,
): THREE.Mesh {
  const geo = new THREE.ExtrudeGeometry(ringToShape(outline, holes), { depth, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = baseY;
  mesh.userData.kind = kind;
  return mesh;
}

/** BoxGeometry UV 0..1 → 公尺：共用面板紋理在不同長度的牆上接縫間距才一致。
 *  端面/頂面（0.4m 窄條）跟著長邊比例被拉伸，可忽略。 */
function scaleWallUV(geo: THREE.BoxGeometry, len: number, height: number): void {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * height);
}

function mat(color: string, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: THEME.materials.roughness, metalness: 0,
    transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: THREE.DoubleSide,
  });
}

/** 頂亮側暗雙材質 [cap, side]：ExtrudeGeometry 蓋面 materialIndex 0、側面 1（three 原生分組）。 */
function matPair(color: string, opacity: number): [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  const side = new THREE.Color(color).multiplyScalar(THEME.body.sideDarken);
  return [mat(color, opacity), mat(`#${side.getHexString()}`, opacity)];
}

/** 全樓層 units 描邊合併為一個 LineSegments（每層 +1 draw call）；stair-void 半透明井不描。 */
function buildUnitEdges(units: { kind: string; polygon: Vec2[]; height: number }[], elevation: number): THREE.LineSegments | null {
  const parts: THREE.BufferGeometry[] = [];
  for (const u of units) {
    if (u.kind === 'stair-void') continue;
    const geo = new THREE.ExtrudeGeometry(ringToShape(u.polygon), { depth: u.height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const edges = new THREE.EdgesGeometry(geo, 20); // 20°：略過近共面碎邊
    edges.translate(0, elevation, 0);
    geo.dispose();
    parts.push(edges);
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const line = new THREE.LineSegments(merged, new THREE.LineBasicMaterial({
    color: THEME.body.edge, transparent: true, opacity: THEME.body.edgeOpacity,
  }));
  line.userData.kind = 'edges';
  return line;
}

/** slab 外框＋各 area 邊界描邊，合併為一條亮色 LineSegments（每層 +1 draw call）。
 *  用 2D ring→EdgesGeometry(平面)：只取封閉外框線，不描填充面。 */
function ringEdges(ring: Vec2[], elevation: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(ringToShape(ring), { depth: 0.001, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  const e = new THREE.EdgesGeometry(geo, 1); // 1°：薄片保留箱體全稜線（上下輪廓＋豎邊，每矩形 12 邊）
  e.translate(0, elevation + 0.02, 0);
  geo.dispose();
  return e;
}

export function buildFloorEdges(
  slab: { outline: Vec2[]; holes?: Vec2[][] }, areas: { polygon: Vec2[] }[], elevation: number,
): THREE.LineSegments | null {
  const parts = [ringEdges(slab.outline, elevation), ...areas.map((a) => ringEdges(a.polygon, elevation))];
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const line = new THREE.LineSegments(merged, new THREE.LineBasicMaterial({
    color: THEME.body.edge, transparent: true, opacity: THEME.body.edgeOpacity,
  }));
  line.userData.kind = 'floor-edges';
  return line;
}

/** 節點相鄰 walk 邊平均單位方向（local xy）；無鄰邊回 null。手扶梯合成斜向用。 */
export function connectorRunDir(nodes: NavNode[], edges: NavEdge[], nodeId: string): Vec2 | null {
  const pos = new Map(nodes.map((n) => [n.id, n.xy]));
  const here = pos.get(nodeId);
  if (!here) return null;
  let dx = 0, dy = 0;
  for (const e of edges) {
    const other = e.from === nodeId ? pos.get(e.to) : e.to === nodeId ? pos.get(e.from) : undefined;
    if (!other) continue;
    dx += other[0] - here[0];
    dy += other[1] - here[1];
  }
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? null : [dx / len, dy / len];
}

/** 軌道鋼軌：細長四邊形軌道溝取中線（最長邊定行進向、與對邊端點平均），
 *  鋪兩根標準軌距（1.435m）鋼軌。非四邊形的軌道溝略過——目前資料全為四邊形。 */
function railGeometries(quad: Vec2[], topY: number): THREE.BufferGeometry[] {
  let i0 = 0, best = -1;
  for (let i = 0; i < 4; i++) {
    const len = Math.hypot(quad[(i + 1) % 4][0] - quad[i][0], quad[(i + 1) % 4][1] - quad[i][1]);
    if (len > best) { best = len; i0 = i; }
  }
  const a: Vec2 = [(quad[i0][0] + quad[(i0 + 3) % 4][0]) / 2, (quad[i0][1] + quad[(i0 + 3) % 4][1]) / 2];
  const b: Vec2 = [(quad[(i0 + 1) % 4][0] + quad[(i0 + 2) % 4][0]) / 2, (quad[(i0 + 1) % 4][1] + quad[(i0 + 2) % 4][1]) / 2];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [];
  const nx = -dy / len, ny = dx / len;
  const out: THREE.BufferGeometry[] = [];
  const GAUGE = 1.435; // 標準軌距——量的是兩軌「內側面」間距，非中心距
  const RAIL_WIDTH = 0.07; // 單軌斷面寬（BoxGeometry z 尺寸）
  const RAIL_OFFSET = (GAUGE + RAIL_WIDTH) / 2; // 內側面基準要外推半個軌寬，才是中心偏移
  for (const s of [-RAIL_OFFSET, RAIL_OFFSET]) {
    const g = new THREE.BoxGeometry(len, 0.12, RAIL_WIDTH);
    g.rotateY(Math.atan2(dy, dx));
    g.translate((a[0] + b[0]) / 2 + nx * s, topY + 0.06, -((a[1] + b[1]) / 2 + ny * s));
    out.push(g);
  }
  return out;
}

function distPtLine(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / Math.hypot(dx, dy);
}

/** 月台邊緣警戒帶：月台長邊兩端點都貼著（<1.2m）某條軌道長邊時，取兩者在月台邊參數軸上的
 *  重疊區間鋪帶（裁掉不重疊/僅端點擦邊的部分，重疊 <1m 略過），避免共線但不重疊的邊誤鋪、
 *  或部分重疊的邊鋪過頭。同一月台邊可能鄰接多條軌道邊，逐條軌道邊各鋪各的重疊段。
 *  內縮方向以月台質心判定。B4 實測鄰接誤差 <0.1m，1.2m 門檻很寬裕。 */
function platformEdgeStrips(
  plats: { polygon: Vec2[]; topY: number }[], trackEdges: [Vec2, Vec2][],
): THREE.BufferGeometry[] {
  const E = THEME.materials.platformEdge;
  const out: THREE.BufferGeometry[] = [];
  for (const p of plats) {
    const cx = p.polygon.reduce((s, q) => s + q[0], 0) / p.polygon.length;
    const cy = p.polygon.reduce((s, q) => s + q[1], 0) / p.polygon.length;
    for (let i = 0; i < p.polygon.length; i++) {
      const a = p.polygon[i], b = p.polygon[(i + 1) % p.polygon.length];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 10) continue;
      let nx = -dy / len, ny = dx / len; // 邊法向，翻向月台內側（質心側）
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
      for (const [c, e] of trackEdges) {
        if (!(distPtLine(a, c, e) < 1.2 && distPtLine(b, c, e) < 1.2)) continue;
        // 軌道端點投影到月台邊參數軸（0..len）；ring 繞向不保證同向，故 tLo/tHi 要 min/max 正規化
        const tc = ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy) / len;
        const te = ((e[0] - a[0]) * dx + (e[1] - a[1]) * dy) / len;
        const tLo = Math.max(0, Math.min(tc, te));
        const tHi = Math.min(len, Math.max(tc, te));
        const overlap = tHi - tLo;
        if (overlap < 1) continue; // 端點擦邊，重疊太短不鋪
        const tMid = (tLo + tHi) / 2;
        const scx = a[0] + (dx * tMid) / len, scy = a[1] + (dy * tMid) / len; // 重疊段中點
        const g = new THREE.BoxGeometry(overlap, 0.02, E.width);
        g.rotateY(Math.atan2(dy, dx));
        g.translate(scx + nx * E.inset, p.topY + 0.015, -(scy + ny * E.inset));
        out.push(g);
      }
    }
  }
  return out;
}

/** 樓梯/手扶梯寫實幾何：水平踏步＋斜底座，手扶梯另加側裙帶與上下出入口平台，
 *  全部合併成單一 geometry——「一座＝一顆 mesh」的結構不變，調暗/陰影/GLB parity 都不受影響。
 *  local 座標：x＝0..runH 沿水平行進向、y＝0..rise、z 置中；建完 rotateY 對齊再平移到低端。 */
function runGeometry(lo: THREE.Vector3, hi: THREE.Vector3, kind: 'stair' | 'escalator'): THREE.BufferGeometry {
  const W = kind === 'escalator' ? 1.2 : 1.4;
  const dx = hi.x - lo.x, dz = hi.z - lo.z;
  const runH = Math.hypot(dx, dz);
  const rise = hi.y - lo.y;
  const slant = Math.hypot(runH, rise);
  const theta = Math.atan2(rise, Math.max(runH, 1e-6));
  const parts: THREE.BufferGeometry[] = [];
  const box = (sx: number, sy: number, sz: number, cx: number, cy: number, cz: number, rotZ = 0): void => {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    if (rotZ) g.rotateZ(rotZ);
    g.translate(cx, cy, cz);
    parts.push(g);
  };
  box(slant, 0.18, W, runH / 2, rise / 2 - 0.14, 0, theta); // 梯級下的斜封板
  // 水平踏步：階高鎖 ~0.16m，踏深隨 run 均分；手扶梯踏步內縮讓出側裙帶
  const stepW = kind === 'escalator' ? W - 0.24 : W;
  const n = Math.max(2, Math.round(rise / 0.16));
  const treadD = runH / n, stepH = rise / n;
  for (let i = 0; i < n; i++)
    box(treadD, 0.06, stepW, (i + 0.5) * treadD, (i + 1) * stepH - 0.03, 0);
  if (kind === 'escalator') {
    for (const s of [-1, 1])
      box(slant * 0.94, 0.72, 0.08, runH / 2, rise / 2 + 0.52, s * (W / 2 - 0.04), theta); // 側裙帶
    box(0.7, 0.06, W, 0.35, 0.03, 0); // 下出入口平台
    box(0.7, 0.06, W, runH - 0.35, rise + 0.03, 0); // 上出入口平台
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  merged.translate(-runH / 2, -rise / 2, 0); // 原點移到中點：mesh.position 維持「位移後中點」的既有契約
  merged.rotateY(Math.atan2(-dz, dx)); // local +x → 水平行進向
  return merged;
}

// connectors：斜坡（stair/escalator）與豎井（elevator）。
// offsetY 供爆炸圖重建：各樓層錨點 y 加位移，豎井/斜坡自然拉伸。
export function buildConnectorsGroup(
  model: StationModel,
  offsetY: (floorId: string) => number = () => 0,
  detail = true, // 爆炸動畫逐幀重建走 false（簡化斜板）——踏步合併幾何每幀重算會拖慢弱手機
): THREE.Group {
  const M = THEME.materials;
  const connGroup = new THREE.Group();
  connGroup.name = 'connectors';
  const nodePos = new Map<string, THREE.Vector3>();
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    for (const n of floor?.nav?.nodes ?? [])
      nodePos.set(n.id, toWorld(n.xy, meta.elevation + offsetY(meta.id)));
  }
  const SPACING = 1.6;
  const groups = new Map<string, StationModel['connectors']>();
  for (const c of model.connectors) {
    const key = c.levels.slice(0, 2).map((level) => level.node).sort().join('|');
    const members = groups.get(key) ?? [];
    members.push(c);
    groups.set(key, members);
  }
  for (const c of model.connectors) {
    const key = c.levels.slice(0, 2).map((level) => level.node).sort().join('|');
    const members = groups.get(key)!;
    const offset = (members.indexOf(c) - (members.length - 1) / 2) * SPACING;
    for (let i = 0; i < c.levels.length - 1; i++) {
      const a0 = nodePos.get(c.levels[i].node);
      const b0 = nodePos.get(c.levels[i + 1].node);
      if (!a0 || !b0) continue;
      // a0/b0 是 nodePos map 內共用的 Vector3 參照（同錨點梯群共用）；clone 後才可安全位移，否則污染 map
      const a = a0.clone();
      const b = b0.clone();
      // 手扶梯/樓梯合成斜向：把較高端沿其樓層相鄰走道方向平移，避免上下端重合退化成垂直棒
      // ponytail: 合成斜向近似, 真實方位需手描 connectors
      if (c.kind !== 'elevator') {
        const hi = a.y >= b.y ? a : b;
        const hiLevel = a.y >= b.y ? c.levels[i] : c.levels[i + 1];
        const hf = model.floors.get(hiLevel.floor);
        const dir = connectorRunDir(hf?.nav?.nodes ?? [], hf?.nav?.edges ?? [], hiLevel.node);
        const run = THEME.body.escalatorRun;
        if (dir) hi.add(new THREE.Vector3(dir[0] * run, 0, -dir[1] * run));
        else hi.x += run; // 回退：沿 +x（樓層長軸近似）
      }
      const c2 = M.connector[c.kind]; // stair / escalator / elevator 各自材質
      let mesh: THREE.Mesh;
      if (c.kind === 'elevator') {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, Math.abs(b.y - a.y), 16), mat(c2.color, c2.opacity));
        mesh.position.set(a.x, (a.y + b.y) / 2, a.z);
      } else if (!detail) {
        const len = a.distanceTo(b);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 1.4), mat(c2.color, c2.opacity));
        mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
        mesh.lookAt(b);
        mesh.rotateY(Math.PI / 2); // BoxGeometry 長軸為 x，lookAt 對齊 z 後轉回
      } else {
        const lo = a.y <= b.y ? a : b;
        const hi = a.y <= b.y ? b : a;
        mesh = new THREE.Mesh(runGeometry(lo, hi, c.kind), mat(c2.color, c2.opacity));
        mesh.position.copy(lo.clone().add(hi).multiplyScalar(0.5));
      }
      // 同錨點梯群純視覺錯開，nav 資料不動
      const lateral = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x);
      if (lateral.length() < 1e-6) lateral.set(1, 0, 0);
      else lateral.normalize();
      mesh.position.addScaledVector(lateral, offset);
      mesh.userData = { kind: `connector-${c.kind}`, connectorId: c.id,
        floors: [c.levels[i].floor, c.levels[i + 1].floor] }; // 聚焦調暗依據（問題6）
      if (c.kind === 'escalator') {
        const up = b.y >= a.y ? b : a; // 行進終點：direction up→朝高端
        const lo = b.y >= a.y ? a : b;
        const to = c.direction === 'down' ? lo : up;
        const from = c.direction === 'down' ? up : lo;
        const arrow = new THREE.Mesh(
          new THREE.ConeGeometry(0.5, 1.2, 12),
          new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, metalness: 0 }));
        arrow.position.copy(from.clone().lerp(to, 0.5));
        arrow.position.addScaledVector(lateral, offset);
        arrow.lookAt(to);
        arrow.rotateX(Math.PI / 2); // Cone 尖端 +y → 對齊行進方向
        arrow.userData.kind = 'connector-arrow';
        arrow.userData.floors = [c.levels[i].floor, c.levels[i + 1].floor];
        connGroup.add(arrow);
      }
      connGroup.add(mesh);
    }
  }
  applyShadowFlags(connGroup);
  return connGroup;
}

/** 付費區表現：半透明染 overlay（貼在付費地面略上）＋虛線邊界框。 */
export function buildPaidOverlay(ring: Vec2[], elevation: number): THREE.Object3D[] {
  const P = THEME.materials.paidOverlay;
  const y = elevation + 0.1; // 付費 area 在 ~elevation+0.05；overlay 疊其上
  const overlay = extrudeMesh(ring, [], 0.02, y,
    new THREE.MeshBasicMaterial({ color: P.color, transparent: true, opacity: P.opacity, depthWrite: false }),
    'paid-overlay');
  const pts = [...ring, ring[0]].map(([x, z]) => toWorld([x, z], y + 0.04));
  const dash = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineDashedMaterial({ color: P.dash, dashSize: 1.2, gapSize: 0.8, transparent: true }));
  dash.computeLineDistances();
  dash.userData.kind = 'paid-dash';
  return [overlay, dash];
}

export function buildStationGroup(model: StationModel): THREE.Group {
  const M = THEME.materials;
  const root = new THREE.Group();
  root.name = 'station';

  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor) continue;
    const g = new THREE.Group();
    g.name = meta.id;
    g.userData = { floorId: meta.id, kind: 'floor' };

    // slab：厚 0.3 m、頂面在 elevation（頂亮側暗）
    g.add(extrudeMesh(floor.slab.outline, floor.slab.holes ?? [], 0.3, meta.elevation - 0.3,
      matPair(M.slab.color, M.slab.opacity), 'slab'));

    // 程序化周界牆帶：沿 slab 外框逐段生實心矮牆（massHeight）——非可走周界「fake wall」，nav 中隱藏
    const shellPts = [...floor.slab.outline, floor.slab.outline[0]];
    for (let i = 0; i < shellPts.length - 1; i++) {
      const a = toWorld(shellPts[i], meta.elevation);
      const b = toWorld(shellPts[i + 1], meta.elevation);
      const len = a.distanceTo(b);
      const shellGeo = new THREE.BoxGeometry(len, THEME.body.massHeight, 0.4);
      scaleWallUV(shellGeo, len, THEME.body.massHeight);
      const wall = new THREE.Mesh(shellGeo, mat(M.shell.color, M.shell.opacity));
      wall.position.copy(a.clone().add(b).multiplyScalar(0.5));
      wall.position.y = meta.elevation + THEME.body.massHeight / 2;
      wall.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      wall.userData.kind = 'shell';
      g.add(wall);
    }

    const railParts: THREE.BufferGeometry[] = [];
    const trackEdges: [Vec2, Vec2][] = [];
    const plats: { polygon: Vec2[]; topY: number }[] = [];
    for (const [i, a] of (floor.areas ?? []).entries()) {
      // 每個 area 疊加微小高度差，避免重疊區域 z-fight（如 B3 臺鐵轉乘區疊在非付費區上）
      const sunk = a.kind === 'track' ? -1.1 : 0.01 + i * 0.01;
      // 圖 2 構圖：月台＝系統色淡化錨點（去塑膠 T3）；系統未知回退 kind 色
      const sys = model.station.systems[a.system]?.color;
      const base = a.kind === 'platform' && sys
        ? mixHex(sys, '#ffffff', THEME.materials.platformWhiten) : M.area[a.kind];
      g.add(extrudeMesh(
        a.polygon, [], 0.05, meta.elevation + sunk, mat(base, M.areaOpacity), a.kind));
      if (a.kind === 'track' && a.polygon.length === 4) {
        railParts.push(...railGeometries(a.polygon, meta.elevation + sunk + 0.05));
        for (let j = 0; j < 4; j++) { // 供警戒帶鄰接判定的軌道長邊
          const c = a.polygon[j], e = a.polygon[(j + 1) % 4];
          if (Math.hypot(e[0] - c[0], e[1] - c[1]) >= 10) trackEdges.push([c, e]);
        }
      }
      if (a.kind === 'platform') plats.push({ polygon: a.polygon, topY: meta.elevation + sunk + 0.05 });
      if (a.kind === 'paid') for (const o of buildPaidOverlay(a.polygon, meta.elevation)) g.add(o);
    }
    if (railParts.length) { // 全樓層鋼軌合併單 mesh（每層 +1 draw call）
      const merged = mergeGeometries(railParts);
      for (const p of railParts) p.dispose();
      const rails = new THREE.Mesh(merged, mat(M.rail.color, 1));
      rails.userData.kind = 'rail';
      g.add(rails);
    }
    const stripParts = platformEdgeStrips(plats, trackEdges);
    if (stripParts.length) { // 全樓層警戒帶合併單 mesh（每層 +1 draw call）
      const merged = mergeGeometries(stripParts);
      for (const p of stripParts) p.dispose();
      const strips = new THREE.Mesh(merged, mat(M.platformEdge.color, 1));
      strips.userData.kind = 'platform-edge';
      g.add(strips);
    }
    for (const u of floor.units ?? []) {
      const u2 = M.unit[u.kind];
      g.add(extrudeMesh(
        u.polygon, [], u.height, meta.elevation, matPair(u2.color, u2.opacity), `unit-${u.kind}`));
    }
    const edgeLine = buildUnitEdges(floor.units ?? [], meta.elevation);
    if (edgeLine) g.add(edgeLine);
    const floorEdge = buildFloorEdges(floor.slab, floor.areas ?? [], meta.elevation);
    if (floorEdge) g.add(floorEdge);
    for (const w of floor.walls ?? []) {
      for (let i = 0; i < w.polyline.length - 1; i++) {
        const a = toWorld(w.polyline[i], meta.elevation);
        const b = toWorld(w.polyline[i + 1], meta.elevation);
        const len = a.distanceTo(b);
        const wallGeo = new THREE.BoxGeometry(len, w.height, w.width ?? 0.3);
        scaleWallUV(wallGeo, len, w.height);
        const wallMesh = new THREE.Mesh(wallGeo, mat(M.wall.color, M.wall.opacity));
        wallMesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
        wallMesh.position.y = meta.elevation + w.height / 2;
        wallMesh.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
        wallMesh.userData.kind = 'wall';
        g.add(wallMesh);
      }
    }
    for (const gate of floor.gates ?? []) {
      const color = gate.accessible ? M.gate.accessible : M.gate.standard;
      const [p1, p2] = gate.line.map((p) => toWorld(p, meta.elevation));
      const yaw = Math.atan2(-(p2.z - p1.z), p2.x - p1.x);
      for (const p of [p1, p2]) {
        // 閘門櫃體：x 沿閘門線、z 沿通行向拉長——比等寬方柱更接近實物
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, 1.3), mat(color, 1));
        post.position.copy(p);
        post.position.y = meta.elevation + 0.5;
        post.rotation.y = yaw;
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
    root.add(g);
  }

  root.add(buildConnectorsGroup(model));
  applyShadowFlags(root);
  return root;
}

/** 依 userData.kind 佈 shadow 旗標——buildStationGroup 與每幀重建的 connectors 共用。
 *  kind 不在自己身上就往 parent 找：export:glb 會把雙材質 mesh 拆成子 primitive，
 *  kind 因此落在 parent（見 tests/glb-roundtrip.test.ts）。 */
export function applyShadowFlags(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const kind = typeof mesh.userData.kind === 'string' ? mesh.userData.kind
      : typeof mesh.parent?.userData.kind === 'string' ? mesh.parent.userData.kind : null;
    if (kind === null) return;
    if (kind === 'slab') { mesh.castShadow = true; mesh.receiveShadow = true; }
    else if (kind === 'wall' || kind === 'shell' || kind.startsWith('unit-') || kind.startsWith('connector-')) {
      mesh.castShadow = true;
    }
  });
}
