import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { floorVisible, applyFloorVisibility, makeTween, tweenAt } from '../src/navview';
import { THEME } from '../src/theme';

describe('floorVisible（nav 單樓層制）', () => {
  it('nav 只有當前樓層可見', () => {
    expect(floorVisible('nav', 'b3', 'b3')).toBe(true);
    expect(floorVisible('nav', 'b1', 'b3')).toBe(false);
  });
  it('overview/preview 全可見；currentFloor null 全可見', () => {
    expect(floorVisible('overview', 'b1', 'b3')).toBe(true);
    expect(floorVisible('preview', 'b1', 'b3')).toBe(true);
    expect(floorVisible('nav', 'b1', null)).toBe(true);
  });
});

describe('applyFloorVisibility', () => {
  const g = new THREE.Group();
  for (const name of ['b1', 'b3', 'connectors']) {
    const f = new THREE.Group();
    f.name = name;
    g.add(f);
  }
  it('nav：他層與 connectors 隱藏', () => {
    applyFloorVisibility(g, 'nav', 'b3');
    expect(g.children.map((c) => c.visible)).toEqual([false, true, false]);
  });
  it('overview：全部還原可見', () => {
    applyFloorVisibility(g, 'overview', null);
    expect(g.children.map((c) => c.visible)).toEqual([true, true, true]);
  });
});

describe('marker tween（等速滑行）', () => {
  it('時長 = 距離/速度，夾在 [segMinMs, segMaxMs]', () => {
    const one = makeTween(new THREE.Vector3(), new THREE.Vector3(THEME.nav.markerSpeed, 0, 0), 0);
    expect(one.ms).toBe(1000);
    expect(makeTween(new THREE.Vector3(), new THREE.Vector3(0.01, 0, 0), 0).ms).toBe(THEME.nav.segMinMs);
    expect(makeTween(new THREE.Vector3(), new THREE.Vector3(999, 0, 0), 0).ms).toBe(THEME.nav.segMaxMs);
  });
  it('線性插值、逾時停在終點', () => {
    const tw = makeTween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(THEME.nav.markerSpeed, 0, 0), 0);
    expect(tweenAt(tw, 500).pos.x).toBeCloseTo(THEME.nav.markerSpeed / 2, 5);
    expect(tweenAt(tw, 500).done).toBe(false);
    const end = tweenAt(tw, 2000);
    expect(end.pos.x).toBeCloseTo(THEME.nav.markerSpeed, 5);
    expect(end.done).toBe(true);
  });
});
