import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { frameGoal, chaseGoal, CHASE_BACK, CHASE_UP } from '../src/camera';

describe('frameGoal', () => {
  it('target=點集中心、距離=半徑*1.3/tan(fov/2)（含最小半徑 12）', () => {
    const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0)];
    const g = frameGoal(pts, 1, 55);
    expect(g.target.x).toBeCloseTo(5, 5);
    // r=5 < 最小 12 → 用 12
    const expected = (12 * 1.3) / Math.tan(THREE.MathUtils.degToRad(55) / 2);
    expect(g.pos.distanceTo(g.target)).toBeCloseTo(expected, 3);
  });
  it('寬 aspect 用垂直 fov、窄 aspect 用水平 fov（取較小者）', () => {
    const pts = [new THREE.Vector3(-50, 0, 0), new THREE.Vector3(50, 0, 0)];
    expect(frameGoal(pts, 0.5, 55).pos.distanceTo(new THREE.Vector3(0, 0, 0)))
      .toBeGreaterThan(frameGoal(pts, 2, 55).pos.distanceTo(new THREE.Vector3(0, 0, 0)));
  });
});

/** 把世界座標投影成畫面 y 的比例（0=頂、1=底）——與 viewer 的相機組態一致。 */
function screenY(p: THREE.Vector3, goal: { pos: THREE.Vector3; target: THREE.Vector3 }, aspect: number): number {
  const cam = new THREE.PerspectiveCamera(55, aspect, 0.1, 2000);
  cam.position.copy(goal.pos);
  cam.lookAt(goal.target);
  cam.updateMatrixWorld(true);
  return (-p.clone().project(cam).y * 0.5 + 0.5);
}

// QA ISSUE-009：梯前全景框 connector 兩端，marker 只在其中一端 → 必然偏離畫面中心。
// 往下的梯 marker 落在中心上方，正好是導航橫幅的位置；不讓位就整個被蓋住。
describe('frameGoal insets（固定 UI 讓位）', () => {
  // 真實幾何：c-elv-rctc-1（B3 n-rc-011 ↔ B1 n-tc-004），explodeFactor=0 的世界座標。
  // 刻意不用合成豎井——純垂直的短連接會落進 MIN_RADIUS 12 的保底，相機退得比內容
  // 需要的更遠，marker 反而靠近畫面中心，測不出這個缺陷。
  const upper = new THREE.Vector3(120, -8, -38);   // 往下的梯：marker 站在上端（B1）
  const lower = new THREE.Vector3(120, -21, -38);
  const ASPECT = 730 / 742;
  const TOP = 255 / 742;   // 桌機：導航橫幅（含 transition 卡）佔掉的頂部比例
  const BOTTOM = 300 / 812; // 手機：max-width:600px 時橫幅變底部 sheet

  it('無 inset 時行為不變（既有呼叫端不受影響）', () => {
    const a = frameGoal([upper, lower], ASPECT, 55);
    for (const b of [frameGoal([upper, lower], ASPECT, 55, {}),
                     frameGoal([upper, lower], ASPECT, 55, { top: 0, bottom: 0 })]) {
      expect(b.pos.distanceTo(a.pos)).toBeCloseTo(0, 6);
      expect(b.target.distanceTo(a.target)).toBeCloseTo(0, 6);
    }
  });

  it('往下的梯：不讓位時 marker 落在頂部橫幅帶內，讓位後移到帶外', () => {
    const before = screenY(upper, frameGoal([upper, lower], ASPECT, 55), ASPECT);
    const after = screenY(upper, frameGoal([upper, lower], ASPECT, 55, { top: TOP }), ASPECT);
    expect(before).toBeLessThan(TOP);      // 迴歸守線：這就是 bug 當時的狀態
    expect(after).toBeGreaterThan(TOP);    // 修好後必須在橫幅下緣以下
  });

  it('往上的梯：本來就在帶外，讓位後不會被推出畫面', () => {
    const after = screenY(lower, frameGoal([lower, upper], ASPECT, 55, { top: TOP }), ASPECT);
    expect(after).toBeGreaterThan(TOP);
    expect(after).toBeLessThan(1);
  });

  it('兩端都仍在畫面內（讓位不得犧牲梯前全景本身）', () => {
    const g = frameGoal([upper, lower], ASPECT, 55, { top: TOP });
    for (const p of [upper, lower]) {
      const y = screenY(p, g, ASPECT);
      expect(y).toBeGreaterThan(TOP);
      expect(y).toBeLessThan(1);
    }
  });

  // PR #5 review：手機版橫幅是底部 sheet（index.html max-width:600px 把它改成 bottom:0）。
  // 只做 top inset 會把內容往下推進 sheet 裡，正好推反。
  it('底部 sheet：讓位方向相反，內容推離下緣而非推向它', () => {
    const MOBILE = 375 / 812;
    const g = frameGoal([lower, upper], MOBILE, 55, { bottom: BOTTOM });
    for (const p of [upper, lower]) {
      const y = screenY(p, g, MOBILE);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1 - BOTTOM); // sheet 上緣以上
    }
  });

  it('上下 inset 方向相反：同一組點的螢幕位移一個往下、一個往上', () => {
    const mid = screenY(upper, frameGoal([upper, lower], ASPECT, 55), ASPECT);
    const withTop = screenY(upper, frameGoal([upper, lower], ASPECT, 55, { top: 0.3 }), ASPECT);
    const withBottom = screenY(upper, frameGoal([upper, lower], ASPECT, 55, { bottom: 0.3 }), ASPECT);
    expect(withTop).toBeGreaterThan(mid);
    expect(withBottom).toBeLessThan(mid);
  });

  it('inset 夾總和上限並保住上下比值，矮視窗配高卡片不會把相機推到無限遠', () => {
    const far = frameGoal([upper, lower], ASPECT, 55, { top: 0.8, bottom: 0.8 });
    const cap = frameGoal([upper, lower], ASPECT, 55, { top: 0.225, bottom: 0.225 });
    expect(far.pos.distanceTo(far.target)).toBeCloseTo(cap.pos.distanceTo(cap.target), 6);
    expect(Number.isFinite(far.pos.length())).toBe(true);
    // 等比例縮小保住比值 → 上下相等時位移互相抵消：注視點就是點集中心，無垂直偏移。
    // （相機仍會退遠，因為可用帶變窄；故單點的螢幕位置會更靠近中心，不是原地不動。）
    const plain = frameGoal([upper, lower], ASPECT, 55, {});
    expect(far.target.distanceTo(plain.target)).toBeCloseTo(0, 6);
    expect(far.pos.distanceTo(far.target)).toBeGreaterThan(plain.pos.distanceTo(plain.target));
  });
});

describe('chaseGoal', () => {
  it('相機在 marker 後上方、注視前方 8m', () => {
    const g = chaseGoal(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10, 0, 0));
    expect(g.pos.x).toBeCloseTo(-CHASE_BACK, 5);
    expect(g.pos.y).toBeCloseTo(CHASE_UP, 5);
    expect(g.target.x).toBeCloseTo(8, 5);
  });
  it('下一點與 marker 重合時朝 -z 保底', () => {
    const g = chaseGoal(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 2, 3));
    expect(g.pos.z).toBeCloseTo(3 + CHASE_BACK, 5);
  });
});
