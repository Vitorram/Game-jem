import { Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { ORLA_FEEDBACK } from '../config';

/** Marcador no mundo: identifica a personagem controlada e confirma ações. */
export class PlayerFeedback {
  readonly group = new Group();
  private readonly geometry = new RingGeometry(ORLA_FEEDBACK.ringInnerRadius, ORLA_FEEDBACK.ringOuterRadius, 32);
  private readonly material = new MeshBasicMaterial({ color: ORLA_FEEDBACK.ringColor, depthWrite: false });
  private remaining = 0;
  private disposed = false;

  constructor() {
    const ring = new Mesh(this.geometry, this.material);
    ring.rotation.x = -Math.PI / 2;
    this.group.name = 'active-player-ring';
    this.group.add(ring);
  }

  action(): void { this.remaining = ORLA_FEEDBACK.actionDuration; }

  update(dt: number, position: { x: number; z: number }): void {
    if (this.disposed) return;
    this.remaining = Math.max(0, this.remaining - Math.max(0, dt));
    this.group.position.set(position.x, ORLA_FEEDBACK.ringHeight, position.z);
    this.group.scale.setScalar(1 + this.remaining / ORLA_FEEDBACK.actionDuration * 0.35);
    this.material.color.set(this.remaining > 0 ? ORLA_FEEDBACK.actionColor : ORLA_FEEDBACK.ringColor);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
