import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { floorOffsetY, easeInOutCubic, EXPLODE_GAP } from '../src/explode';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat }, connectorsDoc);
const elevOf = (id: string) => model.station.floors.find((f) => f.id === id)!.elevation;

describe('floorOffsetY', () => {
  it('factor 0 = 實高（位移 0）', () => {
    expect(floorOffsetY(model, 'hall-b1', 0)).toBe(0);
    expect(floorOffsetY(model, 'plat-b2', 0)).toBe(0);
  });
  it('factor 1 = 最深層不動、往上等距 EXPLODE_GAP', () => {
    const deepest = model.station.floors[model.station.floors.length - 1];
    expect(floorOffsetY(model, deepest.id, 1)).toBe(0);
    const upper = model.station.floors[0];
    expect(floorOffsetY(model, upper.id, 1))
      .toBeCloseTo(deepest.elevation + EXPLODE_GAP - elevOf(upper.id), 6);
  });
  it('未知樓層回 0', () => {
    expect(floorOffsetY(model, 'no-such', 1)).toBe(0);
  });
});

describe('easeInOutCubic', () => {
  it('端點與中點', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 6);
  });
});
