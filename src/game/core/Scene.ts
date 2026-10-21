import type { Scene as ThreeScene } from 'three';

/** Cada cena é dona dos seus recursos; renderer e câmera pertencem ao Game. */
export interface Scene {
  readonly scene: ThreeScene;
  update(dt: number): void;
  dispose(): void;
}
