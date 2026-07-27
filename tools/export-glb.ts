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
import { loadRepoDocs, validateDocs } from './validate';
import { assembleModel } from '../src/loader';
import { buildStationGroup } from '../src/builder';

const root = process.argv[2] ?? '.';
const docs = loadRepoDocs(root);

// 本工具是唯一從磁碟現讀資料的 assembleModel 呼叫端（viewer 與 tracer 都吃 build 時
// 內嵌的常數，由 CI 的 npm run validate 把關）。手改過 data/ 後直接跑 export:glb 時，
// CI 那道關卡不在，所以在這裡自己驗——否則會拿 schema 不合的資料烘出一份壞 GLB。
const { errors, warnings } = validateDocs(docs);
for (const w of warnings) console.warn(`WARN  ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`ERROR ${e}`);
  console.error(`資料驗證未通過（${errors.length} 項），不匯出。先修好資料或跑 npm run validate 看完整報告。`);
  process.exit(1);
}

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
