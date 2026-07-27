// validate 的 CLI 進入點——與函式庫分離，因為 validate.ts 會被 vite.config.ts
// 間接載入（save-handler），頂層副作用會在每次 vite dev/build 讀設定檔時觸發。
// 用法：npm run validate [-- rootDir]（rootDir 需含 data/ 與 refs/sources.json）
import { loadRepoDocs, validateDocs, type RepoDocs } from './validate';

const root = process.argv[2] ?? '.';
let docs: RepoDocs;
try {
  docs = loadRepoDocs(root);
} catch (e) {
  console.error(`讀取資料失敗：${(e as Error).message}`);
  process.exit(1);
}
const { errors, warnings } = validateDocs(docs);
for (const w of warnings) console.warn(`WARN  ${w}`);
for (const e of errors) console.error(`ERROR ${e}`);
console.log(`validate: ${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length ? 1 : 0);
