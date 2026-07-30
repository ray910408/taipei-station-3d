import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildStationGroup, trackHole, TRACK_HOLE_INSET } from '../src/builder';
import { ringArea } from '../src/geometry';
import { THEME } from '../src/theme';
import type { StationModel, Vec2 } from '../src/types';

// inline 迷你 model：一層＋一個 track area（斜置四邊形，驗通用性——不假設軸對齊）
const ELEV = 4;
const model = {
  station: { schema: 'station@1', id: 't', name: { zh: 't' },
    frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
    floors: [{ id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: ELEV, height: 4, estimated: true }] },
  floors: new Map([['a', { schema: 'floor@1', id: 'a',
    slab: { outline: [[0, 0], [40, 0], [40, 40], [0, 40]], source: 's', confidence: 2 },
    areas: [{ id: 'a-aa-track-x', kind: 'track', system: 's',
      polygon: [[2, 2], [32, 22], [30, 25], [0, 5]], source: 's', confidence: 2 }] }]]),
  connectors: [],
} as unknown as StationModel;

describe('軌道鋼軌：每條 track 生兩條 rail，頂面在 elevation − 1.25', () => {
  it('恰 2 條 rail，頂面高度＝elevation − 1.25', () => {
    const g = buildStationGroup(model);
    const rails: THREE.Mesh[] = [];
    g.traverse((o) => { if ((o as THREE.Mesh).userData?.kind === 'rail') rails.push(o as THREE.Mesh); });
    expect(rails.length).toBe(2);
    for (const r of rails) {
      const box = r.geometry as THREE.BoxGeometry;
      expect(box.parameters.height).toBeCloseTo(THEME.rail.h);
      expect(r.position.y + box.parameters.height / 2).toBeCloseTo(ELEV - 1.25, 2);
      expect((r.material as THREE.MeshStandardMaterial).opacity).toBe(1);
      expect((r.material as THREE.MeshStandardMaterial).transparent).toBe(false);
    }
    // 軌距：兩軌中心距＝gauge（斜置也成立）
    expect(rails[0].position.distanceTo(rails[1].position)).toBeCloseTo(THEME.rail.gauge, 6);
  });
});

describe('trackHole：slab 程序化開洞輪廓', () => {
  // B2 a-tp-track-1a：x 貼滿 ±175（與 slab 邊重合）、寬 4.5m
  const b2: Vec2[] = [[-175, -55], [175, -55], [175, -50.5], [-175, -50.5]];

  it('四邊各內縮 TRACK_HOLE_INSET', () => {
    const h = trackHole(b2)!;
    expect(h).toHaveLength(4);
    const xs = h.map((p) => p[0]), ys = h.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-175 + TRACK_HOLE_INSET, 6); // 軸向兩端
    expect(Math.max(...xs)).toBeCloseTo(175 - TRACK_HOLE_INSET, 6);
    expect(Math.min(...ys)).toBeCloseTo(-55 + TRACK_HOLE_INSET, 6); // 側向兩邊
    expect(Math.max(...ys)).toBeCloseTo(-50.5 - TRACK_HOLE_INSET, 6);
  });

  it('繞向為 cw（hole 慣例，與 slab.outline 的 ccw 相反）', () => {
    expect(ringArea(trackHole(b2)!)).toBeLessThan(0);
    // 斜置四邊形（B4 形狀）同樣為 cw——繞向不依賴軸向
    expect(ringArea(trackHole([[109.6, -89.7], [152.9, 50.8], [148.2, 52.1], [104.8, -88.7]])!)).toBeLessThan(0);
  });

  it('非四邊形回 null', () => {
    expect(trackHole([[0, 0], [10, 0], [10, 10]])).toBeNull();
    expect(trackHole([[0, 0], [10, 0], [10, 10], [0, 10], [-5, 5]])).toBeNull();
  });
});
