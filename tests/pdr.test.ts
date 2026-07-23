import { describe, it, expect } from 'vitest';
import {
  PDR_DEFAULTS, initStepState, stepSample, walkStep, crossedNodeIds, type WalkState,
} from '../src/pdr';
import { startFollow, advance } from '../src/follow';
import type { GraphEdge } from '../src/nav';

const e = (from: string, to: string, kind: GraphEdge['kind'], length: number): GraphEdge =>
  ({ from, to, kind, accessible: true, length, cost: length });

/** 合成加速度波形：20ms 取樣、基線 9.8、spike 40ms 寬。 */
const wave = (spikesAtMs: number[], totalMs: number, spikeMag = 12): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let t = 0; t <= totalMs; t += 20)
    out.push([t, spikesAtMs.some((s0) => t >= s0 && t < s0 + 40) ? spikeMag : 9.8]);
  return out;
};

const countSteps = (samples: Array<[number, number]>, p = PDR_DEFAULTS): number => {
  let s = initStepState();
  let steps = 0;
  for (const [t, mag] of samples) {
    const r = stepSample(s, t, mag, p);
    s = r.state;
    if (r.step) steps++;
  }
  return steps;
};

describe('stepSample 步偵測', () => {
  it('間隔合規的 N 個峰 → N 步', () => {
    expect(countSteps(wave([200, 700, 1200], 1500))).toBe(3);
  });

  it('不應期內雙峰 → 1 步', () => {
    expect(countSteps(wave([200, 300], 600))).toBe(1);
  });

  it('閾下噪音 → 0 步', () => {
    expect(countSteps(wave([200, 700], 1000, 10.5))).toBe(0);
  });

  it('params 覆蓋生效：降低閾值後閾下波形成步', () => {
    expect(countSteps(wave([200, 700], 1000, 10.5), { ...PDR_DEFAULTS, peakThreshold: 0.5 }))
      .toBe(2);
  });

  it('首樣本只定基線不成步', () => {
    const r = stepSample(initStepState(), 0, 15);
    expect(r.step).toBe(false);
    expect(r.state.ema).toBe(15);
  });
});

describe('walkStep 沿邊推進', () => {
  const walkEdges = [e('a', 'b', 'walk', 2), e('b', 'c', 'walk', 2)];

  it('累距跨節點：步長 1、邊長 2 → 第 2/4 步各推進一次', () => {
    let follow = startFollow(walkEdges);
    let w: WalkState = { edgeDist: 0 };
    const advCounts: number[] = [];
    for (let i = 0; i < 4; i++) {
      const r = walkStep(walkEdges, follow, w, 1);
      w = r.w;
      for (let k = 0; k < r.advances; k++) follow = advance(follow);
      advCounts.push(r.advances);
    }
    expect(advCounts).toEqual([0, 1, 0, 1]);
  });

  it('單步跨多條短邊 → advances > 1', () => {
    const shorts = [e('a', 'b', 'walk', 0.5), e('b', 'c', 'walk', 0.5), e('c', 'd', 'walk', 2)];
    const r = walkStep(shorts, startFollow(shorts), { edgeDist: 0 }, 1);
    expect(r.advances).toBe(2);
    expect(r.w.edgeDist).toBe(0);
  });

  it('腳下是 connector 邊 → paused、距離不累積', () => {
    const edges = [e('a', 'b', 'escalator', 5), e('b', 'c', 'walk', 2)];
    const r = walkStep(edges, startFollow(edges), { edgeDist: 0.4 }, 1);
    expect(r).toMatchObject({ advances: 0, paused: true, w: { edgeDist: 0 } });
  });

  it('跨進 connector 邊 → 推進後即暫停、溢出距離捨棄', () => {
    const edges = [e('a', 'b', 'walk', 1), e('b', 'c', 'elevator', 5)];
    const r = walkStep(edges, startFollow(edges), { edgeDist: 0 }, 2);
    expect(r).toMatchObject({ advances: 1, paused: true, w: { edgeDist: 0 } });
  });

  it('gate／platform-edge 視同 walk 累距', () => {
    const edges = [e('a', 'b', 'gate', 1), e('b', 'c', 'platform-edge', 1)];
    const r = walkStep(edges, startFollow(edges), { edgeDist: 0 }, 2);
    expect(r).toMatchObject({ advances: 2, paused: false });
  });

  it('已到終點 → 不推進不暫停', () => {
    let follow = startFollow(walkEdges);
    follow = advance(advance(follow));
    expect(walkStep(walkEdges, follow, { edgeDist: 0 }, 1))
      .toMatchObject({ advances: 0, paused: false });
  });

  it('輸入狀態不可變', () => {
    const w: WalkState = { edgeDist: 0 };
    walkStep(walkEdges, startFollow(walkEdges), w, 1);
    expect(w.edgeDist).toBe(0);
  });
});

describe('crossedNodeIds 跨越節點序列', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('advances 1 → 下一節點', () => {
    expect(crossedNodeIds(ids, 0, 1)).toEqual(['b']);
  });
  it('advances 2 → 依序兩個節點（轉角不跳段）', () => {
    expect(crossedNodeIds(ids, 0, 2)).toEqual(['b', 'c']);
  });
  it('advances 0 → 空', () => {
    expect(crossedNodeIds(ids, 1, 0)).toEqual([]);
  });
});
