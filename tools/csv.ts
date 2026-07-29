/** 嚴格 CSV parser（RFC 4180 的子集）。
 *
 *  存在的理由：`refs/opendata/*.csv` 有帶引號的多行欄位，用 `split(',')` 逐行切會在
 *  遇到合法的引號逗號時整列錯位、還安靜地少掉資料。凡是讀那些 CSV 的地方都走這裡。
 *
 *  「嚴格」指的是把下列寫法當語法錯誤回報，而不是寬鬆吃下去——它們都不會改變列數欄數，
 *  於是任何以列數／欄數為準的檢查都看不見：
 *  - 檔尾引號未收（最後一欄會把剩下的內容整包吞進去）
 *  - 收尾引號後接了逗號／換行／檔尾以外的字元（`"月臺層"x`）
 *  - 引號從欄位中途才開始（`月臺"層"`）
 *  - 未引號區出現孤立的 `\r`（非 CRLF，即 `\r` 後面不是 `\n`）
 *
 *  引號內的 `\r`（含引號內 CRLF）維持原樣當內容保留，不受上述規則影響。
 */
export interface CsvParseResult {
  rows: string[][];
  /** 語法問題描述（含行號）；空陣列＝乾淨 */
  malformed: string[];
}

export function parseCsv(text: string): CsvParseResult {
  const rows: string[][] = [];
  const malformed: string[] = [];
  let field = '', row: string[] = [], quoted = false, line = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\n') line++;
      if (c !== '"') { field += c; continue; }
      if (text[i + 1] === '"') { field += '"'; i++; continue; }
      quoted = false;
      const next = text[i + 1];
      if (next !== undefined && next !== ',' && next !== '\n' && next !== '\r') {
        malformed.push(`第${line}行 收尾引號後接了 ${JSON.stringify(next)}`);
      }
    } else if (c === '"') {
      if (field !== '') malformed.push(`第${line}行 引號從欄位中途開始（${JSON.stringify(field.slice(-8) + '"')}）`);
      quoted = true;
    } else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; line++; }
    else if (c === '\r') {
      if (text[i + 1] !== '\n') malformed.push(`第${line}行 孤立的 \\r（非 CRLF）`);
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (quoted) malformed.push('檔尾引號未收');
  return { rows, malformed };
}
