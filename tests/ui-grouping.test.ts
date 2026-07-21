import { describe, it, expect } from 'vitest';
import { groupLandmarks } from '../src/ui';
import { assembleModel } from '../src/loader';
import { listLandmarks } from '../src/nav';
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
const landmarks = listLandmarks(model);

describe('groupLandmarks（B4 起始點不見了——12 筆截斷修復）', () => {
  it('空 query：全 47 筆、4 組、樓層保序、無截斷', () => {
    const groups = groupLandmarks(landmarks, '');
    expect(groups.length).toBe(4);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(47);
    expect(groups.map((g) => g.floorLabel)).toEqual(
      [...new Set(landmarks.map((l) => l.floorLabel))]);
  });

  it('B4 組存在且含 demo 起點 n-rp-003（原 bug 案例）', () => {
    const b4 = groupLandmarks(landmarks, '').at(-1)!;
    expect(b4.floorLabel).toContain('B4');
    expect(b4.items.some((l) => l.id === 'n-rp-003')).toBe(true);
  });

  it('query 過濾跨組、每組只留符合項', () => {
    const groups = groupLandmarks(landmarks, '電梯');
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const l of g.items) expect(l.label + l.floorLabel).toContain('電梯');
    }
  });

  it('query 可用樓層標籤（B4）命中整組', () => {
    const groups = groupLandmarks(landmarks, 'B4');
    expect(groups.length).toBe(1);
    expect(groups[0].items.length).toBe(6);
  });

  it('無符合 → 空陣列', () => {
    expect(groupLandmarks(landmarks, '不存在的地標')).toEqual([]);
  });
});
