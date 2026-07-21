import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { makeTween, tweenAt } from '../src/navview';
import { THEME } from '../src/theme';

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
