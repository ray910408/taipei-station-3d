import type { CalibrationControlPoint, Vec2 } from '../types';
import { fitSimilarity, localToPx, pxPerM, pxToLocal } from './transform';
import { allRefs, getRing, hitVertex, roundPt } from './geom';
import type { ToolContext, ToolHandler } from './store';

/** 校準：兩對「底圖 px ↔ local」控制點 → 相似變換。預覽滿意後寫回 sources.json。 */
export function makeCalibrateTool(ctx: ToolContext): ToolHandler {
  const info = document.querySelector<HTMLDivElement>('#calib-info')!;
  const btnSave = document.querySelector<HTMLButtonElement>('#btn-calib-save')!;
  const btnReset = document.querySelector<HTMLButtonElement>('#btn-calib-reset')!;
  let pts: { px: Vec2; local?: Vec2 }[] = [];

  function need(): 'px' | 'local' | 'done' {
    if (pts.length === 0) return 'px';
    if (!pts[pts.length - 1].local) return 'local';
    return pts.length === 1 ? 'px' : 'done';
  }

  function controlPoints(): [CalibrationControlPoint, CalibrationControlPoint] {
    return [
      { px: [Math.round(pts[0].px[0]), Math.round(pts[0].px[1])], local: roundPt(pts[0].local!) },
      { px: [Math.round(pts[1].px[0]), Math.round(pts[1].px[1])], local: roundPt(pts[1].local!) },
    ];
  }

  function refresh(): void {
    const t = ctx.currentTransform();
    ctx.store.calibMarkers = t ? pts.map((p) => p.local ?? pxToLocal(t, p.px)) : [];
    if (need() === 'done') { preview(); ctx.invalidate(); return; }
    const stepIdx = pts.length === 0 ? 0 : !pts[pts.length - 1].local ? pts.length * 2 - 1 : pts.length * 2;
    info.textContent = [
      '步驟 1/4：點擊底圖上的基準點 A',
      '步驟 2/4：點擊 A 對應的 local 位置（磁吸既有頂點；Enter 改輸入座標）',
      '步驟 3/4：點擊底圖上的基準點 B',
      '步驟 4/4：點擊 B 對應的 local 位置（磁吸既有頂點；Enter 改輸入座標）',
    ][stepIdx];
    btnSave.disabled = true;
    ctx.invalidate();
  }

  function preview(): void {
    try {
      const t = fitSimilarity(controlPoints());
      ctx.store.transformOverride.set(ctx.store.sourceId, t);
      info.textContent = `px_per_m ≈ ${pxPerM(t).toFixed(2)}——檢查底圖對位，滿意後按「儲存校準」`;
      btnSave.disabled = false;
    } catch (e) {
      ctx.setBanner(String(e), 'err');
      reset();
    }
  }

  function reset(): void {
    pts = [];
    ctx.store.transformOverride.delete(ctx.store.sourceId);
    btnSave.disabled = true;
    refresh();
  }

  btnReset.addEventListener('click', reset);
  btnSave.addEventListener('click', () => {
    const src = ctx.store.sourcesDoc.sources.find((s) => s.id === ctx.store.sourceId);
    const t = ctx.store.transformOverride.get(ctx.store.sourceId);
    if (!src || !t) return;
    const basis = prompt('校準依據（basis：控制點對到什麼）', src.calibration?.basis ?? '');
    if (!basis) { ctx.setBanner('需填 basis 才能儲存', 'err'); return; }
    src.calibration = {
      px_per_m: Number(pxPerM(t).toFixed(2)),
      basis,
      status: 'estimated',
      control_points: controlPoints(),
    };
    ctx.markDirty('refs/sources.json');
    void ctx.save();
  });

  return {
    activate: reset,
    deactivate: () => { ctx.store.transformOverride.delete(ctx.store.sourceId); pts = []; },
    down(local) {
      const t = ctx.currentTransform();
      if (!t) { ctx.setBanner('底圖尚未載入，無法校準', 'err'); return true; }
      const n = need();
      if (n === 'px') pts.push({ px: localToPx(t, local) });
      else if (n === 'local') {
        const doc = ctx.floorDoc();
        const hit = hitVertex(doc, allRefs(doc, ctx.store.layers), local, 8 / ctx.store.view.zoom);
        pts[pts.length - 1].local = hit ? ([...getRing(doc, hit.ref)![hit.vi]] as Vec2) : roundPt(local);
      }
      refresh();
      return true;
    },
    key(ev) {
      if (ev.key === 'Escape') { reset(); return true; }
      if (ev.key === 'Enter' && need() === 'local') {
        const input = prompt('local 座標「x,y」（公尺）');
        const m = input?.split(',').map((s) => Number(s.trim()));
        if (m && m.length === 2 && m.every(Number.isFinite)) {
          pts[pts.length - 1].local = [m[0], m[1]];
          refresh();
        } else {
          ctx.setBanner('座標格式錯誤，需「x,y」', 'err');
        }
        return true;
      }
      return false;
    },
  };
}
