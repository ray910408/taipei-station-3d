import type { AreaKind, UnitKind } from './types';

/** Map Presentation System 唯一視覺真源：3D 材質、光影、UI CSS vars 全由此驅動。
 *  tracer(2D) 不在此列——其編輯配色留在 palette.ts。 */
export const THEME = {
  scene: { background: '#14161c', ground: '#1b1e26', groundY: -30, groundSize: 1200 },
  render: { maxPixelRatio: 2, toneMappingExposure: 1.05, envIntensity: 0.35 },
  // n8ao SSAO（去塑膠 T5）：接觸陰影——牆腳/樓板交角/豎井周圍。?ao=off 可關
  ao: { radius: 4, distanceFalloff: 1, intensity: 2.6, color: '#05070b', halfRes: true },
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
  body: { sideDarken: 0.72, edge: '#aab3c2', edgeOpacity: 0.7, massHeight: 0.9, escalatorRun: 8 },
  // 程序化地磚（Phase 6 去塑膠）：白底磚格 × 材質底色相乘；要「有材質的白」不要照片地板。
  // tileGrid：單張 canvas 內磚數（每磚一個亮度微差，打破大片純白）；floorRoughness：
  // 地板類單獨壓低走拋光石英磚（env 反射），其餘材質維持全域 roughness。
  // panelMeters：牆帶/柱面的面板接縫間距（牆 UV 已在 builder 換算成公尺）
  textures: { tileMeters: 2, tileGrid: 4, noiseAlpha: 0.05, groutAlpha: 0.22, tileTintAlpha: 0.05, floorRoughness: 0.5, panelMeters: 2.4 },
  // nav 跟隨（Phase 5）：低視角 chase（pitch≈27°）＋marker 滑行＋換層 crossfade
  nav: {
    chaseBack: 14, chaseUp: 7,
    markerSpeed: 3, segMinMs: 600, segMaxMs: 2500,
    crossfadeMs: 900,
  },
  materials: {
    roughness: 0.85,
    platformWhiten: 0.4,
    slab: { color: '#ffffff', opacity: 1 },
    shell: { color: '#c8ccd4', opacity: 1 },
    wall: { color: '#c8ccd4', opacity: 1 },
    area: {
      platform: '#e9e2cf', paid: '#efe6e6', unpaid: '#e4ebf6',
      corridor: '#e6efe8', track: '#0f1218', restricted: '#e7e9ee',
    } satisfies Record<AreaKind, string>,
    areaOpacity: 1,
    unit: {
      column: { color: '#c4c7cc', opacity: 1 },
      shop: { color: '#f3e2c7', opacity: 1 },
      room: { color: '#e8eaed', opacity: 1 },
      machine: { color: '#d2e3fc', opacity: 1 },
      'stair-void': { color: '#dadce0', opacity: 0.4 },
    } satisfies Record<UnitKind, { color: string; opacity: number }>,
    gate: { accessible: '#37a559', standard: '#7a828f' },
    rail: { color: '#9aa2ae' }, // 軌道溝內的鋼軌——深色溝底上的亮線
    platformEdge: { color: '#d9b74a', inset: 0.45, width: 0.4 }, // 月台邊緣警戒帶（鄰軌道的長邊）
    paidOverlay: { color: '#e6b45a', opacity: 0.18, dash: '#e6b45a' },
    connector: {
      stair: { color: '#8b93a3', opacity: 0.95 },
      escalator: { color: '#f2972e', opacity: 0.96 },
      elevator: { color: '#3f86f4', opacity: 0.62 },
    },
  },
  route: {
    color: '#1a73e8', radius: 0.9, linkRadius: 0.45, hover: 1.2, // hover：路線／pin／marker 懸浮高度單一真源
    markerLift: 1.8, // marker 相對路線平面的額外懸浮空隙——chase 俯角 27° 下要能看見本體與影之間的分離
    markerShadow: { radius: 3.0, opacity: 0.45 }, // 接觸陰影盤：需明顯大於環外徑 1.84，露出的環外暗圈才是懸浮線索
    arrowInterval: 5, arrowSpeed: 0.5,
    pinStart: '#188038', pinEnd: '#d93025', marker: '#00c853', markerSide: '#00913d',
  },
  emphasis: { dim: 0.15, focusDim: 0.05 }, // focusDim：右側樓層鍵聚焦（問題6）；dim：preview/nav 沿用
  // 3D 選點（Phase 4）：tap 判定閾值與 pick pin 色（紫——避開起點綠/終點紅/marker 綠）
  selection: { tapThresholdPx: 6, pin: '#a855f7' },
  poi: {
    tile: '#1f2023', fg: '#ffffff',
    gate: '#1a73e8', gateBg: '#ffffff',
  },
  poiSize: 2.4,
  labels: {
    floorTagMinExplode: 0.6, landmarkMaxDist: 320, landmarkNearDist: 140, floorTagStagger: 10, declutterPad: 4,
    floorTag: { bg: '#1b1e26e6', fg: '#e7ebf2' },
    landmark: { bg: '#22262fcc', fg: '#c7cedb' },
  },
  ui: {
    '--bg': '#1b1e26f2', '--line': '#2f343d', '--fg': '#e7ebf2',
    '--muted': '#9aa4b4', '--primary': '#4f86f4',
    // --muted 在半透明的 #nav-banner 底下（淺色樓板時合成底色約 #3c3e45）只剩 3.9:1，
    // 低於 WCAG AA。這個較亮的次要色在同樣底色上是 6.6:1，且仍明顯暗於 --fg。
    '--fg-dim': '#c3ccda',
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
