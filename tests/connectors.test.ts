import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildConnectorsGroup } from '../src/builder';
import type { StationModel } from '../src/types';
import connectorsDoc from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import bc from '../data/floors/mrt-bl-concourse-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import bp from '../data/floors/mrt-bl-platform-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

function fixture(kind: 'elevator' | 'escalator' | 'stair'): StationModel {
  return {
    station: { schema: 'station@1', id: 't', name: { zh: 't' },
      frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
      floors: [
        { id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: 0, height: 4, estimated: true },
        { id: 'b', short: 'b', file: '', name: { zh: 'b' }, labels: {}, elevation: -8, height: 4, estimated: true },
      ] },
    floors: new Map([
      ['a', { schema: 'floor@1', id: 'a', slab: { outline: [[0, 0], [1, 0], [1, 1]], source: 's', confidence: 2 },
        nav: { nodes: [{ id: 'n-aa-1', xy: [10, 10] }, { id: 'n-aa-2', xy: [20, 10] }], edges: [{ from: 'n-aa-1', to: 'n-aa-2', kind: 'walk' }] } }],
      ['b', { schema: 'floor@1', id: 'b', slab: { outline: [[0, 0], [1, 0], [1, 1]], source: 's', confidence: 2 },
        nav: { nodes: [{ id: 'n-bb-1', xy: [10, 10] }], edges: [] } }],
    ]),
    connectors: [{ id: `c-${kind}-ab-1`, kind, system: 't', direction: 'up', accessible: true,
      levels: [{ floor: 'a', node: 'n-aa-1' }, { floor: 'b', node: 'n-bb-1' }], source: 's', confidence: 2 }],
  } as unknown as StationModel;
}

describe('buildConnectorsGroup 三型分明', () => {
  it('電梯＝CylinderGeometry', () => {
    const g = buildConnectorsGroup(fixture('elevator'));
    const m = g.children.find((c) => (c as THREE.Mesh).userData.kind === 'connector-elevator') as THREE.Mesh;
    expect(m.geometry.type).toBe('CylinderGeometry');
  });
  it('手扶梯與樓梯用不同材質色', () => {
    const esc = buildConnectorsGroup(fixture('escalator')).children.find((o) => (o as THREE.Mesh).userData.kind === 'connector-escalator') as THREE.Mesh;
    const stair = buildConnectorsGroup(fixture('stair')).children.find((o) => (o as THREE.Mesh).userData.kind === 'connector-stair') as THREE.Mesh;
    const c = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color.getHexString();
    expect(c(esc)).not.toBe(c(stair));
  });
});

describe('板南線月台梯群連通器（四組×上下行，開口手描）', () => {
  const nodes = new Map(
    [bc, bp].flatMap((floor) => floor.nav.nodes.map((node) => [node.id, node.xy] as const)),
  );
  // [上行 id, 下行 id, B2 口相對井位方向]：西/中西口朝東（+1）、中東/東口朝西（-1）——皆朝站體中央
  const groups: [string, string, number][] = [
    ['c-esc-bpbc-5', 'c-esc-bpbc-6', 1],
    ['c-esc-bpbc-1', 'c-esc-bpbc-2', 1],
    ['c-esc-bpbc-3', 'c-esc-bpbc-4', -1],
    ['c-esc-bpbc-7', 'c-esc-bpbc-8', -1],
  ];
  it('上下行成對共用兩端節點', () => {
    for (const [up, down] of groups) {
      const cu = connectorsDoc.connectors.find((c) => c.id === up)!;
      const cd = connectorsDoc.connectors.find((c) => c.id === down)!;
      expect(cu.direction).toBe('up');
      expect(cd.direction).toBe('down');
      expect(cd.levels.map((l) => l.node)).toEqual(cu.levels.map((l) => l.node));
    }
  });
  it('B2 口朝站體中央、斜程 ~12m（非退化垂直棒）', () => {
    for (const [up, , sign] of groups) {
      const levels = connectorsDoc.connectors.find((c) => c.id === up)!.levels;
      const lo = nodes.get(levels[0].node)!; // bp（B3 低端）
      const hi = nodes.get(levels[1].node)!; // bc（B2 高端）
      expect(Math.sign(hi[0] - lo[0]), up).toBe(sign);
      const run = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
      expect(run, up).toBeGreaterThan(10);
      expect(run, up).toBeLessThan(14);
    }
  });
});

describe('真實資料電梯豎井對齊', () => {
  it('指定電梯的相鄰停靠 xy 差全為 0', () => {
    const nodes = new Map(
      [tc, tp, bc, rc, bp, rp].flatMap((floor) =>
        floor.nav.nodes.map((node) => [node.id, node.xy] as const)),
    );

    // c-elv-rctp-1/2、c-elv-tptc-1/2 為 Phase 2 語意推定（1.7–14.1m 錯位），對齊另案，不入斷言
    for (const id of ['c-elv-rpbc-1', 'c-elv-bpbc-1', 'c-elv-bctc-1', 'c-elv-rctc-1', 'c-elv-rprc-2']) {
      const levels = connectorsDoc.connectors.find((connector) => connector.id === id)!.levels;
      for (let i = 1; i < levels.length; i++) {
        const from = nodes.get(levels[i - 1].node)!;
        const to = nodes.get(levels[i].node)!;
        expect([to[0] - from[0], to[1] - from[1]], id).toEqual([0, 0]);
      }
    }
  });
});
