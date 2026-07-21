import type { AreaKind, UnitKind } from './types';

/** Map Presentation System 唯一視覺真源：3D 材質、光影、UI CSS vars 全由此驅動。
 *  tracer(2D) 不在此列——其編輯配色留在 palette.ts。 */
export const THEME = {
  scene: { background: '#f1f0ec', ground: '#e7e5e0', groundY: -30, groundSize: 1200 },
  render: { maxPixelRatio: 2, toneMappingExposure: 1.05 },
  lights: {
    hemi: { sky: '#ffffff', ground: '#d8d4cd', intensity: 0.9 },
    sun: {
      color: '#ffffff', intensity: 1.6,
      position: [150, 250, 120] as [number, number, number],
      target: [60, -20, 0] as [number, number, number],
      shadow: { mapSize: 2048, bounds: 180, near: 10, far: 600, bias: -0.0005, normalBias: 0.5 },
    },
  },
  // 體塊語言（Phase 5）：頂亮側暗＋描邊
  body: { sideDarken: 0.8, edge: '#9aa0a6', edgeOpacity: 0.35 },
  // nav 跟隨（Phase 5）：低視角 chase（pitch≈27°）＋marker 滑行＋換層 crossfade
  nav: {
    chaseBack: 14, chaseUp: 7,
    markerSpeed: 3, segMinMs: 600, segMaxMs: 2500,
    crossfadeMs: 900,
  },
  materials: {
    slab: { color: '#ffffff', opacity: 1 },
    shell: { color: '#dadce0', opacity: 0.06 },
    wall: { color: '#dadce0', opacity: 1 },
    area: {
      platform: '#f3e8c9', paid: '#fce8e6', unpaid: '#e8f0fe',
      corridor: '#e6f4ea', track: '#3c4043', restricted: '#e8eaed',
    } satisfies Record<AreaKind, string>,
    areaOpacity: 1,
    unit: {
      column: { color: '#c4c7cc', opacity: 1 },
      shop: { color: '#f3e2c7', opacity: 1 },
      room: { color: '#e8eaed', opacity: 1 },
      machine: { color: '#d2e3fc', opacity: 1 },
      'stair-void': { color: '#dadce0', opacity: 0.4 },
    } satisfies Record<UnitKind, { color: string; opacity: number }>,
    gate: { accessible: '#188038', standard: '#80868b' },
    connector: {
      stair: { color: '#e8a33d', opacity: 0.95 },
      elevator: { color: '#1a73e8', opacity: 0.55 },
    },
  },
  route: {
    color: '#1a73e8', radius: 0.9, linkRadius: 0.45,
    arrowInterval: 5, arrowSpeed: 0.5,
    pinStart: '#188038', pinEnd: '#d93025', marker: '#1a73e8',
  },
  emphasis: { dim: 0.15 },
  poi: {
    tile: '#1f2023', fg: '#ffffff',
    gate: '#1a73e8', gateBg: '#ffffff',
  },
  poiSize: 2.4,
  labels: {
    floorTagMinExplode: 0.6, landmarkMaxDist: 320, floorTagStagger: 10,
    floorTag: { bg: '#ffffffe6', fg: '#202124' },
    landmark: { bg: '#ffffffcc', fg: '#3c4043' },
  },
  ui: {
    '--bg': '#fffffff2', '--line': '#dadce0', '--fg': '#202124',
    '--muted': '#5f6368', '--primary': '#1a73e8',
  },
};
// 注意：不用 `as const`——與 satisfies 併用會撞 TS const-assertion 限制；
// 需要 tuple 型別的 position/target 已個別斷言。

/** boot 時把 UI tokens 寫入 CSS vars——JS 為唯一真源，index.html :root 僅為 first-paint fallback。 */
export function applyUITheme(
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement,
): void {
  for (const [k, v] of Object.entries(THEME.ui)) root.style.setProperty(k, v);
}
