import { describe, it, expect } from 'vitest';
import { isTraceable, pickSourceId } from '../src/tracer/store';
import sourcesDoc from '../refs/sources.json';

/** tracer 的底圖選單是從 refs/sources.json 全表長出來的，而該表也登記非影像來源
 *  （北捷開放資料 CSV）。選到非影像會得到 naturalWidth=0 的空白底圖、校準不了，
 *  且選擇存在 sessionStorage 裡、重整後還會回到那個壞狀態。 */
describe('tracer 底圖來源過濾', () => {
  const sources = sourcesDoc.sources;

  it('CSV 來源一律排除、影像來源一律保留', () => {
    const csv = sources.filter((s) => /\.csv$/i.test(s.file));
    const images = sources.filter((s) => /\.(png|jpe?g)$/i.test(s.file));
    expect(csv.length).toBeGreaterThan(0);
    expect(images.length).toBeGreaterThan(0);
    for (const s of csv) expect(isTraceable(s)).toBe(false);
    for (const s of images) expect(isTraceable(s)).toBe(true);
  });

  it('每個 traceable 來源的副檔名都是瀏覽器能當底圖載入的', () => {
    for (const s of sources.filter(isTraceable)) expect(s.file).toMatch(/\.(png|jpe?g|webp|gif)$/i);
  });

  it('校準過的來源都還在選單裡——校準資料只對影像有意義', () => {
    for (const s of sources.filter((s) => 'calibration' in s)) expect(isTraceable(s)).toBe(true);
  });
});

describe('pickSourceId：session 還原的來源挑選', () => {
  const ids = ['trtc-info-b4', 'tra-b1-map', 'site-isometric-2017'];

  it('存檔的合法選擇要接得回來（即使不是樓層預設）', () => {
    expect(pickSourceId('site-isometric-2017', ids, 'tra-b1-map')).toBe('site-isometric-2017');
  });

  it('存檔的選擇已不在可描清單（CSV／已移除）就退樓層預設', () => {
    expect(pickSourceId('trtc-od-exit-coords', ids, 'tra-b1-map')).toBe('tra-b1-map');
    expect(pickSourceId('gone', ids, 'tra-b1-map')).toBe('tra-b1-map');
  });

  it('沒有存檔就退樓層預設；樓層預設也無效才用第一個', () => {
    expect(pickSourceId(undefined, ids, 'tra-b1-map')).toBe('tra-b1-map');
    expect(pickSourceId(undefined, ids, undefined)).toBe('trtc-info-b4');
    expect(pickSourceId(undefined, ids, 'trtc-od-exit-coords')).toBe('trtc-info-b4');
  });
});
