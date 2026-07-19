import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import { setFloorEmphasis } from '../src/follow';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';
import { Blob } from 'node:buffer';

(globalThis as { Blob?: typeof Blob }).Blob ??= Blob;
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

const opacities = (root: THREE.Object3D): number[] => {
  const out: number[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const m = mesh.material as THREE.MeshStandardMaterial | undefined;
    if (mesh.isMesh && m?.isMaterial) out.push(m.opacity);
  });
  return out;
};

function checkEmphasis(station: THREE.Object3D, active: string): void {
  const before = new Map(
    station.children.map((c) => [c.name, opacities(c)] as const),
  );
  setFloorEmphasis(station as THREE.Group, active);
  for (const child of station.children) {
    const base = before.get(child.name)!;
    const now = opacities(child);
    if (child.name === 'connectors' || child.name === active) {
      // 當前樓層與 connectors 保持基準
      now.forEach((v, i) => expect(v, `${child.name}[${i}]`).toBeCloseTo(base[i], 5));
    } else {
      now.forEach((v, i) => expect(v, `${child.name}[${i}]`).toBeCloseTo(base[i] * 0.15, 5));
    }
  }
  // 還原
  setFloorEmphasis(station as THREE.Group, null);
  for (const child of station.children) {
    const base = before.get(child.name)!;
    opacities(child).forEach((v, i) => expect(v, `restore ${child.name}[${i}]`).toBeCloseTo(base[i], 5));
  }
}

describe('setFloorEmphasis 樓層聚焦（雙軌）', () => {
  let built: THREE.Group;
  let loaded: THREE.Object3D;

  beforeAll(async () => {
    const model = assembleModel(stationDoc, floorDocs, connectorsDoc);
    built = buildStationGroup(model);
    const glb = (await new GLTFExporter().parseAsync(buildStationGroup(model), { binary: true })) as ArrayBuffer;
    const gltf = await new Promise<GLTF>((resolve, reject) =>
      new GLTFLoader().parse(glb, '', resolve, reject));
    loaded = gltf.scene.getObjectByName('station')!;
  });

  it('runtime 軌：非當前樓層調暗 0.15、connectors 不動、null 還原', () => {
    checkEmphasis(built, 'mrt-r-platform-b4');
  });

  it('GLB 軌：loader 可能共用 material，仍不得跨樓層洩漏', () => {
    checkEmphasis(loaded, 'tra-platform-b2');
  });

  it('人工共用 material 也不洩漏（clone 防護）', () => {
    const g = new THREE.Group();
    const shared = new THREE.MeshStandardMaterial({ opacity: 0.8, transparent: true });
    const fa = new THREE.Group();
    fa.name = 'floor-a';
    fa.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    const fb = new THREE.Group();
    fb.name = 'floor-b';
    fb.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared));
    g.add(fa, fb);
    setFloorEmphasis(g, 'floor-a');
    const matA = (fa.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    const matB = (fb.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
    expect(matA.opacity).toBeCloseTo(0.8, 5);
    expect(matB.opacity).toBeCloseTo(0.8 * 0.15, 5);
  });

  it('null 還原 transparent 旗標並清除快照（終審 I-1）', () => {
    const g = new THREE.Group();
    const fa = new THREE.Group();
    fa.name = 'floor-a';
    const opaque = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ opacity: 1, transparent: false }),
    );
    fa.add(opaque);
    g.add(fa);
    setFloorEmphasis(g, 'floor-b'); // fa 被調暗
    expect((opaque.material as THREE.MeshStandardMaterial).transparent).toBe(true);
    setFloorEmphasis(g, null);
    const m = opaque.material as THREE.MeshStandardMaterial;
    expect(m.transparent).toBe(false);
    expect(m.opacity).toBeCloseTo(1, 5);
    expect(opaque.userData.baseOpacity).toBeUndefined();
    expect(opaque.userData.baseTransparent).toBeUndefined();
  });

  it('還原後外部改 opacity（slider），下次聚焦以新值為基準（終審 I-1）', () => {
    const g = new THREE.Group();
    const fa = new THREE.Group();
    fa.name = 'floor-a';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ opacity: 0.9, transparent: true }),
    );
    fa.add(mesh);
    g.add(fa);
    setFloorEmphasis(g, 'floor-b');
    setFloorEmphasis(g, null);
    (mesh.material as THREE.MeshStandardMaterial).opacity = 0.1; // 模擬 slider
    setFloorEmphasis(g, 'floor-b');
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.1 * 0.15, 5);
    setFloorEmphasis(g, null);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.1, 5);
  });
});
