import { describe, expect, it } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath, listLandmarks } from '../src/nav';
import station from '../data/station.json';
import connectors from '../data/connectors.json';
import tc from '../data/floors/tra-concourse-b1.json';
import tp from '../data/floors/tra-platform-b2.json';
import rc from '../data/floors/mrt-r-concourse-b3.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

const model = assembleModel(station, {
  'floors/tra-concourse-b1.json': tc,
  'floors/tra-platform-b2.json': tp,
  'floors/mrt-r-concourse-b3.json': rc,
  'floors/mrt-r-platform-b4.json': rp,
}, connectors);
const graph = buildGraph(model);

describe('Y／Z／R／K 四區地下街', () => {
  it('四區代表地標都可搜尋', () => {
    const ids = new Set(listLandmarks(model).map((landmark) => landmark.id));
    for (const id of ['n-tc-y-west', 'n-tc-z-east', 'n-tc-r-north', 'n-tc-k-west']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it.each([
    ['Y→Z', 'n-tc-y-west', 'n-tc-z-east'],
    ['Z→R', 'n-tc-z-west', 'n-tc-r-north'],
    ['R→K', 'n-tc-r-north', 'n-tc-k-west'],
    ['K→Y', 'n-tc-k-west', 'n-tc-y-east'],
  ])('%s 跨區路線相通', (_label, start, end) => {
    const path = findPath(graph, start, end);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });

  it('四區都保留估算來源，不冒充實測', () => {
    const mallAreas = tc.areas.filter((area) => area.system.endsWith('-mall'));
    expect(mallAreas.map((area) => area.system).sort()).toEqual([
      'k-mall', 'r-mall', 'y-mall', 'z-mall',
    ]);
    for (const area of mallAreas) {
      expect(area.source).toBe('taipei-underground-malls-map');
      expect(area.status).toBe('estimated');
      expect(area.confidence).toBeLessThanOrEqual(2);
    }
  });
});
