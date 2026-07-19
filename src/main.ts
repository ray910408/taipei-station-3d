import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup, toWorld } from './builder';
import { buildGraph, findPath, routeSteps, listLandmarks, sameEndpointMessage } from './nav';
import type { GraphEdge } from './nav';
import { buildRouteObject } from './path';
import { setupUI } from './ui';
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

async function boot(): Promise<void> {
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14171c');
  scene.add(new THREE.HemisphereLight('#cfd8e3', '#2a2f38', 1.1));
  const dir = new THREE.DirectionalLight('#ffffff', 0.9);
  dir.position.set(150, 200, 120);
  scene.add(dir);
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

  const modeDiv = document.querySelector<HTMLDivElement>('#geom-mode')!;
  modeDiv.innerHTML = geomMode === 'glb'
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

  const graph = buildGraph(model);
  let routeEdges: GraphEdge[] | null = null;
  let followState: FollowState | null = null;
  let marker: THREE.Group | null = null;

  const nodeWorld = (id: string): THREE.Vector3 => {
    const n = graph.nodes.get(id)!;
    return toWorld(n.xy, n.z);
  };

  function refreshFollow(): void {
    if (!followState || !routeEdges || !marker) return;
    marker.position.copy(nodeWorld(currentNodeId(followState)));
    setFloorEmphasis(stationGroup, graph.nodes.get(currentNodeId(followState))!.floor);
    const progress = `節點 ${followState.index + 1}/${followState.nodeIds.length}`;
    if (atEnd(followState)) {
      ui.setFollowInfo('已抵達目的地', progress);
      return;
    }
    const next = routeSteps(model, graph, remainingEdges(routeEdges, followState))[0] ?? '前往下一節點';
    ui.setFollowInfo(`下一步：${next}`, progress);
  }

  function exitFollow(): void {
    if (marker) scene.remove(marker); // marker 建一次重用，避免反覆進出累積 GPU 資源
    followState = null;
    setFloorEmphasis(stationGroup, null);
    ui.showFollow(false);
  }

  let routeObj: THREE.Object3D | null = null;
  const clearRoute = () => {
    exitFollow();
    routeEdges = null;
    if (routeObj) { scene.remove(routeObj); routeObj = null; }
  };

  const ui = setupUI({
    model, stationGroup,
    landmarks: listLandmarks(model),
    onClear: clearRoute,
    onStartFollow: () => {
      if (!routeEdges || routeEdges.length === 0) return;
      followState = startFollow(routeEdges);
      if (!marker) marker = buildPositionMarker();
      scene.add(marker);
      ui.showFollow(true);
      refreshFollow();
    },
    onAdvance: () => { if (followState) { followState = advance(followState); refreshFollow(); } },
    onBack: () => { if (followState) { followState = back(followState); refreshFollow(); } },
    onExitFollow: exitFollow,
    onRoute: (start, end, accessibleOnly) => {
      clearRoute();
      const sameMsg = sameEndpointMessage(start, end);
      if (sameMsg) {
        ui.setSteps([sameMsg]);
        ui.setFollowReady(false);
        return;
      }
      const path = findPath(graph, start, end, { accessibleOnly });
      if (!path) { ui.setSteps(['找不到路徑']); ui.setFollowReady(false); return; }
      routeEdges = path;
      routeObj = buildRouteObject(graph, path);
      scene.add(routeObj);
      ui.setSteps(routeSteps(model, graph, path));
      ui.setFollowReady(path.length > 0); // 起訖同點時 findPath 回空陣列，不可進入跟隨
    },
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => {
    if (followState && marker) controls.target.lerp(marker.position, 0.08);
    controls.update();
    renderer.render(scene, camera);
  });
}

boot().catch((e) => {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
});
