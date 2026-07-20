import type { GraphEdge, NavGraph } from './nav';
import type { FollowState } from './follow';
import type { StationModel } from './types';

export type Mode = 'overview' | 'preview' | 'nav';

/** 各模式目標爆炸係數（盤問 Q4：preview 與 overview 同全爆炸） */
export const MODE_EXPLODE: Record<Mode, number> = { overview: 1, preview: 1, nav: 0 };

/** nav 中站在垂直設施前（下一條邊是 connector）→ 回傳該邊，觸發 transition 呈現。 */
export function verticalStep(edges: GraphEdge[], s: FollowState): GraphEdge | null {
  const e = edges[s.index];
  return e && (e.kind === 'stair' || e.kind === 'escalator' || e.kind === 'elevator') ? e : null;
}

/** transition 橫幅文案：「搭電梯上行，前往「B2 臺鐵/高鐵月台層」」 */
export function transitionLabel(model: StationModel, graph: NavGraph, e: GraphEdge): string {
  const src = graph.nodes.get(e.from)!;
  const dst = graph.nodes.get(e.to)!;
  const up = dst.z > src.z;
  const meta = model.station.floors.find((f) => f.id === dst.floor)!;
  const floorLabel = `${meta.labels['complex'] ?? ''} ${meta.name.zh}`.trim();
  const verb = e.kind === 'elevator' ? `搭電梯${up ? '上' : '下'}行`
    : e.kind === 'escalator' ? `搭電扶梯${up ? '上' : '下'}行`
    : `走樓梯${up ? '上' : '下'}樓`;
  return `${verb}，前往「${floorLabel}」`;
}
