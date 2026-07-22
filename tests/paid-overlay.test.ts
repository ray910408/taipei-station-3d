import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildPaidOverlay } from '../src/builder';

describe('buildPaidOverlay：付費區染色＋虛線', () => {
  it('回傳 overlay mesh 與虛線 Line（已算 lineDistance）', () => {
    const ring: [number, number][] = [[0, 0], [8, 0], [8, 6], [0, 6]];
    const objs = buildPaidOverlay(ring, -21);
    const overlay = objs.find((o) => o.userData.kind === 'paid-overlay') as THREE.Mesh;
    const dash = objs.find((o) => o.userData.kind === 'paid-dash') as THREE.Line;
    expect(overlay.material).toBeInstanceOf(THREE.MeshBasicMaterial);
    expect((overlay.material as THREE.MeshBasicMaterial).transparent).toBe(true);
    expect(dash.material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(dash.geometry.getAttribute('lineDistance')).toBeTruthy();
  });
});
