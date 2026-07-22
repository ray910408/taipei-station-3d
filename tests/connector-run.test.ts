import { describe, it, expect } from 'vitest';
import { connectorRunDir } from '../src/builder';
import type { NavNode, NavEdge } from '../src/types';

const nodes: NavNode[] = [{ id: 'n-aa-1', xy: [0, 0] }, { id: 'n-aa-2', xy: [10, 0] }];
const edges: NavEdge[] = [{ from: 'n-aa-1', to: 'n-aa-2', kind: 'walk' }];

describe('connectorRunDir：相鄰走道方向', () => {
  it('取相鄰節點方向（單位向量）', () => {
    const d = connectorRunDir(nodes, edges, 'n-aa-1')!;
    expect(d[0]).toBeCloseTo(1); expect(d[1]).toBeCloseTo(0);
  });
  it('無鄰邊回 null', () => {
    expect(connectorRunDir(nodes, [], 'n-aa-1')).toBeNull();
  });
});
