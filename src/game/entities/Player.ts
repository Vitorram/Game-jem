import { CapsuleGeometry, Mesh, MeshStandardMaterial, MathUtils } from 'three';
import { GAME_CONFIG } from '../config';

export class Player {
  readonly mesh = new Mesh(
    new CapsuleGeometry(0.35, 0.55, 4, 12),
    new MeshStandardMaterial({ color: '#c5f77b', roughness: 0.4 }),
  );

  constructor() {
    this.mesh.position.y = 0.65;
    this.mesh.castShadow = true;
  }

  update(delta: number, axis: { x: number; z: number }) {
    const distance = GAME_CONFIG.playerSpeed * delta;
    const limit = GAME_CONFIG.worldLimit;
    this.mesh.position.x = MathUtils.clamp(this.mesh.position.x + axis.x * distance, -limit, limit);
    this.mesh.position.z = MathUtils.clamp(this.mesh.position.z + axis.z * distance, -limit, limit);
  }

  setPosition(x: number, z: number) {
    this.mesh.position.set(x, this.mesh.position.y, z);
  }
}
