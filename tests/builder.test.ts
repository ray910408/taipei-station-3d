import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import { buildStationGroup, toWorld } from '../src/builder';
import { buildRouteObject } from '../src/path';
import { THEME } from '../src/theme';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';
import fullStationDoc from '../data/station.json';
import fullConnectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);

const fullModel = assembleModel(fullStationDoc, {
  'floors/tra-concourse-b1.json': b1,
  'floors/tra-platform-b2.json': b2,
  'floors/mrt-r-concourse-b3.json': b3,
  'floors/mrt-r-platform-b4.json': b4,
}, fullConnectorsDoc);

function connectorPosition(group: THREE.Group, id: string): THREE.Vector3 {
  const connectors = group.getObjectByName('connectors') as THREE.Group;
  const mesh = connectors.children.find((child) => child.userData.connectorId === id)!;
  return mesh.getWorldPosition(new THREE.Vector3());
}

function nodePosition(id: string): THREE.Vector3 {
  for (const meta of fullModel.station.floors) {
    const node = fullModel.floors.get(meta.id)?.nav?.nodes.find((candidate) => candidate.id === id);
    if (node) return new THREE.Vector3(node.xy[0], meta.elevation, -node.xy[1]);
  }
  throw new Error(`找不到 nav node：${id}`);
}

describe('toWorld', () => {
  it('local (x,y) 對映 three (x, elev, -y)', () => {
    const v = toWorld([3, 7], -4);
    expect([v.x, v.y, v.z]).toEqual([3, -4, -7]);
  });
});

describe('buildStationGroup', () => {
  const group = buildStationGroup(model);

  it('slab 帶 shadow 旗標（applyShadowFlags）', () => {
    const hallGroup = group.children.find((c) => c.name === 'hall-b1') as THREE.Group;
    const slab = hallGroup.children.find((c) => c.userData.kind === 'slab') as THREE.Mesh;
    expect(slab.castShadow).toBe(true);
    expect(slab.receiveShadow).toBe(true);
  });

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

  const fullGroup = buildStationGroup(fullModel);
  const sharedIds = ['c-esc-rprc-3', 'c-esc-rprc-4', 'c-stair-rprc-1'];

  it('共用錨點的三個 connector 量體會彼此錯開', () => {
    const positions = sharedIds.map((id) => connectorPosition(fullGroup, id));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        expect(positions[i].distanceTo(positions[j])).toBeGreaterThanOrEqual(1.5);
      }
    }
  });

  it('共用錨點梯群錯開後中心不變', () => {
    const center = sharedIds
      .map((id) => connectorPosition(fullGroup, id))
      .reduce((sum, position) => sum.add(position), new THREE.Vector3())
      .multiplyScalar(1 / sharedIds.length);
    const expected = nodePosition('n-rp-001').add(nodePosition('n-rc-001')).multiplyScalar(0.5);
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Math.abs(center[axis] - expected[axis])).toBeLessThan(1e-6);
    }
  });

  it('單成員 elevator 的位置不變', () => {
    const a = nodePosition('n-rp-002');
    const b = nodePosition('n-rc-010');
    const expected = new THREE.Vector3(a.x, (a.y + b.y) / 2, a.z);
    expect(connectorPosition(fullGroup, 'c-elv-rprc-1').distanceTo(expected)).toBeLessThan(1e-6);
  });

  it('slab 為頂亮側暗雙材質（side = cap × sideDarken）', () => {
    const hallGroup = group.children.find((c) => c.name === 'hall-b1') as THREE.Group;
    const slab = hallGroup.children.find((c) => c.userData.kind === 'slab') as THREE.Mesh;
    expect(Array.isArray(slab.material)).toBe(true);
    const [cap, side] = slab.material as THREE.MeshStandardMaterial[];
    expect(side.color.r).toBeCloseTo(cap.color.r * THEME.body.sideDarken, 2);
    expect(side.color.g).toBeCloseTo(cap.color.g * THEME.body.sideDarken, 2);
  });

  it('每樓層 units（含實體 unit 者）恰一個合併 edges LineSegments', () => {
    for (const meta of fullModel.station.floors) {
      const g2 = fullGroup.children.find((c) => c.name === meta.id) as THREE.Group;
      const hasSolidUnit = (fullModel.floors.get(meta.id)?.units ?? [])
        .some((u) => u.kind !== 'stair-void');
      expect(
        g2.children.filter((c) => c.userData.kind === 'edges').length, meta.id,
      ).toBe(hasSolidUnit ? 1 : 0);
    }
  });

  it('area 色塊不透明（體塊語言）', () => {
    const hallGroup = group.children.find((c) => c.name === 'hall-b1') as THREE.Group;
    const paid = hallGroup.children.find((c) => c.userData.kind === 'paid') as THREE.Mesh;
    const m = paid.material as THREE.MeshStandardMaterial;
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
  });

  it('四區地下街店鋪依 system 使用不同識別色', () => {
    const floor = fullGroup.getObjectByName('tra-concourse-b1') as THREE.Group;
    const colors = new Map<string, string>();
    for (const child of floor.children) {
      const system = child.userData.system as string | undefined;
      if (!system?.endsWith('-mall') || child.userData.kind !== 'unit-shop') continue;
      const material = (child as THREE.Mesh).material as THREE.MeshStandardMaterial[];
      colors.set(system, `#${material[0].color.getHexString()}`);
    }
    expect(Object.fromEntries(colors)).toEqual({
      'y-mall': fullModel.station.systems['y-mall'].color,
      'z-mall': fullModel.station.systems['z-mall'].color,
      'k-mall': fullModel.station.systems['k-mall'].color,
      'r-mall': fullModel.station.systems['r-mall'].color,
    });
  });
});

describe('buildRouteObject（per-floor run＋link＋pin）', () => {
  const graph = buildGraph(model);
  const path = findPath(graph, 'n-pl-001', 'n-ha-002')!; // 跨層：plat-b2 →（電扶梯）→ hall-b1
  const route = buildRouteObject(graph, path);

  it('run/link/pin 結構與樓層標記', () => {
    expect(route.name).toBe('route');
    const runs = route.children.filter((c) => !(c as THREE.Group).isGroup && typeof c.userData.floor === 'string');
    const links = route.children.filter((c) => c.userData.link === true);
    const pins = route.children.filter((c) => (c as THREE.Group).isGroup);
    expect(runs.length).toBe(1);  // plat-b2 段只有 1 節點（無管）；hall-b1 段 2 節點成管
    expect(links.length).toBe(1); // 電扶梯跨層 link
    expect(pins.length).toBe(2);
    expect(pins[0].userData.floor).toBe('plat-b2');
    expect(pins[1].userData.floor).toBe('hall-b1');
  });
});
