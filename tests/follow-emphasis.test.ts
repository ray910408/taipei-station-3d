import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';
import { setFloorEmphasis, updateBaseOpacity } from '../src/follow';
import { THEME } from '../src/theme';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';
import b1 from '../data/floors/tra-concourse-b1.json';
import b2 from '../data/floors/tra-platform-b2.json';
import b3 from '../data/floors/mrt-r-concourse-b3.json';
import b4 from '../data/floors/mrt-r-platform-b4.json';
import { Blob } from 'node:buffer';

const DIM = THEME.emphasis.dim;

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
    const list = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const m of list) if ((m as THREE.Material).isMaterial) out.push((m as THREE.MeshStandardMaterial).opacity);
  });
  return out;
};

function checkEmphasis(station: THREE.Object3D, active: string): void {
  const conns = station.children.find((c) => c.name === 'connectors');
  const tops = station.children.filter((c) => c.name !== 'connectors').concat(conns ? [...conns.children] : []);
  const before = new Map(tops.map((c) => [c, opacities(c)] as const));
  setFloorEmphasis(station as THREE.Group, active);
  for (const [obj, base] of before) {
    const isConn = obj.parent === conns;
    const keep = isConn
      ? ((obj.userData.floors as string[] | undefined)?.includes(active) ?? true) // 未標 floors 保守不調暗
      : obj.name === active;
    const factor = keep ? 1 : DIM;
    opacities(obj).forEach((v, i) =>
      expect(v, `${obj.name || String(obj.userData.kind)}[${i}]`).toBeCloseTo(base[i] * factor, 5));
  }
  setFloorEmphasis(station as THREE.Group, null);
  for (const [obj, base] of before)
    opacities(obj).forEach((v, i) =>
      expect(v, `restore ${obj.name || String(obj.userData.kind)}[${i}]`).toBeCloseTo(base[i], 5));
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
    expect(matB.opacity).toBeCloseTo(0.8 * DIM, 5);
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
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.1 * DIM, 5);
    setFloorEmphasis(g, null);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.1, 5);
  });

  it('跟隨會話中 slider 更新基準：保留 dim 係數，退出後還原至新基準（複審 I-1R）', () => {
    const g = new THREE.Group();
    const fa = new THREE.Group();
    fa.name = 'floor-a';
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ opacity: 0.9, transparent: true }),
    );
    fa.add(mesh);
    g.add(fa);
    setFloorEmphasis(g, 'floor-b'); // fa 被調暗 → 0.135
    updateBaseOpacity(mesh, 0.45);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.45 * DIM, 5);
    setFloorEmphasis(g, null);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.45, 5);
    // 非會話中：直接生效
    updateBaseOpacity(mesh, 0.2);
    expect((mesh.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.2, 5);
  });

  it('陣列參數：兩樓層同時保持基準、其餘調暗（transition 雙層）', () => {
    const g = new THREE.Group();
    const mk = (name: string) => {
      const f = new THREE.Group();
      f.name = name;
      f.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ opacity: 0.8, transparent: true })));
      g.add(f);
      return f.children[0] as THREE.Mesh;
    };
    const a = mk('floor-a');
    const b = mk('floor-b');
    const c = mk('floor-c');
    setFloorEmphasis(g, ['floor-a', 'floor-b']);
    expect((a.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
    expect((b.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
    expect((c.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8 * DIM, 5);
    setFloorEmphasis(g, null);
    expect((c.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.8, 5);
  });

  it('dimFactor 參數：focusDim 生效、還原正常', () => {
    const g = new THREE.Group();
    const fa = new THREE.Group();
    fa.name = 'floor-a';
    fa.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ opacity: 1, transparent: false })));
    g.add(fa);
    setFloorEmphasis(g, 'floor-b', THEME.emphasis.focusDim);
    expect(((fa.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity)
      .toBeCloseTo(THEME.emphasis.focusDim, 5);
    setFloorEmphasis(g, null);
    expect(((fa.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(1, 5);
  });

  it('connectors 依 userData.floors：不觸 active 的豎井調暗、未標的保守不動', () => {
    const g = new THREE.Group();
    const fa = new THREE.Group();
    fa.name = 'floor-a';
    g.add(fa);
    const conns = new THREE.Group();
    conns.name = 'connectors';
    const mk = (floors?: string[]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshStandardMaterial({ opacity: 0.9, transparent: true }));
      if (floors) m.userData.floors = floors;
      conns.add(m);
      return m;
    };
    const touching = mk(['floor-a', 'floor-b']);
    const far = mk(['floor-b', 'floor-c']);
    const unstamped = mk();
    g.add(conns);
    setFloorEmphasis(g, 'floor-a');
    expect((touching.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.9, 5);
    expect((far.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.9 * DIM, 5);
    expect((unstamped.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.9, 5);
    setFloorEmphasis(g, null);
    expect((far.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.9, 5);
  });
});
