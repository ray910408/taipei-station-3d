import type { Area, Gate, Poi, Unit, Vec2 } from '../types';
import { allRefs, geomKind, getRing, hitGeom, hitVertex, roundPt, type GeomRef, type VertexRef } from './geom';
import {
  addArea, addGate, addNavNode, addPoi, addSlabHole, addUnit, addWall, deleteNavNode,
  deleteVertex, insertVertex, moveNavNode, moveVertex, replaceGeom, segIndexNear, type ProvInput,
} from './edit';
import type { ToolContext, ToolHandler } from './store';

const AREA_KINDS: Area['kind'][] = ['platform', 'paid', 'unpaid', 'corridor', 'track', 'restricted'];
const UNIT_KINDS: Unit['kind'][] = ['column', 'shop', 'room', 'machine', 'stair-void'];
const POI_KINDS: Poi['kind'][] = ['tvm', 'info', 'toilet', 'exit', 'sign'];

function q<T extends HTMLElement>(sel: string): T {
  return document.querySelector<T>(sel)!;
}

function tol(ctx: ToolContext): number {
  return 8 / ctx.store.view.zoom;
}

export function dedupeAdjacentRoundedPoints(pts: Vec2[]): Vec2[] {
  const rounded = pts.map(roundPt);
  return rounded.filter((p, i) => i === 0 || p[0] !== rounded[i - 1][0] || p[1] !== rounded[i - 1][1]);
}

/** 選取／編輯：點選元素、拖頂點、Alt+點刪頂點、雙擊選取元素邊上插點、Esc 取消選取 */
export function makeSelectTool(ctx: ToolContext): ToolHandler {
  let dragging: VertexRef | null = null;
  return {
    down(local, ev) {
      const doc = ctx.floorDoc();
      const refs = allRefs(doc, ctx.store.layers);
      const v = hitVertex(doc, refs, local, tol(ctx));
      if (v && ev.altKey) {
        ctx.pushUndo();
        if (deleteVertex(doc, v)) { ctx.markDirty(ctx.floorFile()); ctx.invalidate(); }
        else { ctx.store.undo.pop(); ctx.setBanner('已達最少點數或此類元素不可刪點', 'err'); }
        return true;
      }
      if (v) {
        dragging = v;
        ctx.pushUndo();
        ctx.store.selection = v.ref;
        ctx.invalidate();
        return true;
      }
      const g = hitGeom(doc, refs, local, tol(ctx));
      ctx.store.selection = g;
      ctx.store.hoverVertex = null;
      ctx.invalidate();
      return Boolean(g); // 點空白 → 交還平移
    },
    move(local) {
      const doc = ctx.floorDoc();
      if (dragging) {
        moveVertex(doc, dragging, local);
        ctx.markDirty(ctx.floorFile());
        ctx.invalidate();
        return;
      }
      const sel = ctx.store.selection;
      if (!sel) return;
      const hv = hitVertex(doc, [sel], local, tol(ctx));
      const prev = ctx.store.hoverVertex;
      if ((hv?.vi ?? -1) !== (prev?.vi ?? -1)) {
        ctx.store.hoverVertex = hv;
        ctx.invalidate();
      }
    },
    up() { dragging = null; },
    dblclick(local) {
      const sel = ctx.store.selection;
      if (!sel) return;
      const doc = ctx.floorDoc();
      const ring = getRing(doc, sel);
      const k = geomKind(sel);
      if (!ring || k === 'point' || k === 'line2') return;
      ctx.pushUndo();
      const si = segIndexNear(ring, local, k === 'ccw' || k === 'cw');
      if (insertVertex(doc, sel, si, local)) { ctx.markDirty(ctx.floorFile()); ctx.invalidate(); }
      else ctx.store.undo.pop();
    },
    key(ev) {
      if (ev.key === 'Escape') {
        ctx.store.selection = null;
        ctx.store.hoverVertex = null;
        ctx.invalidate();
        return true;
      }
      return false;
    },
  };
}

/** 描繪：點擊加點（磁吸頂點；Shift 正交）、Enter/雙擊完成、Esc 取消、Backspace 退點。
 *  poi 1 點、gate 2 點自動完成。 */
export function makeDrawTool(ctx: ToolContext): ToolHandler {
  const targetSel = q<HTMLSelectElement>('#draw-target');
  const kindSel = q<HTMLSelectElement>('#draw-kind');
  const idEl = q<HTMLInputElement>('#draw-id');
  const systemSel = q<HTMLSelectElement>('#draw-system');
  const confSel = q<HTMLSelectElement>('#draw-conf');
  const heightEl = q<HTMLInputElement>('#draw-height');
  const dirSel = q<HTMLSelectElement>('#draw-dir');
  const accEl = q<HTMLInputElement>('#draw-acc');
  const connectsEl = q<HTMLInputElement>('#draw-connects');

  function fillKinds(): void {
    const t = targetSel.value;
    const kinds: string[] = t === 'new-area' ? AREA_KINDS : t === 'new-unit' ? UNIT_KINDS : t === 'new-poi' ? POI_KINDS : [];
    kindSel.replaceChildren(...kinds.map((k) => new Option(k, k)));
    kindSel.disabled = kinds.length === 0;
  }
  targetSel.addEventListener('change', fillKinds);
  fillKinds();

  function provInput(): ProvInput {
    return { source: ctx.store.sourceId, confidence: Number(confSel.value) };
  }

  function snap(local: Vec2, ev: PointerEvent): Vec2 {
    const doc = ctx.floorDoc();
    const hit = hitVertex(doc, allRefs(doc, ctx.store.layers), local, tol(ctx));
    if (hit) return [...getRing(doc, hit.ref)![hit.vi]] as Vec2;
    const draft = ctx.store.draft;
    if (ev.shiftKey && draft.length) {
      const prev = draft[draft.length - 1];
      return Math.abs(local[0] - prev[0]) > Math.abs(local[1] - prev[1])
        ? [local[0], prev[1]]
        : [prev[0], local[1]];
    }
    return local;
  }

  function finish(): void {
    const store = ctx.store;
    const doc = ctx.floorDoc();
    const pts = dedupeAdjacentRoundedPoints(store.draft);
    store.draft = pts;
    if (!pts.length) return;
    const t = targetSel.value;
    const short = ctx.floorShort();
    const idDesc = idEl.value.trim();
    try {
      ctx.pushUndo();
      try {
        if (t === 'replace') {
          if (!store.selection) throw new Error('先用選取工具選要替換的元素');
          replaceGeom(doc, store.selection, pts, provInput());
        } else if (t === 'slab-outline') {
          replaceGeom(doc, { kind: 'slab-outline' }, pts, provInput());
        } else if (t === 'slab-hole') {
          store.selection = addSlabHole(doc, pts);
        } else {
          if (!idDesc) throw new Error('請填 id 描述段');
          if (t === 'new-area') store.selection = addArea(doc, `a-${short}-${idDesc}`, kindSel.value as Area['kind'], systemSel.value, pts, provInput());
          else if (t === 'new-unit') store.selection = addUnit(doc, `u-${short}-${idDesc}`, kindSel.value as Unit['kind'], Number(heightEl.value), pts, provInput());
          else if (t === 'new-wall') store.selection = addWall(doc, `w-${short}-${idDesc}`, Number(heightEl.value), pts, provInput());
          else if (t === 'new-poi') store.selection = addPoi(doc, `p-${short}-${idDesc}`, kindSel.value as Poi['kind'], pts[0], provInput());
          else if (t === 'new-gate') {
            const connects = connectsEl.value.split(',').map((s) => s.trim());
            if (connects.length !== 2 || !connects[0] || !connects[1]) throw new Error('connects 需「付費側,非付費側」兩個 area id');
            store.selection = addGate(doc, `g-${short}-${idDesc}`, systemSel.value, dirSel.value as Gate['direction'], accEl.checked, connects as [string, string], pts, provInput());
          } else throw new Error(`未知描繪目標：${t}`);
        }
      } catch (e) {
        store.undo.pop();
        throw e;
      }
      store.draft = [];
      ctx.markDirty(ctx.floorFile());
      ctx.setBanner('已加入（Ctrl+S 儲存後生效）', 'ok');
      ctx.invalidate();
    } catch (e) {
      ctx.setBanner(String(e), 'err');
    }
  }

  return {
    activate: () => { ctx.store.draft = []; },
    down(local, ev) {
      const t = targetSel.value;
      ctx.store.draft = [...ctx.store.draft, snap(local, ev)];
      if (t === 'new-poi' && ctx.store.draft.length === 1) finish();
      else if (t === 'new-gate' && ctx.store.draft.length === 2) finish();
      ctx.invalidate();
      return true;
    },
    dblclick() { finish(); },
    key(ev) {
      if (ev.key === 'Enter') { finish(); return true; }
      if (ev.key === 'Escape') { ctx.store.draft = []; ctx.invalidate(); return true; }
      if (ev.key === 'Backspace') { ctx.store.draft = ctx.store.draft.slice(0, -1); ctx.invalidate(); return true; }
      return false;
    },
  };
}

/** nav node：點擊新增（自動序號/area）、拖移、Alt+點刪除（未被 edge 引用才可） */
export function makeNavTool(ctx: ToolContext): ToolHandler {
  let dragging: string | null = null;
  return {
    down(local, ev) {
      const doc = ctx.floorDoc();
      const navRefs = (doc.nav?.nodes ?? []).map((n) => ({ kind: 'nav-node', id: n.id }) as GeomRef);
      const hit = hitVertex(doc, navRefs, local, tol(ctx));
      if (hit && hit.ref.kind === 'nav-node') {
        if (ev.altKey) {
          ctx.pushUndo();
          const r = deleteNavNode(doc, hit.ref.id);
          if (r.ok) { ctx.markDirty(ctx.floorFile()); ctx.store.selection = null; }
          else { ctx.store.undo.pop(); ctx.setBanner(r.reason!, 'err'); }
          ctx.invalidate();
          return true;
        }
        dragging = hit.ref.id;
        ctx.pushUndo();
        ctx.store.selection = hit.ref;
        ctx.invalidate();
        return true;
      }
      ctx.pushUndo();
      const node = addNavNode(doc, ctx.floorShort(), local);
      ctx.store.selection = { kind: 'nav-node', id: node.id };
      ctx.markDirty(ctx.floorFile());
      ctx.setBanner(`已新增 ${node.id}${node.area ? `（area: ${node.area}）` : ''}——edge 請手動編修 JSON`, 'ok');
      ctx.invalidate();
      return true;
    },
    move(local) {
      if (!dragging) return;
      moveNavNode(ctx.floorDoc(), dragging, local);
      ctx.markDirty(ctx.floorFile());
      ctx.invalidate();
    },
    up() { dragging = null; },
    key(ev) {
      if (ev.key === 'Escape') { ctx.store.selection = null; ctx.invalidate(); return true; }
      return false;
    },
  };
}
