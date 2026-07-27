// Khronos glTF-Validator 檢查匯出檔（0 errors 為通過）
// 用法：node tools/validate-glb.mjs [glbPath]
import { readFileSync } from 'node:fs';
import validator from 'gltf-validator';

const file = process.argv[2] ?? 'public/models/station.glb';
const report = await validator.validateBytes(new Uint8Array(readFileSync(file)));
const { numErrors, numWarnings, numInfos } = report.issues;
for (const m of report.issues.messages) {
  const level = ['ERROR', 'WARN', 'INFO', 'HINT'][m.severity];
  console.log(`${level} ${m.pointer ?? ''} ${m.message}`);
}
console.log(`glTF validation: ${numErrors} errors, ${numWarnings} warnings, ${numInfos} infos（${file}）`);
process.exit(numErrors ? 1 : 0);
