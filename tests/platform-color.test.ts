import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import { THEME, mixHex } from '../src/theme';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

function platformCapColor(group: THREE.Group): string {
  let hex = '';
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!hex && mesh.isMesh && o.userData.kind === 'platform') {
      const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
      hex = `#${m.color.getHexString()}`;
    }
  });
  return hex;
}

describe('mixHex', () => {
  it('端點與中點', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('月台系統色（去塑膠 T3）', () => {
  it('platform area 底色＝系統色混白 platformWhiten', () => {
    const group = buildStationGroup(assembleModel(
      stationDoc, { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat }, connectorsDoc));
    const expected = mixHex('#888888', '#ffffff', THEME.materials.platformWhiten); // mini fixture test 系統色
    expect(platformCapColor(group)).toBe(expected);
  });

  it('system 不在 systems 表時回退 THEME.materials.area.platform', () => {
    const ghostPlat = structuredClone(plat) as typeof plat;
    for (const a of ghostPlat.areas) if (a.kind === 'platform') a.system = 'ghost';
    const group = buildStationGroup(assembleModel(
      stationDoc, { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': ghostPlat }, connectorsDoc));
    expect(platformCapColor(group)).toBe(THEME.materials.area.platform);
  });
});
