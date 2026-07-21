import { describe, it, expect } from 'vitest';
import { displayLabel } from '../src/ui';

describe('displayLabel（下拉項去重樓層前綴——M-7）', () => {
  it('去掉與組標頭代碼重複的開頭前綴', () => {
    expect(displayLabel('B1 東剪票口外（非付費）', 'B1 臺鐵穿堂層')).toBe('東剪票口外（非付費）');
  });
  it('無前綴 label 原樣返回', () => {
    expect(displayLabel('臺鐵第4月台（候車）', 'B2 臺鐵/高鐵月台層')).toBe('臺鐵第4月台（候車）');
  });
  it('括號內樓層註記不受影響', () => {
    expect(displayLabel('臺鐵轉乘閘門外（B3 非付費）', 'B3 淡水信義線大廳層')).toBe('臺鐵轉乘閘門外（B3 非付費）');
  });
  it('僅比對開頭完整代碼＋空格，不誤傷同字開頭', () => {
    expect(displayLabel('B12 假想點', 'B1 臺鐵穿堂層')).toBe('B12 假想點');
  });
});
