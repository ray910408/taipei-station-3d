import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import stationDoc from '../data/station.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

/** 框架方位角一致性護欄（見 docs/data-conventions.md「方位角」）：
 *  模型的月台軸換算成真方位角後，必須落在北捷開放資料出入口 GPS 推得的實際 R 線走向附近。
 *  bearing_deg 被改、或月台幾何被整體旋轉，這裡就會紅。
 *
 *  容差 = 參考值本身的解析度，不是精度宣稱。參考值是「站的出口重心連線」，
 *  而重心不是軌道上的點：各站出口離散 RMS 85–129 m，除以 √出口數得各站重心 SE
 *  34.7–52.5 m；兩端合成後每條半弦的端點不確定度 57.3 m（701 m 那條）與
 *  69.5 m（552 m 那條），換算成角度是 ±4.7°／±7.2°，平均後 ±4.3°。台北車站(BL12/R10)、
 *  中山(R11/G14) 又都是轉乘站，重心會被非 R 線的站體拉走，而 CSV 沒有逐出口的線別
 *  可供拆分。所以這裡只當「有沒有被整個轉掉」的護欄，不拿來宣稱方位角精度。 */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const LAT0 = 25.0467;
const M_PER_LAT = 111132.92 - 559.82 * Math.cos(rad(2 * LAT0)) + 1.175 * Math.cos(rad(4 * LAT0));
const M_PER_LON = 111412.84 * Math.cos(rad(LAT0)) - 93.5 * Math.cos(rad(3 * LAT0));

/** 各站出入口經緯度重心（refs/opendata/exit-coords.csv：項次,名稱,編號,經度,緯度,無障礙） */
function exitCentroids(): Map<string, [number, number]> {
  const csv = readFileSync(new URL('../refs/opendata/exit-coords.csv', import.meta.url), 'utf8');
  const acc = new Map<string, [number, number, number]>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const c = line.split(',');
    if (c.length < 5) continue;
    const station = /^(台北車站|.+?站)/.exec(c[1])?.[1];
    const lon = Number(c[3]), lat = Number(c[4]);
    if (!station || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const [x, y, n] = acc.get(station) ?? [0, 0, 0];
    acc.set(station, [x + lon, y + lat, n + 1]);
  }
  return new Map([...acc].map(([k, [x, y, n]]) => [k, [x / n, y / n]]));
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
  const centroids = exitCentroids();
  const at = (s: string) => {
    const c = centroids.get(s);
    if (!c) throw new Error(`exit-coords.csv 找不到 ${s}`);
    return c;
  };

  it('出入口 CSV 仍含 R 線三站（台大醫院／台北車站／中山）', () => {
    for (const s of ['台大醫院站', '台北車站', '中山站']) expect(centroids.has(s)).toBe(true);
  });

  it('station.json 有記 bearing_deg——缺欄位就沒東西可護', () => {
    // schema 裡 bearing_deg 是選填，刪掉仍合法；不可讓下面的比對靜默代入 90 而通過
    expect((stationDoc.frame as { bearing_deg?: number }).bearing_deg).toBeTypeOf('number');
  });

  it('bearing_status 仍是 estimated——出口重心撐不起 surveyed', () => {
    // schema 允許 surveyed，但這份開放資料的解析度只有 ±4~5°（見 docs/data-conventions.md）。
    // 要升級請先換掉參考來源（R 線軌道座標或實測月台端點），不是改這個字串。
    expect((stationDoc.frame as { bearing_status?: string }).bearing_status).toBe('estimated');
  });

  it('local +Y 與真北的差在參考值解析度（±4.3°）內', () => {
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

    expect(Math.abs(modelBearing - trackBearing)).toBeLessThan(6); // ±4.3° 解析度 + 餘裕
  });
});
