import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../tools/csv';
import { stationOf } from '../tools/opendata';
import stationDoc from '../data/station.json';
import rp from '../data/floors/mrt-r-platform-b4.json';

/** 框架方位角一致性護欄（見 docs/data-conventions.md「方位角」）：
 *  模型的月台軸換算成真方位角後，必須落在北捷開放資料出入口 GPS 推得的實際 R 線走向附近。
 *  bearing_deg 被改、或月台幾何被整體旋轉，這裡就會紅。
 *
 *  容差 = 參考值本身的解析度，不是精度宣稱。參考值是「站的出口重心連線」，而重心不是
 *  軌道上的點。推導見 docs/data-conventions.md：出口離散度要先投影到弦的法向
 *  （方位角只吃垂直於弦的那半），兩段半弦再按弦長加權內插（弦向＝弧中點切線，等權平均
 *  估的不是站處切線），並算進「兩條半弦共用台北車站端點」的共變異，
 *  得隨機項 ±1.65°；直接拿二維徑向 RMS 又當兩弦獨立，會高估成 ±4.3°。
 *  容差取 6°，餘裕留給那條式子涵蓋不到的系統性偏差：台北車站(BL12/R10)、中山(R11/G14)
 *  都是轉乘站，重心會被非 R 線的站體拉走，而 CSV 沒有逐出口的線別可供拆分。
 *  所以這裡只當「有沒有被整個轉掉」的護欄，不拿來宣稱方位角精度。 */

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const LAT0 = 25.0467;
const M_PER_LAT = 111132.92 - 559.82 * Math.cos(rad(2 * LAT0)) + 1.175 * Math.cos(rad(4 * LAT0));
const M_PER_LON = 111412.84 * Math.cos(rad(LAT0)) - 93.5 * Math.cos(rad(3 * LAT0));

/** 各站出入口經緯度重心＋共變異矩陣（refs/opendata/exit-coords.csv：項次,名稱,編號,經度,緯度,無障礙）。
 *  用共用 parser 而不是 split(',')——出入口名稱若合法地帶引號含逗號，逐行切會整列錯位，
 *  那一筆出口就安靜地從重心裡消失，而 bearing 斷言仍然會過。
 *  cov 是各出口對重心的母體共變異矩陣（÷n，公尺座標系，見 M_PER_LON/M_PER_LAT）——
 *  給下面「推導鏈」測試把離散度投影到弦的法向用，不只是重心本身。 */
function exitStats(): Map<string, { c: [number, number]; n: number; cov: [[number, number], [number, number]] }> {
  const csv = readFileSync(new URL('../refs/opendata/exit-coords.csv', import.meta.url), 'utf8');
  const { rows, malformed } = parseCsv(csv);
  if (malformed.length) throw new Error(`exit-coords.csv 語法有問題：${malformed.join('；')}`);
  const pts = new Map<string, [number, number][]>();
  for (const c of rows.slice(1)) {
    if (c.length < 5) continue;
    const station = stationOf(c[1]);
    const lon = Number(c[3]), lat = Number(c[4]);
    if (!station || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const arr = pts.get(station) ?? [];
    arr.push([lon, lat]);
    pts.set(station, arr);
  }
  return new Map([...pts].map(([station, arr]) => {
    const n = arr.length;
    const cx = arr.reduce((s, [lon]) => s + lon, 0) / n;
    const cy = arr.reduce((s, [, lat]) => s + lat, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const [lon, lat] of arr) {
      const dx = (lon - cx) * M_PER_LON, dy = (lat - cy) * M_PER_LAT;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
    }
    const cov: [[number, number], [number, number]] = [[sxx / n, sxy / n], [sxy / n, syy / n]];
    return [station, { c: [cx, cy] as [number, number], n, cov }];
  }));
}

/** a→b 的距離（公尺） */
function distMeters(a: [number, number], b: [number, number]): number {
  return Math.hypot((b[0] - a[0]) * M_PER_LON, (b[1] - a[1]) * M_PER_LAT);
}

/** 共變異矩陣投影到方位角 bearingDeg 的法向、除以出口數——重心沿該法向的變異數（平方公尺） */
function normalVarianceOfCentroid(cov: [[number, number], [number, number]], n: number, bearingDeg: number): number {
  const t = rad(bearingDeg);
  const nx = Math.cos(t), ny = -Math.sin(t); // 垂直於方位角 t 的單位向量
  return (nx * nx * cov[0][0] + 2 * nx * ny * cov[0][1] + ny * ny * cov[1][1]) / n;
}

/** 同一站在兩個不同弦的法向分量之間的重心共變異（平方公尺）——兩條半弦共用端點時的相關修正項 */
function normalCrossCovarianceOfCentroid(
  cov: [[number, number], [number, number]], n: number, bearing1Deg: number, bearing2Deg: number,
): number {
  const t1 = rad(bearing1Deg), t2 = rad(bearing2Deg);
  const n1 = [Math.cos(t1), -Math.sin(t1)], n2 = [Math.cos(t2), -Math.sin(t2)];
  return (n1[0] * cov[0][0] * n2[0] + n1[0] * cov[0][1] * n2[1] + n1[1] * cov[1][0] * n2[0] + n1[1] * cov[1][1] * n2[1]) / n;
}

/** a→b 的真方位角（度，北為 0、順時針） */
function bearing(a: [number, number], b: [number, number]): number {
  return deg(Math.atan2((b[0] - a[0]) * M_PER_LON, (b[1] - a[1]) * M_PER_LAT));
}

/** a→b→c 兩段半弦在 b（台北車站）處的切線方位角：弦向＝弧中點切線，等權平均估的是
 *  偏離 b 點 (L2−L1)/4 處的切線，不是 b 點本身；等曲率下切線隨弧長線性變化，
 *  b 點切線＝按弦長線性內插（弦短的那段權重大：w1=L2/(L1+L2)、w2=L1/(L1+L2)）。 */
function weightedTrackBearing(a: [number, number], b: [number, number], c: [number, number]): number {
  const L1 = distMeters(a, b);
  const L2 = distMeters(b, c);
  return (bearing(a, b) * L2 + bearing(b, c) * L1) / (L1 + L2);
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
    // schema 允許 surveyed，但這份開放資料只能給到隨機項 ±1.65°＋未量化的系統性偏差（見 docs/data-conventions.md）。
    // 要升級請先換掉參考來源（R 線軌道座標或實測月台端點），不是改這個字串。
    expect((stationDoc.frame as { bearing_status?: string }).bearing_status).toBe('estimated');
  });

  it('local +Y 與真北的差在參考值解析度內', () => {
    // 實際 R 線在台北車站的切線方位角：兩段半弦按弦長加權內插（弦向＝弧中點切線，非端點）
    const trackBearing = weightedTrackBearing(at('台大醫院站'), at('台北車站'), at('中山站'));
    expect(trackBearing).toBeGreaterThan(14);
    expect(trackBearing).toBeLessThan(22);

    // 模型月台軸的真方位角 = local +Y 的方位角 + 月台軸距 +Y 的夾角
    const bearingDeg = (stationDoc.frame as { bearing_deg?: number }).bearing_deg;
    expect(bearingDeg).toBeTypeOf('number');
    const plusYBearing = bearingDeg! - 90;
    const platform = rp.areas.find((a) => a.id === 'a-rp-platform');
    expect(platform).toBeDefined();
    const modelBearing = plusYBearing + axisFromPlusY(platform!.polygon);

    expect(Math.abs(modelBearing - trackBearing)).toBeLessThan(6); // 隨機項僅 ±1.65°，餘裕幾乎全是留給未量化的系統性偏差
  });

  it('推導鏈機器背書：docs「方位角」段的每個數字都是這裡算出來的', () => {
    // 這條測試把 docs/data-conventions.md「方位角」段引用的每個中間數字都重算一遍並釘住。
    // 兩個出口座標等量反向移動不會動到重心、出口數、鍵指紋、bearing 斷言，但會動到這裡的
    // 共變異矩陣——docs 那串數字會無聲過期而沒有測試發現。紅了不是放寬容差，是回去照這條
    // 推導鏈重推一次，把新數字同步進 docs，不是改這裡的期望值。
    const taida = stats.get('台大醫院站')!;
    const taipei = stats.get('台北車站')!;
    const zhongshan = stats.get('中山站')!;

    // 弦長與方位角
    const L1 = distMeters(taida.c, taipei.c);
    const L2 = distMeters(taipei.c, zhongshan.c);
    const brg1 = bearing(taida.c, taipei.c);
    const brg2 = bearing(taipei.c, zhongshan.c);
    expect(L1).toBeCloseTo(552.5, 0);
    expect(L2).toBeCloseTo(701.2, 0);
    expect(brg1).toBeCloseTo(14.75, 1);
    expect(brg2).toBeCloseTo(20.97, 1);

    // 法向重心 SE：共變異矩陣投影到弦的法向、再除以出口數
    const seTaidaChord1 = Math.sqrt(normalVarianceOfCentroid(taida.cov, taida.n, brg1));
    const seTaipeiChord1 = Math.sqrt(normalVarianceOfCentroid(taipei.cov, taipei.n, brg1));
    const seTaipeiChord2 = Math.sqrt(normalVarianceOfCentroid(taipei.cov, taipei.n, brg2));
    const seZhongshanChord2 = Math.sqrt(normalVarianceOfCentroid(zhongshan.cov, zhongshan.n, brg2));
    expect(seTaidaChord1).toBeCloseTo(15.43, 1);
    expect(seTaipeiChord1).toBeCloseTo(27.59, 1);
    expect(seTaipeiChord2).toBeCloseTo(26.19, 1);
    expect(seZhongshanChord2).toBeCloseTo(33.73, 1);

    // 半弦 SE（角度）：兩端法向 SE 均方根、除以弦長轉成角度
    const se1Rad = Math.sqrt(seTaidaChord1 ** 2 + seTaipeiChord1 ** 2) / L1;
    const se2Rad = Math.sqrt(seTaipeiChord2 ** 2 + seZhongshanChord2 ** 2) / L2;
    expect(deg(se1Rad)).toBeCloseTo(3.278, 2);
    expect(deg(se2Rad)).toBeCloseTo(3.489, 2);

    // 相關修正：兩條半弦共用台北車站端點，加權平均（權重同 weightedTrackBearing）的變異數要扣掉這項共變異
    const w1 = L2 / (L1 + L2), w2 = L1 / (L1 + L2);
    const covTaipei = normalCrossCovarianceOfCentroid(taipei.cov, taipei.n, brg1, brg2);
    const varCorrelated = w1 ** 2 * se1Rad ** 2 + w2 ** 2 * se2Rad ** 2 - (2 * w1 * w2 * covTaipei) / (L1 * L2);
    const varIndependent = w1 ** 2 * se1Rad ** 2 + w2 ** 2 * se2Rad ** 2;
    const seCorrelated = deg(Math.sqrt(varCorrelated));
    const seIndependent = deg(Math.sqrt(varIndependent));
    expect(seCorrelated).toBeCloseTo(1.65, 1);
    expect(seIndependent).toBeCloseTo(2.39, 1);
    expect(seCorrelated).toBeLessThan(seIndependent); // 共變異項為負方向，相關修正後應該比獨立平均小

    // 徑向版（不投影到法向，直接用二維離散度）：docs 用來說明為什麼不能直接拿它當法向誤差
    const radialRms = (s: { cov: [[number, number], [number, number]] }) => Math.sqrt(s.cov[0][0] + s.cov[1][1]);
    expect(radialRms(taida)).toBeCloseTo(105.5, 0);
    expect(radialRms(taipei)).toBeCloseTo(129.4, 0);
    expect(radialRms(zhongshan)).toBeCloseTo(85.2, 0);
  });

  it('推導鏈機器背書（模型側）：docs「方位角」段引用的模型軸數字釘住', () => {
    // 上面「解析度內」那條測試容差 6°，a-rp-platform 轉個 2、3° 仍全綠——不足以護住
    // docs 引用的 N17.5°E／差 0.02° 這幾個數字本身。這裡把模型軸換算成真方位角、
    // 跟軌道加權切線方位角的差都釘住；紅了代表 docs 與 station.json 的 axis_note 要同步重算，
    // 不是放寬這裡的期望值。
    const platform = rp.areas.find((a) => a.id === 'a-rp-platform');
    expect(platform).toBeDefined();
    const platformAxis = axisFromPlusY(platform!.polygon);
    expect(platformAxis).toBeCloseTo(17.51, 1); // docs：模型 a-rp-platform 主軸距 local +Y 為 N17.5°E

    const bearingDeg = (stationDoc.frame as { bearing_deg?: number }).bearing_deg;
    const modelBearing = bearingDeg! - 90 + platformAxis;

    const trackBearing = weightedTrackBearing(at('台大醫院站'), at('台北車站'), at('中山站'));
    expect(trackBearing).toBeCloseTo(17.49, 1); // 兩半弦按弦長加權內插的站處切線方位角

    expect(Math.abs(modelBearing - trackBearing)).toBeCloseTo(0.02, 1); // docs 結論：差 0.02°
  });
});
