import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/** 北捷開放資料 join key 稽核（見 refs/opendata/README.md）。
 *
 *  README 的「已知錯誤／正規化規則」清單被手寫維護時錯過三輪：漏檔、漏例外、
 *  掃描本身有盲區（用集合比對去宣稱順序沒問題）。所以改成這裡現掃現比：
 *  異常集合被凍結在 EXPECTED，重新下載 CSV 後只要異常有增減就會紅，
 *  逼人回去更新 README，而不是讓那份清單默默過期。 */

const R = new URL('../refs/opendata/', import.meta.url);
const read = (f: string) => readFileSync(new URL(f, R), 'utf8');

/** 最小 CSV parser：elevator-locations 有帶引號的多行欄位 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const body = (f: string, minCols: number) => parseCsv(read(f)).slice(1).filter((r) => r.length > minCols);

/** 站名去尾綴。台北車站本名就以「站」結尾，不能無腦去尾 */
const bareName = (s: string) => (s === '台北車站' ? s : s.replace(/站$/, '')).replace(/[（(].*/, '').trim();
/** 出口編號正規化：去「出口」前綴、單一出口→0，其餘（M2、2A…）原樣保留 */
const exitKey = (s: string) => (s === '單一出口' ? '0' : s.replace(/^出口/, ''));
const stationOf = (exitName: string) => /^(台北車站|.+?站)/.exec(exitName)?.[1] ?? '';

function audit(): string[] {
  const found = new Set<string>(); // 同一缺陷可能被多個索引命中，去重
  const acc = body('accessibility-facilities.csv', 3);
  const elv = body('elevator-locations.csv', 3);
  const coords = body('exit-coords.csv', 4);
  const ramps = body('exit-elevator-ramp-gps.csv', 4);

  const codeSet = (codes: string[]) => [...new Set(codes)].sort().join(',');
  const accCodes = new Map<string, string[]>();
  for (const r of acc) accCodes.set(bareName(r[2]), (accCodes.get(bareName(r[2])) ?? []).concat(r[1].split('/').map((s) => s.trim())));
  const elvCodes = new Map<string, string[]>();
  const lineCode = new Map<string, string>();
  for (const r of elv) {
    elvCodes.set(bareName(r[1]), (elvCodes.get(bareName(r[1])) ?? []).concat(r[2].trim()));
    lineCode.set(`${r[0].trim()}|${bareName(r[1])}`, r[2].trim());
  }

  for (const r of acc) {
    const lines = r[0].split('/').map((s) => s.trim());
    const codes = r[1].split('/').map((s) => s.trim());
    const name = bareName(r[2]);
    if (lines.length !== codes.length) { found.add(`arity ${r[2]} ${r[0]}|${r[1]}`); continue; }
    // 順序只在「兩檔的編號集合一致」時才判定——集合不一致是編號值錯（下面另報），
    // 拿有錯值的 elevator-locations 當真相會把值錯誤誤報成順序錯誤
    if (codeSet(codes) !== codeSet(elvCodes.get(name) ?? [])) continue;
    for (let i = 0; i < lines.length; i++) {
      const truth = lineCode.get(`${lines[i]}|${name}`);
      if (truth && truth !== codes[i]) found.add(`order ${r[2]} ${r[0]}|${r[1]}`);
    }
  }
  // 編號值：elevator-locations 的編號未出現在 accessibility 同站的編號集合裡
  for (const r of elv) {
    const name = bareName(r[1]), code = r[2].trim();
    if (!accCodes.get(name)?.includes(code)) found.add(`code ${name} ${code}`);
  }
  // 同一編號對到多站
  const byCode = new Map<string, Set<string>>();
  for (const r of elv) {
    const s = byCode.get(r[2].trim()) ?? new Set<string>();
    s.add(bareName(r[1]));
    byCode.set(r[2].trim(), s);
  }
  for (const [code, names] of byCode) if (names.size > 1) found.add(`dupcode ${code} ${[...names].sort().join(',')}`);

  // 出口編號：ramp-gps 每列都應能 join 回 exit-coords 的同站同編號
  const coordKeys = new Set(coords.map((r) => `${stationOf(r[1])}|${exitKey(r[2])}`));
  for (const r of ramps) {
    const k = `${stationOf(r[1])}|${exitKey(r[2])}`;
    if (!coordKeys.has(k)) found.add(`exitkey ${r[1]} ${r[2]}`);
  }
  // 座標值域：兩個帶經緯度的檔案。實際有效值 lon 121.41~121.62、lat 24.96~25.17，
  // 這裡取大台北的寬鬆外框，抓的是掉小數點／非數值這種明顯壞值
  for (const [f, rows] of [['exit-coords.csv', coords], ['exit-elevator-ramp-gps.csv', ramps]] as const) {
    for (const r of rows) {
      const lon = Number(r[3]), lat = Number(r[4]);
      const ok = Number.isFinite(lon) && Number.isFinite(lat)
        && lon >= 121.3 && lon <= 121.7 && lat >= 24.9 && lat <= 25.3;
      if (!ok) found.add(`coord ${f} ${r[1]} ${r[3]},${r[4]}`);
    }
  }
  // 站名異體字
  for (const f of ['accessibility-facilities.csv', 'elevator-locations.csv', 'exit-elevator-ramp-gps.csv',
    'exit-coords.csv', 'station-facilities.csv']) if (read(f).includes('幸褔')) found.add(`typo幸褔 ${f}`);

  return [...found].sort();
}

/** README「已知原檔錯誤」的機器可讀版本。有增減＝原檔換版或掃描邏輯變了，兩邊都要更新。 */
const EXPECTED = [
  'arity 松江南京站 中和新蘆線|O08/G15',        // Line 只給一條、Station_Number 給兩個（G15 會被丟掉）
  'code 中山國中 BF12',                        // 應為 BR12
  'code 七張 G03A',                            // 應為 G03
  'coord exit-elevator-ramp-gps.csv 圓山站出口無障礙坡道2 121.5201211,250717908', // 緯度掉小數點
  'dupcode G03A 七張,小碧潭',                  // 同上的後果：同編號對到兩站
  'exitkey 奇岩站出口無障礙坡道 單一出口',      // exit-coords 只有出口 1/2/3、無 0
  'exitkey 幸褔站出口電梯 出口1',               // 幸褔異體字的連帶後果：站名對不上就 join 不到
  'order 台北車站 淡水信義線/板南線|BL12/R10',  // 實際 淡水信義線=R10、板南線=BL12
  'typo幸褔 accessibility-facilities.csv',
  'typo幸褔 elevator-locations.csv',
  'typo幸褔 exit-elevator-ramp-gps.csv',
].sort();

describe('北捷開放資料 join key 稽核', () => {
  it('異常集合與 README 的已知錯誤清單一致', () => {
    expect(audit()).toEqual(EXPECTED);
  });

  it('出口編號正規化涵蓋所有出現過的形態', () => {
    const shapes = new Set<string>();
    for (const f of ['exit-elevator-ramp-gps.csv', 'exit-coords.csv']) {
      for (const r of body(f, 4)) {
        const v = r[2];
        shapes.add(v === '單一出口' ? '單一出口' : /^出口/.test(v) ? '出口+' : /^\d+[A-Z]?$/.test(v) ? '數字(+字母)' : /^M\d+$/.test(v) ? 'M+數字' : `未知:${v}`);
      }
    }
    // 未知形態＝正規化規則有洞，README 要補
    expect([...shapes].sort()).toEqual(['M+數字', '出口+', '單一出口', '數字(+字母)']);
  });
});
