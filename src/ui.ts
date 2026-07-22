import type { Landmark } from './nav';
import type { Mode } from './mode';
import type { StationModel } from './types';

export interface UIHandles {
  setMode(mode: Mode): void;
  setPreview(stats: string, steps: string[], ready: boolean): void;
  setNavInfo(next: string, remain: string, progress: string): void;
  setTransition(label: string | null): void;
  showArrive(on: boolean): void;
  showPickCard(lm: Landmark | null): void;
  setPdrHint(on: boolean): void;
  setPdrToggle(on: boolean): void;
}

export interface LandmarkGroup { floorLabel: string; items: Landmark[] }

/** 依 query 過濾後、按樓層（floorLabel，保原始順序）分組——下拉全列不截斷（B4 修復）。 */
export function groupLandmarks(landmarks: Landmark[], query: string): LandmarkGroup[] {
  const q = query.trim();
  const matched = q
    ? landmarks.filter((l) => (l.label + l.floorLabel).includes(q))
    : landmarks;
  const groups: LandmarkGroup[] = [];
  for (const lm of matched) {
    const last = groups[groups.length - 1];
    if (last?.floorLabel === lm.floorLabel) last.items.push(lm);
    else groups.push({ floorLabel: lm.floorLabel, items: [lm] });
  }
  return groups;
}

/** 下拉顯示用：去掉與組標頭重複的樓層前綴（如「B1 」）；資料 label 保全稱。 */
export function displayLabel(label: string, floorLabel: string): string {
  const code = floorLabel.split(' ')[0]; // 「B1 臺鐵穿堂層」→「B1」
  return label.startsWith(`${code} `) ? label.slice(code.length + 1) : label;
}

/** 搜尋欄＋過濾清單：focus/input 顯示符合項，pointerdown 選取（先於 blur）。 */
function attachSearch(
  input: HTMLInputElement, list: HTMLUListElement,
  landmarks: Landmark[], onPick: (lm: Landmark) => void, onEdit?: () => void,
): void {
  const render = (q: string): void => {
    const groups = groupLandmarks(landmarks, q);
    if (groups.length === 0 && q !== '') { // 空 query 不顯示空狀態（清單本來就收合）
      const li = document.createElement('li');
      li.className = 'empty-note';
      li.textContent = '找不到符合的地點';
      list.replaceChildren(li);
      list.hidden = false;
      return;
    }
    list.replaceChildren(...groups.flatMap((g) => {
      const head = document.createElement('li');
      head.className = 'group-label';
      head.textContent = g.floorLabel;
      return [head, ...g.items.map((lm) => {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = displayLabel(lm.label, g.floorLabel); // 樓層資訊由組標頭承載
        btn.addEventListener('pointerdown', (ev) => ev.preventDefault()); // 防 input blur 先收清單
        btn.addEventListener('click', () => { list.hidden = true; onPick(lm); });
        li.append(btn);
        return li;
      })];
    }));
    list.hidden = groups.length === 0;
  };
  input.addEventListener('focus', () => render(input.value.trim()));
  input.addEventListener('input', () => { onEdit?.(); render(input.value.trim()); });
  input.addEventListener('blur', () => setTimeout(() => {
    if (!list.contains(document.activeElement)) list.hidden = true;
  }, 120));
}

export function setupUI(opts: {
  model: StationModel;
  landmarks: Landmark[];
  onRoute(start: string, end: string, accessibleOnly: boolean): void;
  onCancelRoute(): void;
  onRouteInvalid(): void;
  onStartNav(): void;
  onAdvance(): void;
  onBack(): void;
  onRecenter(): void;
  onExitNav(): void;
  onFloorFocus(id: string | null): void;
  onPickDismiss(): void;
  pdrAvailable: boolean;
  onPdrToggle(on: boolean): Promise<boolean>;
  onVoiceToggle(on: boolean): void;
}): UIHandles {
  const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
  const searchbar = $('#searchbar');
  const routeCard = $('#route-card');
  const navBanner = $('#nav-banner');
  const transitionBanner = $('#transition-banner');
  const arriveCard = $('#arrive-card');
  const floorButtons = $('#floor-buttons');
  const endInput = $<HTMLInputElement>('#end-input');
  const startInput = $<HTMLInputElement>('#start-input');
  const accToggle = $<HTMLInputElement>('#acc-toggle');
  const routeDest = $('#route-dest');
  const routeStatsDiv = $('#route-stats');
  const stepsOl = $<HTMLOListElement>('#steps');
  const btnStartNav = $<HTMLButtonElement>('#btn-start-nav');

  // a11y 切換（沿用 Phase 3）
  for (const [btnId, cls] of [['btn-bigtext', 'big-text'], ['btn-contrast', 'high-contrast']] as const) {
    const b = $<HTMLButtonElement>(`#${btnId}`);
    b.addEventListener('click', () => {
      const on = document.body.classList.toggle(cls);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  // 設定角落
  const settingsMenu = $('#settings-menu');
  $('#btn-settings').addEventListener('click', () => {
    settingsMenu.hidden = !settingsMenu.hidden;
    $('#btn-settings').setAttribute('aria-expanded', String(!settingsMenu.hidden));
  });

  const settingsRoot = $('#settings');
  document.addEventListener('pointerdown', (ev) => {
    if (settingsMenu.hidden) return;
    if (!settingsRoot.contains(ev.target as Node)) {
      settingsMenu.hidden = true;
      $('#btn-settings').setAttribute('aria-expanded', 'false');
    }
  });

  // Esc 漸退：設定選單 → 開啟中的結果清單 → 選點卡 → preview 返回 overview（nav 不接——誤按代價高）
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!settingsMenu.hidden) {
      settingsMenu.hidden = true;
      $('#btn-settings').setAttribute('aria-expanded', 'false');
      return;
    }
    const open = document.querySelector<HTMLElement>('.results:not([hidden])');
    if (open) { open.hidden = true; return; }
    if (!pickCard.hidden) { opts.onPickDismiss(); return; } // 先關選點卡，不動整條路線（終審 F6）
    if (document.body.dataset.mode === 'preview') opts.onCancelRoute();
  });

  // 樓層按鈕：點=聚焦、再點=取消（盤問 Q7；overview 限定，setMode 時隱藏並重置）
  let focusedFloor: string | null = null;
  const resetFloorFocus = (): void => {
    focusedFloor = null;
    for (const b of floorButtons.querySelectorAll('button')) b.setAttribute('aria-pressed', 'false');
  };
  for (const meta of opts.model.station.floors) {
    const b = document.createElement('button');
    b.textContent = meta.labels['complex'] ?? meta.id;
    b.dataset.floorId = meta.id;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      focusedFloor = focusedFloor === meta.id ? null : meta.id;
      for (const other of floorButtons.querySelectorAll('button'))
        other.setAttribute('aria-pressed', String(other.dataset.floorId === focusedFloor));
      opts.onFloorFocus(focusedFloor);
    });
    floorButtons.append(b);
  }

  // 兩段式搜尋（盤問 Q6）：先終點、後起點，齊了自動算路線
  const labelById = new Map(opts.landmarks.map((l) => [l.id, l.label]));
  let startId: string | null = null;
  let endId: string | null = null;
  const labelOf = (id: string | null): string => (id && labelById.get(id)) || '';
  const tryRoute = (): void => {
    if (startId && endId) opts.onRoute(startId, endId, accToggle.checked);
  };
  // 使用者編輯已選欄位文字＝選擇失效：清 ID、清統計、停用開始導航（終審 I-2）
  const invalidateRoute = (): void => {
    routeStatsDiv.textContent = '';
    stepsOl.replaceChildren();
    btnStartNav.disabled = true;
    opts.onRouteInvalid();
  };
  const applyEnd = (lm: Landmark): void => {
    endId = lm.id;
    endInput.value = lm.label;
    routeDest.textContent = `終點：${lm.label}（${lm.floorLabel}）`;
    searchbar.hidden = true;
    routeCard.hidden = false;
    if (!startId) startInput.focus();
    else tryRoute();
  };
  attachSearch(endInput, $<HTMLUListElement>('#end-results'), opts.landmarks, applyEnd, () => {
    endId = null;
    routeDest.textContent = '';
    invalidateRoute();
  });
  attachSearch(startInput, $<HTMLUListElement>('#start-results'), opts.landmarks, (lm) => {
    startId = lm.id;
    startInput.value = lm.label;
    tryRoute();
  }, () => {
    startId = null;
    invalidateRoute();
  });
  accToggle.addEventListener('change', tryRoute);
  $('#btn-swap').addEventListener('click', () => {
    [startId, endId] = [endId, startId];
    startInput.value = labelOf(startId);
    endInput.value = labelOf(endId);
    routeDest.textContent = endId ? `終點：${labelOf(endId)}` : '';
    tryRoute();
  });

  // 3D 選點確認小卡：設起點＝預填等終點；設終點＝走 applyEnd 既有流程
  const pickCard = $('#pick-card');
  const pickLabel = $('#pick-label');
  let pickedLm: Landmark | null = null;
  function showPickCard(lm: Landmark | null): void {
    pickedLm = lm;
    pickCard.hidden = lm === null;
    if (lm) pickLabel.textContent = `${lm.label}（${lm.floorLabel}）`;
  }
  $('#btn-pick-start').addEventListener('click', () => {
    if (pickedLm) {
      labelById.set(pickedLm.id, pickedLm.label);
      startId = pickedLm.id;
      startInput.value = pickedLm.label;
      if (endId) tryRoute();
    }
    opts.onPickDismiss();
  });
  $('#btn-pick-end').addEventListener('click', () => {
    if (pickedLm) {
      labelById.set(pickedLm.id, pickedLm.label);
      applyEnd(pickedLm);
    }
    opts.onPickDismiss();
  });
  $('#btn-pick-cancel').addEventListener('click', () => opts.onPickDismiss());

  // 步感應 toggle：預設關；開啟在手勢內請求權限，拒絕/不支援時回滾
  const pdrToggle = $<HTMLInputElement>('#pdr-toggle');
  pdrToggle.disabled = !opts.pdrAvailable;
  let pdrReq = 0; // 晚到的舊請求結果不覆寫最新 toggle 狀態（終審 F1）
  pdrToggle.addEventListener('change', () => {
    const req = ++pdrReq;
    void opts.onPdrToggle(pdrToggle.checked).then((on) => {
      if (req === pdrReq) pdrToggle.checked = on;
    });
  });
  function setPdrToggle(on: boolean): void {
    pdrToggle.checked = on;
  }

  $<HTMLInputElement>('#voice-toggle').addEventListener('change', (ev) => {
    opts.onVoiceToggle((ev.target as HTMLInputElement).checked);
  });

  const resetEndpoints = (): void => {
    startId = null;
    endId = null;
    startInput.value = '';
    endInput.value = '';
    routeDest.textContent = '';
    routeStatsDiv.textContent = '';
    stepsOl.replaceChildren();
    btnStartNav.disabled = true;
  };

  $('#btn-cancel-route').addEventListener('click', () => opts.onCancelRoute());
  btnStartNav.addEventListener('click', () => opts.onStartNav());
  $('#btn-advance').addEventListener('click', () => opts.onAdvance());
  $('#btn-back').addEventListener('click', () => opts.onBack());
  $('#btn-recenter').addEventListener('click', () => opts.onRecenter());
  $('#btn-exit-nav').addEventListener('click', () => opts.onExitNav());
  $('#btn-finish').addEventListener('click', () => opts.onExitNav());
  $('#btn-arrive-back').addEventListener('click', () => opts.onBack());

  function setMode(mode: Mode): void {
    document.body.dataset.mode = mode;
    searchbar.hidden = mode !== 'overview';
    floorButtons.hidden = mode !== 'overview';
    routeCard.hidden = mode !== 'preview';
    navBanner.hidden = mode !== 'nav';
    if (mode !== 'nav') { transitionBanner.hidden = true; arriveCard.hidden = true; }
    if (mode !== 'overview') resetFloorFocus();
    if (mode === 'overview') resetEndpoints();
  }
  function setPreview(stats: string, steps: string[], ready: boolean): void {
    routeStatsDiv.textContent = stats;
    stepsOl.replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
    btnStartNav.disabled = !ready;
  }
  function setNavInfo(next: string, remain: string, progress: string): void {
    $('#nav-next').textContent = next;
    $('#nav-remain').textContent = remain;
    $('#nav-progress').textContent = progress;
  }
  function setTransition(label: string | null): void {
    transitionBanner.hidden = label === null;
    if (label !== null) transitionBanner.textContent = label;
  }
  function showArrive(on: boolean): void {
    arriveCard.hidden = !on;
    if (on) navBanner.hidden = true; // 抵達＝單一 CTA，收起 nav 按鈕列
    else if (document.body.dataset.mode === 'nav') navBanner.hidden = false; // overview 收尾時不得誤開
  }
  function setPdrHint(on: boolean): void {
    $('#pdr-hint').hidden = !on;
  }

  return { setMode, setPreview, setNavInfo, setTransition, showArrive, showPickCard, setPdrHint, setPdrToggle };
}
