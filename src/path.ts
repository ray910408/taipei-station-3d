import * as THREE from 'three';
import type { GraphEdge, NavGraph } from './nav';
import { toWorld } from './builder';
import { THEME } from './theme';

// 箭頭紋理：module 級快取永不釋放（同 icons.ts matCache 慣例）；
// vitest 為 node 環境無 canvas → null，材質退純色
let arrowTex: THREE.CanvasTexture | null = null;
function routeArrowTexture(): THREE.CanvasTexture | null {
  if (arrowTex || typeof document === 'undefined') return arrowTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = THEME.route.color;
  ctx.fillRect(0, 0, 64, 32);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); // chevron 指向 +u（管軸前進方向）
  ctx.moveTo(22, 4);
  ctx.lineTo(44, 16);
  ctx.lineTo(22, 28);
  ctx.lineTo(30, 16);
  ctx.closePath();
  ctx.fill();
  arrowTex = new THREE.CanvasTexture(c);
  arrowTex.colorSpace = THREE.SRGBColorSpace;
  arrowTex.wrapS = THREE.RepeatWrapping;
  arrowTex.wrapT = THREE.RepeatWrapping;
  return arrowTex;
}

/** 導航線箭頭流動：主迴圈每幀呼叫（共用紋理 offset，一次驅動所有 run）。 */
export function tickRouteArrows(nowMs: number): void {
  if (arrowTex) arrowTex.offset.x = -(((nowMs / 1000) * THEME.route.arrowSpeed) % 1);
}

export function buildRouteObject(
  graph: NavGraph,
  edges: GraphEdge[],
  offsetY: (floorId: string) => number = () => 0,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'route';
  if (edges.length === 0) return group;

  const ids = [edges[0].from, ...edges.map((e) => e.to)];
  const nodes = ids.map((id) => graph.nodes.get(id)!);
  const pts = nodes.map((n) => toWorld(n.xy, n.z + offsetY(n.floor) + 1.2)); // 浮在樓面上方

  const tex = routeArrowTexture();
  const tubeMat = new THREE.MeshBasicMaterial(
    tex ? { map: tex, toneMapped: false } : { color: THEME.route.color, toneMapped: false });

  // 依樓層切段：連續同層節點成 run（粗管＋箭頭）、跨層邊成 link（細管）——nav 可逐層開關
  let run: { floor: string; pts: THREE.Vector3[] } | null = null;
  const flushRun = (): void => {
    if (run && run.pts.length >= 2) {
      const curve = new THREE.CatmullRomCurve3(run.pts);
      const len = curve.getLength();
      const geo = new THREE.TubeGeometry(
        curve, Math.max(16, run.pts.length * 8), THEME.route.radius, 8, false);
      // u 由 [0,1] 改為 len/interval 圈：共用紋理下每 run 箭頭間距一致（RepeatWrapping 吃 u>1）
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / THEME.route.arrowInterval));
      const mesh = new THREE.Mesh(geo, tubeMat);
      mesh.userData.floor = run.floor;
      group.add(mesh);
    }
    run = null;
  };
  for (let i = 0; i < nodes.length; i++) {
    if (run && run.floor !== nodes[i].floor) flushRun();
    if (!run) run = { floor: nodes[i].floor, pts: [] };
    run.pts.push(pts[i]);
    const next = nodes[i + 1];
    if (next && next.floor !== nodes[i].floor) {
      flushRun();
      const link = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.LineCurve3(pts[i], pts[i + 1]), 1, THEME.route.linkRadius, 8, false),
        new THREE.MeshBasicMaterial({ color: THEME.route.color, toneMapped: false }));
      link.userData.link = true;
      group.add(link);
    }
  }
  flushRun();

  // 水滴 pin：球頭＋倒錐尾（Google 風）；帶樓層標記供 nav 開關
  const pin = (p: THREE.Vector3, color: string, floor: string): THREE.Group => {
    const g = new THREE.Group();
    const m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.8, 20), m);
    tail.rotation.x = Math.PI;
    tail.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 20, 16), m);
    head.position.y = 2.2;
    g.add(tail, head);
    g.position.copy(p);
    g.userData.floor = floor;
    return g;
  };
  group.add(pin(pts[0], THEME.route.pinStart, nodes[0].floor));
  group.add(pin(pts[pts.length - 1], THEME.route.pinEnd, nodes[nodes.length - 1].floor));
  return group;
}
