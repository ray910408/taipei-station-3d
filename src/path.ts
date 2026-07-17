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
