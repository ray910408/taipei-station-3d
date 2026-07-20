import { describe, it, expect } from 'vitest';
import { startFollow, advance, back, atEnd, currentNodeId, remainingEdges } from '../src/follow';
import type { GraphEdge } from '../src/nav';

const e = (from: string, to: string): GraphEdge =>
  ({ from, to, kind: 'walk', accessible: true, length: 5, cost: 5 });
const edges = [e('a', 'b'), e('b', 'c'), e('c', 'd')];

describe('follow 狀態機', () => {
  it('startFollow 展開節點序列，起點為第 0 節點', () => {
    const s = startFollow(edges);
    expect(s.nodeIds).toEqual(['a', 'b', 'c', 'd']);
    expect(currentNodeId(s)).toBe('a');
    expect(atEnd(s)).toBe(false);
  });

  it('advance 逐節點推進，到終點夾住', () => {
    let s = startFollow(edges);
    s = advance(s); expect(currentNodeId(s)).toBe('b');
    s = advance(advance(s)); expect(currentNodeId(s)).toBe('d');
    expect(atEnd(s)).toBe(true);
    expect(currentNodeId(advance(s))).toBe('d');
  });

  it('back 回退，起點夾住', () => {
    let s = advance(startFollow(edges));
    s = back(s); expect(currentNodeId(s)).toBe('a');
    expect(currentNodeId(back(s))).toBe('a');
  });

  it('remainingEdges 回傳自目前節點起的殘餘邊', () => {
    const s = advance(startFollow(edges));
    expect(remainingEdges(edges, s).map((x) => x.to)).toEqual(['c', 'd']);
  });

  it('空路線丟錯', () => {
    expect(() => startFollow([])).toThrow();
  });
});
