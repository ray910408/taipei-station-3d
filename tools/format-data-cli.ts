// format-data 的 CLI 進入點——與函式庫分離，因為 format-data.ts 會被 vite.config.ts
// 間接載入（save-handler），頂層副作用會在每次 vite dev/build 讀設定檔時觸發。
// 用法：npm run format:data [-- --check] [rootDir]（--check 只檢查不寫檔，違規 exit 1）
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataFiles, formatDataJson } from './format-data';

const check = process.argv.includes('--check');
const root = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '.';
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
