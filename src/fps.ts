import type * as THREE from 'three';

/** ?fps=1 開發用效能 overlay：FPS／frame ms／draw calls。每 500ms 更新一次。
 *  回傳 tick 需在 renderer.render 之後呼叫（info.render.calls 為當幀值）。 */
export function attachFpsOverlay(renderer: THREE.WebGLRenderer): (() => void) | null {
  if (typeof document === 'undefined') return null; // node 環境保底（constraint 一致性）
  if (new URLSearchParams(location.search).get('fps') !== '1') return null;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:98;background:#000c;'
    + 'color:#0f0;font:12px monospace;padding:6px 8px;border-radius:6px;'
    + 'pointer-events:none;white-space:pre';
  document.body.append(el);
  let frames = 0;
  let last = performance.now();
  return () => {
    frames++;
    const now = performance.now();
    const span = now - last;
    if (span >= 500) {
      el.textContent = `${((frames * 1000) / span).toFixed(0)} fps  ${(span / frames).toFixed(1)} ms`
        + `\ndraws ${renderer.info.render.calls}`;
      frames = 0;
      last = now;
    }
  };
}
