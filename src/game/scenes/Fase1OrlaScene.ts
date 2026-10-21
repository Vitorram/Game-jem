import {
  Scene, Color, HemisphereLight, DirectionalLight, MathUtils, Vector3,
} from 'three';
import type { PerspectiveCamera } from 'three';
import type { Scene as GameScene } from '../core/Scene';
import type { Input } from '../core/Input';
import { Player, type PlayerId } from '../entities/Player';
import { GRID_CONFIG, ORLA_CONFIG, ORLA_CAMERA } from '../config';

import { GridMap } from '../map/GridMap';
import { GridMapView } from '../map/GridMapView';
import { ORLA_MAP } from '../map/orlaMap';

/** Cena da Orla; recursos próprios liberados em dispose. */
export class Fase1OrlaScene implements GameScene {
  readonly scene = new Scene();
  readonly players = [new Player(1), new Player(2), new Player(3)];
  private selectedId: PlayerId = 1;
  private readonly input: Pick<Input, 'getAxis'>;
  private readonly idle = { x: 0, z: 0 };
  readonly map = new GridMap(ORLA_MAP, GRID_CONFIG.tileSize, GRID_CONFIG.playerRadius);
  private readonly mapView = new GridMapView(this.map);
  private readonly resolveMovement = this.map.resolveMovement.bind(this.map);
  private readonly sun: DirectionalLight;
  private disposed = false;
  private readonly cameraTarget = new Vector3();
  private cameraHeight: number = ORLA_CAMERA.closeHeight;

  get player() { return this.players[this.selectedId - 1]; }

  constructor(input: Pick<Input, 'getAxis'> = { getAxis: () => ({ x: 0, z: 0 }) }) {
    this.input = input;
    const { hemisphere, sun } = ORLA_CONFIG;
    this.scene.background = new Color(ORLA_CONFIG.background);
    this.scene.add(new HemisphereLight(hemisphere.skyColor, hemisphere.groundColor, hemisphere.intensity));
    this.sun = new DirectionalLight(sun.color, sun.intensity);
    this.sun.position.set(sun.position.x, sun.position.y, sun.position.z);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(sun.shadowMapSize, sun.shadowMapSize);
    Object.assign(this.sun.shadow.camera, {
      left: -sun.shadowExtent, right: sun.shadowExtent,
      top: sun.shadowExtent, bottom: -sun.shadowExtent,
      near: sun.shadowNear, far: sun.shadowFar,
    });
    this.sun.shadow.bias = sun.shadowBias;
    this.sun.shadow.normalBias = sun.shadowNormalBias;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.mapView.group);
    this.players.forEach((player, index) => {
      const spawn = this.map.spawns[index];
      player.setPosition(spawn.x, spawn.z);
      this.scene.add(player.mesh);
    });
  }

  selectPlayer(id: PlayerId): void {
    if (!this.disposed) this.selectedId = id;
  }

  configureCamera(camera: PerspectiveCamera, aspect: number, closeView = true): void {
    if (this.disposed) return;
    camera.aspect = Math.max(aspect, ORLA_CAMERA.minAspect);
    camera.fov = ORLA_CAMERA.fov;
    camera.near = ORLA_CAMERA.near;
    camera.far = ORLA_CAMERA.far;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    this.updateCamera(camera, 0, closeView, true);
  }

  /** Limita a pegada inteira do frustum no chão, inclusive após resize e zoom. */
  updateCamera(camera: PerspectiveCamera, dt: number, closeView: boolean, snap = false): void {
    if (this.disposed) return;
    const config = ORLA_CAMERA;
    const angle = Math.atan2(1, config.tilt);
    const sin = Math.sin(angle), cos = Math.cos(angle);
    const tan = Math.tan(MathUtils.degToRad(config.fov) / 2);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const denominator = sin - y * tan * cos;
      const px = x * tan * camera.aspect / denominator;
      const pz = config.tilt + (-cos - y * tan * sin) / denominator;
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minZ = Math.min(minZ, pz); maxZ = Math.max(maxZ, pz);
    }
    const halfX = this.map.width / 2 - config.groundPadding;
    const halfZ = this.map.depth / 2 - config.groundPadding;
    const maxHeight = Math.min(2 * halfX / (maxX - minX), 2 * halfZ / (maxZ - minZ));
    const height = Math.min(maxHeight, (closeView ? config.closeHeight : config.wideHeight) * Math.max(1, config.portraitAspect / camera.aspect));
    const blend = snap ? 1 : 1 - Math.exp(-config.followSmoothing * Math.max(0, dt));
    this.cameraHeight = Math.min(maxHeight, MathUtils.lerp(this.cameraHeight, height, blend));
    this.cameraTarget.lerp(this.player.mesh.position, blend);
    const h = this.cameraHeight;
    this.cameraTarget.x = MathUtils.clamp(this.cameraTarget.x, -halfX - minX * h, halfX - maxX * h);
    this.cameraTarget.z = MathUtils.clamp(this.cameraTarget.z, -halfZ - minZ * h, halfZ - maxZ * h);
    this.cameraTarget.y = 0;
    camera.position.set(this.cameraTarget.x, h, this.cameraTarget.z + h * config.tilt);
    camera.lookAt(this.cameraTarget);
    camera.updateMatrixWorld(true);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const axis = this.input.getAxis();
    for (const player of this.players) {
      player.update(dt, player === this.player ? axis : this.idle, this.resolveMovement);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.players.forEach(player => player.dispose());
    this.mapView.dispose();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.scene.background = null;
  }
}
