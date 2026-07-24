import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildConnectorsGroup } from '../src/builder';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';

const floorDocs = {
  'floors/tra-concourse-b1.json': b1,
  'floors/tra-platform-b2.json': b2,
  'floors/mrt-r-concourse-b3.json': b3,
  'floors/mrt-r-platform-b4.json': b4,
};

describe('connector 子物件帶兩端樓層（問題6：豎井跟著聚焦調暗）', () => {
  it('每個子物件（含 escalator 箭頭）userData.floors 為 2 個合法樓層 id', () => {
    const model = assembleModel(stationDoc, floorDocs, connectorsDoc);
    const grp = buildConnectorsGroup(model);
    expect(grp.children.length).toBeGreaterThan(0);
    for (const child of grp.children) {
      const floors = child.userData.floors as string[];
      expect(Array.isArray(floors), String(child.userData.kind)).toBe(true);
      expect(floors).toHaveLength(2);
      for (const f of floors)
        expect(model.station.floors.some((m) => m.id === f), f).toBe(true);
    }
  });
});
