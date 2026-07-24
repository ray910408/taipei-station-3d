import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup, buildConnectorsGroup, toWorld, applyShadowFlags } from './builder';
import { THEME, applyUITheme } from './theme';
import {
  buildGraph, findPath, routeSteps, routeStats, formatStats,
  listLandmarks, sameEndpointMessage, routeFloors,
} from './nav';
import type { GraphEdge } from './nav';
import { buildRouteObject, tickRouteArrows, makePin } from './path';
import { applyFloorFade, setShellVisible } from './navview';
import { attachPoiIcons } from './icons';
import { attachFloorTextures } from './texture';
import { createLabelLayer } from './labels';
import { attachFpsOverlay } from './fps';
import { attachCompass } from './compass';
import { resolveFloor, snapToNode, toLandmark } from './selection';
import { PDR_DEFAULTS, initStepState, stepSample, type PdrParams, type StepState } from './pdr';
import { motionSupported, requestMotionPermission, startMotion } from './pdr-sensor';
import { createSpeaker } from './speech';
import { setupUI } from './ui';
import { MODE_EXPLODE, type Mode } from './mode';
import { floorOffsetY, applyExplode, easeInOutCubic, disposeDeep } from './explode';
import { CameraRig, frameGoal } from './camera';
import { buildPositionMarker, setFloorEmphasis } from './follow';
import { startNavSession, type EventOutcome, type NavSession } from './nav-session';
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

const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;
const EXPLODE_MS = REDUCED_MOTION ? 0 : 800; // ms=0 → t 立即為 1，直接到位

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
  // 環境光：RoomEnvironment PMREM——表面對光有方向性響應，去蠟質均勻感（去塑膠 T2）
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = THEME.render.envIntensity;
  pmrem.dispose();

  // 地磚微紋理：runtime 附掛（json/glb 兩軌通用；去塑膠 T4）
  attachFloorTextures(stationGroup, Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  // AO 管線：?ao=off 走原始路徑（降級開關，比照 ?geom=glb 慣例）
  const aoOff = new URLSearchParams(location.search).get('ao') === 'off';
  let composer: EffectComposer | null = null;
  if (!aoOff) {
    composer = new EffectComposer(renderer);
    const n8ao = new N8AOPass(scene, camera, innerWidth, innerHeight);
    const A = THEME.ao;
    n8ao.configuration.aoRadius = A.radius;
    n8ao.configuration.distanceFalloff = A.distanceFalloff;
    n8ao.configuration.intensity = A.intensity;
    n8ao.configuration.color = new THREE.Color(A.color);
    n8ao.configuration.halfRes = A.halfRes;
    n8ao.configuration.gammaCorrection = false; // 輸出色彩由 OutputPass 統一
    composer.addPass(n8ao);
    composer.addPass(new OutputPass());
  }
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
  const rig = new CameraRig(camera, controls, REDUCED_MOTION ? 1 : 0.08);
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
  let marker: THREE.Group | null = null;
  let routeObj: THREE.Object3D | null = null;
  let session: NavSession | null = null; // 導航會話：一次導航＝一個實例，退出即銷毀
  let fadedFloors: string[] = []; // 會話 crossfade 作用中的樓層——掉出 directive 清單即還原
  let pickNodeId: string | null = null; // 3D 選點目前 snap 的節點
  // PDR（Phase 4）：sim 假步與沿邊推進狀態；感測器接線在 T6
  const pdrQuery = new URLSearchParams(location.search);
  const pdrSim = pdrQuery.get('pdr') === 'sim';
  const storedStep = Number(localStorage.getItem('pdr-step-length'));
  const pdrParams: PdrParams = {
    ...PDR_DEFAULTS,
    peakThreshold: Number(pdrQuery.get('pdrPeak')) || PDR_DEFAULTS.peakThreshold,
    stepLength: Number(pdrQuery.get('pdrStep')) || storedStep || PDR_DEFAULTS.stepLength,
    minStepMs: Number(pdrQuery.get('pdrMinMs')) || PDR_DEFAULTS.minStepMs,
  };
  let stopMotion: (() => void) | null = null;
  let stepState: StepState = initStepState();
  const speaker = createSpeaker();

  // 常駐指南針（所有模式可見）；點擊＝使用者接管相機，nav 中暫停自動跟隨（「回正」可恢復）
  const compass = attachCompass(camera, controls, () => {
    rig.cancel();
    session?.handle({ type: 'userCameraGrab' }, performance.now());
  });

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
    if (pickNodeId) placePickPin();
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

  /** 銷毀即清理（設計裁決 2）：會話態隨實例消失，這裡只收 THREE/DOM/sensor 殘留。 */
  function destroySession(): void {
    if (!session) return;
    session = null; // 先斷參照：onPdrToggle 的晚到授權據此判廢
    if (marker) scene.remove(marker); // marker 建一次重用（Phase 3 慣例）
    for (const f of fadedFloors) {
      const g = stationGroup.getObjectByName(f);
      if (g) applyFloorFade(g, null);
    }
    fadedFloors = [];
    ui.setTransition(null);
    ui.showArrive(false);
    stopMotion?.();
    stopMotion = null;
    ui.setPdrToggle(false);
    ui.setPdrHint(false);
    speaker.stop(); // 殘句不跨出導航（終審 F4）
  }

  /** 冪等 crossfade 套用：掉出清單的樓層還原（swap 完成/會話收尾皆循此徑）。 */
  function applyFloorFades(fades: { floor: string; factor: number }[]): void {
    for (const f of fadedFloors) {
      if (!fades.some((x) => x.floor === f)) {
        const g = stationGroup.getObjectByName(f);
        if (g) applyFloorFade(g, null);
      }
    }
    for (const { floor, factor } of fades) {
      const g = stationGroup.getObjectByName(floor);
      if (g) applyFloorFade(g, factor);
    }
    fadedFloors = fades.map((x) => x.floor);
  }

  /** 一次性效果套用。順序固定：fadeRestore → emphasis → nav 文案 → pdr → 語音。 */
  function applyOutcome(o: EventOutcome): void {
    if (o.fadeRestore) {
      for (const f of o.fadeRestore) {
        const g = stationGroup.getObjectByName(f);
        if (g) applyFloorFade(g, null);
      }
      fadedFloors = fadedFloors.filter((f) => !o.fadeRestore!.includes(f));
    }
    if (o.emphasisFloor !== undefined) setFloorEmphasis(stationGroup, o.emphasisFloor);
    if (o.nav) {
      ui.setNavInfo(o.nav.next, o.nav.remain, o.nav.progress);
      ui.setTransition(o.nav.transition);
      ui.showArrive(o.nav.arrived);
    }
    if (o.pdrToggle === true) {
      ui.setPdrToggle(true);
      stepState = initStepState();
      stopMotion?.();
      stopMotion = startMotion((t, mag) => {
        const r = stepSample(stepState, t, mag, pdrParams);
        stepState = r.state;
        if (r.step && session) applyOutcome(session.handle({ type: 'stepDetected' }, performance.now()));
      });
    } else if (o.pdrToggle === false) {
      stopMotion?.();
      stopMotion = null;
      ui.setPdrToggle(false);
    }
    if (o.pdrHint !== undefined) ui.setPdrHint(o.pdrHint);
    if (o.speech) speaker.speak(o.speech);
  }

  function clearRoute(): void {
    destroySession();
    routeEdges = null;
    refreshRoute();
  }

  function setMode(m: Mode): void {
    mode = m;
    clearPick(); // 模式切換一律收 pin 與小卡
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
    onRouteInvalid: () => { routeEdges = null; refreshRoute(); setFloorEmphasis(stationGroup, null); },
    onStartNav: () => {
      if (!routeEdges?.length) return;
      session = startNavSession({
        model, graph, edges: routeEdges, nodeWorld,
        aspect: () => camera.aspect,
        stepLength: () => pdrParams.stepLength,
        reducedMotion: REDUCED_MOTION, pdrSim,
      }, performance.now());
      if (!marker) marker = buildPositionMarker();
      scene.add(marker);
      setMode('nav');
      applyOutcome(session.initial);
    },
    onAdvance: () => {
      if (session) applyOutcome(session.handle({ type: 'advanceRequested' }, performance.now()));
    },
    onBack: () => {
      if (session) applyOutcome(session.handle({ type: 'backRequested' }, performance.now()));
    },
    onRecenter: () => {
      if (session) applyOutcome(session.handle({ type: 'recenterRequested' }, performance.now()));
    },
    onExitNav: () => setMode('overview'),
    onFloorFocus: (id) => setFloorEmphasis(stationGroup, id),
    onPickDismiss: () => clearPick(),
    pdrAvailable: !pdrSim && motionSupported(), // sim 模式用假步、真感測 toggle 停用
    stepLength: pdrParams.stepLength,
    onStepLength: (len) => {
      pdrParams.stepLength = len;
      localStorage.setItem('pdr-step-length', String(len));
    },
    onPdrToggle: async (on) => {
      if (!session) return false;
      const s = session; // 晚到授權雙防線之一：會話身分（票號比對在會話內）
      const o1 = s.handle({ type: 'pdrToggleRequested', on }, performance.now());
      applyOutcome(o1);
      if (!o1.requestPermission) return o1.pdrToggle === true;
      stopMotion?.();
      stopMotion = null;
      const granted = await requestMotionPermission();
      if (s !== session) return false; // 等待期間會話已銷毀/重建——不啟動
      const o2 = s.handle(
        { type: 'pdrPermissionResult', granted, ticket: o1.requestPermission.ticket },
        performance.now());
      applyOutcome(o2);
      return o2.pdrToggle === true;
    },
    onVoiceToggle: (on) => {
      speaker.setEnabled(on);
      if (on) speaker.speak('語音導航已開啟'); // 手勢內首播＝iOS unlock
    },
  });

  // 3D 選點（Phase 4）：tap（位移 < 閾值、單指）→ raycast slab → snap 最近節點 → pin＋確認小卡
  const slabs: THREE.Mesh[] = [];
  stationGroup.traverse((o) => {
    if ((o as THREE.Mesh).userData?.kind === 'slab') slabs.push(o as THREE.Mesh);
  });
  const raycaster = new THREE.Raycaster();
  const pickPin = makePin(THEME.selection.pin);
  function placePickPin(): void {
    pickPin.position.copy(nodeWorld(pickNodeId!));
    pickPin.position.y += 1.2; // 與 route pin 同高（浮在樓面上方）
  }
  function clearPick(): void {
    scene.remove(pickPin);
    pickNodeId = null;
    ui.showPickCard(null);
  }
  let tapStart: { x: number; y: number; id: number } | null = null;
  let tapVoid = false;
  let tapMaxDist = 0; // 途中最大位移——拖遠繞回原點不算 tap（終審人工項）
  // 使用者拖曳＝接管鏡頭（任何模式）；nav 中另暫停自動跟隨
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    rig.cancel();
    session?.handle({ type: 'userCameraGrab' }, performance.now());
    if (tapStart !== null) { tapVoid = true; return; } // 第二指（DOLLY_ROTATE）→ 本次點擊作廢
    tapStart = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    tapVoid = false;
    tapMaxDist = 0;
  });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if (tapStart && ev.pointerId === tapStart.id)
      tapMaxDist = Math.max(tapMaxDist, Math.hypot(ev.clientX - tapStart.x, ev.clientY - tapStart.y));
  });
  renderer.domElement.addEventListener('pointercancel', () => { tapVoid = true; tapStart = null; });
  renderer.domElement.addEventListener('pointerup', (ev) => {
    const start = tapStart;
    tapStart = null;
    if (tapVoid || !start || ev.pointerId !== start.id || mode === 'nav') return;
    if (ev.button !== 0) return; // 僅左鍵/觸控選點——右鍵旋轉原地放開不觸發（終審 F7）
    const dist = Math.max(tapMaxDist, Math.hypot(ev.clientX - start.x, ev.clientY - start.y));
    if (dist > THEME.selection.tapThresholdPx) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    ), camera);
    const hit = raycaster.intersectObjects(slabs, false)[0];
    const floorId = hit ? resolveFloor(hit.object) : null;
    // xy 免逆算爆炸位移：explode 只動 group.position.y，world x/z 不受影響
    const node = floorId ? snapToNode(graph, floorId, [hit.point.x, -hit.point.z]) : null;
    if (!node) { clearPick(); return; }
    pickNodeId = node.id;
    placePickPin();
    scene.add(pickPin);
    ui.showPickCard(toLandmark(model, node));
  });

  // ?pdr=sim：按 s 鍵＝一步假步伐——與真感測器共用 stepDetected 事件管線
  if (pdrSim) addEventListener('keydown', (ev) => {
    if (ev.key === 's' && session) {
      applyOutcome(session.handle({ type: 'stepDetected' }, performance.now()));
    }
  });

  setMode('overview'); // boot：實高 → 爆炸圖展開動畫

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer?.setSize(innerWidth, innerHeight);
    labelLayer.resize(innerWidth, innerHeight);
  });

  renderer.setAnimationLoop(() => {
    if (explodeAnim) {
      const t = Math.min(1, (performance.now() - explodeAnim.t0) / EXPLODE_MS);
      explodeFactor = explodeAnim.from + (explodeAnim.to - explodeAnim.from) * easeInOutCubic(t);
      refreshScene();
      if (t >= 1) explodeAnim = null;
    }
    tickRouteArrows(performance.now());
    if (session && marker) {
      const d = session.frame(performance.now());
      marker.position.copy(d.markerPos);
      applyFloorFades(d.floorFades);
      if (d.cameraGoal) rig.goal = d.cameraGoal;
    }
    rig.tick();
    controls.update();
    compass?.tick(); // controls.update 後：target/相機皆為當幀最終值
    labelLayer.update(camera, mode, explodeFactor);
    if (composer) composer.render();
    else renderer.render(scene, camera);
    labelLayer.render(scene, camera);
    fpsTick?.();
  });
}

boot().catch((e) => {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
});
