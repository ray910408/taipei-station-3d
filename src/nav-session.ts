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

/** 導航事件：使用者或感測器對會話說的話。discriminated union——QA 重現步驟＝可回放腳本。 */
export type NavEvent =
  | { type: 'advanceRequested' } // 手動「我到了」
  | { type: 'backRequested' };

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

  /** marker 世界座標：邊上有 PDR 殘距時沿邊插值，否則所在節點（connector 邊 edgeDist 恆 0）。 */
  function markerWorldPos(): THREE.Vector3 {
    const pos = nodeWorld(currentNodeId(follow));
    const edge = edges[follow.index];
    if (!edge || pdrWalk.edgeDist <= 0) return pos;
    return pos.lerp(nodeWorld(edge.to), Math.min(pdrWalk.edgeDist / edge.length, 1));
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
  function advanceOnce(now2: number): EventOutcome {
    follow = advance(follow);
    const o = navRefresh(now2);
    o.speech = o.nav!.arrived ? '已抵達目的地' : o.nav!.next;
    return o;
  }

  function handle(ev: NavEvent, now2: number): EventOutcome {
    switch (ev.type) {
      case 'advanceRequested': {
        pdrWalk = { edgeDist: 0 }; // 手動確認＝重新對齊節點，殘距作廢
        return advanceOnce(now2);
      }
      case 'backRequested': {
        follow = back(follow);
        pdrWalk = { edgeDist: 0 };
        return navRefresh(now2);
      }
    }
  }

  function frame(now2: number): FrameDirective {
    void now2;
    return { markerPos: markerWorldPos(), cameraGoal: null, floorFades: [] };
  }

  return { initial: navRefresh(now), handle, frame };
}
