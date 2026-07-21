import * as THREE from 'three';
import { THEME } from './theme';

let cached: THREE.CanvasTexture | null = null;

/** 2m×2m 單磚 canvas 紋理：白底＋磚縫＋固定 seed 噪點（RepeatWrapping 平鋪成格）。
 *  Node 環境（vitest / export-glb）回傳 null——builder 不碰 document 的邊界由此模組守住。 */
export function floorTileTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  if (cached) return cached;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, S, S);
  const T = THEME.textures;
  // 固定 seed LCG：每次載入紋理一致，避免 reload 閃爍差異
  let seed = 42;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  ctx.fillStyle = `rgba(60,64,67,${T.noiseAlpha})`;
  for (let i = 0; i < 900; i++) ctx.fillRect(Math.floor(rand() * S), Math.floor(rand() * S), 1, 1);
  ctx.strokeStyle = `rgba(60,64,67,${T.groutAlpha})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / T.tileMeters, 1 / T.tileMeters);
  tex.colorSpace = THREE.SRGBColorSpace;
  cached = tex;
  return tex;
}

const TEXTURED_KINDS = new Set(['slab', 'platform', 'paid', 'unpaid', 'corridor', 'restricted']);

/** runtime 附掛地磚紋理（json/glb 兩軌通用——attachPoiIcons 慣例）。
 *  ExtrudeGeometry UV＝shape 公尺座標，repeat 即公尺磚格；glb 拆 primitive 後 kind 在 parent（fallback 同 applyShadowFlags）。 */
export function attachFloorTextures(root: THREE.Object3D, anisotropy = 1): void {
  const tex = floorTileTexture();
  if (!tex) return;
  tex.anisotropy = anisotropy;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const kind = typeof mesh.userData.kind === 'string' ? mesh.userData.kind
      : typeof mesh.parent?.userData.kind === 'string' ? mesh.parent.userData.kind : '';
    if (!TEXTURED_KINDS.has(kind)) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMaterial && 'map' in std) {
        std.map = tex;
        std.needsUpdate = true;
      }
    }
  });
}
