import type { FloorDoc, SourcesDoc, StationDoc, Vec2 } from '../types';
import type { GeomRef, VertexRef } from './geom';
import type { PxTransform } from './transform';
import type { ViewState } from './view';

export type ToolName = 'select' | 'draw' | 'nav' | 'calibrate';

export interface Layers {
  image: boolean; areas: boolean; units: boolean; walls: boolean;
  gates: boolean; pois: boolean; nav: boolean; labels: boolean;
}

export interface TracerStore {
  station: StationDoc;
  floorDocs: Map<string, FloorDoc>;   // 編輯用工作副本（deep clone）
  sourcesDoc: SourcesDoc;             // 同上（校準寫入）
  floorId: string;
  sourceId: string;
  tool: ToolName;
  layers: Layers;
  imageOpacity: number;
  view: ViewState;
  views: Record<string, ViewState>;   // 各樓層各自記住視角
  transformOverride: Map<string, PxTransform>; // 校準預覽（未存檔前）
  selection: GeomRef | null;
  hoverVertex: VertexRef | null;
  draft: Vec2[];                      // 描繪中的點列
  calibMarkers: Vec2[];               // 校準控制點顯示（local）
  dirty: Set<string>;                 // 未儲存的檔案 relPath
  undo: { floorId: string; snap: string }[]; // 目前樓層的 JSON snapshots
}

export interface ToolHandler {
  activate?(): void;
  deactivate?(): void;
  /** 回傳 true 表示已處理（main 不做平移） */
  down?(local: Vec2, ev: PointerEvent): boolean;
  move?(local: Vec2, ev: PointerEvent): void;
  up?(local: Vec2, ev: PointerEvent): void;
  dblclick?(local: Vec2): void;
  /** 回傳 true 表示已處理 */
  key?(ev: KeyboardEvent): boolean;
}

export interface ToolContext {
  store: TracerStore;
  invalidate(): void;
  setStatus(text: string): void;
  setBanner(text: string, kind: 'ok' | 'err'): void;
  pushUndo(): void;
  markDirty(file: string): void;
  floorFile(): string;   // 'data/floors/<id>.json'
  floorShort(): string;  // 'rp' 等
  floorDoc(): FloorDoc;
  save(): Promise<void>;
  currentTransform(): PxTransform | null;
}

export function createStore(args: {
  station: StationDoc; floors: Map<string, FloorDoc>; sources: SourcesDoc;
}): TracerStore {
  return {
    station: args.station,
    floorDocs: args.floors,
    sourcesDoc: args.sources,
    floorId: args.station.floors[0]?.id ?? '',
    sourceId: '',
    tool: 'select',
    layers: { image: true, areas: true, units: true, walls: true, gates: true, pois: true, nav: true, labels: true },
    imageOpacity: 0.7,
    view: { zoom: 3, panX: 0, panY: 0 },
    views: {},
    transformOverride: new Map(),
    selection: null,
    hoverVertex: null,
    draft: [],
    calibMarkers: [],
    dirty: new Set(),
    undo: [],
  };
}

/** tracer 只描得動圖片。`refs/sources.json` 同時登記了非影像來源（北捷開放資料 CSV 等），
 *  那些選進來只會得到一張 naturalWidth=0 的空白底圖、還校準不了，所以不進選單也不接受還原。 */
export function isTraceable(s: { file: string }): boolean {
  return /\.(png|jpe?g|webp|gif)$/i.test(s.file);
}

/** session 還原時決定用哪個底圖：存檔的選擇優先（但必須仍是可描的來源），
 *  否則退樓層預設，再否則第一個可描來源。抽出來是為了能單獨測——它同時要滿足
 *  「合法的非預設選擇要接得回來」與「已失效／非影像的選擇不能還原成壞狀態」。 */
export function pickSourceId(
  savedId: string | undefined,
  traceableIds: readonly string[],
  floorDefault: string | undefined,
): string {
  if (savedId !== undefined && traceableIds.includes(savedId)) return savedId;
  if (floorDefault !== undefined && traceableIds.includes(floorDefault)) return floorDefault;
  return traceableIds[0];
}
