// tools/floor-svg.ts
import type { Pt } from './rp-geometry'

export interface FloorSvgJson {
  slab: { outline: Pt[] }
  areas?: { kind: string; polygon?: Pt[] }[]
  units?: { polygon?: Pt[] }[]
}

export const AREA_FILL: Record<string, string> = {
  corridor: '#dbeafe', unpaid: '#dcfce7', paid: '#fef9c3',
  platform: '#e0e7ff', track: '#fecaca', 'stair-void': '#f3e8ff',
}

/** 底圖（slab＋areas＋units）與座標翻轉，供 rp 點位圖與走線找邊圖共用。
 *  獨立成無 CLI 的模組：gen-edges 若 value-import gen-rp-points,其檔尾
 *  `if (!process.env.VITEST) main()` 會被連帶執行。 */
export function floorSvgBase(floor: FloorSvgJson): { fy: (y: number) => number; open: string; parts: string[]; size: [number, number] } {
  const outline = floor.slab.outline
  const xs = outline.map(p => p[0]); const ys = outline.map(p => p[1])
  const minX = Math.min(...xs) - 5, maxX = Math.max(...xs) + 5
  const minY = Math.min(...ys) - 5, maxY = Math.max(...ys) + 5
  const fy = (y: number) => maxY + minY - y // 模型 +Y 朝北,SVG y 朝下 → 翻轉
  const poly = (pts: Pt[], fill: string, stroke = '#9ca3af') =>
    `<polygon points="${pts.map(([x, y]) => `${x},${fy(y)}`).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="0.3"/>`
  const parts: string[] = [poly(outline, '#f3f4f6', '#6b7280')]
  for (const a of floor.areas ?? []) if ((a.polygon?.length ?? 0) >= 3) parts.push(poly(a.polygon!, AREA_FILL[a.kind] ?? '#e5e7eb'))
  for (const u of floor.units ?? []) if ((u.polygon?.length ?? 0) >= 3) parts.push(poly(u.polygon!, '#d1d5db'))
  // 缺少內在尺寸會讓部分縮圖器（實測三星相簿）崩潰，進而拖垮媒體索引。
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${maxX - minX}" height="${maxY - minY}" viewBox="${minX} ${minY} ${maxX - minX} ${maxY - minY}">`
  return { fy, open, parts, size: [maxX - minX, maxY - minY] }
}
