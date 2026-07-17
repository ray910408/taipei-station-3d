import AjvModule from 'ajv/dist/2020.js';
import stationSchema from '../schemas/station.schema.json';
import floorSchema from '../schemas/floor.schema.json';
import connectorsSchema from '../schemas/connectors.schema.json';
import type { ConnectorsDoc, FloorDoc, StationDoc, StationModel } from './types';

const Ajv2020 = (AjvModule as any).default ?? AjvModule;

export class LoaderError extends Error {
  constructor(message: string, public details: string[]) {
    super(message);
    this.name = 'LoaderError';
  }
}

export function assembleModel(
  stationDoc: unknown,
  floorDocsByFile: Record<string, unknown>,
  connectorsDoc: unknown,
  opts: { validate?: boolean } = {},
): StationModel {
  const details: string[] = [];
  if (opts.validate !== false) {
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const check = (schema: object, doc: unknown, label: string) => {
      const validate = ajv.compile(schema);
      if (!validate(doc)) {
        for (const e of validate.errors ?? []) details.push(`${label}${e.instancePath} ${e.message}`);
      }
    };
    check(stationSchema, stationDoc, 'data/station.json');
    for (const [file, doc] of Object.entries(floorDocsByFile)) check(floorSchema, doc, `data/${file}`);
    check(connectorsSchema, connectorsDoc, 'data/connectors.json');
    if (details.length) throw new LoaderError('資料 schema 驗證失敗', details);
  }

  const station = stationDoc as StationDoc;
  const floors = new Map<string, FloorDoc>();
  for (const meta of station.floors) {
    const doc = floorDocsByFile[meta.file];
    if (!doc) throw new LoaderError('缺少樓層檔', [`station.json 指到 ${meta.file}，但未載入`]);
    floors.set(meta.id, doc as FloorDoc);
  }
  return { station, floors, connectors: (connectorsDoc as ConnectorsDoc).connectors };
}
