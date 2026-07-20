import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup, buildConnectorsGroup, toWorld } from './builder';
import {
  buildGraph, findPath, routeSteps, routeStats, formatStats,
  listLandmarks, sameEndpointMessage,
} from './nav';
import type { GraphEdge } from './nav';
import { buildRouteObject } from './path';
import { setupUI } from './ui';
import { MODE_EXPLODE, verticalStep, transitionLabel, type Mode } from './mode';
import { floorOffsetY, applyExplode, easeInOutCubic, disposeDeep } from './explode';
import { CameraRig, frameGoal, chaseGoal } from './camera';
import {
  startFollow, advance, back, atEnd, currentNodeId, remainingEdges,
  buildPositionMarker, setFloorEmphasis, type FollowState,
} from './follow';
import stationDoc from '../data/station.json';
import connectorsDoc from '../data/connectors.json';

function showOverlay(text: string): void {
  const el = document.querySelector<HTMLDivElement>('#overlay')!;
  el.textContent = text;
  el.style.display = 'block';
}

const floorModules = import.meta.glob('../data/floors/*.json', { eager: true });
const floorDocsByFile: Record<string, unknown> = {};
for (const [p, mod] of Object.entries(floorModules)) {
  floorDocsByFile[p.replace('../data/', '')] = (mod as { default: unknown }).default;
}

const EXPLODE_MS = 800;

async function boot(): Promise<void> {
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14171c');
  scene.add(new THREE.HemisphereLight('#cfd8e3', '#2a2f38', 1.1));
  const dirLight = new THREE.DirectionalLight('#ffffff', 0.9);
  dirLight.position.set(150, 200, 120);
  scene.add(dirLight);
  scene.add(new THREE.GridHelper(500, 50, '#2c333d', '#232830'));

  // 幾何雙軌：預設 runtime extrude；?geom=glb 載入離線匯出檔
  const geomMode = new URLSearchParams(location.search).get('geom') === 'glb' ? 'glb' : 'json';
  let stationGroup: THREE.Group;
  if (geomMode === 'glb') {
    const gltf = await new GLTFLoader().loadAsync('models/station.glb').catch(() => {
      throw new Error('載入 models/station.glb 失敗——請先執行 npm run export:glb');
    });
    const found = gltf.scene.getObjectByName('station');
    if (!found) throw new Error('station.glb 內找不到名為 station 的節點');
    stationGroup = found as THREE.Group;
  } else {
    stationGroup = buildStationGroup(model);
  }
  scene.add(stationGroup);

  document.querySelector<HTMLDivElement>('#geom-mode')!.innerHTML = geomMode === 'glb'
    ? '幾何：GLB <a href="./">切回 runtime</a>'
    : '幾何：runtime <a href="?geom=glb">切至 GLB</a>';

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(220, 140, 260);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.querySelector('#app')!.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(60, -18, 0);
  controls.enableDamping = true;
  const rig = new CameraRig(camera, controls);

  const graph = buildGraph(model);
  const landmarks = listLandmarks(model);

  let mode: Mode = 'overview';
  let explodeFactor = 0; // boot 時由實高動畫展開至 overview 爆炸
  let explodeAnim: { from: number; to: number; t0: number } | null = null;
  let routeEdges: GraphEdge[] | null = null;
  let followState: FollowState | null = null;
  let marker: THREE.Group | null = null;
  let routeObj: THREE.Object3D | null = null;
  let chaseAuto = true;

  const offsetAt = (factor: number) => (floorId: string) => floorOffsetY(model, floorId, factor);
  const nodeWorldAt = (id: string, factor: number): THREE.Vector3 => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z + floorOffsetY(model, n.floor, factor));
  };
  const nodeWorld = (id: string): THREE.Vector3 => nodeWorldAt(id, explodeFactor);

  function refreshRoute(): void {
    if (routeObj) { scene.remove(routeObj); disposeDeep(routeObj); routeObj = null; }
    if (routeEdges?.length) {
      routeObj = buildRouteObject(graph, routeEdges, offsetAt(explodeFactor));
      scene.add(routeObj);
    }
  }

  let connObj: THREE.Object3D = stationGroup.getObjectByName('connectors')!;
  function refreshScene(): void {
    applyExplode(stationGroup, model, explodeFactor);
    // connectors 豎井/斜坡需隨層距拉伸——重建（幾何小、便宜；舊物件釋放 GPU 資源）
    stationGroup.remove(connObj);
    disposeDeep(connObj);
    connObj = buildConnectorsGroup(model, offsetAt(explodeFactor));
    stationGroup.add(connObj);
    refreshRoute();
    if (marker && followState) marker.position.copy(nodeWorld(currentNodeId(followState)));
  }

  function setExplode(target: number): void {
    if (Math.abs(target - explodeFactor) > 1e-3)
      explodeAnim = { from: explodeFactor, to: target, t0: performance.now() };
  }

  function routePoints(factor: number): THREE.Vector3[] {
    if (!routeEdges?.length) return [];
    const ids = [routeEdges[0].from, ...routeEdges.map((e) => e.to)];
    return ids.map((id) => nodeWorldAt(id, factor));
  }

  function exitNav(): void {
    if (marker) scene.remove(marker); // marker 建一次重用（Phase 3 慣例）
    followState = null;
    ui.setTransition(null);
    ui.showArrive(false);
  }

  function clearRoute(): void {
    exitNav();
    routeEdges = null;
    refreshRoute();
  }

  function setMode(m: Mode): void {
    mode = m;
    ui.setMode(m);
    setExplode(MODE_EXPLODE[m]);
    if (m === 'overview') {
      clearRoute();
      setFloorEmphasis(stationGroup, null);
    }
    if (m === 'preview') {
      setFloorEmphasis(stationGroup, null); // 跨樓層路線需全樓層可見
      rig.goal = frameGoal(routePoints(MODE_EXPLODE[m]), camera.aspect); // 以目標爆炸係數框路徑
    }
    if (m === 'nav') chaseAuto = true;
  }

  function refreshNav(): void {
    if (!followState || !routeEdges || !marker) return;
    marker.position.copy(nodeWorld(currentNodeId(followState)));
    const cur = graph.nodes.get(currentNodeId(followState))!;
    const vEdge = verticalStep(routeEdges, followState);
    if (vEdge) {
      // vertical transition 呈現：雙層強調＋橫幅＋同框兩端（盤問 Q3）
      setFloorEmphasis(stationGroup, [cur.floor, graph.nodes.get(vEdge.to)!.floor]);
      ui.setTransition(transitionLabel(model, graph, vEdge));
      chaseAuto = false;
      rig.goal = frameGoal([nodeWorld(vEdge.from), nodeWorld(vEdge.to)], camera.aspect);
    } else {
      setFloorEmphasis(stationGroup, cur.floor);
      ui.setTransition(null);
      chaseAuto = true;
    }
    const remain = remainingEdges(routeEdges, followState);
    const progress = `節點 ${followState.index + 1}/${followState.nodeIds.length}`;
    if (atEnd(followState)) {
      ui.setNavInfo('已抵達目的地', '', progress);
      ui.showArrive(true);
      return;
    }
    ui.showArrive(false);
    const next = routeSteps(model, graph, remain)[0] ?? '前往下一節點';
    ui.setNavInfo(`下一步：${next}`, `剩餘 ${formatStats(routeStats(remain))}`, progress);
  }

  const ui = setupUI({
    model, landmarks,
    onRoute: (start, end, accessibleOnly) => {
      const sameMsg = sameEndpointMessage(start, end);
      const path = sameMsg ? null : findPath(graph, start, end, { accessibleOnly });
      if (!path || path.length === 0) {
        routeEdges = null;
        refreshRoute();
        ui.setPreview(sameMsg ?? '找不到路徑', [], false);
        return;
      }
      routeEdges = path;
      refreshRoute();
      ui.setPreview(formatStats(routeStats(path)), routeSteps(model, graph, path), true);
      setMode('preview');
    },
    onCancelRoute: () => setMode('overview'),
    onRouteInvalid: () => { routeEdges = null; refreshRoute(); },
    onStartNav: () => {
      if (!routeEdges?.length) return;
      followState = startFollow(routeEdges);
      if (!marker) marker = buildPositionMarker();
      scene.add(marker);
      setMode('nav');
      refreshNav();
    },
    onAdvance: () => {
      if (!followState) return;
      followState = advance(followState);
      chaseAuto = true; // 推進恢復跟隨；transition 中 refreshNav 會再關
      refreshNav();
    },
    onBack: () => { if (followState) { followState = back(followState); refreshNav(); } },
    onRecenter: () => {
      if (followState) refreshNav(); // transition=重設雙層同框、一般=恢復 chase（終審 I-3）
      else chaseAuto = true;
    },
    onExitNav: () => setMode('overview'),
    onFloorFocus: (id) => setFloorEmphasis(stationGroup, id),
  });

  // nav 中拖曳＝暫停自動跟隨（回正鈕/推進恢復）
  renderer.domElement.addEventListener('pointerdown', () => {
    if (mode === 'nav') { chaseAuto = false; rig.cancel(); }
  });

  setMode('overview'); // boot：實高 → 爆炸圖展開動畫

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop(() => {
    if (explodeAnim) {
      const t = Math.min(1, (performance.now() - explodeAnim.t0) / EXPLODE_MS);
      explodeFactor = explodeAnim.from + (explodeAnim.to - explodeAnim.from) * easeInOutCubic(t);
      refreshScene();
      if (t >= 1) explodeAnim = null;
    }
    if (mode === 'nav' && followState && marker && chaseAuto && !atEnd(followState)
        && routeEdges && !verticalStep(routeEdges, followState)) {
      const nextId = followState.nodeIds[Math.min(followState.index + 1, followState.nodeIds.length - 1)];
      rig.goal = chaseGoal(marker.position, nodeWorld(nextId));
    }
    rig.tick();
    controls.update();
    renderer.render(scene, camera);
  });
}

boot().catch((e) => {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
});
