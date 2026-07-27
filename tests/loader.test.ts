import { describe, it, expect } from 'vitest';
import { assembleModel, LoaderError } from '../src/loader';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const floorDocs = { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat };

describe('assembleModel', () => {
  it('合法資料組成 StationModel', () => {
    const model = assembleModel(stationDoc, floorDocs, connectorsDoc);
    expect(model.station.id).toBe('mini-station');
    expect(model.floors.size).toBe(2);
    expect(model.floors.get('hall-b1')?.gates?.length).toBe(2);
    expect(model.connectors.length).toBe(2);
  });

  // schema 違規不在此把關：資料為 build 時內嵌常數，schema 由 CI 的 npm run validate
  // 於 build 前驗過（見 tests/validate.test.ts）。此處只守組裝期的參照完整性。
  it('缺少樓層檔 throw LoaderError 且 details 指出檔案', () => {
    const call = () => assembleModel(stationDoc, { 'floors/hall-b1.json': hall }, connectorsDoc);
    expect(call).toThrowError(LoaderError);
    try {
      call();
    } catch (e) {
      expect((e as LoaderError).details.some((d) => d.includes('plat-b2.json'))).toBe(true);
    }
  });
});
