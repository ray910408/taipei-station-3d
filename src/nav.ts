import type { StationModel, Vec2 } from './types';

export interface GraphNode { id: string; floor: string; xy: Vec2; z: number; name?: string }
export interface GraphEdge {
  from: string; to: string;
  kind: 'walk' | 'gate' | 'platform-edge' | 'stair' | 'escalator' | 'elevator';
  accessible: boolean; length: number; gate?: string; gateSystem?: string; connector?: string;
}
export interface NavGraph { nodes: Map<string, GraphNode>; adj: Map<string, GraphEdge[]> }

const dist3 = (a: GraphNode, b: GraphNode) =>
  Math.hypot(a.xy[0] - b.xy[0], a.xy[1] - b.xy[1], a.z - b.z);

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
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: e.kind,
        accessible: gate ? gate.accessible : true,
        length: dist3(a, b),
        gate: gate?.id,
        gateSystem: gate?.system,
      };
      addEdge({ from: e.from, to: e.to, ...base });
      if (e.bidir !== false) addEdge({ from: e.to, to: e.from, ...base });
    }
  }

  for (const c of model.connectors) {
    for (let i = 0; i < c.levels.length - 1; i++) {
      const lo = c.levels[i];
      const hi = c.levels[i + 1];
      const a = nodes.get(lo.node);
      const b = nodes.get(hi.node);
      if (!a || !b) continue;
      const base: Omit<GraphEdge, 'from' | 'to'> = {
        kind: c.kind, accessible: c.accessible, length: dist3(a, b), connector: c.id,
      };
      if (c.direction === 'up' || c.direction === 'both') addEdge({ from: lo.node, to: hi.node, ...base });
      if (c.direction === 'down' || c.direction === 'both') addEdge({ from: hi.node, to: lo.node, ...base });
    }
  }
  return { nodes, adj };
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
      const tentative = (g.get(current) ?? Infinity) + e.length;
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
      else steps.push(`搭電梯至「${name}」`);
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
