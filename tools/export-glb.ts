// 離線匯出：data/*.json → public/models/station.glb（以 vite-node 在 node 執行）
// 用法：npm run export:glb [-- rootDir]
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
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { loadRepoDocs } from './validate.mjs';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';

const root = process.argv[2] ?? '.';
const docs = loadRepoDocs(root);
const floorDocsByFile: Record<string, unknown> = {};
for (const f of docs.station.floors ?? []) floorDocsByFile[f.file] = docs.floors.get(f.id);
const model = assembleModel(docs.station, floorDocsByFile, docs.connectors);
const group = buildStationGroup(model);

const exporter = new GLTFExporter();
const glb = (await exporter.parseAsync(group, { binary: true })) as ArrayBuffer;
const out = path.join(root, 'public', 'models', 'station.glb');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(glb));
console.log(`已匯出 ${out}（${(glb.byteLength / 1024).toFixed(0)} KB）`);
