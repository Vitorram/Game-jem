import { ACESFilmicToneMapping, BoxGeometry, Color, ConeGeometry, CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, MathUtils, Mesh, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GRID_CONFIG } from '../config';
import { GridMap } from '../map/GridMap';
import { GridMapView } from '../map/GridMapView';
import { ORLA_MAP } from '../map/orlaMap';
import { Player } from '../entities/Player';
import { VehicleModels, type VehicleKind } from '../traffic/VehicleModels';

export type IntroShot = 'city' | 'incident' | 'response' | 'team';
export type IntroPlayback = { shot: IntroShot; reducedMotion: boolean; paused: boolean };

/** A private film set: it reuses game art without touching session or traffic state. */
export function createIntroWorld(host: HTMLElement, readPlayback: () => IntroPlayback) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  host.prepend(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color('#a0c4c1');
  scene.fog = new Fog('#a0c4c1', 45, 95);
  scene.add(new HemisphereLight('#fff0d0', '#728e8a', 2.1));
  const sun = new DirectionalLight('#ffe2bc', 3);
  sun.position.set(-9, 20, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: .5, far: 65 });
  sun.shadow.normalBias = .04;
  scene.add(sun);
  const map = new GridMap(ORLA_MAP, GRID_CONFIG.tileSize, GRID_CONFIG.playerRadius);
  const mapView = new GridMapView(map);
  scene.add(mapView.group);
  const models = new VehicleModels();
  const roadZ = map.cellCenter(0, map.rows - 1).z - map.tileSize * 1.5;
  const incidentZ = roadZ + 1.2;
  const palette = ['#5eaba0', '#d7aa54', '#d67462', '#829ab2', '#dcd8c9'];
  const createCar = (kind: VehicleKind, paint: string, x: number, z: number, direction = 1) => {
    const model = models.create(kind, paint);
    model.group.scale.setScalar(.72);
    model.group.rotation.y = direction * Math.PI / 2;
    model.group.position.set(x, .03, z);
    scene.add(model.group);
    return model;
  };
  const front = createCar('sedan', '#e3b85f', 5.1, incidentZ);
  const back = createCar('hatch', '#c85d51', 3.4, incidentZ);
  front.group.rotation.y += .12;
  back.group.rotation.y -= .18;
  const passing = Array.from({ length: 8 }, (_, i) => ({
    model: createCar((['hatch', 'suv', 'sedan', 'motorcycle'] as const)[i % 4], palette[i % palette.length], i * 6 - 22, roadZ + (i % 2 ? 3.5 : 2.7), -1),
    speed: 1.9 + (i % 3) * .2,
  }));
  const queue = [-.2, -3, -5.8].map((x, i) => createCar('hatch', palette[i], x, incidentZ));
  const coneGeometry = new ConeGeometry(.16, .48, 16);
  const stripeGeometry = new CylinderGeometry(.065, .10, .10, 16);
  const baseGeometry = new BoxGeometry(.4, .065, .4);
  const orange = new MeshStandardMaterial({ color: '#f4873e', roughness: .75 });
  const white = new MeshStandardMaterial({ color: '#fff4da', roughness: .75 });
  const black = new MeshStandardMaterial({ color: '#263b3d' });
  const cones = Array.from({ length: 8 }, (_, i) => {
    const cone = new Group();
    const body = new Mesh(coneGeometry, orange); body.position.y = .28; body.castShadow = true;
    const stripe = new Mesh(stripeGeometry, white); stripe.position.y = .32;
    const base = new Mesh(baseGeometry, black); base.position.y = .04;
    cone.add(body, stripe, base);
    cone.position.set(1.7 + (i % 4) * 1.7, .04, incidentZ + (i < 4 ? -.57 : .57));
    cone.visible = false;
    scene.add(cone);
    return cone;
  });
  const crew = [new Player(1), new Player(2), new Player(3)];
  crew.forEach((player, i) => { player.setPosition(2.3 + i * 1.5, roadZ - 1.1); player.mesh.visible = false; scene.add(player.mesh); });

  const camera = new PerspectiveCamera(42, 1, .1, 150);
  camera.position.set(-15, 22, 29);
  const target = new Vector3(2, 0, 3);
  const wantedPosition = new Vector3(), wantedTarget = new Vector3(), projected = new Vector3();
  const resize = () => { const w = host.clientWidth || 1, h = host.clientHeight || 1; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  let lastTime = 0, shotTime = 0;
  let lastShot: IntroShot = 'city';
  let disposed = false;
  renderer.setAnimationLoop((now: number) => {
    if (disposed) return;
    const { shot, paused, reducedMotion } = readPlayback();
    const dt = lastTime ? Math.min((now - lastTime) / 1000, .05) : 0;
    lastTime = now;
    if (paused || document.hidden) return;
    if (shot !== lastShot) { lastShot = shot; shotTime = 0; }
    shotTime += dt;
    const motion = reducedMotion ? 0 : Math.min(shotTime / 12, 1);
    if (shot === 'city') {
      wantedPosition.set(-14 + motion * 9, 22 - motion * 4, 28);
      wantedTarget.set(2, 0, 3.5);
    } else if (shot === 'incident') {
      wantedPosition.set(9 - motion * 2, 10 - motion, 19);
      wantedTarget.set(4.2, .1, incidentZ);
    } else if (shot === 'response') {
      wantedPosition.set(-2 + motion * 3, 8, 16);
      wantedTarget.set(4.2, .3, incidentZ - .7);
    } else {
      wantedPosition.set(4.3, 3.6, 13.7);
      wantedTarget.set(3.8, .7, roadZ - .7);
    }
    if (camera.aspect < 1) {
      const zoomOut = Math.min(1.7, 1 / camera.aspect);
      wantedPosition.sub(wantedTarget).multiplyScalar(zoomOut).add(wantedTarget);
    }
    const smoothing = reducedMotion ? 1 : 1 - Math.exp(-dt * 1.8);
    camera.position.lerp(wantedPosition, smoothing); target.lerp(wantedTarget, smoothing); camera.lookAt(target);
    if (!reducedMotion) mapView.update(dt);
    passing.forEach(({ model, speed }) => {
      if (!reducedMotion) { model.group.position.x -= dt * speed; if (model.group.position.x < -25) model.group.position.x = 25; }
    });
    const detected = shot !== 'city';
    back.group.position.x = detected ? 3.4 : 1.4 + Math.min(shotTime / 5, 1) * 2;
    queue.forEach((model, i) => { model.group.visible = detected; model.group.position.x = -.2 - i * 2.8; });
    const responding = shot === 'response' || shot === 'team';
    cones.forEach((cone, i) => {
      const grow = reducedMotion || shot === 'team' ? 1 : MathUtils.clamp((shotTime - .25 * i) * 2.8, 0, 1);
      cone.visible = responding && grow > 0;
      cone.scale.setScalar(Math.max(.001, 1 - Math.pow(1 - grow, 3)));
    });
    crew.forEach((player, i) => {
      player.mesh.visible = responding;
      const progress = reducedMotion || shot === 'team' ? 1 : MathUtils.clamp(shotTime / 3.3, 0, 1);
      const oldZ = player.mesh.position.z;
      player.mesh.position.z = roadZ - 1.7 + progress * .9;
      player.mesh.rotation.y = 0;
      player.animateWalking(dt, responding && shot === 'response' ? Math.abs(player.mesh.position.z - oldZ) : 0);
      if (i === 2) player.mesh.rotation.y = -.2;
    });
    projected.set(4.2, .6, incidentZ).project(camera);
    host.style.setProperty('--incident-x', `${(projected.x * .5 + .5) * 100}%`);
    host.style.setProperty('--incident-y', `${(-projected.y * .5 + .5) * 100}%`);
    renderer.render(scene, camera);
  });
  return () => {
    disposed = true; renderer.setAnimationLoop(null); observer.disconnect();
    crew.forEach(player => player.dispose()); models.dispose(); mapView.dispose();
    coneGeometry.dispose(); stripeGeometry.dispose(); baseGeometry.dispose(); orange.dispose(); white.dispose(); black.dispose(); sun.shadow.map?.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); scene.clear();
  };
}
