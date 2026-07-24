// 導航會話（NavSession）：一次導航的完整生命——事件進（handle）、每幀冪等指令出（frame）。
// 設計裁決見 docs/nav-session-design.md、詞彙見 CONTEXT.md。會話零場景操作：世界座標經注入的
// nodeWorld 取得，THREE.Vector3 僅作純數值型別；實際套用（THREE/DOM/speech/sensor）在 main.ts adapter。
import * as THREE from 'three';
import type { StationModel } from './types';
import { routeSteps, partialRemaining, formatStats, type GraphEdge, type NavGraph } from './nav';
import {
  startFollow, advance, back, atEnd, currentNodeId, remainingEdges, type FollowState,
} from './follow';
import { verticalStep, transitionLabel } from './mode';
import type { WalkState } from './pdr';
import type { CameraGoal } from './camera';
import { chaseGoal, frameGoal } from './camera';
import { makeTween, tweenAt, chaseAim, aimPastVertical, type Tween, type PathTarget } from './navview';

/** 導航事件：使用者或感測器對會話說的話。discriminated union——QA 重現步驟＝可回放腳本。 */
export type NavEvent =
  | { type: 'advanceRequested' } // 手動「我到了」
  | { type: 'backRequested' }
  | { type: 'recenterRequested' } // 「回正」：恢復自動跟隨
  | { type: 'userCameraGrab' };    // 拖曳/指南針點擊＝使用者接管相機

/** nav 面板一次性文案（原 refreshNav 的 UI 更新組）。 */
export interface NavInfo {
  next: string;
  remain: string;
  progress: string;
  arrived: boolean;          // 抵達卡顯示
  transition: string | null; // 垂直段橫幅；null＝清除
}

/** 一次性效果（每事件至多一份）。語音只得出現於此，不得進 FrameDirective（設計裁決 3）。 */
export interface EventOutcome {
  nav?: NavInfo;
  speech?: string;
  emphasisFloor?: string;    // setFloorEmphasis 目標樓層
  fadeRestore?: string[];    // 中斷中的換層先還原——adapter 須在 emphasisFloor 之前套用
  requestPermission?: { ticket: number }; // 去向 OS 要 motion 權限，回覆帶同票
  pdrToggle?: boolean;       // true＝啟動感測器＋UI 開；false＝停感測器＋UI 關
  pdrHint?: boolean;         // 「梯前請手動確認」提示
}

/** 冪等連續狀態：adapter 每幀重複套用安全。 */
export interface FrameDirective {
  markerPos: THREE.Vector3;
  cameraGoal: CameraGoal | null; // null＝本幀不干預相機
  floorFades: { floor: string; factor: number }[]; // 換層 crossfade；掉出清單的樓層由 adapter 還原
}

export interface NavSessionDeps {
  model: StationModel;
  graph: NavGraph;
  edges: GraphEdge[];        // preview 產物：入會話即凍結，呼叫端不得再變異
  nodeWorld(id: string): THREE.Vector3; // 幾何 seam：世界座標（含呼叫當下 explode 係數）
  aspect(): number;          // frameGoal 用（梯前全景/抵達框景）
  stepLength(): number;      // PDR 步長——UI 旋鈕可於會話中調整，故用 getter
  reducedMotion: boolean;    // 免滑行分支（與原 advanceOnce 一致）
  pdrSim: boolean;           // ?pdr=sim：假步鍵，PDR 視為常時啟用
}

export interface NavSession {
  /** 建構當下的初始狀態（nav 文案／emphasis）——adapter 於 startNav 後立即套用。 */
  readonly initial: EventOutcome;
  handle(ev: NavEvent, now: number): EventOutcome;
  frame(now: number): FrameDirective;
}

export function startNavSession(deps: NavSessionDeps, now: number): NavSession {
  const { model, graph, edges, nodeWorld } = deps;
  let follow: FollowState = startFollow(edges); // 空路線在此 throw（沿既有行為）
  let pdrWalk: WalkState = { edgeDist: 0 };
  let lastFloor: string | null = null;
  let tween: Tween | null = null;
  let chaseAuto = true;
  // 滑行佇列（glide queue）：尚未抵達的目標點。不變量：tween≠null ⟺ path 非空且
  // tween.to＝path[0].pos——佇列只在本檔集中建構，invariant 由建構保證（審查候選 C 歸零）。
  let path: PathTarget[] = [];

  /** marker 世界座標：邊上有 PDR 殘距時沿邊插值，否則所在節點（connector 邊 edgeDist 恆 0）。 */
  function markerWorldPos(): THREE.Vector3 {
    const pos = nodeWorld(currentNodeId(follow));
    const edge = edges[follow.index];
    if (!edge || pdrWalk.edgeDist <= 0) return pos;
    return pos.lerp(nodeWorld(edge.to), Math.min(pdrWalk.edgeDist / edge.length, 1));
  }

  /** 當下視覺位置：滑行中取 tween 插值，否則 markerWorldPos。 */
  function markerPos(now2: number): THREE.Vector3 {
    return tween ? tweenAt(tween, now2).pos : markerWorldPos();
  }

  /** 原 refreshNav 對應：nav 文案＋emphasis。now2 供後續換層 crossfade 起算（Task 4）。 */
  function navRefresh(now2: number): EventOutcome {
    void now2;
    const o: EventOutcome = {};
    const cur = graph.nodes.get(currentNodeId(follow))!;
    o.emphasisFloor = cur.floor;
    lastFloor = cur.floor;
    const vEdge = verticalStep(edges, follow);
    const transition = vEdge ? transitionLabel(model, graph, vEdge) : null;
    const progress = `進度 ${follow.index + 1}/${follow.nodeIds.length}`;
    if (atEnd(follow)) {
      o.nav = { next: '已抵達目的地', remain: '', progress, arrived: true, transition };
    } else {
      const remain = remainingEdges(edges, follow);
      const next = routeSteps(model, graph, remain)[0] ?? '前往下一節點';
      o.nav = {
        next: `下一步：${next}`,
        remain: `剩餘 ${formatStats(partialRemaining(remain, pdrWalk.edgeDist))}`,
        progress, arrived: false, transition,
      };
    }
    return o;
  }

  /** 單次節點推進的完整體感：手動確認與 PDR 跨節點的共同入口（原 main.ts advanceOnce）。 */
  function advanceOnce(now2: number, fromPosIn?: THREE.Vector3): EventOutcome {
    let fromPos = fromPosIn ?? markerWorldPos();
    if (tween) { fromPos = tween.to.clone(); tween = null; path = []; } // 快轉：站上前段終點
    follow = advance(follow);
    chaseAuto = true;
    const o = navRefresh(now2);
    o.speech = o.nav!.arrived ? '已抵達目的地' : o.nav!.next;
    if (deps.reducedMotion) return o; // 免滑行：frame() 直接回新節點位置
    const to = markerWorldPos();
    path = [{ pos: to, residual: false }]; // 手動推進目標＝節點
    tween = makeTween(fromPos, to, now2);
    return o;
  }

  function handle(ev: NavEvent, now2: number): EventOutcome {
    switch (ev.type) {
      case 'advanceRequested': {
        const fromPos = markerPos(now2).clone(); // 殘距視覺位置——重置前取
        pdrWalk = { edgeDist: 0 }; // 手動確認＝重新對齊節點，殘距作廢
        return advanceOnce(now2, fromPos);
      }
      case 'backRequested': {
        tween = null;
        path = [];
        follow = back(follow);
        pdrWalk = { edgeDist: 0 };
        return navRefresh(now2);
      }
      case 'recenterRequested': {
        chaseAuto = true;
        return navRefresh(now2); // 原 onRecenter：refreshNav（含 emphasis 重套）
      }
      case 'userCameraGrab': {
        chaseAuto = false;
        return {};
      }
    }
  }

  /** 每幀相機意圖（QA0723-1..4 的決策現場）：null＝本幀不干預。 */
  function cameraGoal(markerP: THREE.Vector3): CameraGoal | null {
    if (!chaseAuto) return null;
    const holdEdge = tween === null ? verticalStep(edges, follow) : null;
    if (holdEdge) {
      // 梯前全景（QA0723-3）：框 connector 兩端；每幀重算——爆炸收合期間跟著 nodeWorld 收斂
      return frameGoal([nodeWorld(holdEdge.from), nodeWorld(holdEdge.to)], deps.aspect());
    }
    if (atEnd(follow) && tween === null) {
      // 抵達後拉（P-6）：框最後兩節點；持續發出——rig 收斂即釋放，視覺等同原單次設定
      return frameGoal(follow.nodeIds.slice(-2).map((id) => nodeWorld(id)), deps.aspect());
    }
    const nextId = follow.nodeIds[Math.min(follow.index + 1, follow.nodeIds.length - 1)];
    let aim = chaseAim({
      tween,
      atEnd: atEnd(follow),
      vertical: verticalStep(edges, follow) !== null,
      nextPos: nodeWorld(nextId),
    });
    if (!atEnd(follow)) {
      // 搭乘 tween 中 aim 與 marker 垂直堆疊時改瞄出梯方向——不再跳北（QA0723-4）
      const dx0 = aim ? aim.x - markerP.x : 0;
      const dz0 = aim ? aim.z - markerP.z : 0;
      if (aim === null || dx0 * dx0 + dz0 * dz0 <= 1e-4) {
        const rest = follow.nodeIds.slice(follow.index + 1).map((id) => nodeWorld(id));
        aim = aimPastVertical(markerP, rest) ?? nodeWorld(nextId); // 末線防呆：整段零位移仍給 goal
      }
    }
    return aim ? chaseGoal(markerP, aim) : null;
  }

  function frame(now2: number): FrameDirective {
    if (tween && tweenAt(tween, now2).done) {
      const reached = tween.to;
      path = path.slice(1); // [0] 已抵達
      tween = path.length > 0 ? makeTween(reached, path[0].pos, now2) : null;
    }
    const pos = markerPos(now2);
    return { markerPos: pos, cameraGoal: cameraGoal(pos), floorFades: [] };
  }

  return { initial: navRefresh(now), handle, frame };
}
