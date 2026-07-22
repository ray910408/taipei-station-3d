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
export interface Area extends Provenance { id: string; kind: AreaKind; system: string; polygon: Vec2[] }

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

export interface NavNode { id: string; xy: Vec2; area?: string; tier?: 0 | 1; name?: LocalizedName }
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
  frame: { units: 'm'; origin_note: string; axis_note: string; bearing_deg?: number; bearing_status?: string };
  systems: Record<string, { name: LocalizedName; color: string }>;
  floors: FloorMeta[];
  demo?: { start: string; end: string };
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
