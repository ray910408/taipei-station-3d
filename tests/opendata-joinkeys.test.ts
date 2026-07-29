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
function parseCsv(text: string): { rows: string[][]; unterminated: boolean } {
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
  // 走到檔尾引號還沒收＝檔案語法壞掉。此時最後那個欄位會把剩下的內容整包吞進去，
  // 列數欄數卻可能仍然「看起來正常」，所以要另外報出來
  return { rows, unterminated: quoted };
}
/** 資料列（不含標頭）。**不丟任何列**——欄數不對的列會被 `malformed` 檢查抓出來，
 *  在這裡 filter 掉等於讓截斷的列從所有後續檢查中安靜消失。 */
const body = (f: string) => parseCsv(read(f)).rows.slice(1);
const header = (f: string) => parseCsv(read(f)).rows[0];

/** 站名去尾綴。台北車站本名就以「站」結尾，不能無腦去尾 */
const bareName = (s: string) => (s === '台北車站' ? s : s.replace(/站$/, '')).replace(/[（(].*/, '').trim();
/** 出口編號正規化：去「出口」前綴、單一出口→0，其餘（M2、2A…）原樣保留 */
const exitKey = (s: string) => (s === '單一出口' ? '0' : s.replace(/^出口/, ''));
const stationOf = (exitName: string) => /^(台北車站|.+?站)/.exec(exitName)?.[1] ?? '';

/** 這份快照的形狀，凍結起來。**不能拿進來的檔案自己的標頭當 schema**——整份被截掉一欄
 *  （標頭與每一列一起少）時那樣看是自洽的，一個欄位就這麼靜靜不見了。 */
const SCHEMA: Record<string, { rows: number; header: string[] }> = {
  'accessibility-facilities.csv': {
    rows: 118,
    header: ['Line', 'Station_Number', 'Station_Name', 'Station_Form', 'PAO', 'Elevator_and_Wheelchair_Ramps',
      'Ticket_Gates_for_the_Disabled', 'Toilet_Facilities_for_Disabled', 'Reserved_Spaces_for_Wheelchairs',
      'Doors_Open_Side', 'Elevator', 'Anti_slip_Strips', 'Train_Destination_Announcements', 'Public_Address_System',
      'Priority_Seats_for_Visually_Impaired_Passengers', 'Tactile_Guide_Paths_quantity',
      'Passenger_Information_Display_Systems_count', 'door_indicator_light_count',
      'Train_Passenger_Information_Systems_quantity', '1999_Sign_Language_Service_quantity'],
  },
  'elevator-locations.csv': { rows: 135, header: ['路線別', '車站名稱', '車站編號', '電梯位置', '更新日期'] },
  'station-facilities.csv': {
    rows: 119, // 118 站＋板橋依線別拆兩列
    header: ['序號/編號', '縣市別代碼', '地址-行政區域代碼', '車站名稱', '電梯', '電扶梯', '銀行ATM',
      '哺集乳室', '嬰兒尿布台', '飲水機/飲水臺', '充電站', '自動售票機', '廁所'],
  },
  'exit-coords.csv': { rows: 388, header: ['項次', '出入口名稱', '出入口編號', '經度', '緯度', '是否為無障礙用'] },
  'exit-elevator-ramp-gps.csv': { rows: 190, header: ['項次', '出入口電梯/無障礙坡道名稱', '出入口編號', '經度', '緯度'] },
};
const FILES = Object.keys(SCHEMA);
/** 各檔的站名取法（正規化後應五檔一致） */
const STATION_COL: Record<string, (r: string[]) => string> = {
  'accessibility-facilities.csv': (r) => bareName(r[2]),
  'elevator-locations.csv': (r) => bareName(r[1]),
  'station-facilities.csv': (r) => bareName(r[3]),
  'exit-coords.csv': (r) => bareName(stationOf(r[1])),
  'exit-elevator-ramp-gps.csv': (r) => bareName(stationOf(r[1])),
};

function audit(): string[] {
  const found = new Set<string>(); // 同一缺陷可能被多個索引命中，去重

  // 檔案形狀：標頭欄名、列數、每列欄數都對凍結的 SCHEMA 比，而不是對檔案自己的標頭比
  for (const f of FILES) {
    const want = SCHEMA[f];
    if (parseCsv(read(f)).unterminated) found.add(`unterminated ${f}`);
    const got = header(f);
    if (got.join(',') !== want.header.join(',')) found.add(`schema ${f} 標頭不符 ${got.join(',')}`);
    const rows = body(f).filter((r) => !(r.length === 1 && r[0] === '')); // 檔尾空行不算
    if (rows.length !== want.rows) found.add(`rowcount ${f} ${rows.length}≠${want.rows}`);
    body(f).forEach((r, i) => {
      if (r.length === 1 && r[0] === '') return;
      if (r.length !== want.header.length) found.add(`malformed ${f} 第${i + 2}列 欄數${r.length}≠${want.header.length}`);
    });
  }
  const rowsOf = (f: string) => body(f).filter((r) => r.length === SCHEMA[f].header.length);
  const acc = rowsOf('accessibility-facilities.csv');
  const elv = rowsOf('elevator-locations.csv');
  const coords = rowsOf('exit-coords.csv');
  const ramps = rowsOf('exit-elevator-ramp-gps.csv');

  // 站名集合：README 宣稱「正規化後五檔 118 站完全對齊」，這裡把那句話變成可驗的
  // （幸褔異體字另有 typo 條目，先正規化掉才不會重複報同一件事）
  const stations = new Map(FILES.map((f) =>
    [f, new Set(rowsOf(f).map((r) => STATION_COL[f](r).replace('幸褔', '幸福')).filter(Boolean))]));
  const union = new Set([...stations.values()].flatMap((s) => [...s]));
  for (const [f, s] of stations) {
    const missing = [...union].filter((x) => !s.has(x)).sort();
    if (missing.length) found.add(`stationset ${f} 缺 ${missing.join(',')}`);
  }
  if (union.size !== 118) found.add(`stationcount ${union.size}≠118`);

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
    // 線別對照的存在性**先獨立驗**，不受下面任何 gate 影響。查無對照＝線別寫法在兩檔
    // 對不上（錯字、異體字），也是壞掉的 join key；掛在 gate 後面的話，凡是已有編號值
    // 錯誤的站（中山國中、七張）就永遠驗不到線別
    for (const line of lines) {
      if (!lineCode.has(`${line}|${name}`)) found.add(`lineunknown ${r[2]} ${line}`);
    }
    if (lines.length !== codes.length) { found.add(`arity ${r[2]} ${r[0]}|${r[1]}`); continue; }
    // 順序只在「兩檔的編號集合一致」時才判定——集合不一致是編號值錯（下面另報），
    // 拿有錯值的 elevator-locations 當真相會把值錯誤誤報成順序錯誤
    if (codeSet(codes) !== codeSet(elvCodes.get(name) ?? [])) continue;
    for (let i = 0; i < lines.length; i++) {
      if (lineCode.get(`${lines[i]}|${name}`) !== codes[i]) found.add(`order ${r[2]} ${r[0]}|${r[1]}`);
    }
  }
  // 編號值：兩檔的每站編號集合**雙向**比對。單向只查「elv 的編號在不在 acc 裡」的話，
  // acc 多出一個假編號時仍然全中、稽核照樣綠
  for (const name of new Set([...accCodes.keys(), ...elvCodes.keys()])) {
    const a = codeSet(accCodes.get(name) ?? []), e = codeSet(elvCodes.get(name) ?? []);
    if (a !== e) found.add(`code ${name} elv=${e} acc=${a}`);
  }
  // 同一編號對到多站
  const byCode = new Map<string, Set<string>>();
  for (const r of elv) {
    const s = byCode.get(r[2].trim()) ?? new Set<string>();
    s.add(bareName(r[1]));
    byCode.set(r[2].trim(), s);
  }
  for (const [code, names] of byCode) if (names.size > 1) found.add(`dupcode ${code} ${[...names].sort().join(',')}`);

  // 出口編號：ramp-gps 每列都應能 join 回 exit-coords 的同站同編號。
  // exit-coords 這側先驗唯一性——把某站的出口改標成另一站既有的編號時，列數與座標值域
  // 都不動、若該出口又沒有 ramp 對應列就完全無聲，只有重複鍵看得出來
  const coordCount = new Map<string, number>();
  for (const r of coords) {
    const k = `${stationOf(r[1])}|${exitKey(r[2])}`;
    coordCount.set(k, (coordCount.get(k) ?? 0) + 1);
  }
  for (const [k, n] of coordCount) if (n > 1) found.add(`dupexit exit-coords.csv ${k} x${n}`);
  for (const r of ramps) {
    const k = `${stationOf(r[1])}|${exitKey(r[2])}`;
    if (!coordCount.has(k)) found.add(`exitkey ${r[1]} ${r[2]}`);
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
  // 前導單引號：Excel 匯出「強制文字」的殘留，會被當成內容的一部分渲染出去
  for (const f of FILES) {
    for (const r of rowsOf(f)) {
      r.forEach((v, i) => { if (v.startsWith("'")) found.add(`apostrophe ${f} ${SCHEMA[f].header[i]} ${v.slice(0, 12)}`); });
    }
  }
  // 站名異體字
  for (const f of ['accessibility-facilities.csv', 'elevator-locations.csv', 'exit-elevator-ramp-gps.csv',
    'exit-coords.csv', 'station-facilities.csv']) if (read(f).includes('幸褔')) found.add(`typo幸褔 ${f}`);

  return [...found].sort();
}

/** README「已知原檔錯誤」的機器可讀版本。有增減＝原檔換版或掃描邏輯變了，兩邊都要更新。 */
const EXPECTED = [
  "apostrophe station-facilities.csv 充電站 '非付費區，近出口2", // 三和國中；Excel 強制文字殘留
  'arity 松江南京站 中和新蘆線|O08/G15',        // Line 只給一條、Station_Number 給兩個（G15 會被丟掉）
  'code 中山國中 elv=BF12 acc=BR12',            // elevator-locations 那邊錯，應為 BR12
  'code 七張 elv=G03A acc=G03',                // 同上，應為 G03
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
      for (const r of body(f).filter((r) => r.length === SCHEMA[f].header.length)) {
        const v = r[2];
        shapes.add(v === '單一出口' ? '單一出口' : /^出口/.test(v) ? '出口+' : /^\d+[A-Z]?$/.test(v) ? '數字(+字母)' : /^M\d+$/.test(v) ? 'M+數字' : `未知:${v}`);
      }
    }
    // 未知形態＝正規化規則有洞，README 要補
    expect([...shapes].sort()).toEqual(['M+數字', '出口+', '單一出口', '數字(+字母)']);
  });
});
