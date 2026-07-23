import { describe, it, expect } from 'vitest';
import { partialRemaining } from '../src/nav';
import type { GraphEdge } from '../src/nav';

const e = (from: string, to: string, kind: GraphEdge['kind'], length: number): GraphEdge =>
  ({ from, to, kind, accessible: true, length, cost: length });

describe('partialRemaining 殘距扣減（ISSUE-001）', () => {
  const edges = [e('a', 'b', 'walk', 10), e('b', 'c', 'escalator', 5)];

  it('edgeDist 0 ＝ routeStats 原值', () => {
    const s = partialRemaining(edges, 0);
    expect(s.meters).toBe(15);
    expect(s.seconds).toBeCloseTo(10 / 1.2 + 40, 5);
  });

  it('走 3m → meters 與 seconds 同步扣減', () => {
    const s = partialRemaining(edges, 3);
    expect(s.meters).toBe(12);
    expect(s.seconds).toBeCloseTo(7 / 1.2 + 40, 5);
  });

  it('edgeDist 超過首邊長 → 只扣到首邊長（夾限不為負）', () => {
    expect(partialRemaining(edges, 99).meters).toBe(5);
  });

  it('空邊列 → 零統計、不產生 NaN', () => {
    expect(partialRemaining([], 3)).toEqual({ meters: 0, seconds: 0 });
  });
});
