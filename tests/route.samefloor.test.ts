import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, listLandmarks } from '../src/nav';
import type { GraphEdge, NavGraph } from '../src/nav';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(stationDoc, {
  'floors/tra-concourse-b1.json': tc,
  'floors/tra-platform-b2.json': tp,
  'floors/mrt-r-concourse-b3.json': rc,
  'floors/mrt-r-platform-b4.json': rp,
}, connectorsDoc);
const graph = buildGraph(model);

const floorOf = (id: string): string => graph.nodes.get(id)!.floor;

/** 路線經過的樓層序列（相鄰去重）。 */
function pathFloors(edges: GraphEdge[]): string[] {
  const seq = [floorOf(edges[0].from)];
  for (const e of edges) {
    const f = floorOf(e.to);
    if (f !== seq[seq.length - 1]) seq.push(f);
  }
  return seq;
}

/** 只走同樓層邊（依模式過濾 accessible）能否從 start 到 goal。 */
function intraFloorReachable(g: NavGraph, start: string, goal: string, accOnly: boolean): boolean {
  const floor = floorOf(start);
  if (floorOf(goal) !== floor) return false;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === goal) return true;
    for (const e of g.adj.get(cur) ?? []) {
      if (accOnly && !e.accessible) continue;
      if (floorOf(e.to) !== floor || seen.has(e.to)) continue;
      seen.add(e.to);
      queue.push(e.to);
    }
  }
  return false;
}

describe('同樓層路線不繞別層（QA ISSUE-002 回歸）', () => {
  it('淡水信義線月台 南端→北端 全程停留 B4', () => {
    const path = findPath(graph, 'n-rp-001', 'n-rp-005')!;
    expect(pathFloors(path)).toEqual(['mrt-r-platform-b4']);
  });

  it('淡水信義線月台 南端→中段 全程停留 B4', () => {
    const path = findPath(graph, 'n-rp-001', 'n-rp-003')!;
    expect(pathFloors(path)).toEqual(['mrt-r-platform-b4']);
  });

  it('窮舉：所有同層可達的地標對，路線不得離層（兩種模式）', () => {
    const lms = listLandmarks(model);
    for (const a of lms) {
      for (const b of lms) {
        if (a.id === b.id) continue;
        for (const accessibleOnly of [false, true]) {
          if (!intraFloorReachable(graph, a.id, b.id, accessibleOnly)) continue;
          const path = findPath(graph, a.id, b.id, { accessibleOnly });
          expect(path, `${a.label}→${b.label} acc=${accessibleOnly}`).not.toBeNull();
          expect(pathFloors(path!), `${a.label}→${b.label} acc=${accessibleOnly}`).toEqual([a.floor]);
        }
      }
    }
  });
});
