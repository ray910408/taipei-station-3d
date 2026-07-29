import { describe, it, expect } from 'vitest';
import { isTraceable } from '../src/tracer/store';
import sourcesDoc from '../refs/sources.json';

/** tracer 的底圖選單是從 refs/sources.json 全表長出來的，而該表也登記非影像來源
 *  （北捷開放資料 CSV）。選到非影像會得到 naturalWidth=0 的空白底圖、校準不了，
 *  且選擇存在 sessionStorage 裡、重整後還會回到那個壞狀態。 */
describe('tracer 底圖來源過濾', () => {
  const sources = sourcesDoc.sources;

  it('CSV 來源一律排除、影像來源一律保留', () => {
    const traceable = sources.filter(isTraceable).map((s) => s.id);
    const rest = sources.filter((s) => !isTraceable(s)).map((s) => s.id);
    expect(rest.length).toBeGreaterThan(0); // 表裡確實有非影像來源，這條測試才有意義
    for (const id of rest) expect(id).toMatch(/^trtc-od-/);
    for (const s of sources.filter((s) => /\.(png|jpe?g)$/i.test(s.file))) {
      expect(traceable).toContain(s.id);
    }
  });

  it('每個 traceable 來源的副檔名都是瀏覽器能當底圖載入的', () => {
    for (const s of sources.filter(isTraceable)) expect(s.file).toMatch(/\.(png|jpe?g|webp|gif)$/i);
  });

  it('校準過的來源都還在選單裡——校準資料只對影像有意義', () => {
    for (const s of sources.filter((s) => 'calibration' in s)) expect(isTraceable(s)).toBe(true);
  });
});
