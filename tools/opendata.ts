/** 北捷開放資料 join key 正規化——`tests/opendata-joinkeys.test.ts` 與
 *  `tests/frame-bearing.test.ts` 共用，避免規則改版時兩檔各自維護一份、靜默分岔
 *  （第十一輪 review 抓到的 CSV parser 重複就是同一種問題）。 */

/** 站名去尾綴。台北車站本名就以「站」結尾，不能無腦去尾 */
export const bareName = (s: string) => (s === '台北車站' ? s : s.replace(/站$/, '')).replace(/[（(].*/, '').trim();

/** 出口編號正規化：去「出口」前綴、單一出口→0，其餘（M2、2A…）原樣保留 */
export const exitKey = (s: string) => (s === '單一出口' ? '0' : s.replace(/^出口/, ''));

/** 從出入口名稱擷取站名（如「七張站出口1」→「七張站」）。查無比對時回傳空字串而非 undefined，
 *  呼叫端用 `!station` 濾掉即可——空字串與 undefined 都是 falsy，行為等價。 */
export const stationOf = (exitName: string) => /^(台北車站|.+?站)/.exec(exitName)?.[1] ?? '';
