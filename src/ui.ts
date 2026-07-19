import type * as THREE from 'three';
import type { Landmark } from './nav';
import type { StationModel } from './types';

export interface UIHandles {
  setSteps(steps: string[]): void;
  showFollow(on: boolean): void;
  setFollowInfo(next: string, progress: string): void;
  setFollowReady(on: boolean): void;
}

export function setupUI(opts: {
  model: StationModel;
  stationGroup: THREE.Group;
  landmarks: Landmark[];
  onRoute: (start: string, end: string, accessibleOnly: boolean) => void;
  onClear: () => void;
  onStartFollow: () => void;
  onAdvance: () => void;
  onBack: () => void;
  onExitFollow: () => void;
}): UIHandles {
  const { model, stationGroup } = opts;
  const floorsDiv = document.querySelector<HTMLDivElement>('#floors')!;
  const stepsOl = document.querySelector<HTMLOListElement>('#steps')!;

  for (const [btnId, cls] of [['btn-bigtext', 'big-text'], ['btn-contrast', 'high-contrast']] as const) {
    const b = document.querySelector<HTMLButtonElement>(`#${btnId}`)!;
    b.addEventListener('click', () => {
      const on = document.body.classList.toggle(cls);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  for (const meta of model.station.floors) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.addEventListener('change', () => {
      const g = stationGroup.children.find((c) => c.name === meta.id);
      if (g) g.visible = cb.checked;
    });
    label.append(cb, ` ${meta.labels['complex'] ?? ''} ${meta.name.zh}`);
    floorsDiv.append(label);
  }

  const selStart = document.querySelector<HTMLSelectElement>('#sel-start')!;
  const selEnd = document.querySelector<HTMLSelectElement>('#sel-end')!;
  for (const sel of [selStart, selEnd]) {
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const lm of opts.landmarks) {
      let og = groups.get(lm.floorLabel);
      if (!og) {
        og = document.createElement('optgroup');
        og.label = lm.floorLabel;
        groups.set(lm.floorLabel, og);
        sel.append(og);
      }
      const o = document.createElement('option');
      o.value = lm.id;
      o.textContent = lm.label;
      og.append(o);
    }
  }
  const demo = model.station.demo;
  if (demo) { selStart.value = demo.start; selEnd.value = demo.end; }
  for (const sel of [selStart, selEnd]) {
    // 改起訖即失效既有路線——否則「開始導航」會沿舊 routeEdges 走（與畫面選擇不符）
    sel.addEventListener('change', () => { opts.onClear(); setSteps([]); setFollowReady(false); });
  }

  const opacity = document.querySelector<HTMLInputElement>('#opacity')!;
  opacity.addEventListener('input', () => {
    const k = Number(opacity.value) / 100;
    stationGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const m = mesh.material as THREE.MeshStandardMaterial | undefined;
      if (m && (mesh.userData.kind === 'slab' || mesh.userData.kind === 'shell')) {
        m.opacity = (mesh.userData.kind === 'slab' ? 0.9 : 0.08) * k * (1 / 0.6);
        m.transparent = true;
        // 跟隨會話中同步快照，退出/下一次聚焦以 slider 新值為基準
        if (mesh.userData.baseOpacity !== undefined) mesh.userData.baseOpacity = m.opacity;
      }
    });
  });

  const btnRoute = document.querySelector<HTMLButtonElement>('#btn-route')!;
  const btnAcc = document.querySelector<HTMLButtonElement>('#btn-route-acc')!;
  const btnClear = document.querySelector<HTMLButtonElement>('#btn-clear')!;
  const btnFollow = document.querySelector<HTMLButtonElement>('#btn-follow')!;
  const followPanel = document.querySelector<HTMLDivElement>('#follow-panel')!;
  const followNext = document.querySelector<HTMLDivElement>('#follow-next')!;
  const followProgress = document.querySelector<HTMLDivElement>('#follow-progress')!;
  document.querySelector<HTMLButtonElement>('#btn-advance')!.addEventListener('click', () => opts.onAdvance());
  document.querySelector<HTMLButtonElement>('#btn-back')!.addEventListener('click', () => opts.onBack());
  document.querySelector<HTMLButtonElement>('#btn-exit-follow')!.addEventListener('click', () => opts.onExitFollow());
  btnFollow.addEventListener('click', () => opts.onStartFollow());
  const canRoute = opts.landmarks.length >= 2;
  btnRoute.disabled = !canRoute;
  btnAcc.disabled = !canRoute;
  if (!canRoute) btnRoute.title = btnAcc.title = '資料尚無具名節點（landmarks）';
  btnRoute.addEventListener('click', () => opts.onRoute(selStart.value, selEnd.value, false));
  btnAcc.addEventListener('click', () => opts.onRoute(selStart.value, selEnd.value, true));
  btnClear.addEventListener('click', () => { opts.onClear(); setSteps([]); setFollowReady(false); });

  function setSteps(steps: string[]): void {
    stepsOl.replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
  }
  function showFollow(on: boolean): void {
    followPanel.style.display = on ? 'block' : 'none';
    for (const b of [btnRoute, btnAcc, btnClear, btnFollow]) b.style.display = on ? 'none' : '';
    selStart.disabled = on;
    selEnd.disabled = on;
  }
  function setFollowInfo(next: string, progress: string): void {
    followNext.textContent = next;
    followProgress.textContent = progress;
  }
  function setFollowReady(on: boolean): void { btnFollow.disabled = !on; }
  return { setSteps, showFollow, setFollowInfo, setFollowReady };
}
