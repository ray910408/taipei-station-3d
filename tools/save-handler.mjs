// tracer 存檔核心：整批（多檔）換入 → 全站驗證 → 全過才寫檔（canonical 格式）。
// 由 vite dev plugin 的 POST /__tracer/save 呼叫；可單獨測試。
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatDataJson } from './format-data.mjs';
import { loadRepoDocs, validateDocs } from './validate.mjs';

const SAVABLE = /^(data\/floors\/[a-z0-9-]+\.json|data\/connectors\.json|data\/station\.json|refs\/sources\.json)$/;

/** files: Array<{ file, doc }> → { ok, errors, written } */
export function applySave(rootDir, files) {
  if (!Array.isArray(files) || files.length === 0) return fail(['payload 必須是非空 files 陣列']);
  for (const f of files) {
    if (!f || typeof f.file !== 'string' || !SAVABLE.test(f.file)) return fail([`不允許寫入的路徑：${f?.file}`]);
    if (f.doc === null || typeof f.doc !== 'object') return fail([`${f.file}: doc 必須是物件`]);
  }
  let docs;
  try { docs = loadRepoDocs(rootDir); } catch (e) { return fail([`讀取現有資料失敗：${e.message}`]); }
  for (const { file, doc } of files) {
    if (file === 'data/station.json') docs.station = doc; // 注意：floors map 仍依載入時清單（tracer 不新增樓層）
    else if (file === 'data/connectors.json') docs.connectors = doc;
    else if (file === 'refs/sources.json') docs.sources = doc;
    else {
      const meta = (docs.station.floors ?? []).find((fl) => `data/${fl.file}` === file);
      if (!meta) return fail([`${file} 不在 station.json floors 清單`]);
      docs.floors.set(meta.id, doc);
    }
  }
  const { errors } = validateDocs(docs);
  if (errors.length) return fail(errors);
  const written = [];
  for (const { file, doc } of files) {
    writeFileSync(path.join(rootDir, file), formatDataJson(doc), 'utf8');
    written.push(file);
  }
  return { ok: true, errors: [], written };
}

function fail(errors) {
  return { ok: false, errors, written: [] };
}
