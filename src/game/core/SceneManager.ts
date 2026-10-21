import type { Scene } from './Scene';

export class SceneManager {
  private active: Scene | null = null;
  private disposed = false;
  private readonly retired = new WeakSet<Scene>();

  get current(): Scene | null { return this.active; }

  /** Transfere a propriedade da cena ao manager. Não reutilize cenas descartadas. */
  setScene(next: Scene): void {
    if (this.disposed) throw new Error('SceneManager já foi descartado.');
    if (next === this.active) return;
    if (this.retired.has(next)) throw new Error('Esta cena já foi descartada. Crie uma nova instância.');

    const previous = this.active;
    this.active = null;
    if (previous) {
      this.retired.add(previous);
      previous.dispose();
    }
    this.active = next;
  }

  update(dt: number): void {
    this.active?.update(dt);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const previous = this.active;
    this.active = null;
    if (previous) {
      this.retired.add(previous);
      previous.dispose();
    }
  }
}
