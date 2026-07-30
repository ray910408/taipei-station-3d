import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import { floorTileTexture, wallPanelTexture, attachProceduralTextures } from '../src/texture';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

describe('texture（去塑膠 T4）——Node 安全性', () => {
  it('node 環境（無 document）floorTileTexture / wallPanelTexture 回傳 null', () => {
    expect(typeof document).toBe('undefined'); // vitest node 環境前提
    expect(floorTileTexture()).toBeNull();
    expect(wallPanelTexture()).toBeNull();
  });

  it('node 環境 attachProceduralTextures 不擲錯、不改材質', () => {
    const group = buildStationGroup(assembleModel(
      stationDoc, { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat }, connectorsDoc));
    expect(() => attachProceduralTextures(group)).not.toThrow();
    let anyMap = false;
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        if ((m as THREE.MeshStandardMaterial).map) anyMap = true;
    });
    expect(anyMap).toBe(false);
  });
});
