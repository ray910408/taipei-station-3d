import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../tools/csv';
import stationDoc from '../data/station.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

/** 框架方位角一致性護欄（見 docs/data-conventions.md「方位角」）：
 *  模型的月台軸換算成真方位角後，必須落在北捷開放資料出入口 GPS 推得的實際 R 線走向附近。
 *  bearing_deg 被改、或月台幾何被整體旋轉，這裡就會紅。
 *
 *  容差 = 參考值本身的解析度，不是精度宣稱。參考值是「站的出口重心連線」，而重心不是
 *  軌道上的點。推導見 docs/data-conventions.md：出口離散度要先投影到弦的法向
 *  （方位角只吃垂直於弦的那半），再算進「兩條半弦共用台北車站端點」的共變異，
 *  得隨機項 ±1.6°；直接拿二維徑向 RMS 又當兩弦獨立，會高估成 ±4.9°。
 *  容差取 6°，餘裕留給那條式子涵蓋不到的系統性偏差：台北車站(BL12/R10)、中山(R11/G14)
 *  都是轉乘站，重心會被非 R 線的站體拉走，而 CSV 沒有逐出口的線別可供拆分。
 *  所以這裡只當「有沒有被整個轉掉」的護欄，不拿來宣稱方位角精度。 */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const LAT0 = 25.0467;
const M_PER_LAT = 111132.92 - 559.82 * Math.cos(rad(2 * LAT0)) + 1.175 * Math.cos(rad(4 * LAT0));
const M_PER_LON = 111412.84 * Math.cos(rad(LAT0)) - 93.5 * Math.cos(rad(3 * LAT0));

/** 各站出入口經緯度重心（refs/opendata/exit-coords.csv：項次,名稱,編號,經度,緯度,無障礙）。
 *  用共用 parser 而不是 split(',')——出入口名稱若合法地帶引號含逗號，逐行切會整列錯位，
 *  那一筆出口就安靜地從重心裡消失，而 bearing 斷言仍然會過。 */
function exitStats(): Map<string, { c: [number, number]; n: number }> {
  const csv = readFileSync(new URL('../refs/opendata/exit-coords.csv', import.meta.url), 'utf8');
  const { rows, malformed } = parseCsv(csv);
  if (malformed.length) throw new Error(`exit-coords.csv 語法有問題：${malformed.join('；')}`);
  const acc = new Map<string, [number, number, number]>();
  for (const c of rows.slice(1)) {
    if (c.length < 5) continue;
    const station = /^(台北車站|.+?站)/.exec(c[1])?.[1];
    const lon = Number(c[3]), lat = Number(c[4]);
    if (!station || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const [x, y, n] = acc.get(station) ?? [0, 0, 0];
    acc.set(station, [x + lon, y + lat, n + 1]);
  }
  return new Map([...acc].map(([k, [x, y, n]]) => [k, { c: [x / n, y / n] as [number, number], n }]));
}

/** a→b 的真方位角（度，北為 0、順時針） */
function bearing(a: [number, number], b: [number, number]): number {
  return deg(Math.atan2((b[0] - a[0]) * M_PER_LON, (b[1] - a[1]) * M_PER_LAT));
}

/** 多邊形主軸與 local +Y 的夾角（度）——以邊長加權的二階矩取主軸 */
function axisFromPlusY(polygon: number[][]): number {
  let cx = 0, cy = 0, len = 0;
  const mids = polygon.map((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, l] as const;
  });
  for (const [x, y, l] of mids) { cx += x * l; cy += y * l; len += l; }
  cx /= len; cy /= len;
  let mxx = 0, myy = 0, mxy = 0;
  for (const [x, y, l] of mids) {
    const dx = x - cx, dy = y - cy;
    mxx += dx * dx * l; myy += dy * dy * l; mxy += dx * dy * l;
  }
  return 90 - deg(0.5 * Math.atan2(2 * mxy, mxx - myy));
}

describe('框架方位角：模型月台軸 vs 實際 R 線走向', () => {
  const stats = exitStats();
  const at = (s: string) => {
    const v = stats.get(s);
    if (!v) throw new Error(`exit-coords.csv 找不到 ${s}`);
    return v.c;
  };

  it('出入口 CSV 仍含 R 線三站，且出口數與文件的推導一致', () => {
    // 出口數要一起釘住：少一筆出口不會讓下面的 bearing 斷言變紅（掉一個台大醫院出口，
    // 平均值仍落在 17° 附近），但 docs 那段不確定度就不是照這些點算出來的了
    const n = Object.fromEntries(['台大醫院站', '台北車站', '中山站'].map((s) => [s, stats.get(s)?.n]));
    expect(n).toEqual({ 台大醫院站: 4, 台北車站: 8, 中山站: 6 });
  });

  it('station.json 有記 bearing_deg——缺欄位就沒東西可護', () => {
    // schema 裡 bearing_deg 是選填，刪掉仍合法；不可讓下面的比對靜默代入 90 而通過
    expect((stationDoc.frame as { bearing_deg?: number }).bearing_deg).toBeTypeOf('number');
  });

  it('bearing_status 仍是 estimated——出口重心撐不起 surveyed', () => {
    // schema 允許 surveyed，但這份開放資料只能給到隨機項 ±1.6°＋未量化的系統性偏差（見 docs/data-conventions.md）。
    // 要升級請先換掉參考來源（R 線軌道座標或實測月台端點），不是改這個字串。
    expect((stationDoc.frame as { bearing_status?: string }).bearing_status).toBe('estimated');
  });

  it('local +Y 與真北的差在參考值解析度內', () => {
    // 實際 R 線在台北車站的切線方位角：南北兩段半弦的平均（整段弦有曲率）
    const south = bearing(at('台大醫院站'), at('台北車站'));
    const north = bearing(at('台北車站'), at('中山站'));
    const trackBearing = (south + north) / 2;
    expect(trackBearing).toBeGreaterThan(14);
    expect(trackBearing).toBeLessThan(22);

    // 模型月台軸的真方位角 = local +Y 的方位角 + 月台軸距 +Y 的夾角
    const bearingDeg = (stationDoc.frame as { bearing_deg?: number }).bearing_deg;
    expect(bearingDeg).toBeTypeOf('number');
    const plusYBearing = bearingDeg! - 90;
    const platform = rp.areas.find((a) => a.id === 'a-rp-platform');
    expect(platform).toBeDefined();
    const modelBearing = plusYBearing + axisFromPlusY(platform!.polygon);

    expect(Math.abs(modelBearing - trackBearing)).toBeLessThan(6); // 隨機項僅 ±1.6°，餘裕幾乎全是留給未量化的系統性偏差
  });
});
