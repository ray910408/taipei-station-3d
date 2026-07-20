import * as THREE from 'three';
import type { GraphEdge, NavGraph } from './nav';
import { toWorld } from './builder';
import { THEME } from './theme';

export function buildRouteObject(
  graph: NavGraph,
  edges: GraphEdge[],
  offsetY: (floorId: string) => number = () => 0,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'route';
  if (edges.length === 0) return group;

  const ids = [edges[0].from, ...edges.map((e) => e.to)];
  const pts = ids.map((id) => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z + offsetY(n.floor) + 1.2); // 浮在（可能爆炸位移後的）樓面上方
  });

  const curve = new THREE.CatmullRomCurve3(pts);
  const tube = new THREE.Mesh(
    new THREE.TubeGeometry(curve, Math.max(16, pts.length * 8), THEME.route.radius, 8, false),
    new THREE.MeshBasicMaterial({ color: THEME.route.color, toneMapped: false }),
  );
  group.add(tube);

  // 水滴 pin：球頭＋倒錐尾（Google 風）；隨 route 每次重建、照常走 disposeDeep
  const pin = (p: THREE.Vector3, color: string): THREE.Group => {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.8, 20), m);
    tail.rotation.x = Math.PI; // 尖端朝下指樓面
    tail.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 16), m);
    head.position.y = 2.2;
    g.add(tail, head);
    g.position.copy(p);
    return g;
  };
  group.add(pin(pts[0], THEME.route.pinStart));
  group.add(pin(pts[pts.length - 1], THEME.route.pinEnd));
  return group;
}
