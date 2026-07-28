import type * as THREE from 'three';

/** ?fps=1 開發用效能 overlay：FPS／frame ms／draw calls。每 500ms 更新一次。
 *  回傳 tick 需在該幀**所有** render 之後呼叫（composer 與 labelLayer 都跑完）。 */
export function attachFpsOverlay(renderer: THREE.WebGLRenderer): (() => void) | null {
  if (typeof document === 'undefined') return null; // node 環境保底（constraint 一致性）
  if (new URLSearchParams(location.search).get('fps') !== '1') return null;
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:98;background:#000c;'
    + 'color:#0f0;font:12px monospace;padding:6px 8px;border-radius:6px;'
    + 'pointer-events:none;white-space:pre';
  document.body.append(el);
  // three 預設每次 renderer.render() 起手就 info.reset()。AO 開啟時 EffectComposer 一幀要跑
  // 多個 pass，計數於是被洗成「最後一道全螢幕合成 quad」＝1，比實際少兩個數量級——
  // 預設顯示 draws 1，?ao=off 才顯示 213，拿它做效能診斷會得到相反結論（QA ISSUE-005）。
  // 改由本模組每幀歸零一次，讓計數涵蓋整幀所有 pass。
  let frames = 0;
  let last = performance.now();
  let started = false;
  return () => {
    if (!started) {
      // 接手時機在第一次 tick，不在掛載時：掛載點（main.ts）之後還有 PMREM 環境貼圖預濾
      // 等 boot 期 render，提早關掉 autoReset 會把那些 draw call 累進第一次讀數——
      // boot 超過 500ms 的裝置上，第一格數字會是開機統計而非首幀（PR #5 review）。
      started = true;
      renderer.info.autoReset = false;
      renderer.info.reset(); // 丟掉 boot 與首幀，從下一幀開始才是乾淨的每幀計數
      last = performance.now();
    }
    frames++;
    const now = performance.now();
    const span = now - last;
    if (span >= 500) {
      el.textContent = `${((frames * 1000) / span).toFixed(0)} fps  ${(span / frames).toFixed(1)} ms`
        + `\ndraws ${renderer.info.render.calls}`;
      frames = 0;
      last = now;
    }
    renderer.info.reset(); // autoReset 已關；歸零必須每幀做，否則跨幀累加成無意義的大數
  };
}
