import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import { buildStationGroup, toWorld } from '../src/builder';
import { buildRouteObject } from '../src/path';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);

describe('toWorld', () => {
  it('local (x,y) 對映 three (x, elev, -y)', () => {
    const v = toWorld([3, 7], -4);
    expect([v.x, v.y, v.z]).toEqual([3, -4, -7]);
  });
});

describe('buildStationGroup', () => {
  const group = buildStationGroup(model);

  it('每樓一個 group + connectors group', () => {
    const names = group.children.map((c) => c.name);
    expect(names).toContain('hall-b1');
    expect(names).toContain('plat-b2');
    expect(names).toContain('connectors');
  });

  it('樓層 group 帶 userData.floorId 且含 slab 與 area meshes', () => {
    const hallGroup = group.children.find((c) => c.name === 'hall-b1') as THREE.Group;
    expect(hallGroup.userData.floorId).toBe('hall-b1');
    const kinds = hallGroup.children.map((c) => c.userData.kind).filter(Boolean);
    expect(kinds).toContain('slab');
    expect(kinds).toContain('paid');
    expect(kinds).toContain('unpaid');
  });

  it('connectors group 含 2 個量體（電扶梯斜坡 + 電梯豎井）', () => {
    const conns = group.children.find((c) => c.name === 'connectors') as THREE.Group;
    expect(conns.children.length).toBe(2);
  });
});

describe('buildRouteObject', () => {
  it('路徑物件含管線與起終點', () => {
    const graph = buildGraph(model);
    const path = findPath(graph, 'n-pl-001', 'n-ha-002')!;
    const route = buildRouteObject(graph, path);
    expect(route.name).toBe('route');
    expect(route.children.length).toBeGreaterThanOrEqual(3); // tube + 2 spheres
  });
});
