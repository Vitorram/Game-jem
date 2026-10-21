import {
  Scene, Color, HemisphereLight, DirectionalLight, Mesh,
  PlaneGeometry, MeshStandardMaterial, MathUtils,
} from 'three';
import type { PerspectiveCamera } from 'three';
import type { Scene as GameScene } from '../core/Scene';
import type { Input } from '../core/Input';
import { Player, type PlayerId } from '../entities/Player';
import { GAME_CONFIG, ORLA_CONFIG } from '../config';

/** Base da Orla: chão e personagens, ainda sem mapa ou habilidades. */
export class Fase1OrlaScene implements GameScene {
  readonly scene = new Scene();
  readonly players = [new Player(1), new Player(2), new Player(3)];
  private selectedId: PlayerId = 1;
  private readonly input: Pick<Input, 'getAxis'>;
  private readonly idle = { x: 0, z: 0 };
  private readonly ground: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly sun: DirectionalLight;
  private disposed = false;

  get player() { return this.players[this.selectedId - 1]; }

  constructor(input: Pick<Input, 'getAxis'> = { getAxis: () => ({ x: 0, z: 0 }) }) {
    this.input = input;
    const { ground, hemisphere, sun } = ORLA_CONFIG;
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
    this.ground = new Mesh(
      new PlaneGeometry(ground.width, ground.depth),
      new MeshStandardMaterial({ color: ground.color, roughness: ground.roughness }),
    );
    this.ground.name = 'orla-ground';
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.players.forEach((player, index) => {
      player.setPosition((index - 1) * ORLA_CONFIG.playerSpacing, 0);
      this.scene.add(player.mesh);
    });
  }

  selectPlayer(id: PlayerId): void {
    if (!this.disposed) this.selectedId = id;
  }

  /** Enquadra os oito cantos do volume da fase; não segue a personagem. */
  configureCamera(camera: PerspectiveCamera, aspect: number): void {
    if (this.disposed) return;
    const config = ORLA_CONFIG.camera;
    const angle = MathUtils.degToRad(config.elevationDegrees);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    const tan = Math.tan(MathUtils.degToRad(config.fov) / 2);
    const halfWidth = ORLA_CONFIG.ground.width / 2;
    const halfDepth = ORLA_CONFIG.ground.depth / 2;
    camera.aspect = Math.max(aspect, 0.01);
    camera.fov = config.fov;
    camera.near = config.near;
    let distance = 0;
    for (const x of [-halfWidth, halfWidth]) {
      for (const y of [0, config.contentHeight]) {
        for (const z of [-halfDepth, halfDepth]) {
          const depthOffset = y * sin + z * cos;
          const vertical = Math.abs(y * cos - z * sin) / tan;
          const horizontal = Math.abs(x) / (tan * camera.aspect);
          distance = Math.max(distance, depthOffset + Math.max(vertical, horizontal) * config.framingPadding);
        }
      }
    }
    camera.far = Math.max(config.minFar, distance + Math.hypot(halfWidth, halfDepth, config.contentHeight) * 2);
    camera.up.set(0, 1, 0);
    camera.position.set(0, distance * sin, distance * cos);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
  }

  update(dt: number): void {
    if (this.disposed) return;
    const axis = this.input.getAxis();
    const limitX = Math.min(GAME_CONFIG.worldLimit, ORLA_CONFIG.ground.width / 2 - ORLA_CONFIG.ground.edgeMargin);
    const limitZ = Math.min(GAME_CONFIG.worldLimit, ORLA_CONFIG.ground.depth / 2 - ORLA_CONFIG.ground.edgeMargin);
    for (const player of this.players) {
      player.update(dt, player === this.player ? axis : this.idle);
      player.mesh.position.x = MathUtils.clamp(player.mesh.position.x, -limitX, limitX);
      player.mesh.position.z = MathUtils.clamp(player.mesh.position.z, -limitZ, limitZ);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.players.forEach(player => player.dispose());
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.sun.shadow.dispose();
    this.scene.clear();
    this.scene.background = null;
  }
}
