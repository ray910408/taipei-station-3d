import type { AreaKind, UnitKind } from './types';

/** Map Presentation System 唯一視覺真源：3D 材質、光影、UI CSS vars 全由此驅動。
 *  tracer(2D) 不在此列——其編輯配色留在 palette.ts。 */
export const THEME = {
  scene: { background: '#eceae5', ground: '#dcd9d2', groundY: -30, groundSize: 1200 },
  render: { maxPixelRatio: 2, toneMappingExposure: 1.05, envIntensity: 0.35 },
  // n8ao SSAO（去塑膠 T5）：接觸陰影——牆腳/樓板交角/豎井周圍。?ao=off 可關
  ao: { radius: 4, distanceFalloff: 1, intensity: 2.5, color: '#30343c', halfRes: true },
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
  body: { sideDarken: 0.8, edge: '#80868b', edgeOpacity: 0.55 },
  // 程序化地磚（Phase 6 去塑膠）：白底單磚 × 材質底色相乘；強度刻意壓低——要「有材質的白」不要照片地板
  textures: { tileMeters: 2, noiseAlpha: 0.05, groutAlpha: 0.1 },
  // nav 跟隨（Phase 5）：低視角 chase（pitch≈27°）＋marker 滑行＋換層 crossfade
  nav: {
    chaseBack: 14, chaseUp: 7,
    markerSpeed: 3, segMinMs: 600, segMaxMs: 2500,
    crossfadeMs: 900,
  },
  materials: {
    roughness: 0.85,
    platformWhiten: 0.55,
    slab: { color: '#ffffff', opacity: 1 },
    shell: { color: '#dadce0', opacity: 0.06 },
    wall: { color: '#dadce0', opacity: 1 },
    area: {
      platform: '#f3e8c9', paid: '#f9efee', unpaid: '#eef3fb',
      corridor: '#eff5f0', track: '#3c4043', restricted: '#eeeff1',
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
  // 3D 選點（Phase 4）：tap 判定閾值與 pick pin 色（紫——避開起點綠/終點紅/marker 藍）
  selection: { tapThresholdPx: 6, pin: '#9334e6' },
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

/** 線性混色（sRGB 分量插值）：t=0 → a、t=1 → b。月台系統色淡化等表現層共用。 */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const ch = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  const r = ch((ca >> 16) & 255, (cb >> 16) & 255);
  const g = ch((ca >> 8) & 255, (cb >> 8) & 255);
  const bl = ch(ca & 255, cb & 255);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

/** boot 時把 UI tokens 寫入 CSS vars——JS 為唯一真源，index.html :root 僅為 first-paint fallback。 */
export function applyUITheme(
  root: { style: { setProperty(name: string, value: string): void } } = document.documentElement,
): void {
  for (const [k, v] of Object.entries(THEME.ui)) root.style.setProperty(k, v);
}
