import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { THEME } from './theme';
import { toWorld, trackAxis } from './builder';
import type { Area, LocalizedName, StationModel, Vec2 } from './types';
import type { Mode } from './mode';

export type LabelKind = 'floor-tag' | 'landmark' | 'platform';

/** 能見度 gate（純函數，node 可測）：landmark 只在 overview 依三級 LOD 進退，preview/nav 隱藏；
 *  L0 大地標常駐、L1 中距顯示、L2 近距顯示；
 *  platform 月台編號同走三級 LOD（預設 tier 1）；
 *  floor tag 依爆炸程度顯示（nav 仍全隱，資訊由 DOM banner 承載）。 */
export function labelVisible(
  kind: LabelKind, mode: Mode, explodeFactor: number, cameraDist: number, tier?: 0 | 1 | 2,
): boolean {
  if (mode === 'nav') return false;
  if (kind === 'floor-tag') return explodeFactor > THEME.labels.floorTagMinExplode;
  if (mode === 'preview') return false; // landmark／platform：preview 讓位給路線（Phase 4 舊債 2）
  if (tier === 0) return true; // L0 大地標常駐
  if (tier === 2) return cameraDist < THEME.labels.landmarkNearDist; // L2 次要：近距才出
  return cameraDist < THEME.labels.landmarkMaxDist; // L1（未標 tier 預設）
}

interface Entry { obj: CSS2DObject; kind: LabelKind; tier?: 0 | 1 | 2; floor: string; leader?: THREE.Object3D; w?: number; h?: number }

export interface LabelBox { x: number; y: number; w: number; h: number; priority: number }

/** 螢幕矩形貪婪去疊：priority 高者先佔位（平手取 index 小者），與已保留矩形相交者剔除。
 *  O(n²)——標籤數 ~40，可忽略。中心點座標；pad 為兩兩間最小留白。 */
export function declutter(items: LabelBox[], pad: number): boolean[] {
  const order = items.map((_, i) => i).sort((a, b) => items[b].priority - items[a].priority || a - b);
  const kept: number[] = [];
  const out = items.map(() => false);
  for (const i of order) {
    const it = items[i];
    const hit = kept.some((k) => {
      const o = items[k];
      return Math.abs(it.x - o.x) * 2 < it.w + o.w + pad * 2
          && Math.abs(it.y - o.y) * 2 < it.h + o.h + pad * 2;
    });
    if (!hit) { kept.push(i); out[i] = true; }
  }
  return out;
}

export interface LabelLayer {
  update(camera: THREE.Camera, mode: Mode, explodeFactor: number, focusFloor?: string | null, inTransit?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  resize(width: number, height: number): void;
}

function el(text: string, css: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const div = document.createElement('div');
  div.textContent = text;
  Object.assign(div.style, {
    pointerEvents: 'none', whiteSpace: 'nowrap',
    fontFamily: '"Noto Sans TC", system-ui, sans-serif',
    ...css,
  });
  return div;
}

/** 引線＋錨點 dot：釘住 label 對應的地面點，避免自由飄浮感（landmark／platform 共用）。 */
function leaderAt(xy: Vec2, elevation: number): THREE.Group {
  const foot = toWorld(xy, elevation + 0.1);
  const head = toWorld(xy, elevation + 3);
  const leader = new THREE.Group();
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([foot, head]),
    new THREE.LineBasicMaterial({ color: THEME.body.edge, transparent: true, opacity: 0.75 }));
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 8, 6),
    new THREE.MeshBasicMaterial({ color: THEME.body.edge, toneMapped: false }));
  dot.position.copy(foot);
  leader.add(line, dot);
  return leader;
}

/** 場景內標籤層：floor tag（樓層＋系統品牌色條）、月台編號與 landmark 名稱。
 *  CSS2DObject parent 進樓層 group → local 座標自動跟爆炸位移。 */
export function createLabelLayer(
  container: HTMLElement, stationGroup: THREE.Group, model: StationModel,
): LabelLayer {
  const css2d = new CSS2DRenderer();
  css2d.setSize(container.clientWidth, container.clientHeight);
  Object.assign(css2d.domElement.style,
    { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '1' }); // UI cards 在 z 10
  container.append(css2d.domElement);

  const entries: Entry[] = [];
  for (const meta of model.station.floors) {
    const floorGroup = stationGroup.getObjectByName(meta.id);
    const floor = model.floors.get(meta.id);
    if (!floorGroup || !floor) continue;

    // floor tag：置於 slab 西側外緣；品牌色條讀資料（systems），不進 THEME
    const sysKey = meta.id.startsWith('tra') ? 'tra' : 'trtc';
    const sysColor = model.station.systems[sysKey]?.color ?? '#5f6368';
    const xs = floor.slab.outline.map((p) => p[0]);
    const zs = floor.slab.outline.map((p) => p[1]);
    const west = Math.min(...xs) - 6;
    const midZ = (Math.min(...zs) + Math.max(...zs)) / 2;
    const tag = new CSS2DObject(el(`${meta.labels['complex'] ?? meta.id}·${meta.name.zh}`, {
      background: THEME.labels.floorTag.bg, color: THEME.labels.floorTag.fg,
      fontSize: '13px', fontWeight: '700',
      padding: '3px 10px', borderRadius: '999px',
      borderLeft: `4px solid ${sysColor}`, boxShadow: '0 1px 3px #00000033',
    }));
    const idx = model.station.floors.indexOf(meta);
    const stagger = (idx % 2 === 0 ? -1 : 1) * THEME.labels.floorTagStagger; // 相鄰樓層南北交錯
    tag.position.copy(toWorld([west, midZ + stagger], meta.elevation + 2));
    floorGroup.add(tag);
    entries.push({ obj: tag, kind: 'floor-tag', floor: meta.id });

    // platform：月台名＋側別編號（B2「高鐵第1月台 1A/1B」、B4「淡水信義線月台 1/2」）
    const platforms = (floor.areas ?? []).filter(
      (a): a is Area & { name: LocalizedName } => a.kind === 'platform' && a.name !== undefined);
    for (const [pi, a] of platforms.entries()) {
      const s = a.sides ?? {};
      const sides = [s.south, s.north, s.east, s.west].filter((v): v is string => !!v).sort();
      const pl = new CSS2DObject(el(sides.length ? `${a.name.zh} ${sides.join('/')}` : a.name.zh, {
        background: THEME.labels.platform.bg, color: THEME.labels.platform.fg,
        fontSize: '11px', fontWeight: '600',
        padding: '1px 6px', borderRadius: '6px', boxShadow: '0 1px 2px #00000022',
      }));
      const n = a.polygon.length; // 質心近似：頂點平均（月台為近矩形，足夠）
      const c: Vec2 = [a.polygon.reduce((t, p) => t + p[0], 0) / n, a.polygon.reduce((t, p) => t + p[1], 0) / n];
      // 同層多月台的質心會落在同一條橫向線上（B2 四座 x 皆 0）→ 沿月台長軸錯開，否則 declutter 只留得住 2 個
      const axis = trackAxis(a.polygon);
      const off = (pi - (platforms.length - 1) / 2) * THEME.labels.platformStagger;
      if (axis && off !== 0) {
        const [dx, dy] = [axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]];
        const L = Math.hypot(dx, dy) || 1;
        c[0] += (dx / L) * off;
        c[1] += (dy / L) * off;
      }
      pl.position.copy(toWorld(c, meta.elevation + 3));
      floorGroup.add(pl);
      const leader = leaderAt(c, meta.elevation);
      floorGroup.add(leader);
      entries.push({ obj: pl, kind: 'platform', tier: 1, floor: meta.id, leader });
    }

    // landmark：具名 nav node 名稱小籤
    for (const n of floor.nav?.nodes ?? []) {
      if (!n.name) continue;
      const lm = new CSS2DObject(el(n.name.zh, {
        background: THEME.labels.landmark.bg, color: THEME.labels.landmark.fg,
        fontSize: '11px',
        padding: '1px 6px', borderRadius: '6px', boxShadow: '0 1px 2px #00000022',
      }));
      lm.position.copy(toWorld(n.xy, meta.elevation + 3));
      floorGroup.add(lm);

      const leader = leaderAt(n.xy, meta.elevation); // 引線＋錨點：釘住 label 對應的樓層節點
      floorGroup.add(leader);

      entries.push({ obj: lm, kind: 'landmark', tier: n.tier, floor: meta.id, leader });
    }
  }

  const tmp = new THREE.Vector3();
  const proj = new THREE.Vector3(); // 重用投影暫存，避免每 frame×label clone（手機 GC 抖動）
  let vw = container.clientWidth, vh = container.clientHeight;
  const priorityOf = (e: Entry): number =>
    e.kind === 'floor-tag' ? 4 : e.kind === 'platform' ? 3 // platform 與 tier-0 landmark 同級
      : e.tier === 0 ? 3 : e.tier === 2 ? 1 : 2;
  return {
    update(camera, mode, explodeFactor, focusFloor = null, inTransit = false) {
      const cand: { e: Entry; x: number; y: number; w: number; h: number; priority: number }[] = [];
      for (const e of entries) {
        // 樓層聚焦：非聚焦樓層標籤直接隱藏（半透明仍佔位——不採用）
        if (focusFloor !== null && e.floor !== focusFloor) { e.obj.visible = false; continue; }
        // 鏡頭滑行中 landmark 不參與（距離掃過閾值會大量閃現）；floor tag 不受影響
        if (e.kind === 'landmark' && inTransit) { e.obj.visible = false; continue; }
        const world = e.obj.getWorldPosition(tmp);
        const dist = world.distanceTo(camera.position);
        if (!labelVisible(e.kind, mode, explodeFactor, dist, e.tier)) { e.obj.visible = false; continue; }
        const p = proj.copy(world).project(camera); // NDC（重用暫存，不每候選 clone）
        // 尺寸快取：display:none 時 offsetWidth=0，只在量得到時更新（字型晚載誤差可忽略）
        const mw = e.obj.element.offsetWidth;
        if (mw > 0) { e.w = mw; e.h = e.obj.element.offsetHeight; }
        cand.push({
          e,
          x: (p.x * 0.5 + 0.5) * vw,
          y: (-p.y * 0.5 + 0.5) * vh,
          w: e.w ?? 120, h: e.h ?? 22, // 首次未量到的保守預設
          priority: priorityOf(e),
        });
      }
      const keep = declutter(cand, THEME.labels.declutterPad);
      for (const e of entries) if (e.leader) e.leader.visible = e.obj.visible;
      cand.forEach((c, i) => { c.e.obj.visible = keep[i]; if (c.e.leader) c.e.leader.visible = keep[i]; });
    },
    render(scene, camera) { css2d.render(scene, camera); },
    resize(w, h) { css2d.setSize(w, h); vw = w; vh = h; },
  };
}
