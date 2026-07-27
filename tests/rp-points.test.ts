import { describe, expect, it } from 'vitest'
import { pointInPolygon } from '../src/geometry'
import { distToPolygonEdge, serpentineOrder, type Pt } from '../tools/rp-geometry'
import { generateFloorPoints } from '../tools/gen-rp-points'

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

describe('generateFloorPoints', () => {
  // 20×20 slab,16×16 paid 區,中央 6×6 unit 障礙,格距 4
  const floor = {
    id: 'test-floor',
    slab: { outline: [[0, 0], [20, 0], [20, 20], [0, 20]] as Pt[] },
    areas: [
      { id: 'a1', kind: 'paid', polygon: [[2, 2], [18, 2], [18, 18], [2, 18]] as Pt[], note: '測試區' },
      { id: 'a2', kind: 'track', polygon: [[0, 0], [2, 0], [2, 20], [0, 20]] as Pt[] },
    ],
    units: [{ id: 'u1', kind: 'room', polygon: [[7, 7], [13, 13], [7, 13]] as Pt[] }],
  }

  it('格點落在可走區、避開 unit、蛇行編號', () => {
    const pts = generateFloorPoints(floor as never, 'B9', 4, 0.8)
    // 候選 x,y ∈ {4,8,12,16}(bbox 2..18,起點 min+spacing/2);
    // unit 三角形 (7,7)-(13,13)-(7,13) 蓋掉 (8,8) 內部? (8,8) 在三角形邊 y=x 上緣外側,
    // 但離斜邊距離 0 <0.8 → 剔除;(8,12) 在三角形內 → 剔除;(12,12) 距斜邊 0 → 剔除
    const coords = pts.map(p => [p.x, p.y])
    expect(coords).not.toContainEqual([8, 12])
    expect(coords).toContainEqual([4, 4])
    expect(coords).toContainEqual([16, 16])
    // track 區不產點(x=4 行仍在 paid 內,但 track 自己的 0..2 帶無點)
    expect(coords.every(([x]) => x >= 4)).toBe(true)
    // 蛇行:第一列(y=4)x 遞增,第二列(y=8)x 遞減
    const row1 = pts.filter(p => p.y === 4).map(p => p.x)
    const row2 = pts.filter(p => p.y === 8).map(p => p.x)
    expect(row1).toEqual([...row1].sort((a, b) => a - b))
    expect(row2).toEqual([...row2].sort((a, b) => b - a))
    // 編號:前綴+三位流水、note 帶入
    expect(pts[0].id).toBe('B9-001')
    expect(pts[0].floor).toBe('test-floor')
    expect(pts[0].note).toBe('測試區')
    // 離牆 0.8:貼 area 邊(x=2 邊,候選最近 x=4 距 2)全過 —— 驗上界:沒有點離自己 area 邊 <0.8
  })

  it('內部縫不剔點:兩相鄰可走區', () => {
    const seamFloor = {
      id: 'seam-floor',
      slab: { outline: [[0, 0], [20, 0], [20, 10], [0, 10]] as Pt[] },
      areas: [
        { id: 'L', kind: 'paid', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] as Pt[] },
        { id: 'R', kind: 'unpaid', polygon: [[10, 0], [20, 0], [20, 10], [10, 10]] as Pt[] },
      ],
    }
    const pts = generateFloorPoints(seamFloor as never, 'S', 3, 0.8)
    const coords = pts.map(p => [p.x, p.y])
    expect(coords).toContainEqual([10.5, 4.5])   // 距內部縫 0.5m → 保留(非牆)
    expect(coords).not.toContainEqual([19.5, 4.5]) // 距外牆 0.5m → 剔除
  })
})
