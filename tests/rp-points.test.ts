import { describe, expect, it } from 'vitest'
import { pointInPolygon, distToPolygonEdge, serpentineOrder, type Pt } from '../tools/rp-geometry'

const square: Pt[] = [[0, 0], [10, 0], [10, 10], [0, 10]]

describe('rp-geometry', () => {
  it('pointInPolygon:內/外/凹多邊形', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true)
    expect(pointInPolygon([15, 5], square)).toBe(false)
    // L 形凹多邊形,缺口處要判外
    const lshape: Pt[] = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]]
    expect(pointInPolygon([2, 8], lshape)).toBe(true)
    expect(pointInPolygon([8, 8], lshape)).toBe(false)
  })

  it('distToPolygonEdge:內點到最近邊', () => {
    expect(distToPolygonEdge([5, 5], square)).toBeCloseTo(5)
    expect(distToPolygonEdge([1, 5], square)).toBeCloseTo(1)
    // 外點也回距離(給 unit 淨距用)
    expect(distToPolygonEdge([11, 5], square)).toBeCloseTo(1)
    expect(distToPolygonEdge([13, 14], square)).toBeCloseTo(5) // 對角外(10,10)+hypot(3,4)
  })

  it('serpentineOrder:隔列反向', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 },
      { x: 0, y: 4 }, { x: 4, y: 4 }, { x: 8, y: 4 },
    ]
    const out = serpentineOrder(pts, 4)
    expect(out.map(p => [p.x, p.y])).toEqual([
      [0, 0], [4, 0], [8, 0],   // 第一列 x 遞增
      [8, 4], [4, 4], [0, 4],   // 第二列 x 遞減
    ])
  })
})
