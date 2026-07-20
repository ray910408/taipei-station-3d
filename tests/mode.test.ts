import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import { MODE_EXPLODE, verticalStep, transitionLabel } from '../src/mode';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat }, connectorsDoc);
const graph = buildGraph(model);
const path = findPath(graph, 'n-pl-001', 'n-ha-002')!; // ['escalator', 'gate']

describe('MODE_EXPLODE', () => {
  it('overview/preview 全爆炸、nav 實高', () => {
    expect(MODE_EXPLODE).toEqual({ overview: 1, preview: 1, nav: 0 });
  });
});

describe('verticalStep', () => {
  it('站在垂直邊前回傳該邊；否則 null；終點 null', () => {
    expect(verticalStep(path, { nodeIds: [], index: 0 })?.kind).toBe('escalator');
    expect(verticalStep(path, { nodeIds: [], index: 1 })).toBeNull(); // gate
    expect(verticalStep(path, { nodeIds: [], index: 2 })).toBeNull(); // 越界＝抵達
  });
});

describe('transitionLabel', () => {
  it('電扶梯上行文案含目的樓層', () => {
    expect(transitionLabel(model, graph, path[0])).toBe('搭電扶梯上行，前往「B1 測試大廳」');
  });
});
