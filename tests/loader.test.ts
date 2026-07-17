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

  it('schema 違規 throw LoaderError 且 details 指出檔案', () => {
    const bad = structuredClone(stationDoc) as any;
    bad.schema = 'station@9';
    expect(() => assembleModel(bad, floorDocs, connectorsDoc)).toThrowError(LoaderError);
    try {
      assembleModel(bad, floorDocs, connectorsDoc);
    } catch (e) {
      expect((e as LoaderError).details.some((d) => d.includes('station'))).toBe(true);
    }
  });

  it('缺少樓層檔 throw LoaderError', () => {
    expect(() => assembleModel(stationDoc, { 'floors/hall-b1.json': hall }, connectorsDoc))
      .toThrowError(LoaderError);
  });
});
