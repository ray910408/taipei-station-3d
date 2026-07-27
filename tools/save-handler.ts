// tracer 存檔核心：整批（多檔）換入 → 全站驗證 → 全過才寫檔（canonical 格式）。
// 由 vite dev plugin 的 POST /__tracer/save 呼叫；可單獨測試。
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConnectorsDoc, FloorDoc, SourcesDoc, StationDoc } from '../src/types';
import { formatDataJson } from './format-data';
import { loadRepoDocs, validateDocs, type RepoDocs } from './validate';

const SAVABLE = /^(data\/floors\/[a-z0-9-]+\.json|data\/connectors\.json|data\/station\.json|refs\/sources\.json)$/;

export interface SaveFile { file: string; doc: unknown }
export interface SaveResult { ok: boolean; errors: string[]; written: string[] }

/** doc 來自 tracer 的 HTTP payload，形狀不可信——先擋路徑與型別，換入後一律走 validateDocs 把關。 */
export function applySave(rootDir: string, files: SaveFile[]): SaveResult {
  if (!Array.isArray(files) || files.length === 0) return fail(['payload 必須是非空 files 陣列']);
  for (const f of files) {
    if (!f || typeof f.file !== 'string' || !SAVABLE.test(f.file)) return fail([`不允許寫入的路徑：${f?.file}`]);
    if (f.doc === null || typeof f.doc !== 'object') return fail([`${f.file}: doc 必須是物件`]);
  }
  let docs: RepoDocs;
  try { docs = loadRepoDocs(rootDir); } catch (e) { return fail([`讀取現有資料失敗：${(e as Error).message}`]); }
  for (const { file, doc } of files) {
    if (file === 'data/station.json') docs.station = doc as StationDoc; // 注意：floors map 仍依載入時清單（tracer 不新增樓層）
    else if (file === 'data/connectors.json') docs.connectors = doc as ConnectorsDoc;
    else if (file === 'refs/sources.json') docs.sources = doc as SourcesDoc;
    else {
      const meta = (docs.station.floors ?? []).find((fl) => `data/${fl.file}` === file);
      if (!meta) return fail([`${file} 不在 station.json floors 清單`]);
      docs.floors.set(meta.id, doc as FloorDoc);
    }
  }
  const { errors } = validateDocs(docs);
  if (errors.length) return fail(errors);
  const written: string[] = [];
  for (const { file, doc } of files) {
    writeFileSync(path.join(rootDir, file), formatDataJson(doc), 'utf8');
    written.push(file);
  }
  return { ok: true, errors: [], written };
}

function fail(errors: string[]): SaveResult {
  return { ok: false, errors, written: [] };
}
