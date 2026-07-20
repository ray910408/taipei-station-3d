import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { THEME } from './theme';
import { toWorld } from './builder';
import type { StationModel } from './types';
import type { Mode } from './mode';

export type LabelKind = 'floor-tag' | 'landmark';

/** 能見度 gate（純函數，node 可測）：nav 全隱（資訊由 DOM banner 承載）；
 *  floor tag 只在爆炸展開後出現；landmark 依鏡頭距離進退。 */
export function labelVisible(
  kind: LabelKind, mode: Mode, explodeFactor: number, cameraDist: number,
): boolean {
  if (mode === 'nav') return false;
  if (kind === 'floor-tag') return explodeFactor > THEME.labels.floorTagMinExplode;
  return cameraDist < THEME.labels.landmarkMaxDist;
}

interface Entry { obj: CSS2DObject; kind: LabelKind }

export interface LabelLayer {
  update(camera: THREE.Camera, mode: Mode, explodeFactor: number): void;
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

/** 場景內標籤層：floor tag（樓層＋系統品牌色條）與 landmark 名稱。
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
    tag.position.copy(toWorld([west, midZ], meta.elevation + 2));
    floorGroup.add(tag);
    entries.push({ obj: tag, kind: 'floor-tag' });

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
      entries.push({ obj: lm, kind: 'landmark' });
    }
  }

  const tmp = new THREE.Vector3();
  return {
    update(camera, mode, explodeFactor) {
      for (const e of entries) {
        const dist = e.obj.getWorldPosition(tmp).distanceTo(camera.position);
        e.obj.visible = labelVisible(e.kind, mode, explodeFactor, dist);
      }
    },
    render(scene, camera) { css2d.render(scene, camera); },
    resize(w, h) { css2d.setSize(w, h); },
  };
}
