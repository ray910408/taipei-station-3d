import type * as THREE from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** 指北針 CSS 旋轉角（deg）：fwd＝相機水平前向 (x,z)。
 *  世界北＝-z（builder.toWorld 將資料 +y 映為 -z；樓層平面圖北朝上）。
 *  面北(0,-1)→0°、面東(1,0)→-90°、面南(0,1)→180°、面西(-1,0)→90°。 */
export function compassAngle(fwdX: number, fwdZ: number): number {
  return Math.atan2(-fwdX, -fwdZ) * (180 / Math.PI);
}

/** 常駐指北針：右上角圓鈕，針形隨相機水平朝向旋轉；點擊把相機繞 target 轉到面北。
 *  比照 fps.ts——attach 建 DOM、回傳 { tick }；node 環境無 document 回 null。 */
export function attachCompass(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  onUserRotate: () => void,
): { tick: () => void } | null {
  if (typeof document === 'undefined') return null; // node 環境保底（比照 fps.ts）
  const btn = document.createElement('button');
  btn.id = 'compass';
  btn.setAttribute('aria-label', '指北（點擊面向北方）');
  // 針形隨整個 svg 旋轉：紅色北端＋南端 muted 尖，「N」隨北端走＝紅端恆指真北
  btn.innerHTML = '<svg id="compass-needle" viewBox="0 0 40 40" aria-hidden="true">'
    + '<path class="n" d="M20 6 L15.5 20 L24.5 20 Z" />'
    + '<path class="s" d="M20 34 L15.5 20 L24.5 20 Z" />'
    + '<text x="20" y="15.5">N</text></svg>';
  document.body.append(btn);
  const needle = btn.querySelector<SVGElement>('#compass-needle')!;

  btn.addEventListener('click', () => {
    onUserRotate(); // 點擊＝使用者接管相機（比照 canvas pointerdown）
    const off = camera.position.clone().sub(controls.target);
    const r = Math.hypot(off.x, off.z); // 水平半徑
    if (r < 1e-6) return; // 正俯視無水平朝向——不動作
    // 移到 target 正南（+z）看向北：俯仰(off.y)與距離(√(off.y²+r²))皆不變
    camera.position.set(controls.target.x, controls.target.y + off.y, controls.target.z + r);
  });

  let lastDeg = NaN;
  return {
    tick: () => {
      const fx = controls.target.x - camera.position.x;
      const fz = controls.target.z - camera.position.z;
      if (fx * fx + fz * fz < 1e-8) return; // 近正俯視——前向水平分量太小，維持上一角
      const deg = compassAngle(fx, fz);
      if (Math.abs(deg - lastDeg) < 0.5) return; // 僅角度顯著變化才寫 DOM（省每幀 style 重寫）
      lastDeg = deg;
      needle.style.transform = `rotate(${deg}deg)`;
    },
  };
}
