import type * as THREE from 'three';
import type { StationModel } from './types';

export interface UIHandles { setSteps(steps: string[]): void }

export function setupUI(opts: {
  model: StationModel;
  stationGroup: THREE.Group;
  onRoute: (accessibleOnly: boolean) => void;
  onClear: () => void;
}): UIHandles {
  const { model, stationGroup } = opts;
  const floorsDiv = document.querySelector<HTMLDivElement>('#floors')!;
  const stepsOl = document.querySelector<HTMLOListElement>('#steps')!;

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

  const opacity = document.querySelector<HTMLInputElement>('#opacity')!;
  opacity.addEventListener('input', () => {
    const k = Number(opacity.value) / 100;
    stationGroup.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const m = mesh.material as THREE.MeshLambertMaterial | undefined;
      if (m && (mesh.userData.kind === 'slab' || mesh.userData.kind === 'shell')) {
        m.opacity = (mesh.userData.kind === 'slab' ? 0.9 : 0.08) * k * (1 / 0.6);
        m.transparent = true;
      }
    });
  });

  const btnRoute = document.querySelector<HTMLButtonElement>('#btn-route')!;
  const btnAcc = document.querySelector<HTMLButtonElement>('#btn-route-acc')!;
  const btnClear = document.querySelector<HTMLButtonElement>('#btn-clear')!;
  const hasDemo = Boolean(model.station.demo);
  btnRoute.disabled = !hasDemo;
  btnAcc.disabled = !hasDemo;
  if (!hasDemo) btnRoute.title = btnAcc.title = 'station.json 尚未設定 demo 起訖';
  btnRoute.addEventListener('click', () => opts.onRoute(false));
  btnAcc.addEventListener('click', () => opts.onRoute(true));
  btnClear.addEventListener('click', () => { opts.onClear(); setSteps([]); });

  function setSteps(steps: string[]): void {
    stepsOl.replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
  }
  return { setSteps };
}
