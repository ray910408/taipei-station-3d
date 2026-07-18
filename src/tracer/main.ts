import { assembleModel, LoaderError } from '../loader';
import type { FloorDoc, SourceRef, SourcesDoc, Vec2 } from '../types';
import { fitSimilarity, localToPx, type PxTransform } from './transform';
import { fitView, screenToLocal, zoomAt, type ViewState } from './view';
import { render, type RenderInput } from './render';
import { createStore, type ToolContext, type ToolHandler, type ToolName, type TracerStore } from './store';
import { makeCalibrateTool } from './tool-calibrate';
import stationJson from '../../data/station.json';
import connectorsJson from '../../data/connectors.json';
import sourcesJson from '../../refs/sources.json';

// 工具於後續任務註冊：Task 5 → calibrate；Task 6 → select/draw/nav
const toolFactories: Partial<Record<ToolName, (ctx: ToolContext) => ToolHandler>> = {};
toolFactories.calibrate = makeCalibrateTool;

const DEFAULT_SOURCE: Record<string, string> = {
  'mrt-r-platform-b4': 'trtc-info-b4',
  'mrt-r-concourse-b3': 'trtc-info-b3',
  'tra-concourse-b1': 'tra-b1-map',
  'tra-platform-b2': 'tra-b2-map',
};

function el<T extends HTMLElement>(sel: string): T {
  const found = document.querySelector<T>(sel);
  if (!found) throw new Error(`找不到元素 ${sel}`);
  return found;
}

function showOverlay(text: string): void {
  const overlay = el<HTMLDivElement>('#overlay');
  overlay.textContent = text;
  overlay.style.display = 'block';
}

interface SessionUI {
  floorId?: string; sourceId?: string; layers?: TracerStore['layers'];
  imageOpacity?: number; views?: Record<string, ViewState>;
}

function boot(store: TracerStore): void {
  const cv = el<HTMLCanvasElement>('#cv');
  const ctx2d = cv.getContext('2d')!;
  const statusEl = el<HTMLDivElement>('#status');
  const bannerEl = el<HTMLDivElement>('#banner');
  const btnSave = el<HTMLButtonElement>('#btn-save');
  const btnUndo = el<HTMLButtonElement>('#btn-undo');

  // ---- session 還原（存檔會觸發資料熱重載整頁刷新，靠這裡接回工作狀態）----
  const saved: SessionUI = JSON.parse(sessionStorage.getItem('tracer-ui') ?? 'null') ?? {};
  if (saved.floorId && store.floorDocs.has(saved.floorId)) store.floorId = saved.floorId;
  if (saved.layers) store.layers = { ...store.layers, ...saved.layers };
  if (saved.imageOpacity !== undefined) store.imageOpacity = saved.imageOpacity;
  if (saved.views) store.views = saved.views;
  store.sourceId = saved.sourceId ?? DEFAULT_SOURCE[store.floorId] ?? store.sourcesDoc.sources[0].id;

  function persistSession(): void {
    store.views[store.floorId] = store.view;
    const s: SessionUI = {
      floorId: store.floorId, sourceId: store.sourceId, layers: store.layers,
      imageOpacity: store.imageOpacity, views: store.views,
    };
    sessionStorage.setItem('tracer-ui', JSON.stringify(s));
  }
  addEventListener('beforeunload', persistSession);

  // ---- 影像與校準變換 ----
  const imageCache = new Map<string, HTMLImageElement>();
  function currentSource(): SourceRef | undefined {
    return store.sourcesDoc.sources.find((s) => s.id === store.sourceId);
  }
  function currentImage(): HTMLImageElement | null {
    const src = currentSource();
    if (!src) return null;
    let img = imageCache.get(src.id);
    if (!img) {
      img = new Image();
      img.src = '/' + src.file; // dev server 直接供應 repo 根下的 refs/**
      img.onload = invalidate;
      imageCache.set(src.id, img);
    }
    return img;
  }
  function currentTransform(): PxTransform | null {
    const src = currentSource();
    if (!src) return null;
    const override = store.transformOverride.get(src.id);
    if (override) return override;
    const cp = src.calibration?.control_points;
    if (cp) return fitSimilarity(cp);
    const img = currentImage();
    if (!img || img.naturalWidth === 0) return null;
    // 未校準：暫定 10 px/m、圖中心對 local 原點，讓圖可見以便校準
    return { c: 0.1, d: 0, u0: img.naturalWidth / 2, v0: img.naturalHeight / 2, x0: 0, y0: 0 };
  }

  // ---- 重繪 ----
  let rafPending = false;
  function invalidate(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderNow(); });
  }
  function renderNow(): void {
    const input: RenderInput = {
      view: store.view,
      floor: store.floorDocs.get(store.floorId)!,
      image: store.layers.image ? currentImage() : null,
      imageTransform: currentTransform(),
      imageOpacity: store.imageOpacity,
      layers: store.layers,
      selection: store.selection,
      hoverVertex: store.hoverVertex,
      draft: store.draft,
      calibMarkers: store.calibMarkers,
    };
    render(ctx2d, input);
  }
  function resize(): void {
    cv.width = cv.clientWidth;
    cv.height = cv.clientHeight;
    invalidate();
  }
  addEventListener('resize', resize);

  // ---- ToolContext 與 undo/save ----
  function setBanner(text: string, kind: 'ok' | 'err'): void {
    bannerEl.textContent = text;
    bannerEl.className = kind;
  }
  function floorMeta() {
    return store.station.floors.find((f) => f.id === store.floorId)!;
  }
  const toolCtx: ToolContext = {
    store,
    invalidate,
    setStatus: (t) => { statusEl.textContent = t; },
    setBanner,
    pushUndo: () => {
      const doc = store.floorDocs.get(store.floorId)!;
      store.undo.push({ floorId: store.floorId, snap: JSON.stringify(doc) });
      if (store.undo.length > 50) store.undo.shift();
    },
    markDirty: (file) => { store.dirty.add(file); btnSave.textContent = '儲存*（Ctrl+S）'; },
    floorFile: () => `data/${floorMeta().file}`,
    floorShort: () => floorMeta().short,
    floorDoc: () => store.floorDocs.get(store.floorId)!,
    save,
    currentTransform,
  };
  function undo(): void {
    const top = store.undo[store.undo.length - 1];
    if (!top) { setBanner('沒有可復原的步驟', 'err'); return; }
    if (top.floorId !== store.floorId) { setBanner('復原堆疊屬於其他樓層，先切回該樓層', 'err'); return; }
    store.undo.pop();
    store.floorDocs.set(store.floorId, JSON.parse(top.snap) as FloorDoc);
    toolCtx.markDirty(toolCtx.floorFile());
    store.selection = null;
    store.hoverVertex = null;
    invalidate();
  }
  async function save(): Promise<void> {
    if (store.dirty.size === 0) { setBanner('沒有未儲存的變更', 'ok'); return; }
    const files = [...store.dirty].map((file) => ({ file, doc: docFor(file) }));
    persistSession();
    const res = await fetch('/__tracer/save', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ files }),
    }).then((r) => r.json()).catch((e) => ({ ok: false, errors: [String(e)], written: [] }));
    if (res.ok) {
      store.dirty.clear();
      btnSave.textContent = '儲存（Ctrl+S）';
      setBanner(`已儲存 ${res.written.join('、')}（資料熱重載將刷新頁面）`, 'ok');
    } else {
      setBanner(res.errors.join('\n'), 'err');
    }
  }
  function docFor(file: string): unknown {
    if (file === 'refs/sources.json') return store.sourcesDoc;
    const meta = store.station.floors.find((f) => `data/${f.file}` === file)!;
    return store.floorDocs.get(meta.id);
  }

  // ---- 工具註冊與切換 ----
  const tools: Partial<Record<ToolName, ToolHandler>> = {};
  for (const [name, make] of Object.entries(toolFactories)) tools[name as ToolName] = make(toolCtx);
  const radios = [...document.querySelectorAll<HTMLInputElement>('input[name="tool"]')];
  for (const r of radios) {
    r.disabled = r.value !== 'select' && !(r.value in tools);
    r.addEventListener('change', () => { if (r.checked) switchTool(r.value as ToolName); });
  }
  function switchTool(name: ToolName): void {
    tools[store.tool]?.deactivate?.();
    store.tool = name;
    store.draft = [];
    store.calibMarkers = [];
    el<HTMLElement>('#draw-form').hidden = name !== 'draw';
    el<HTMLElement>('#calib-panel').hidden = name !== 'calibrate';
    tools[name]?.activate?.();
    invalidate();
  }

  // ---- 指標事件（工具未處理的左鍵拖曳與中鍵拖曳＝平移）----
  let panFrom: { x: number; y: number; view: ViewState } | null = null;
  function localOf(ev: MouseEvent): Vec2 {
    const rect = cv.getBoundingClientRect();
    return screenToLocal(store.view, [ev.clientX - rect.left, ev.clientY - rect.top]);
  }
  cv.addEventListener('pointerdown', (ev) => {
    cv.setPointerCapture(ev.pointerId);
    const handled = ev.button === 0 && tools[store.tool]?.down?.(localOf(ev), ev);
    if (!handled) panFrom = { x: ev.clientX, y: ev.clientY, view: { ...store.view } };
  });
  cv.addEventListener('pointermove', (ev) => {
    const local = localOf(ev);
    toolCtx.setStatus(`x=${local[0].toFixed(1)}, y=${local[1].toFixed(1)}${store.tool === 'calibrate' ? pxStatus(local) : ''}`);
    if (panFrom) {
      store.view = {
        ...panFrom.view,
        panX: panFrom.view.panX + (ev.clientX - panFrom.x),
        panY: panFrom.view.panY + (ev.clientY - panFrom.y),
      };
      invalidate();
      return;
    }
    tools[store.tool]?.move?.(local, ev);
  });
  cv.addEventListener('pointerup', (ev) => {
    if (panFrom) { panFrom = null; return; }
    tools[store.tool]?.up?.(localOf(ev), ev);
  });
  cv.addEventListener('dblclick', (ev) => {
    tools[store.tool]?.dblclick?.(localOf(ev));
  });
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = cv.getBoundingClientRect();
    store.view = zoomAt(store.view, [ev.clientX - rect.left, ev.clientY - rect.top], ev.deltaY < 0 ? 1.15 : 1 / 1.15);
    invalidate();
  }, { passive: false });
  function pxStatus(local: Vec2): string {
    const t = currentTransform();
    if (!t) return '';
    const [u, v] = localToPx(t, local);
    return ` | px=(${u.toFixed(0)}, ${v.toFixed(0)})`;
  }

  // ---- 鍵盤 ----
  addEventListener('keydown', (ev) => {
    const tag = (ev.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (ev.ctrlKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (ev.ctrlKey && ev.key.toLowerCase() === 's') { ev.preventDefault(); void save(); return; }
    if (tools[store.tool]?.key?.(ev)) ev.preventDefault();
  });
  btnSave.addEventListener('click', () => void save());
  btnUndo.addEventListener('click', undo);

  // ---- 樓層/底圖/圖層/透明度 ----
  const floorSel = el<HTMLSelectElement>('#floor');
  for (const f of store.station.floors) {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = `${f.labels['complex'] ?? ''} ${f.name.zh}（${f.id}）`;
    floorSel.append(opt);
  }
  const sourceSel = el<HTMLSelectElement>('#source');
  for (const s of store.sourcesDoc.sources) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.id + (s.calibration ? '（已校準）' : '');
    sourceSel.append(opt);
  }
  floorSel.value = store.floorId;
  sourceSel.value = store.sourceId;
  floorSel.addEventListener('change', () => {
    store.views[store.floorId] = store.view;
    store.floorId = floorSel.value;
    store.sourceId = DEFAULT_SOURCE[store.floorId] ?? store.sourceId;
    sourceSel.value = store.sourceId;
    store.selection = null;
    store.hoverVertex = null;
    store.draft = [];
    store.view = store.views[store.floorId] ?? fitToFloor();
    invalidate();
  });
  sourceSel.addEventListener('change', () => { store.sourceId = sourceSel.value; invalidate(); });
  for (const key of ['image', 'areas', 'units', 'walls', 'gates', 'pois', 'nav', 'labels'] as const) {
    const cb = el<HTMLInputElement>(`#layer-${key}`);
    cb.checked = store.layers[key];
    cb.addEventListener('change', () => { store.layers[key] = cb.checked; invalidate(); });
  }
  const opacityEl = el<HTMLInputElement>('#img-opacity');
  opacityEl.value = String(Math.round(store.imageOpacity * 100));
  opacityEl.addEventListener('input', () => { store.imageOpacity = Number(opacityEl.value) / 100; invalidate(); });

  function fitToFloor(): ViewState {
    const outline = store.floorDocs.get(store.floorId)!.slab.outline;
    const xs = outline.map((p) => p[0]);
    const ys = outline.map((p) => p[1]);
    return fitView(cv.clientWidth, cv.clientHeight, [Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]);
  }

  resize();
  store.view = store.views[store.floorId] ?? fitToFloor();
  invalidate();
}

// ---- 資料載入（與 viewer 相同來源；編輯用深拷貝工作副本）----
try {
  const floorModules = import.meta.glob('../../data/floors/*.json', { eager: true });
  const floorDocsByFile: Record<string, unknown> = {};
  for (const [p, mod] of Object.entries(floorModules))
    floorDocsByFile[p.replace('../../data/', '')] = (mod as { default: unknown }).default;
  const model = assembleModel(stationJson, floorDocsByFile, connectorsJson);
  const store = createStore({
    station: model.station,
    floors: new Map([...model.floors].map(([id, doc]) => [id, structuredClone(doc)])),
    sources: structuredClone(sourcesJson) as SourcesDoc,
  });
  boot(store);
} catch (e) {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
}
