import type { ConnectorsDoc, FloorDoc, StationDoc, StationModel } from './types';

export class LoaderError extends Error {
  constructor(message: string, public details: string[]) {
    super(message);
    this.name = 'LoaderError';
  }
}

/** data/*.json 由 import.meta.glob 於 build 時靜態內嵌——schema 正確性在 CI 由
 *  `npm run validate` 於 build 前把關（同一份 schemas/，另含參照/幾何/語意檢查），
 *  tracer 寫入路徑則由 dev server 的 applySave → validateDocs 把關。
 *  瀏覽器端不再重驗一次建置常數（省下 ajv ~107 KB）；此處只保留組裝期的參照完整性。 */
export function assembleModel(
  stationDoc: unknown,
  floorDocsByFile: Record<string, unknown>,
  connectorsDoc: unknown,
): StationModel {
  const station = stationDoc as StationDoc;
  const floors = new Map<string, FloorDoc>();
  for (const meta of station.floors) {
    const doc = floorDocsByFile[meta.file];
    if (!doc) throw new LoaderError('缺少樓層檔', [`station.json 指到 ${meta.file}，但未載入`]);
    floors.set(meta.id, doc as FloorDoc);
  }
  return { station, floors, connectors: (connectorsDoc as ConnectorsDoc).connectors };
}
