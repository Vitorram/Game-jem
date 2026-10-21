import { CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, RingGeometry, Vector3 } from 'three';
import type { AbilitySnapshot, MapPoint } from '../core/AbilityLab';

/** Apenas indicadores de habilidade sobre a plataforma vazia. */
export class AbilityVisuals {
  readonly group = new Group();
  private clear() {
    this.group.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
      }
    });
    this.group.clear();
  }
  private ring(point: MapPoint, radius: number, color: string, opacity = 1) {
    const mesh = new Mesh(new RingGeometry(radius - 0.045, radius, 48), new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(point.x, 0.035, point.z);
    this.group.add(mesh);
  }
  private beacon(point: MapPoint, color: string) {
    const mesh = new Mesh(new CylinderGeometry(0.10, 0.16, 0.4, 12), new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5 }));
    mesh.position.set(point.x, 0.2, point.z);
    this.group.add(mesh);
  }
  sync(state: AbilitySnapshot) {
    this.clear();
    for (const sensor of state.sensors) {
      this.beacon(sensor, '#62d7a7');
      this.ring(sensor, 1.5, '#62d7a7', 0.5);
    }
    if (state.light) {
      const { level, x, z } = state.light;
      this.beacon(state.light, level ? '#ffe19a' : '#6d7683');
      if (level) {
        const radius = level === 1 ? 1.8 : 3;
        const glow = new Mesh(new CircleGeometry(radius, 48), new MeshBasicMaterial({ color: '#ffe6a0', transparent: true, opacity: level === 1 ? 0.12 : 0.25, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(x, 0.025, z);
        const light = new PointLight('#ffe1a0', level === 1 ? 6 : 18, radius * 2, 2);
        light.position.set(x, 1.4, z);
        this.group.add(glow, light);
        this.ring(state.light, radius, '#ffe1a0', 0.65);
      }
    }
    if (state.role === 2) {
      const stops = state.editing ? state.draft : state.stops;
      stops.forEach((stop, index) => {
        this.ring(stop, 0.4, state.editing && state.selectedStop === index ? '#ffffff' : '#cdb1ff');
        if (!index) return;
        const from = new Vector3(stops[index - 1].x, 0.05, stops[index - 1].z);
        const to = new Vector3(stop.x, 0.05, stop.z);
        const direction = to.clone().sub(from);
        const segment = new Mesh(new CylinderGeometry(0.035, 0.035, direction.length(), 6), new MeshBasicMaterial({ color: state.editing ? '#e4d4ff' : '#b18aee' }));
        segment.position.copy(from).add(to).multiplyScalar(0.5);
        segment.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
        this.group.add(segment);
      });
    }
    for (const issue of state.issues) {
      if (issue.marked || state.role === 3) this.ring(issue, 0.6, issue.marked ? '#ff806d' : issue.revealed ? '#ffd878' : '#79b8ff', 0.85);
    }
  }
}
