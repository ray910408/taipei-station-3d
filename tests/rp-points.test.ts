import { describe, expect, it } from 'vitest'
import { pointInPolygon } from '../src/geometry'
import { chainRows, distToPolygonEdge, type Pt } from '../tools/rp-geometry'
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

  it('chainRows:相鄰列反向串接,不留回頭路', () => {
    const rows = [
      [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 8, y: 0 }],
      [{ x: 0, y: 4 }, { x: 4, y: 4 }, { x: 8, y: 4 }],
    ]
    expect(chainRows(rows).map(p => [p.x, p.y])).toEqual([
      [0, 0], [4, 0], [8, 0],   // 第一列
      [8, 4], [4, 4], [0, 4],   // 第二列自最近端接上 → 反向
    ])
  })

  it('chainRows:起點試遍全部——貪婪從固定列起步會多繞一整條長廊', () => {
    // 三列等長,中間那列在最外側。從第 0 列起貪婪:0→1→2 要橫跨兩次;
    // 從第 1 列(最外)起才是 1→0→2 的單向掃過。
    const row = (y: number) => [{ x: 0, y }, { x: 10, y }]
    const chained = chainRows([row(0), row(100), row(50)])
    let len = 0
    for (let i = 1; i < chained.length; i++) {
      len += Math.hypot(chained[i].x - chained[i - 1].x, chained[i].y - chained[i - 1].y)
    }
    expect(len).toBeLessThan(140) // 最佳 = 10+50+10+50+10 = 130;固定起點的貪婪會到 230
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
    // 走訪順序:每一列(此區主軸退化成 x 固定的直行)內部單調,且沒有橫跨全區的回頭路。
    // 不斷言固定方向——方向由 chainRows 依總距離決定,起點不同就會整條反過來。
    for (const c of new Set(pts.map(p => p.x))) {
      const seq = pts.filter(p => p.x === c).map(p => p.y)
      const mono = seq.every((v, i) => i === 0 || v > seq[i - 1]) || seq.every((v, i) => i === 0 || v < seq[i - 1])
      expect(mono).toBe(true)
    }
    const steps = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
    expect(Math.max(...steps)).toBeLessThanOrEqual(4 * 3) // 障礙造成的斷點最多跳 3 格
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
    // 格線逐區置中,間距 1.4 讓 R 區最外兩排都落在距邊界 0.71m(< clearance 0.8)
    const pts = generateFloorPoints(seamFloor as never, 'S', 1.4, 0.8)
    expect(pts.some(p => p.x > 10 && p.x - 10 < 0.8)).toBe(true)  // 距內部縫 <0.8 → 保留(縫非牆)
    expect(pts.some(p => 20 - p.x < 0.8)).toBe(false)             // 同距離的外牆側 → 剔除
  })

  it('比 spacing 窄的可走區不會整座落空', () => {
    // 真實案例:B2 四座月台各只有 11m 寬。全樓層共用一組格線時,20m 格線依相位
    // 只落進其中兩座,另兩座完全沒有點——採完才會發現半層沒資料。
    const bands: [number, number][] = [[-51.5, -40.5], [-28.8, -17.8], [-1, 10], [20.5, 31.5]]
    const platFloor = {
      id: 'plat-floor',
      slab: { outline: [[-95, -55], [95, -55], [95, 35], [-95, 35]] as Pt[] },
      areas: bands.map(([y0, y1], i) => ({
        id: `plat-${i + 1}`, kind: 'platform',
        polygon: [[-95, y0], [95, y0], [95, y1], [-95, y1]] as Pt[],
      })),
    }
    const pts = generateFloorPoints(platFloor as never, 'P', 20, 0.8)
    for (const [y0, y1] of bands) {
      expect(pts.filter(p => p.y >= y0 && p.y <= y1).length).toBeGreaterThan(0)
    }
  })
})
