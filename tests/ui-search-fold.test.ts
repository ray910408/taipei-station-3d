import { describe, it, expect } from 'vitest';
import { groupLandmarks } from '../src/ui';
import type { Landmark } from '../src/nav';

const lm = (id: string, label: string, floorLabel: string): Landmark =>
  ({ floor: 'f', floorLabel, id, label });

describe('搜尋折疊與別名（BUG-002/003）', () => {
  const data = [
    lm('a', 'B1 臺鐵東付費島', 'B1 臺鐵穿堂層'),
    lm('b', 'B3 往B1 長電扶梯口', 'B3 淡水信義線大廳層'),
    lm('c', 'B3 廁所（大廳非付費區）', 'B3 淡水信義線大廳層'),
  ];
  const ids = (q: string) => groupLandmarks(data, q).flatMap((g) => g.items).map((l) => l.id);

  it('打「台鐵」命中「臺鐵」標籤（折疊）', () => expect(ids('台鐵')).toEqual(['a']));
  it('打「臺鐵」同樣命中（雙向折疊）', () => expect(ids('臺鐵')).toEqual(['a']));
  it('別名：「捷運」命中淡水信義線樓層項目', () => expect(ids('捷運')).toEqual(['b', 'c']));
  it('別名：「手扶梯」命中「電扶梯」', () => expect(ids('手扶梯')).toEqual(['b']));
  it('別名：「紅線」命中淡水信義線', () => expect(ids('紅線')).toEqual(['b', 'c']));
  it('別名：「洗手間」命中「廁所」', () => expect(ids('洗手間')).toEqual(['c']));
  it('非別名詞不受表影響：「付費島」僅命中 a', () => expect(ids('付費島')).toEqual(['a']));
});
