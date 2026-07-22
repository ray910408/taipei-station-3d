import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildGraph } from '../src/nav';
import { resolveFloor, snapToNode, toLandmark } from '../src/selection';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);
const graph = buildGraph(model);

describe('snapToNode', () => {
  it('同層最近節點：hall-b1 (1,0) 最近 n-ha-002 (2,0)', () => {
    expect(snapToNode(graph, 'hall-b1', [1, 0])?.id).toBe('n-ha-002');
  });

  it('跨層隔離：同座標在 plat-b2 只 snap 該層節點', () => {
    expect(snapToNode(graph, 'plat-b2', [1, 0])?.id).toBe('n-pl-002');
  });

  it('該層無節點回 null', () => {
    expect(snapToNode(graph, 'no-such-floor', [0, 0])).toBeNull();
  });
});

describe('toLandmark', () => {
  it('有名節點沿用名稱與樓層標籤', () => {
    expect(toLandmark(model, graph.nodes.get('n-ha-002')!)).toEqual({
      floor: 'hall-b1', floorLabel: 'B1 測試大廳', id: 'n-ha-002', label: '測試出口',
    });
  });

  it('無名節點 fallback 名「B1 選點」', () => {
    expect(toLandmark(model, graph.nodes.get('n-ha-001')!).label).toBe('B1 選點');
  });
});

describe('resolveFloor', () => {
  it('沿祖先鏈找 userData.floorId', () => {
    const floor = new THREE.Group();
    floor.userData.floorId = 'hall-b1';
    const child = new THREE.Group();
    const mesh = new THREE.Mesh();
    floor.add(child);
    child.add(mesh);
    expect(resolveFloor(mesh)).toBe('hall-b1');
  });

  it('鏈上無 floorId 回 null', () => {
    expect(resolveFloor(new THREE.Mesh())).toBeNull();
    expect(resolveFloor(null)).toBeNull();
  });
});
