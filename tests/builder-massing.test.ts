import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildStationGroup } from '../src/builder';
import { THEME } from '../src/theme';
import type { StationModel } from '../src/types';

const model = {
  station: { schema: 'station@1', id: 't', name: { zh: 't' },
    frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
    floors: [{ id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: 0, height: 4, estimated: true }] },
  floors: new Map([['a', { schema: 'floor@1', id: 'a',
    slab: { outline: [[0, 0], [10, 0], [10, 10], [0, 10]], source: 's', confidence: 2 } }]]),
  connectors: [],
} as unknown as StationModel;

describe('程序化牆帶：shell 迴圈重調為 massHeight 實心牆', () => {
  it('shell 段高度＝THEME.body.massHeight 且不透明', () => {
    const g = buildStationGroup(model);
    const shell = [] as THREE.Mesh[];
    g.traverse((o) => { if ((o as THREE.Mesh).userData?.kind === 'shell') shell.push(o as THREE.Mesh); });
    expect(shell.length).toBeGreaterThan(0);
    const box = shell[0].geometry as THREE.BoxGeometry;
    expect(box.parameters.height).toBeCloseTo(THEME.body.massHeight);
    expect((shell[0].material as THREE.MeshStandardMaterial).opacity).toBe(1);
  });
});
