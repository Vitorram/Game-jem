/**
 * Input independente para o segundo jogador no modo cooperativo local.
 * Teclas: I/J/K/L para mover, U para interagir, O para abrir/fechar tablet, P para correr.
 */
const P2_MOVEMENT = new Set(['KeyI', 'KeyJ', 'KeyK', 'KeyL']);

export class LocalCoopInput {
  private keys = new Set<string>();
  private interactPressedRaw = false;
  private tabletPressedRaw = false;

  private onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.target instanceof HTMLElement
      && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (P2_MOVEMENT.has(event.code) || event.code === 'KeyP') {
      event.preventDefault();
      this.keys.add(event.code);
    }
    if (event.code === 'KeyU') { event.preventDefault(); this.interactPressedRaw = true; }
    if (event.code === 'KeyO') { event.preventDefault(); this.tabletPressedRaw = true; }
  };

  private onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
    if (event.code === 'KeyU') this.interactPressedRaw = false;
    if (event.code === 'KeyO') this.tabletPressedRaw = false;
  };

  clear = () => { this.keys.clear(); this.interactPressedRaw = false; this.tabletPressedRaw = false; };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  private held(...codes: string[]) {
    return codes.some(code => this.keys.has(code));
  }

  getAxis() {
    const x = Number(this.held('KeyL')) - Number(this.held('KeyJ'));
    const z = Number(this.held('KeyK')) - Number(this.held('KeyI'));
    const length = Math.hypot(x, z) || 1;
    return { x: x / length, z: z / length };
  }

  isSprinting() { return this.held('KeyP'); }

  /** Consome o pressionamento de U (interagir). */
  consumeInteract(): boolean {
    if (this.interactPressedRaw) { this.interactPressedRaw = false; return true; }
    return false;
  }

  /** Consome o pressionamento de O (tablet). */
  consumeTablet(): boolean {
    if (this.tabletPressedRaw) { this.tabletPressedRaw = false; return true; }
    return false;
  }

  /** `true` enquanto U está pressionado (para detecção contínua, se necessário). */
  get interactHeld() { return this.interactPressedRaw; }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    this.clear();
  }
}

