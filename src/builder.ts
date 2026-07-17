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
