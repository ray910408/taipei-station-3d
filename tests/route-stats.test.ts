import { describe, it, expect } from 'vitest';
import { routeStats, formatStats } from '../src/nav';
import type { GraphEdge } from '../src/nav';

const e = (kind: GraphEdge['kind'], length: number, cost = length): GraphEdge =>
  ({ from: 'a', to: 'b', kind, accessible: true, length, cost });

describe('routeStats', () => {
  it('公尺=Σlength（不含懲罰）、秒=步行/1.2 + connector 固定秒', () => {
    const edges = [e('walk', 12), e('elevator', 7, 47), e('gate', 2), e('walk', 6)];
    const s = routeStats(edges);
    expect(s.meters).toBeCloseTo(27, 6);
    expect(s.seconds).toBeCloseTo((12 + 2 + 6) / 1.2 + 60, 6);
  });
  it('formatStats 分鐘無條件進位、最少 1 分鐘', () => {
    expect(formatStats({ meters: 27.4, seconds: 76.7 })).toBe('約 27 公尺・約 2 分鐘');
    expect(formatStats({ meters: 5, seconds: 10 })).toBe('約 5 公尺・約 1 分鐘');
  });
});
