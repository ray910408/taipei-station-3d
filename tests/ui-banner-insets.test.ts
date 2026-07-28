import { describe, it, expect } from 'vitest';
import { bannerInsetsFrom } from '../src/ui';

// 導航橫幅有兩種版型（index.html）：桌機頂部置中卡片、max-width:600px 時底部 sheet。
// 相機讓位（camera.frameGoal 的 insets）要靠這裡判對邊、算對比例。
// 錨定邊由 CSS 自訂屬性 --anchor 宣告後傳進來，不在此推測。
describe('bannerInsetsFrom', () => {
  // 實測值：730×742 桌機視窗，橫幅含 transition 卡 top=12 bottom=255
  const DESKTOP = { top: 12, bottom: 255 };
  // 實測值：375×812 手機視窗，橫幅為底部 sheet top=561 bottom=812（高 251）
  const MOBILE = { top: 561, bottom: 812 };

  it('頂部卡片 → top inset', () => {
    expect(bannerInsetsFrom(DESKTOP, 742, 'top')).toEqual({ top: 255 / 742 });
  });

  it('底部 sheet → bottom inset（只做 top 會把內容推進 sheet 裡）', () => {
    expect(bannerInsetsFrom(MOBILE, 812, 'bottom')).toEqual({ bottom: 251 / 812 });
  });

  // PR #5 review：只拖視窗下緣時橫幅自身尺寸不變，ResizeObserver 不觸發，
  // 但 inset 是比例、分母是視窗高——不重算就會低估遮擋。
  it('橫幅尺寸不變、視窗變矮 → 遮擋比例必須變大', () => {
    const tall = bannerInsetsFrom(DESKTOP, 900, 'top').top!;
    const short = bannerInsetsFrom(DESKTOP, 600, 'top').top!;
    expect(short).toBeGreaterThan(tall);
    expect(short).toBeCloseTo(255 / 600, 6); // 用當下視窗高，不是快取時的那個
  });

  // PR #5 review：先前用「哪一邊比較近」推測錨定邊，矮視窗下會判反並把 marker
  // 往橫幅裡推。錨定邊改由 CSS 宣告，這裡只負責照著算。
  it('矮視窗、橫幅幾乎佔滿高度：仍照宣告的 top 算，不因下緣較近而判反', () => {
    // 舊猜法：260 - 255 = 5 < top 12 → 會誤判成 bottom
    expect(bannerInsetsFrom(DESKTOP, 260, 'top')).toEqual({ top: 255 / 260 });
    expect(bannerInsetsFrom(MOBILE, 812, 'bottom').bottom).toBeGreaterThan(0);
  });

  it('橫幅高於視窗時比例夾在 1（總和上限由 frameGoal 的 MAX_INSET 負責）', () => {
    expect(bannerInsetsFrom({ top: 12, bottom: 400 }, 300, 'top')).toEqual({ top: 1 });
    expect(bannerInsetsFrom({ top: -50, bottom: 300 }, 200, 'bottom')).toEqual({ bottom: 1 });
  });

  it('視窗高 0 或負值不炸（resize 過程可能量到 0）', () => {
    expect(bannerInsetsFrom(DESKTOP, 0, 'top')).toEqual({});
    expect(bannerInsetsFrom(DESKTOP, -1, 'top')).toEqual({});
  });
});
