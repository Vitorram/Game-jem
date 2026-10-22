import { BoxGeometry, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import type { RiskSnapshot } from './RiskWorkflow';

const colors = { hidden: '#79b8ff', inspected: '#ffd878', released: '#ff806d', routing: '#cdb1ff', resolved: '#62d7a7' };

/** Um, dois ou três traços identificam o ponto; a cor acompanha seu estado. */
export class RiskMarkers {
  readonly group = new Group();
  private readonly ring = new RingGeometry(0.55, 0.65, 32);
  private readonly bar = new BoxGeometry(0.09, 0.3, 0.09);
  private readonly materials = new Map<number, MeshBasicMaterial>();
  private disposed = false;
  constructor(state: RiskSnapshot) {
    this.group.name = 'orla-risks';
    state.risks.forEach(risk => {
      const material = new MeshBasicMaterial({ color: colors[risk.status] });
      this.materials.set(risk.id, material);
      const marker = new Group();
      marker.name = `risk-${risk.id}`;
      marker.position.set(risk.point.x, 0.04, risk.point.z);
      const ring = new Mesh(this.ring, material);
      ring.rotation.x = -Math.PI / 2;
      marker.add(ring);
      for (let i = 0; i < risk.id; i++) {
        const bar = new Mesh(this.bar, material);
        bar.position.set((i - (risk.id - 1) / 2) * 0.18, 0.15, 0);
        marker.add(bar);
      }
      this.group.add(marker);
    });
  }
  sync(state: RiskSnapshot): void {
    if (!this.disposed) state.risks.forEach(risk => this.materials.get(risk.id)?.color.set(colors[risk.status]));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ring.dispose(); this.bar.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear(); this.group.clear();
  }
}
