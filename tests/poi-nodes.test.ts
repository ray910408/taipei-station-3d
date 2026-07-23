import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, listLandmarks } from '../src/nav';
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

describe('廁所/出口 POI 節點（BUG-004）', () => {
  const named = (kw: string) => landmarks.filter((l) => l.label.includes(kw));

  it('廁所×2、出口×2 進搜尋清單', () => {
    expect(named('廁所').map((l) => l.id).sort()).toEqual(['n-rc-019', 'n-tc-009']);
    expect(named('出口').map((l) => l.id).sort()).toEqual(['n-rc-016', 'n-tc-010']);
  });

  it('每個新 POI 從 B4 月台（n-rp-003）皆可達（連通性）', () => {
    for (const id of ['n-tc-009', 'n-tc-010', 'n-rc-016', 'n-rc-019']) {
      const path = findPath(graph, 'n-rp-003', id, { accessibleOnly: false });
      expect(path, id).not.toBeNull();
      expect(path!.length).toBeGreaterThan(0);
    }
  });
});
