import type { StationModel, Vec2 } from './types';
import { segmentClear } from './visibility';

export interface GraphNode { id: string; floor: string; xy: Vec2; z: number; name?: string }
export interface GraphEdge {
  from: string; to: string;
  kind: 'walk' | 'gate' | 'platform-edge' | 'stair' | 'escalator' | 'elevator';
  accessible: boolean;
  length: number;      // 真實 3D 公尺（顯示、統計用）
  cost: number;        // A* 鬆弛用；connector 邊 = length + 轉乘懲罰
  gate?: string; gateSystem?: string; connector?: string;
}
export interface NavGraph { nodes: Map<string, GraphNode>; adj: Map<string, GraphEdge[]> }

const dist3 = (a: GraphNode, b: GraphNode) =>
  Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1], a.z - b.z);

// 垂直設施轉乘懲罰（公尺當量）：等待＋轉乘體感成本。
// 若無此項，connector 上下節點同 xy 時垂直邊只計高差，
// 「上樓再下樓」會被定價成比月台直走便宜（QA ISSUE-002）。
// 電扶梯 < 樓梯 符合乘客偏好；電梯含候梯時間最高。stair 走 connector 迴圈同一路徑。
const TRANSFER_PENALTY: Record<'stair' | 'escalator' | 'elevator', number> = {
  escalator: 20,
  stair: 25,
  elevator: 40,
};

export function buildGraph(model: StationModel): NavGraph {
  const nodes = new Map<string, GraphNode>();
  const adj = new Map<string, GraphEdge[]>();
  const addEdge = (e: GraphEdge) => {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e);
  };

  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor?.nav) continue;
    for (const n of floor.nav.nodes) {
      nodes.set(n.id, { id: n.id, floor: meta.id, xy: n.xy, z: meta.elevation, name: n.name?.zh });
    }
  }

  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor?.nav) continue;
    const gateById = new Map((floor.gates ?? []).map((g) => [g.id, g]));
    for (const e of floor.nav.edges) {
      const a = nodes.get(e.from);
      const b = nodes.get(e.to);
      if (!a || !b) continue;
      const gate = e.kind === 'gate' ? gateById.get(e.gate ?? '') : undefined;
      const len = dist3(a, b);
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: e.kind,
        accessible: gate ? gate.accessible : true,
        length: len,
        cost: len,
        gate: gate?.id,
        gateSystem: gate?.system,
      };
      addEdge({ from: e.from, to: e.to, ...base });
      if (e.bidir !== false) addEdge({ from: e.to, to: e.from, ...base });
    }
  }

  // 自動視線邊：同 area 內兩兩節點，直線落在 area polygon 內且不穿 units 障礙
  // → 補 walk 邊。手繪邊優先（已有直接邊者跳過）；跨 area 一律不補（閘門拓撲不動）。
  const hasDirect = (a: string, b: string) => (adj.get(a) ?? []).some((e) => e.to === b);
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor?.nav) continue;
    const areaPoly = new Map((floor.areas ?? []).map((a) => [a.id, a.polygon]));
    const unitPolys = (floor.units ?? []).map((u) => u.polygon);
    const ns = floor.nav.nodes;
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const na = ns[i];
        const nb = ns[j];
        if (!na.area || na.area !== nb.area) continue;
        const poly = areaPoly.get(na.area);
        if (!poly || hasDirect(na.id, nb.id) || hasDirect(nb.id, na.id)) continue;
        if (!segmentClear(na.xy, nb.xy, poly, unitPolys)) continue;
        const ga = nodes.get(na.id)!;
        const gb = nodes.get(nb.id)!;
        const len = dist3(ga, gb);
        const base = { kind: 'walk' as const, accessible: true, length: len, cost: len };
        addEdge({ from: na.id, to: nb.id, ...base });
        addEdge({ from: nb.id, to: na.id, ...base });
      }
    }
  }

  for (const c of model.connectors) {
    for (let i = 0; i < c.levels.length - 1; i++) {
      const lo = c.levels[i];
      const hi = c.levels[i + 1];
      const a = nodes.get(lo.node);
      const b = nodes.get(hi.node);
      if (!a || !b) continue;
      const len = dist3(a, b);
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: c.kind,
        accessible: c.accessible,
        length: len,
        cost: len + TRANSFER_PENALTY[c.kind],
        connector: c.id,
      };
      if (c.direction === 'up' || c.direction === 'both') addEdge({ from: lo.node, to: hi.node, ...base });
      if (c.direction === 'down' || c.direction === 'both') addEdge({ from: hi.node, to: lo.node, ...base });
    }
  }
  return { nodes, adj };
}

/** 起訖相同時回傳提示訊息，否則 null——main.ts onRoute 防呆的可測試判斷（QA ISSUE-001）。 */
export function sameEndpointMessage(start: string, end: string): string | null {
  return start === end ? '起點與終點相同，請選擇不同地標' : null;
}

export function findPath(
  graph: NavGraph, start: string, goal: string,
  opts: { accessibleOnly?: boolean } = {},
): GraphEdge[] | null {
  const startN = graph.nodes.get(start);
  const goalN = graph.nodes.get(goal);
  if (!startN || !goalN) return null;

  const g = new Map<string, number>([[start, 0]]);
  const cameFrom = new Map<string, GraphEdge>();
  const open = new Set<string>([start]);
  const h = (id: string) => dist3(graph.nodes.get(id)!, goalN);

  while (open.size) {
    let current = '';
    let best = Infinity;
    for (const id of open) {
      const f = (g.get(id) ?? Infinity) + h(id);
      if (f < best || (f === best && id < current)) { best = f; current = id; }
    }
    if (current === goal) {
      const edges: GraphEdge[] = [];
      let cur = goal;
      while (cur !== start) {
        const e = cameFrom.get(cur)!;
        edges.unshift(e);
        cur = e.from;
      }
      return edges;
    }
    open.delete(current);
    for (const e of graph.adj.get(current) ?? []) {
      if (opts.accessibleOnly && !e.accessible) continue;
      const tentative = (g.get(current) ?? Infinity) + e.cost;
      if (tentative < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, tentative);
        cameFrom.set(e.to, e);
        open.add(e.to);
      }
    }
  }
  return null;
}

export function routeSteps(model: StationModel, graph: NavGraph, edges: GraphEdge[]): string[] {
  const steps: string[] = [];
  let walk = 0;
  const flushWalk = () => {
    if (walk > 0) {
      steps.push(`步行約 ${Math.max(1, Math.round(walk))} 公尺`);
      walk = 0;
    }
  };
  const floorZh = (floorId: string) =>
    model.station.floors.find((f) => f.id === floorId)?.name.zh ?? floorId;

  for (const e of edges) {
    if (e.kind === 'walk' || e.kind === 'platform-edge') {
      walk += e.length;
      continue;
    }
    flushWalk();
    if (e.kind === 'gate') {
      const sys = e.gateSystem ? model.station.systems[e.gateSystem]?.name.zh ?? e.gateSystem : '';
      steps.push(`通過${sys}閘門`);
    } else {
      const dest = graph.nodes.get(e.to)!;
      const src = graph.nodes.get(e.from)!;
      const goingUp = dest.z > src.z;
      const name = floorZh(dest.floor);
      if (e.kind === 'escalator') steps.push(`搭電扶梯${goingUp ? '上' : '下'}至「${name}」`);
      else if (e.kind === 'stair') steps.push(`走樓梯${goingUp ? '上' : '下'}至「${name}」`);
      else steps.push(`搭電梯${goingUp ? '上' : '下'}至「${name}」`);
    }
  }
  flushWalk();
  return steps;
}

export interface Landmark { floor: string; floorLabel: string; id: string; label: string }

export function listLandmarks(model: StationModel): Landmark[] {
  const out: Landmark[] = [];
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    for (const n of floor?.nav?.nodes ?? []) {
      if (!n.name) continue;
      out.push({
        floor: meta.id,
        floorLabel: `${meta.labels['complex'] ?? ''} ${meta.name.zh}`.trim(),
        id: n.id,
        label: n.name.zh,
      });
    }
  }
  return out;
}

export interface RouteStats { meters: number; seconds: number }

const WALK_SPEED = 1.2; // m/s，車站人流保守值
// ponytail: 固定候梯＋乘行秒數；Phase 4 有實測數據再校
const CONNECTOR_SECONDS: Record<'stair' | 'escalator' | 'elevator', number> = {
  escalator: 40, stair: 50, elevator: 60,
};

export function routeStats(edges: GraphEdge[]): RouteStats {
  let meters = 0;
  let seconds = 0;
  for (const e of edges) {
    meters += e.length;
    if (e.kind === 'stair' || e.kind === 'escalator' || e.kind === 'elevator')
      seconds += CONNECTOR_SECONDS[e.kind];
    else seconds += e.length / WALK_SPEED;
  }
  return { meters, seconds };
}

export function formatStats(s: RouteStats): string {
  return `約 ${Math.max(1, Math.round(s.meters))} 公尺・約 ${Math.max(1, Math.ceil(s.seconds / 60))} 分鐘`;
}
