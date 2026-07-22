import type { GraphEdge } from './nav';
import type { FollowState } from './follow';

// PDR 1D 步進沿邊（Phase 4）：步偵測與沿路徑推進的純函式核心。
// 感測器薄殼在 pdr-sensor.ts；推進體感走 main.ts advanceOnce()——本模組零 DOM。

export interface PdrParams {
  peakThreshold: number;  // m/s²：去重力後加速度峰值門檻
  rearmThreshold: number; // 遲滯：偏差回落至此以下才重新武裝
  minStepMs: number;      // 不應期：兩步最短間隔
  emaAlpha: number;       // 重力基線 EMA 係數（~50Hz 取樣）
  stepLength: number;     // 公尺/步
}

// ponytail: 固定步長＋單軸模長峰值偵測；真機誤差大再上自適應步長/頻域法
export const PDR_DEFAULTS: PdrParams = {
  peakThreshold: 1.2,
  rearmThreshold: 0.4,
  minStepMs: 300,
  emaAlpha: 0.02,
  stepLength: 0.7,
};

export interface StepState { ema: number | null; lastStepT: number; armed: boolean }

export const initStepState = (): StepState =>
  ({ ema: null, lastStepT: -Infinity, armed: true });

/** 單樣本步偵測：mag = |accelerationIncludingGravity|（重力由 EMA 基線去除）。 */
export function stepSample(
  s: StepState, t: number, mag: number, p: PdrParams = PDR_DEFAULTS,
): { state: StepState; step: boolean } {
  if (s.ema === null) return { state: { ...s, ema: mag }, step: false }; // 首樣本定基線
  const ema = s.ema + p.emaAlpha * (mag - s.ema);
  const dev = mag - ema;
  if (s.armed && dev > p.peakThreshold && t - s.lastStepT >= p.minStepMs)
    return { state: { ema, lastStepT: t, armed: false }, step: true };
  if (!s.armed && dev < p.rearmThreshold)
    return { state: { ema, lastStepT: s.lastStepT, armed: true }, step: false };
  return { state: { ...s, ema }, step: false };
}

export interface WalkState { edgeDist: number } // 腳下這條邊已走距離（公尺）

const isConnector = (e: GraphEdge): boolean =>
  e.kind === 'stair' || e.kind === 'escalator' || e.kind === 'elevator';

/** 一步沿邊累距：回傳應呼叫 advanceOnce 的次數。
 *  腳下（或跨進）connector 邊 → paused＝退手動確認，距離歸零不累積。 */
export function walkStep(
  edges: GraphEdge[], follow: FollowState, w: WalkState, stepLen: number,
): { w: WalkState; advances: number; paused: boolean } {
  let idx = follow.index;
  if (idx >= edges.length) return { w: { edgeDist: 0 }, advances: 0, paused: false }; // atEnd
  if (isConnector(edges[idx])) return { w: { edgeDist: 0 }, advances: 0, paused: true };
  let dist = w.edgeDist + stepLen;
  let advances = 0;
  while (idx < edges.length && !isConnector(edges[idx]) && dist >= edges[idx].length) {
    dist -= edges[idx].length;
    idx++;
    advances++;
  }
  if (idx >= edges.length) return { w: { edgeDist: 0 }, advances, paused: false };
  if (isConnector(edges[idx])) return { w: { edgeDist: 0 }, advances, paused: true };
  return { w: { edgeDist: dist }, advances, paused: false };
}
