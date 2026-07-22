import { describe, it, expect } from 'vitest';
import { assembleModel } from '../src/loader';
import { buildGraph, findPath } from '../src/nav';
import { startFollow, advance, atEnd } from '../src/follow';
import { walkStep, type WalkState } from '../src/pdr';
import stationDoc from './fixtures/mini/data/station.json';
import hall from './fixtures/mini/data/floors/hall-b1.json';
import plat from './fixtures/mini/data/floors/plat-b2.json';
import connectorsDoc from './fixtures/mini/data/connectors.json';

const model = assembleModel(
  stationDoc,
  { 'floors/hall-b1.json': hall, 'floors/plat-b2.json': plat },
  connectorsDoc,
);
const graph = buildGraph(model);

describe('PDR 沿邊推進端到端（月台→大廳）', () => {
  it('connector 前暫停、手動過梯後步進恢復、最終抵達', () => {
    const edges = findPath(graph, 'n-pl-001', 'n-ha-002')!;
    expect(edges[0].kind).toBe('escalator'); // 首段即電扶梯——一開始就該暫停
    let follow = startFollow(edges);
    let w: WalkState = { edgeDist: 0 };

    // 站在電扶梯前：步進不推、paused
    expect(walkStep(edges, follow, w, 1)).toMatchObject({ advances: 0, paused: true });

    // 手動「我到了」過電扶梯（比照 main.ts onAdvance：重置距離）
    follow = advance(follow);
    w = { edgeDist: 0 };

    // 之後為 gate 邊（7m）：步長 1m，第 7 步跨節點抵達
    let total = 0;
    for (let i = 0; i < 7; i++) {
      const r = walkStep(edges, follow, w, 1);
      w = r.w;
      for (let k = 0; k < r.advances; k++) follow = advance(follow);
      total += r.advances;
    }
    expect(total).toBe(1);
    expect(atEnd(follow)).toBe(true);
  });
});
