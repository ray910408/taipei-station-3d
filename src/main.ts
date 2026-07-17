import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { assembleModel, LoaderError } from './loader';
import { buildStationGroup } from './builder';
import { buildGraph, findPath, routeSteps } from './nav';
import { buildRouteObject } from './path';
import { setupUI } from './ui';
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

try {
  const model = assembleModel(stationDoc, floorDocsByFile, connectorsDoc);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#14171c');
  scene.add(new THREE.HemisphereLight('#cfd8e3', '#2a2f38', 1.1));
  const dir = new THREE.DirectionalLight('#ffffff', 0.9);
  dir.position.set(150, 200, 120);
  scene.add(dir);
  scene.add(new THREE.GridHelper(500, 50, '#2c333d', '#232830'));

  const stationGroup = buildStationGroup(model);
  scene.add(stationGroup);

  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
  camera.position.set(220, 140, 260);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  document.querySelector('#app')!.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(60, -18, 0);
  controls.enableDamping = true;

  const graph = buildGraph(model);
  let routeObj: THREE.Object3D | null = null;
  const clearRoute = () => { if (routeObj) { scene.remove(routeObj); routeObj = null; } };

  const ui = setupUI({
    model, stationGroup,
    onClear: clearRoute,
    onRoute: (accessibleOnly) => {
      clearRoute();
      const demo = model.station.demo!;
      const path = findPath(graph, demo.start, demo.end, { accessibleOnly });
      if (!path) { ui.setSteps(['找不到路徑']); return; }
      routeObj = buildRouteObject(graph, path);
      scene.add(routeObj);
      ui.setSteps(routeSteps(model, graph, path));
    },
  });

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
} catch (e) {
  if (e instanceof LoaderError) showOverlay(`${e.message}\n\n${e.details.join('\n')}`);
  else showOverlay(String(e));
  throw e;
}
