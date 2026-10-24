const movementCodes = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);

export class Input {
  private keys = new Set<string>();
  private touch = new Map<number, string>();
  private actionAxis: { x: number; z: number } | null = null;
  private onKeyDown = (event: KeyboardEvent) => {
    if (!movementCodes.has(event.code) && event.code !== 'ShiftLeft' && event.code !== 'ShiftRight') return;
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    event.preventDefault();
    this.keys.add(event.code);
  };
  private onKeyUp = (event: KeyboardEvent) => { this.keys.delete(event.code); };
  clear = () => { this.keys.clear(); this.touch.clear(); };

  constructor() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.clear);
  }

  setTouch(pointerId: number, code?: string) {
    if (code) this.touch.set(pointerId, code);
    else this.touch.delete(pointerId);
  }

  private held(...codes: string[]) {
    return codes.some(code => this.keys.has(code) || [...this.touch.values()].includes(code));
  }

  getAxis() {
    if (this.actionAxis) return this.actionAxis;
    const x = Number(this.held('KeyD', 'ArrowRight')) - Number(this.held('KeyA', 'ArrowLeft'));
    const z = Number(this.held('KeyS', 'ArrowDown')) - Number(this.held('KeyW', 'ArrowUp'));
    const length = Math.hypot(x, z) || 1;
    return { x: x / length, z: z / length };
  }

  setActionAxis(axis: { x: number; z: number } | null): void { this.actionAxis = axis; }

  isSprinting() { return this.held('ShiftLeft', 'ShiftRight'); }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.clear);
    this.clear();
    this.actionAxis = null;
  }
}

