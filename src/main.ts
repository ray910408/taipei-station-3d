import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup, buildConnectorsGroup, toWorld, applyShadowFlags } from './builder';
import { THEME, applyUITheme } from './theme';
import {
  buildGraph, findPath, routeSteps, routeStats, formatStats,
  listLandmarks, sameEndpointMessage, routeFloors,
} from './nav';
import type { GraphEdge } from './nav';
import { buildRouteObject, tickRouteArrows } from './path';
import { makeTween, tweenAt, chaseAim, swapFactors, applyFloorFade, setShellVisible, type Tween, type FloorSwap } from './navview';
import { attachPoiIcons } from './icons';
import { createLabelLayer } from './labels';
import { attachFpsOverlay } from './fps';
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
  applyUITheme();
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(THEME.scene.background);
  scene.add(new THREE.HemisphereLight(
    THEME.lights.hemi.sky, THEME.lights.hemi.ground, THEME.lights.hemi.intensity));
  const sun = new THREE.DirectionalLight(THEME.lights.sun.color, THEME.lights.sun.intensity);
  sun.position.set(...THEME.lights.sun.position);
  sun.target.position.set(...THEME.lights.sun.target);
  sun.castShadow = true;
  const sh = THEME.lights.sun.shadow;
  sun.shadow.mapSize.set(sh.mapSize, sh.mapSize);
  sun.shadow.camera.left = -sh.bounds;
  sun.shadow.camera.right = sh.bounds;
  sun.shadow.camera.top = sh.bounds;
  sun.shadow.camera.bottom = -sh.bounds;
  sun.shadow.camera.near = sh.near;
  sun.shadow.camera.far = sh.far;
  sun.shadow.bias = sh.bias;
  sun.shadow.normalBias = sh.normalBias; // 薄 extrude slab 抗 acne 主力
  sun.shadow.camera.updateProjectionMatrix(); // three 不會因 bounds 變更自動重算
  scene.add(sun, sun.target);

  // 地面：radial 漸暈、邊緣融進背景色——去除「漂浮在灰板上」的分析圖感
  const groundCanvas = document.createElement('canvas');
  groundCanvas.width = groundCanvas.height = 512;
  {
    const ctx = groundCanvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(256, 256, 256 * 0.15, 256, 256, 256 * 0.5);
    grad.addColorStop(0, THEME.scene.ground);
    grad.addColorStop(1, THEME.scene.background);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);
  }
  const groundTex = new THREE.CanvasTexture(groundCanvas);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(THEME.scene.groundSize, THEME.scene.groundSize),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = THEME.scene.groundY;
  ground.receiveShadow = true;
  scene.add(ground);

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
    applyShadowFlags(stationGroup);
  } else {
    stationGroup = buildStationGroup(model);
  }
  scene.add(stationGroup);
  attachPoiIcons(stationGroup, model); // json/glb 兩軌通用（GLB 不含 Sprite，一律 runtime 附掛）

  document.querySelector<HTMLDivElement>('#geom-mode')!.innerHTML = geomMode === 'glb'
    ? '幾何：GLB <a href="./">切回 runtime</a>'
    : '幾何：runtime <a href="?geom=glb">切至 GLB</a>';

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(220, 140, 260);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  const fpsTick = attachFpsOverlay(renderer);
  renderer.setPixelRatio(Math.min(devicePixelRatio, THEME.render.maxPixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = THEME.render.toneMappingExposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // 場景靜止時省 shadow pass；變更點才 needsUpdate
  renderer.shadowMap.needsUpdate = true;
  document.querySelector('#app')!.append(renderer.domElement);
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '台北車站站體 3D 地圖');
  const labelLayer = createLabelLayer(
    document.querySelector<HTMLElement>('#app')!, stationGroup, model);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(60, -18, 0);
  controls.enableDamping = true;
  controls.screenSpacePanning = false; // 平移沿地平面（前後左右——地圖慣例）
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
  const rig = new CameraRig(camera, controls);
  // 開場：從初始視角滑入、框住整棟爆炸後的建築
  const framePts: THREE.Vector3[] = [];
  for (const meta of model.station.floors) {
    const floor = model.floors.get(meta.id);
    if (!floor) continue;
    const y = meta.elevation + floorOffsetY(model, meta.id, 1);
    for (const p of floor.slab.outline) framePts.push(toWorld(p, y));
  }
  const overviewGoal = () => frameGoal(framePts, camera.aspect);

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
  let markerTween: Tween | null = null;
  let floorSwap: FloorSwap | null = null;
  let lastNavFloor: string | null = null;

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
    renderer.shadowMap.needsUpdate = true; // 樓層/connectors 位移＝唯一會動到影子的來源
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
    markerTween = null;
    if (floorSwap) {
      for (const id of [floorSwap.fromFloor, floorSwap.toFloor]) {
        const g = stationGroup.getObjectByName(id);
        if (g) applyFloorFade(g, null);
      }
      floorSwap = null;
    }
    lastNavFloor = null;
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
    setShellVisible(stationGroup, m !== 'nav'); // 效能：nav 隱外殼（dim 後不可見卻整面渲染）
    const wantShadow = m !== 'nav'; // 效能：低視角 nav 影子存在感極低、PCFSoft 採樣昂貴
    if (renderer.shadowMap.enabled !== wantShadow) {
      renderer.shadowMap.enabled = wantShadow;
      if (wantShadow) renderer.shadowMap.needsUpdate = true;
      scene.traverse((o) => {
        const mats = (o as THREE.Mesh).material;
        for (const mt of Array.isArray(mats) ? mats : mats ? [mats] : [])
          (mt as THREE.Material).needsUpdate = true; // shadow define 變更需重編（首次後有 program cache）
      });
    }
    ui.setMode(m);
    setExplode(MODE_EXPLODE[m]);
    if (m === 'overview') {
      clearRoute();
      setFloorEmphasis(stationGroup, null);
      rig.goal = overviewGoal(); // H-3：結束導航/取消預覽一律回全覽框景（boot 同路徑）
    }
    if (m === 'preview') {
      // 路線樓層保亮、其餘調暗——上層樓板不再遮住跨樓層路線（M-8）
      setFloorEmphasis(stationGroup, routeEdges ? routeFloors(graph, routeEdges) : null);
      rig.goal = frameGoal(routePoints(MODE_EXPLODE[m]), camera.aspect); // 以目標爆炸係數框路徑
    }
    if (m === 'nav') chaseAuto = true;
  }

  /** 抵達後相機後拉：框住最後兩節點展示終點周邊（P-6）。 */
  function arriveGoal(): void {
    if (!followState) return;
    const pts = followState.nodeIds.slice(-2).map((id) => nodeWorld(id));
    rig.goal = frameGoal(pts, camera.aspect);
  }

  function refreshNav(): void {
    if (!followState || !routeEdges || !marker) return;
    marker.position.copy(nodeWorld(currentNodeId(followState)));
    const cur = graph.nodes.get(currentNodeId(followState))!;
    setFloorEmphasis(stationGroup, cur.floor); // 半透明看見上下樓層（風格關卡回饋 1）
    if (lastNavFloor !== null && lastNavFloor !== cur.floor) {
      if (floorSwap) { // 前一場未完先收尾，避免殘留錯誤透明度
        for (const id of [floorSwap.fromFloor, floorSwap.toFloor]) {
          const g = stationGroup.getObjectByName(id);
          if (g) applyFloorFade(g, null);
        }
        setFloorEmphasis(stationGroup, cur.floor); // 舊快照還原後重套，連續換層不覆寫新 dim
      }
      floorSwap = { fromFloor: lastNavFloor, toFloor: cur.floor, t0: performance.now() };
    }
    lastNavFloor = cur.floor;
    const vEdge = verticalStep(routeEdges, followState);
    ui.setTransition(vEdge ? transitionLabel(model, graph, vEdge) : null);
    const remain = remainingEdges(routeEdges, followState);
    const progress = `進度 ${followState.index + 1}/${followState.nodeIds.length}`;
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
      if (!followState || !marker) return;
      if (markerTween) { marker.position.copy(markerTween.to); markerTween = null; } // 連按收斂到節點，不切角
      const fromPos = marker.position.clone();
      followState = advance(followState);
      chaseAuto = true;
      refreshNav();
      markerTween = makeTween(fromPos, marker.position.clone(), performance.now());
      marker.position.copy(fromPos);
    },
    onBack: () => {
      if (followState) { markerTween = null; followState = back(followState); refreshNav(); }
    },
    onRecenter: () => {
      chaseAuto = true;
      if (followState) refreshNav();
    },
    onExitNav: () => setMode('overview'),
    onFloorFocus: (id) => setFloorEmphasis(stationGroup, id),
  });

  // 使用者拖曳＝接管鏡頭（任何模式）；nav 中另暫停自動跟隨
  renderer.domElement.addEventListener('pointerdown', () => {
    rig.cancel();
    if (mode === 'nav') chaseAuto = false;
  });

  setMode('overview'); // boot：實高 → 爆炸圖展開動畫

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    labelLayer.resize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop(() => {
    if (explodeAnim) {
      const t = Math.min(1, (performance.now() - explodeAnim.t0) / EXPLODE_MS);
      explodeFactor = explodeAnim.from + (explodeAnim.to - explodeAnim.from) * easeInOutCubic(t);
      refreshScene();
      if (t >= 1) explodeAnim = null;
    }
    if (markerTween && marker) {
      const { pos, done } = tweenAt(markerTween, performance.now());
      marker.position.copy(pos);
      if (done) {
        markerTween = null;
        if (mode === 'nav' && followState && atEnd(followState)) arriveGoal(); // P-6：滑行到站才後拉
      }
    }
    if (floorSwap) {
      const { fromFactor, toFactor, done } = swapFactors(floorSwap, performance.now(), THEME.emphasis.dim);
      const fromG = stationGroup.getObjectByName(floorSwap.fromFloor);
      const toG = stationGroup.getObjectByName(floorSwap.toFloor);
      if (fromG) applyFloorFade(fromG, done ? null : fromFactor);
      if (toG) applyFloorFade(toG, done ? null : toFactor);
      if (done) floorSwap = null;
    }
    tickRouteArrows(performance.now());
    if (mode === 'nav' && followState && marker && chaseAuto && routeEdges) {
      const nextId = followState.nodeIds[Math.min(followState.index + 1, followState.nodeIds.length - 1)];
      const aim = chaseAim({
        tween: markerTween,
        atEnd: atEnd(followState),
        vertical: verticalStep(routeEdges, followState) !== null,
        nextPos: nodeWorld(nextId),
      });
      if (aim) rig.goal = chaseGoal(marker.position, aim);
    }
    rig.tick();
    controls.update();
    labelLayer.update(camera, mode, explodeFactor);
    renderer.render(scene, camera);
    labelLayer.render(scene, camera);
    fpsTick?.();
  });
}

boot().catch((e) => {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
});
