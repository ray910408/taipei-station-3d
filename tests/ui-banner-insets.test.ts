import { describe, it, expect } from 'vitest';
import { bannerInsetsFrom } from '../src/ui';

// 導航橫幅有兩種版型（index.html）：桌機頂部置中卡片、max-width:600px 時底部 sheet。
// 相機讓位（camera.frameGoal 的 insets）要靠這裡判對邊、算對比例。
describe('bannerInsetsFrom', () => {
  // 實測值：730×742 桌機視窗，橫幅含 transition 卡 top=12 bottom=255
  const DESKTOP = { top: 12, bottom: 255 };
  // 實測值：375×812 手機視窗，橫幅為底部 sheet top=561 bottom=812（高 251）
  const MOBILE = { top: 561, bottom: 812 };

  it('頂部卡片 → top inset', () => {
    expect(bannerInsetsFrom(DESKTOP, 742)).toEqual({ top: 255 / 742 });
  });

  it('底部 sheet → bottom inset（只做 top 會把內容推進 sheet 裡）', () => {
    expect(bannerInsetsFrom(MOBILE, 812)).toEqual({ bottom: 251 / 812 });
  });

  // PR #5 review：只拖視窗下緣時橫幅自身尺寸不變，ResizeObserver 不觸發，
  // 但 inset 是比例、分母是視窗高——不重算就會低估遮擋。
  it('橫幅尺寸不變、視窗變矮 → 遮擋比例必須變大', () => {
    const tall = bannerInsetsFrom(DESKTOP, 900).top!;
    const short = bannerInsetsFrom(DESKTOP, 600).top!;
    expect(short).toBeGreaterThan(tall);
    expect(short).toBeCloseTo(255 / 600, 6); // 用當下視窗高，不是快取時的那個
  });

  it('視窗高 0 或負值不炸（resize 過程可能量到 0）', () => {
    expect(bannerInsetsFrom(DESKTOP, 0)).toEqual({});
    expect(bannerInsetsFrom(DESKTOP, -1)).toEqual({});
  });

  it('回傳的比例恆在 0～1（夾總和的責任在 frameGoal，這裡不先夾）', () => {
    for (const h of [300, 600, 742, 900, 1400]) {
      const i = bannerInsetsFrom(DESKTOP, h);
      const v = i.top ?? i.bottom!;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
