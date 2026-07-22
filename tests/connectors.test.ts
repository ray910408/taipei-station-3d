import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildConnectorsGroup } from '../src/builder';
import type { StationModel } from '../src/types';

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
    const esc = buildConnectorsGroup(fixture('escalator')).children[0] as THREE.Mesh;
    const stair = buildConnectorsGroup(fixture('stair')).children[0] as THREE.Mesh;
    const c = (m: THREE.Mesh) => (m.material as THREE.MeshStandardMaterial).color.getHexString();
    expect(c(esc)).not.toBe(c(stair));
  });
});
