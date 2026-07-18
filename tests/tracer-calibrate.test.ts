import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCalibrateTool } from '../src/tracer/tool-calibrate';
import type { ToolContext } from '../src/tracer/store';

function stubDocument() {
  const els: Record<string, { textContent: string; disabled: boolean; addEventListener: () => void }> = {};
  const get = (sel: string) => (els[sel] ??= { textContent: '', disabled: false, addEventListener: () => {} });
  (globalThis as { document?: unknown }).document = { querySelector: get };
  return { els, get };
}

function fakeContext(): ToolContext {
  const store: ToolContext['store'] = {
    station: {
      schema: 'station@1', id: 'station', name: { zh: '測試' },
      frame: { units: 'm', origin_note: '', axis_note: '' }, systems: {}, floors: [],
    },
    floorDocs: new Map(),
    sourcesDoc: { schema: 'sources@1', sources: [] },
    floorId: 'f',
    sourceId: 'src-a',
    tool: 'calibrate',
    layers: { image: false, areas: false, units: false, walls: false, gates: false, pois: false, nav: false, labels: false },
    imageOpacity: 0,
    view: { zoom: 4, panX: 0, panY: 0 },
    views: {},
    transformOverride: new Map(),
    selection: null,
    hoverVertex: null,
    draft: [],
    calibMarkers: [],
    dirty: new Set(),
    undo: [],
  };

  return {
    store,
    currentTransform: () => ({ c: 0.1, d: 0, u0: 0, v0: 0, x0: 0, y0: 0 }),
    floorDoc: () => ({
      schema: 'floor@1', id: 'f',
      slab: { outline: [[0, 0], [50, 0], [50, 50], [0, 50]], source: 's', confidence: 2 },
    }),
    invalidate: () => {},
    setStatus: () => {},
    setBanner: () => {},
    pushUndo: () => {},
    markDirty: () => {},
    floorFile: () => 'data/floors/f.json',
    floorShort: () => 'f',
    save: async () => {},
  };
}

const pointerEvent = { altKey: false } as PointerEvent;
const enterEvent = { key: 'Enter' } as KeyboardEvent;

function completePreview(tool: ReturnType<typeof makeCalibrateTool>): void {
  tool.activate!();
  tool.down!([1, 2], pointerEvent);
  globalThis.prompt = () => '10,0';
  tool.key!(enterEvent);
  tool.down!([2, 2], pointerEvent);
  globalThis.prompt = () => '20,0';
  tool.key!(enterEvent);
}

describe('calibrate tool lifecycle', () => {
  let dom: ReturnType<typeof stubDocument>;

  beforeEach(() => { dom = stubDocument(); });
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { prompt?: unknown }).prompt;
  });

  it('完成預覽後 deactivate 清除 override', () => {
    const ctx = fakeContext();
    const tool = makeCalibrateTool(ctx);

    completePreview(tool);
    expect(ctx.store.transformOverride.has('src-a')).toBe(true);

    tool.deactivate!();
    expect(ctx.store.transformOverride.has('src-a')).toBe(false);
  });

  it('deactivate → activate 後狀態歸零', () => {
    const ctx = fakeContext();
    const tool = makeCalibrateTool(ctx);

    completePreview(tool);
    tool.deactivate!();
    tool.activate!();
    tool.down!([3, 3], pointerEvent);

    expect(dom.get('#calib-info').textContent).toContain('步驟 2/4');
  });

  it('進行中 deactivate 不留殘態', () => {
    const tool = makeCalibrateTool(fakeContext());

    tool.activate!();
    tool.down!([1, 2], pointerEvent);
    tool.deactivate!();
    tool.activate!();
    tool.down!([3, 3], pointerEvent);

    expect(dom.get('#calib-info').textContent).toContain('步驟 2/4');
  });
});
