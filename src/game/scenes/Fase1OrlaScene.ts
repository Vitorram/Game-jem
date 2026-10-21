import { Scene, Color } from 'three';
import type { Scene as GameScene } from '../core/Scene';

/** Base vazia da fase 1, ainda sem personagens, objetos ou missão. */
export class Fase1OrlaScene implements GameScene {
  readonly scene = new Scene();

  constructor() {
    this.scene.background = new Color('#111a20');
  }

  update(_dt: number): void {}

  dispose(): void {
    // Não há geometrias, materiais ou texturas nesta cena vazia.
    this.scene.clear();
    this.scene.background = null;
  }
}
