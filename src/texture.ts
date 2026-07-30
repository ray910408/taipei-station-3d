import * as THREE from 'three';
import { THEME } from './theme';

let cachedTile: THREE.CanvasTexture | null = null;
let cachedPanel: THREE.CanvasTexture | null = null;

/** tileGrid×tileGrid 磚 canvas 紋理：白底＋每磚亮度微差＋磚縫＋固定 seed 噪點
 *  （RepeatWrapping 平鋪成格）。多磚同張才做得出鄰磚色差——單磚平鋪每格都長一樣。
 *  Node 環境（vitest / export-glb）回傳 null——builder 不碰 document 的邊界由此模組守住。 */
export function floorTileTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (cachedTile) return cachedTile;
  const T = THEME.textures;
  const S = 256; // 每磚 px
  const N = T.tileGrid;
  const c = document.createElement('canvas');
  c.width = c.height = S * N;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S * N, S * N);
  // 固定 seed LCG：每次載入紋理一致，避免 reload 閃爍差異
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let ty = 0; ty < N; ty++)
    for (let tx = 0; tx < N; tx++) {
      ctx.fillStyle = `rgba(60,64,67,${rand() * T.tileTintAlpha})`;
      ctx.fillRect(tx * S, ty * S, S, S);
    }
  ctx.fillStyle = `rgba(60,64,67,${T.noiseAlpha})`;
  for (let i = 0; i < 900 * N * N; i++)
    ctx.fillRect(Math.floor(rand() * S * N), Math.floor(rand() * S * N), 1, 1);
  ctx.strokeStyle = `rgba(60,64,67,${T.groutAlpha})`;
  ctx.lineWidth = 2;
  for (let i = 0; i <= N; i++) {
    const p = Math.min(i * S + 0.5, S * N - 0.5);
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S * N); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(S * N, p); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / (T.tileMeters * N), 1 / (T.tileMeters * N));
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedTile = tex;
  return tex;
}

/** 牆帶/柱面面板紋理：直向接縫（每 panelMeters 一道）＋每片亮度微差＋噪點。
 *  只有直縫沒有橫縫——shell 牆帶才 0.9m 高，橫縫擠不下。
 *  u/v 皆以公尺計（牆 UV 由 builder 換算、柱為 ExtrudeGeometry 原生公尺 UV）。 */
export function wallPanelTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (cachedPanel) return cachedPanel;
  const T = THEME.textures;
  const S = 256; // 每片 px
  const N = 4; // 多片同張做鄰片色差，理由同 floorTileTexture
  const c = document.createElement('canvas');
  c.width = S * N;
  c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S * N, S);
  let seed = 7;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let tx = 0; tx < N; tx++) {
    ctx.fillStyle = `rgba(60,64,67,${rand() * T.tileTintAlpha})`;
    ctx.fillRect(tx * S, 0, S, S);
  }
  ctx.fillStyle = `rgba(60,64,67,${T.noiseAlpha})`;
  for (let i = 0; i < 900 * N; i++)
    ctx.fillRect(Math.floor(rand() * S * N), Math.floor(rand() * S), 1, 1);
  ctx.strokeStyle = `rgba(60,64,67,${T.groutAlpha})`;
  ctx.lineWidth = 2;
  for (let i = 0; i <= N; i++) {
    const p = Math.min(i * S + 0.5, S * N - 0.5);
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, S); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / (T.panelMeters * N), 1 / T.panelMeters);
  tex.colorSpace = THREE.SRGBColorSpace;
  cachedPanel = tex;
  return tex;
}

const FLOOR_KINDS = new Set(['slab', 'platform', 'paid', 'unpaid', 'corridor', 'restricted']);
const PANEL_KINDS = new Set(['shell', 'wall', 'unit-column']);

/** runtime 附掛程序化紋理：地板類貼磚格、牆帶/柱貼面板（比照 attachPoiIcons 慣例）。
 *  ExtrudeGeometry UV＝shape 公尺座標，repeat 即公尺磚格。
 *  kind 不在自己身上就往 parent 找，理由同 applyShadowFlags：export:glb 拆 primitive 後
 *  kind 落在 parent。註：此 fallback 目前無測試覆蓋——本函式在 node 環境會因無 document
 *  提前返回，要驗得先 stub document，代價高於這一行的風險。 */
export function attachProceduralTextures(root: THREE.Object3D, anisotropy = 1): void {
  const tile = floorTileTexture();
  const panel = wallPanelTexture();
  if (!tile || !panel) return;
  tile.anisotropy = anisotropy;
  panel.anisotropy = anisotropy;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const kind = typeof mesh.userData.kind === 'string' ? mesh.userData.kind
      : typeof mesh.parent?.userData.kind === 'string' ? mesh.parent.userData.kind : '';
    const isFloor = FLOOR_KINDS.has(kind);
    if (!isFloor && !PANEL_KINDS.has(kind)) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMaterial && 'map' in std) {
        std.map = isFloor ? tile : panel;
        if (isFloor) std.roughness = THEME.textures.floorRoughness; // 拋光石英磚：地板類單獨壓低吃 env 反射
        std.needsUpdate = true;
      }
    }
  });
}
