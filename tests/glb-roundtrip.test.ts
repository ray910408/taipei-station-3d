import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel } from '../src/loader';
import { applyShadowFlags, buildStationGroup } from '../src/builder';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';
import { Blob } from 'node:buffer';

(globalThis as { Blob?: typeof Blob }).Blob ??= Blob;
// GLTFExporter 二進位路徑用 FileReader 讀回 Blob——Node 沒有，補最小 shim
class NodeFileReader {
  result: ArrayBuffer | null = null;
  onload: ((ev: unknown) => void) | null = null;
  onloadend: ((ev: unknown) => void) | null = null;
  readAsArrayBuffer(blob: InstanceType<typeof Blob>): void {
    void blob.arrayBuffer().then((buf) => {
      this.result = buf;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
}
(globalThis as { FileReader?: unknown }).FileReader ??= NodeFileReader;

const floorDocs = {
  'floors/tra-concourse-b1.json': b1,
  'floors/tra-platform-b2.json': b2,
  'floors/mrt-r-concourse-b3.json': b3,
  'floors/mrt-r-platform-b4.json': b4,
};

function parseGlb(buf: ArrayBuffer): Promise<GLTF> {
  return new Promise((resolve, reject) => new GLTFLoader().parse(buf, '', resolve, reject));
}

// 雙材質 mesh 經 GLB 拆成 2 primitives：以「材質槽數」為雙軌 parity 單位
function drawUnits(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (!mesh.isMesh) return;
    n += Array.isArray(mesh.material) ? mesh.material.length : 1;
  });
  return n;
}

describe('GLB round-trip parity（雙軌契約）', () => {
  let built: THREE.Group;
  let loaded: THREE.Object3D;

  beforeAll(async () => {
    const model = assembleModel(stationDoc, floorDocs, connectorsDoc);
    built = buildStationGroup(model);
    const glb = (await new GLTFExporter().parseAsync(built, { binary: true })) as ArrayBuffer;
    const gltf = await parseGlb(glb);
    loaded = gltf.scene.getObjectByName('station')!;
  });

  it('station 節點存在且子節點名稱（樓層/connectors）一致', () => {
    expect(loaded).toBeTruthy();
    const names = (g: THREE.Object3D) => g.children.map((c) => c.name).sort();
    expect(names(loaded)).toEqual(names(built));
  });

  it('各子 group 的材質槽數一致', () => {
    for (const child of built.children) {
      const twin = loaded.children.find((c) => c.name === child.name)!;
      expect(twin, child.name).toBeTruthy();
      expect(drawUnits(twin), child.name).toBe(drawUnits(child));
    }
  });

  it('各樓層 bounding box 一致（誤差 < 1 cm）', () => {
    for (const child of built.children) {
      const twin = loaded.children.find((c) => c.name === child.name)!;
      const a = new THREE.Box3().setFromObject(child);
      const b = new THREE.Box3().setFromObject(twin);
      for (const k of ['x', 'y', 'z'] as const) {
        expect(Math.abs(a.min[k] - b.min[k]), `${child.name} min.${k}`).toBeLessThan(0.01);
        expect(Math.abs(a.max[k] - b.max[k]), `${child.name} max.${k}`).toBeLessThan(0.01);
      }
    }
  });

  it('userData 經 extras 保留（floorId 與 slab/shell kind——ui.ts 的契約）', () => {
    const floor = loaded.children.find((c) => c.name === 'mrt-r-platform-b4')!;
    expect(floor.userData.floorId).toBe('mrt-r-platform-b4');
    let slab = 0;
    let shell = 0;
    floor.traverse((o) => {
      if (o.userData.kind === 'slab') slab++;
      if (o.userData.kind === 'shell') shell++;
    });
    expect(slab).toBe(1);
    expect(shell).toBeGreaterThan(0);
  });

  it('GLB 軌：雙材質拆 primitive 後 applyShadowFlags 仍佈 slab 旗標（parent fallback）', () => {
    applyShadowFlags(loaded);
    const floor = loaded.children.find((c) => c.name === 'mrt-r-platform-b4')!;
    let ok = false;
    floor.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const kind = o.userData.kind ?? o.parent?.userData.kind;
      if (mesh.isMesh && kind === 'slab' && mesh.castShadow && mesh.receiveShadow) ok = true;
    });
    expect(ok).toBe(true);
  });
});
