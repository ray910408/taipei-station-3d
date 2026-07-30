export type Vec2 = [number, number];

export interface LocalizedName { zh: string; en?: string }

export interface Provenance {
  source: string;
  confidence: 1 | 2 | 3 | 4 | 5;
  status?: 'estimated' | 'traced' | 'verified';
  note?: string;
}

export interface Slab extends Provenance { outline: Vec2[]; holes?: Vec2[][] }

export type AreaKind = 'platform' | 'paid' | 'unpaid' | 'corridor' | 'track' | 'restricted';
// sides：島式月台兩面的側別編號（如 4A/4B），鍵為該面朝向的方位
export interface Area extends Provenance {
  id: string; kind: AreaKind; system: string; polygon: Vec2[];
  name?: LocalizedName;
  sides?: { north?: string; south?: string; east?: string; west?: string };
}

export interface Wall extends Provenance { id: string; polyline: Vec2[]; height: number; width?: number }

export type UnitKind = 'column' | 'shop' | 'room' | 'machine' | 'stair-void';
export interface Unit extends Provenance { id: string; kind: UnitKind; polygon: Vec2[]; height: number }

export interface Gate extends Provenance {
  id: string; kind: 'faregate'; system: string;
  direction: 'in' | 'out' | 'both'; accessible: boolean;
  line: [Vec2, Vec2]; connects: [string, string];
}

export type PoiKind = 'tvm' | 'info' | 'toilet' | 'exit' | 'sign';
export interface Poi extends Provenance {
  id: string; kind: PoiKind; system?: string; position: Vec2; name?: LocalizedName;
}

export interface NavNode { id: string; xy: Vec2; area?: string; tier?: 0 | 1 | 2; name?: LocalizedName }
export interface NavEdge {
  from: string; to: string; kind: 'walk' | 'gate' | 'platform-edge'; gate?: string; bidir?: boolean;
}

export interface FloorDoc {
  schema: 'floor@1'; id: string; slab: Slab;
  areas?: Area[]; walls?: Wall[]; units?: Unit[]; gates?: Gate[]; pois?: Poi[];
  nav?: { nodes: NavNode[]; edges: NavEdge[] };
}

export interface FloorMeta {
  id: string; short: string; file: string; name: LocalizedName;
  labels: Record<string, string>; elevation: number; height: number; estimated: boolean;
}

export interface StationDoc {
  schema: 'station@1'; id: string; name: LocalizedName;
  frame: {
    units: 'm'; origin_note: string; axis_note: string; bearing_deg?: number; bearing_status?: string;
    origin_wgs84?: { lat: number; lon: number; status: 'estimated' | 'surveyed'; note: string };
  };
  systems: Record<string, { name: LocalizedName; color: string }>;
  facts?: StationFacts;
  floors: FloorMeta[];
}

// 官方建模參考值，非模型幾何本體；模型與資料衝突時記在 note，不直接回寫幾何
export interface StationFacts {
  source: string;
  verified?: string;
  building?: { length_m?: number; width_m?: number; height_m?: number; floors_above?: number; floors_below?: number };
  platforms?: Record<string, { form: string; count: number; length_m?: number; width_m?: number; tracks?: number; note?: string }>;
  exits?: { building?: number; metro?: number; metro_accessible?: string[]; note?: string };
  accessibility?: { metro_elevators?: number; tra_ramps?: string[]; note?: string };
}

export interface ConnectorLevel { floor: string; node: string }
export interface Connector extends Provenance {
  id: string; kind: 'stair' | 'escalator' | 'elevator'; system: string;
  direction: 'up' | 'down' | 'both'; accessible: boolean; levels: ConnectorLevel[];
}
export interface ConnectorsDoc { schema: 'connectors@1'; connectors: Connector[] }

export interface StationModel {
  station: StationDoc;
  floors: Map<string, FloorDoc>;
  connectors: Connector[];
}

export interface CalibrationControlPoint { px: Vec2; local: Vec2 }

export interface Calibration {
  px_per_m: number;
  basis: string;
  status: 'estimated' | 'surveyed';
  control_points?: [CalibrationControlPoint, CalibrationControlPoint];
}

export interface SourceRef {
  id: string; title: string; file: string;
  url?: string; captured?: string; license_note?: string;
  calibration?: Calibration;
}

export interface SourcesDoc { schema: 'sources@1'; sources: SourceRef[] }
