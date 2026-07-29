import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import stationDoc from '../data/station.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

/** 框架方位角回歸鎖（見 docs/data-conventions.md「方位角」）：
 *  模型的月台軸換算成真方位角後，必須落在北捷開放資料出入口 GPS 推得的實際 R 線走向附近。
 *  bearing_deg 被改、或月台幾何被整體旋轉，這裡就會紅。 */

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

  it('local +Y 與真北的差 < 5°', () => {
    // 實際 R 線在台北車站的切線方位角：南北兩段半弦的平均（整段弦有曲率）
    const south = bearing(at('台大醫院站'), at('台北車站'));
    const north = bearing(at('台北車站'), at('中山站'));
    const trackBearing = (south + north) / 2;
    expect(trackBearing).toBeGreaterThan(14);
    expect(trackBearing).toBeLessThan(22);

    // 模型月台軸的真方位角 = local +Y 的方位角 + 月台軸距 +Y 的夾角
    const plusYBearing = (stationDoc.frame.bearing_deg ?? 90) - 90;
    const platform = rp.areas.find((a) => a.id === 'a-rp-platform');
    expect(platform).toBeDefined();
    const modelBearing = plusYBearing + axisFromPlusY(platform!.polygon);

    expect(Math.abs(modelBearing - trackBearing)).toBeLessThan(5);
  });
});
