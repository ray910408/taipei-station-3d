// data/*.json 與 refs/sources.json 的唯一序列化格式：2 空格縮排、純數字陣列（座標對等）單行。
// tracer 存檔與人工編修共用，確保 diff 穩定。
// 用法：node tools/format-data.mjs [--check] [rootDir]（--check 只檢查不寫檔，違規 exit 1）
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function formatDataJson(value) {
  return fmt(value, 0) + '\n';
}

function fmt(v, indent) {
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
    const keys = Object.keys(v).filter((k) => v[k] !== undefined);
    if (keys.length === 0) return '{}';
    return `{\n${keys.map((k) => `${padIn}${JSON.stringify(k)}: ${fmt(v[k], indent + 1)}`).join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(v);
}

export function dataFiles(rootDir) {
  const floorDir = path.join(rootDir, 'data', 'floors');
  const floors = readdirSync(floorDir).filter((f) => f.endsWith('.json'))
    .map((f) => `data/floors/${f}`).sort();
  return ['data/station.json', 'data/connectors.json', ...floors, 'refs/sources.json'];
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const root = process.argv.filter((a) => !a.startsWith('--'))[2] ?? '.';
  let changed = 0;
  for (const rel of dataFiles(root)) {
    const p = path.join(root, rel);
    const current = readFileSync(p, 'utf8');
    const canonical = formatDataJson(JSON.parse(current));
    if (current === canonical) continue;
    changed++;
    if (check) console.error(`非 canonical 格式：${rel}`);
    else { writeFileSync(p, canonical, 'utf8'); console.log(`已重排：${rel}`); }
  }
  console.log(`format-data: ${changed} 檔${check ? '需重排' : '已重排'}，共 ${dataFiles(root).length} 檔`);
  if (check && changed) process.exit(1);
}
