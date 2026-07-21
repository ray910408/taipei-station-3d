import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { StationModel, Vec2 } from './types';
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

// connectors：斜坡（stair/escalator）與豎井（elevator）。
// offsetY 供爆炸圖重建：各樓層錨點 y 加位移，豎井/斜坡自然拉伸。
export function buildConnectorsGroup(
  model: StationModel,
  offsetY: (floorId: string) => number = () => 0,
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
      const a = nodePos.get(c.levels[i].node);
      const b = nodePos.get(c.levels[i + 1].node);
      if (!a || !b) continue;
      const c2 = c.kind === 'elevator' ? M.connector.elevator : M.connector.stair;
      let mesh: THREE.Mesh;
      if (c.kind === 'elevator') {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(2, b.y - a.y, 2), mat(c2.color, c2.opacity));
        mesh.position.set(a.x, (a.y + b.y) / 2, a.z);
      } else {
        const len = a.distanceTo(b);
        mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.25, 1.4), mat(c2.color, c2.opacity));
        mesh.position.copy(a.clone().add(b).multiplyScalar(0.5));
        mesh.lookAt(b);
        mesh.rotateY(Math.PI / 2); // BoxGeometry 長軸為 x，lookAt 對齊 z 後轉回
      }
      // 同錨點梯群純視覺錯開，nav 資料不動
      const lateral = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x);
      if (lateral.length() < 1e-6) lateral.set(1, 0, 0);
      else lateral.normalize();
      mesh.position.addScaledVector(lateral, offset);
      mesh.userData = { kind: `connector-${c.kind}`, connectorId: c.id };
      connGroup.add(mesh);
    }
  }
  applyShadowFlags(connGroup);
  return connGroup;
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

    // 外殼：沿 slab 輪廓的半透明立面
    const shellPts = [...floor.slab.outline, floor.slab.outline[0]];
    for (let i = 0; i < shellPts.length - 1; i++) {
      const a = toWorld(shellPts[i], meta.elevation);
      const b = toWorld(shellPts[i + 1], meta.elevation);
      const len = a.distanceTo(b);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(len, meta.height, 0.05), mat(M.shell.color, M.shell.opacity));
      wall.position.copy(a.clone().add(b).multiplyScalar(0.5));
      wall.position.y = meta.elevation + meta.height / 2;
      wall.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
      wall.userData.kind = 'shell';
      g.add(wall);
    }

    for (const [i, a] of (floor.areas ?? []).entries()) {
      // 每個 area 疊加微小高度差，避免重疊區域 z-fight（如 B3 臺鐵轉乘區疊在非付費區上）
      const sunk = a.kind === 'track' ? -1.1 : 0.01 + i * 0.01;
      // 圖 2 構圖：月台＝系統色淡化錨點（去塑膠 T3）；系統未知回退 kind 色
      const sys = model.station.systems[a.system]?.color;
      const base = a.kind === 'platform' && sys
        ? mixHex(sys, '#ffffff', THEME.materials.platformWhiten) : M.area[a.kind];
      g.add(extrudeMesh(
        a.polygon, [], 0.05, meta.elevation + sunk, mat(base, M.areaOpacity), a.kind));
    }
    for (const u of floor.units ?? []) {
      const u2 = M.unit[u.kind];
      g.add(extrudeMesh(
        u.polygon, [], u.height, meta.elevation, matPair(u2.color, u2.opacity), `unit-${u.kind}`));
    }
    const edgeLine = buildUnitEdges(floor.units ?? [], meta.elevation);
    if (edgeLine) g.add(edgeLine);
    for (const w of floor.walls ?? []) {
      for (let i = 0; i < w.polyline.length - 1; i++) {
        const a = toWorld(w.polyline[i], meta.elevation);
        const b = toWorld(w.polyline[i + 1], meta.elevation);
        const len = a.distanceTo(b);
        const wallMesh = new THREE.Mesh(
          new THREE.BoxGeometry(len, w.height, w.width ?? 0.3), mat(M.wall.color, M.wall.opacity));
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
    root.add(g);
  }

  root.add(buildConnectorsGroup(model));
  applyShadowFlags(root);
  return root;
}

/** 依 userData.kind 佈 shadow 旗標——json/glb 兩軌與每幀重建的 connectors 共用。 */
export function applyShadowFlags(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const kind = typeof mesh.userData.kind === 'string' ? mesh.userData.kind
      : typeof mesh.parent?.userData.kind === 'string' ? mesh.parent.userData.kind : null;
    if (kind === null) return;
    if (kind === 'slab') { mesh.castShadow = true; mesh.receiveShadow = true; }
    else if (kind === 'wall' || kind.startsWith('unit-') || kind.startsWith('connector-')) {
      mesh.castShadow = true;
    }
  });
}
