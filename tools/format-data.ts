// data/*.json 與 refs/sources.json 的唯一序列化格式：2 空格縮排、純數字陣列（座標對等）單行。
// tracer 存檔與人工編修共用，確保 diff 穩定。
// 純函式庫，零頂層副作用——vite.config.ts 會經 save-handler 間接載入本檔，
// 任何頂層動作都會在每次 vite dev/build 載入設定檔時觸發。CLI 進入點在 format-data-cli.ts。
import { readdirSync } from 'node:fs';
import path from 'node:path';

export function formatDataJson(value: unknown): string {
  return fmt(value, 0) + '\n';
}

function fmt(v: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    if (v.every((x) => typeof x === 'number')) {
      if (!v.every((x) => Number.isFinite(x))) throw new Error('JSON 不允許非有限數值');
      return `[${v.map((x) => JSON.stringify(x)).join(', ')}]`;
    }
    return `[\n${v.map((x) => padIn + fmt(x, indent + 1)).join(',\n')}\n${pad}]`;
  }
  if (v !== null && typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    const keys = Object.keys(rec).filter((k) => rec[k] !== undefined);
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${padIn}${JSON.stringify(k)}: ${fmt(rec[k], indent + 1)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
}

export function dataFiles(rootDir: string): string[] {
  const floorDir = path.join(rootDir, 'data', 'floors');
  const floors = readdirSync(floorDir).filter((f) => f.endsWith('.json'))
    .map((f) => `data/floors/${f}`).sort();
  return ['data/station.json', 'data/connectors.json', ...floors, 'refs/sources.json'];
}

