// tests/gen-edges.test.ts
import { describe, expect, it } from 'vitest'
import { eulerCircuit, floorWalks, type FloorNavJson } from '../tools/gen-edges'

const tri: [string, string][] = [['a', 'b'], ['b', 'c'], ['c', 'a']]

// 明確註記 FloorNavJson：xy/polygon 才會被檢查成 Pt tuple——裸字面量會推斷成
// number[] 而在 floorWalks 呼叫處炸 TS2345。SVG 用的 slab 這裡不放（不在
// FloorNavJson 上會觸發 excess property check）,Task 2 的測試自己加。
const floor: FloorNavJson = {
  id: 'f1',
  areas: [{ id: 'ar1', kind: 'corridor', note: '東廊', polygon: [[0, 0], [40, 0], [40, 20], [0, 20]] }],
  nav: {
    nodes: [
      { id: 'n1', xy: [0, 0], area: 'ar1' }, { id: 'n2', xy: [30, 0], area: 'ar1' },
      { id: 'n3', xy: [30, 20] }, { id: 'n4', xy: [0, 20] },
    ],
    edges: [
      { from: 'n1', to: 'n2', kind: 'walk' }, { from: 'n2', to: 'n3', kind: 'walk' },
      { from: 'n3', to: 'n4', kind: 'gate' },
      { from: 'n1', to: 'n4', kind: 'stair' },
    ],
  },
}

describe('eulerCircuit', () => {
  it('每條無向邊恰好正反各走一次，且首尾相接成迴路', () => {
    const out = eulerCircuit(tri)
    expect(out).toHaveLength(6)
    for (const [a, b] of tri) {
      expect(out.filter(([x, y]) => x === a && y === b)).toHaveLength(1)
      expect(out.filter(([x, y]) => x === b && y === a)).toHaveLength(1)
    }
    for (let i = 0; i + 1 < out.length; i++) expect(out[i][1]).toBe(out[i + 1][0])
    expect(out[out.length - 1][1]).toBe(out[0][0])
  })
})

describe('floorWalks', () => {
  it('walk 邊入迴路 required、gate 邊雙向附尾 optional、connector 邊不收', () => {
    const walks = floorWalks(floor, 1)
    const req = walks.filter(w => w.required)
    const opt = walks.filter(w => !w.required)
    expect(req).toHaveLength(4) // 2 條 walk 邊 ×2 向
    expect(opt).toHaveLength(2) // 1 條 gate 邊 ×2 向
    expect(opt.every(w => w.kind === 'gate')).toBe(true)
    expect(walks.some(w => w.kind === 'stair')).toBe(false)
    expect(walks.map(w => w.seq)).toEqual([1, 2, 3, 4, 5, 6])
    const w12 = req.find(w => w.from === 'n1' && w.to === 'n2')!
    expect(w12.lengthM).toBeCloseTo(30, 1)
    expect(w12.fromXy).toEqual([0, 0])
    expect(w12.note).toBe('東廊') // from 節點的 area note
  })
  it('walk 子圖不連通時各連通塊各自成迴路', () => {
    const f2 = {
      ...floor,
      nav: {
        nodes: floor.nav!.nodes, // fixture 必有 nav；註記 FloorNavJson 後為 optional，非空斷言
        edges: [
          { from: 'n1', to: 'n2', kind: 'walk' },
          { from: 'n3', to: 'n4', kind: 'walk' }, // 與 n1-n2 不相連（gate 隔開的情境）
        ],
      },
    }
    const walks = floorWalks(f2, 1).filter(w => w.required)
    expect(walks).toHaveLength(4)
    // 各塊內部連續：前兩筆屬同一塊且首尾相接，後兩筆亦然
    expect(walks[0].to).toBe(walks[1].from)
    expect(walks[1].to).toBe(walks[0].from)
    expect(walks[2].to).toBe(walks[3].from)
  })
  it('無 nav 的樓層回空陣列', () => {
    expect(floorWalks({ id: 'f9' }, 1)).toEqual([])
  })
})
