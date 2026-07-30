import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildStationGroup, trackAxis, trackHole, TRACK_HOLE_INSET } from '../src/builder';
import { ringArea } from '../src/geometry';
import { THEME } from '../src/theme';
import type { StationModel, Vec2 } from '../src/types';

// inline 迷你 model：一層＋一個 track area（斜置四邊形，驗通用性——不假設軸對齊）
const ELEV = 4;
const TRACK: Vec2[] = [[2, 2], [32, 22], [30, 25], [0, 5]];
const model = {
  station: { schema: 'station@1', id: 't', name: { zh: 't' },
    frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {},
    floors: [{ id: 'a', short: 'a', file: '', name: { zh: 'a' }, labels: {}, elevation: ELEV, height: 4, estimated: true }] },
  floors: new Map([['a', { schema: 'floor@1', id: 'a',
    slab: { outline: [[0, 0], [40, 0], [40, 40], [0, 40]], source: 's', confidence: 2 },
    areas: [{ id: 'a-aa-track-x', kind: 'track', system: 's',
      polygon: TRACK, source: 's', confidence: 2 }] }]]),
  connectors: [],
} as unknown as StationModel;

const floorGroup = buildStationGroup(model).children.find((c) => c.name === 'a') as THREE.Group;
const meshOf = (kind: string): THREE.Mesh =>
  floorGroup.children.find((c) => c.userData.kind === kind) as THREE.Mesh;

describe('軌道鋼軌：斜置軌道也對齊「軌頂 = elevation − 1.25」與內側面軌距', () => {
  const R = THEME.materials.rail;

  it('軌條頂面 = elevation − 1.25，斷面高 = rail.h', () => {
    const bb = new THREE.Box3().setFromObject(meshOf('rail'));
    expect(bb.max.y).toBeCloseTo(ELEV - 1.25, 6);
    expect(bb.max.y - bb.min.y).toBeCloseTo(R.h, 6);
    const m = meshOf('rail').material as THREE.MeshStandardMaterial;
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
  });

  it('兩根鋼軌、跨距（外緣）= 軌距 + 2×軌寬——軌距量的是內側面', () => {
    const pos = meshOf('rail').geometry.attributes.position;
    expect(pos.count).toBe(2 * 24); // 兩顆 box 合併，非一根
    // 斜置：把頂點投影到軌道中軸法向上量跨距（world x/z；toWorld 把 data y 映到 −z）
    const [a, b] = trackAxis(TRACK)!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const [nx, nz] = [(b[1] - a[1]) / len, (b[0] - a[0]) / len]; // 世界向 (dx,−dy) 的法向
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) * nx + pos.getZ(i) * nz;
      lo = Math.min(lo, t); hi = Math.max(hi, t);
    }
    expect(hi - lo).toBeCloseTo(R.gauge + 2 * R.w, 4); // 4 位：position 是 float32
  });
});

describe('軌道凹槽：溝壁封住道床，不是懸空的挖洞', () => {
  it('溝壁自道床頂面接到 slab 頂面（無懸空縫）', () => {
    const bb = new THREE.Box3().setFromObject(meshOf('track-wall'));
    const bedTop = ELEV - THEME.trackSunk + 0.05;
    expect(bb.min.y).toBeCloseTo(bedTop, 6); // 壁腳＝床面，中間不留縫
    expect(bb.max.y).toBeCloseTo(ELEV + 0.01, 6); // 壁頂封到樓板面（+1cm 免共面）
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
