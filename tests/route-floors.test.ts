import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, listLandmarks, routeFloors } from '../src/nav';
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
const landmarks = listLandmarks(model);

describe('routeFloors（M-8 preview 調暗非路線樓層）', () => {
  it('跨樓層路線：含兩端樓層、去重、首項為起點樓層', () => {
    const start = landmarks.find((l) => l.floorLabel.startsWith('B4'))!;
    const end = landmarks.find((l) => l.floorLabel.startsWith('B1'))!;
    const path = findPath(graph, start.id, end.id, { accessibleOnly: false })!;
    const floors = routeFloors(graph, path);
    expect(floors[0]).toBe(graph.nodes.get(start.id)!.floor);
    expect(floors).toContain(graph.nodes.get(end.id)!.floor);
    expect(new Set(floors).size).toBe(floors.length);
  });
  it('同樓層路線：單一樓層', () => {
    const [a, b] = landmarks.filter((l) => l.floorLabel.startsWith('B1'));
    const path = findPath(graph, a.id, b.id, { accessibleOnly: false })!;
    expect(routeFloors(graph, path)).toEqual([graph.nodes.get(a.id)!.floor]);
  });
});
