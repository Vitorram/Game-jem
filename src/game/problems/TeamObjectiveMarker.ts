import { ArrowHelper, Color, Group, Material, Mesh, MeshStandardMaterial, TorusGeometry, Vector3 } from 'three';

/** Linha direcional no chão para a equipe atualmente selecionada. */
export class TeamObjectiveMarker {
  readonly group = new Group();
  private readonly arrow: ArrowHelper;
  private readonly targetRing: Mesh<TorusGeometry, MeshStandardMaterial>;
  private readonly direction = new Vector3();

  constructor() {
    this.group.name = 'team-objective-direction';
    this.arrow = new ArrowHelper(new Vector3(1, 0, 0), new Vector3(), 1, new Color('#77e2c0'), 0.34, 0.19);
    this.group.add(this.arrow);
    this.targetRing = new Mesh(new TorusGeometry(0.48, 0.055, 6, 24), new MeshStandardMaterial({
      color: '#77e2c0', emissive: '#1a5f4a', roughness: 0.65,
    }));
    this.targetRing.rotation.x = Math.PI / 2;
    this.targetRing.position.y = 0.06;
    this.group.add(this.targetRing);
    this.group.visible = false;
  }

  setVisible(visible: boolean): void { this.group.visible = visible; }

  update(from: { x: number; z: number }, to: { x: number; z: number }): number {
    this.direction.set(to.x - from.x, 0, to.z - from.z);
    const distance = this.direction.length();
    if (distance > 0.001) this.direction.normalize();
    this.arrow.position.set(from.x, 0.32, from.z);
    this.arrow.setDirection(this.direction);
    this.arrow.setLength(Math.max(0.1, distance), 0.34, 0.19);
    this.targetRing.position.set(to.x, 0.06, to.z);
    return distance;
  }

  dispose(): void {
    this.arrow.line.geometry.dispose();
    this.arrow.cone.geometry.dispose();
    this.disposeMaterials(this.arrow.line.material);
    this.disposeMaterials(this.arrow.cone.material);
    this.targetRing.geometry.dispose();
    this.targetRing.material.dispose();
    this.group.clear();
  }

  private disposeMaterials(material: Material | Material[]): void {
    (Array.isArray(material) ? material : [material]).forEach(item => item.dispose());
  }
}
