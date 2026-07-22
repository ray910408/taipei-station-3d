// DeviceMotion 薄 adapter（Phase 4）：權限三態＋取樣。步偵測邏輯在 pdr.ts。
// 取 accelerationIncludingGravity 模長——iOS/Android 對 acceleration 欄位支援不一，
// 重力由 pdr.ts 的 EMA 基線去除。

interface MotionPermissionApi { requestPermission?: () => Promise<string> }

export function motionSupported(): boolean {
  return typeof DeviceMotionEvent !== 'undefined';
}

/** iOS 需在使用者手勢內呼叫；無 requestPermission 的平台視同 granted。 */
export async function requestMotionPermission(): Promise<boolean> {
  if (!motionSupported()) return false;
  const api = DeviceMotionEvent as unknown as MotionPermissionApi;
  if (typeof api.requestPermission !== 'function') return true;
  try {
    return (await api.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/** 開始取樣，回傳 stop。樣本＝(performance.now(), |accelerationIncludingGravity|)。 */
export function startMotion(onSample: (t: number, mag: number) => void): () => void {
  const handler = (ev: DeviceMotionEvent): void => {
    const a = ev.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    onSample(performance.now(), Math.hypot(a.x, a.y, a.z));
  };
  addEventListener('devicemotion', handler);
  return () => removeEventListener('devicemotion', handler);
}
