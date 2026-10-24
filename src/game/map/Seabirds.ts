import { BufferGeometry, DoubleSide, DynamicDrawUsage, Float32BufferAttribute, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Euler, Vector3 } from 'three';

/** Six cosmetic gulls, two draw calls, no colliders or per-frame allocations. */
export class Seabirds {
  readonly group = new Group();
  private readonly material = new MeshBasicMaterial({ color: '#fff4dc', side: DoubleSide });
  private readonly wings: InstancedMesh[] = [];
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly euler = new Euler();
  private readonly scale = new Vector3(1, 1, 1);
  private elapsed = 0;
  private disposed = false;
  constructor(private readonly width: number, private readonly shore: number) {
    this.group.name = 'orla-seabirds';
    for (const side of [-1, 1]) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([0,0,0, side*.24,.015,.02, side*.12,0,-.09],3));
      const wing = new InstancedMesh(geometry, this.material, 6);
      wing.name = `seabird-wing-${side}`;
      wing.instanceMatrix.setUsage(DynamicDrawUsage);
      wing.frustumCulled = false;
      this.wings.push(wing); this.group.add(wing);
    }
    this.update(0);
  }
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    this.elapsed += dt;
    this.wings.forEach((wing, index) => {
      const side = index === 0 ? -1 : 1;
      for (let bird = 0; bird < 6; bird++) {
        const phase = bird*1.71;
        this.position.set(((bird*this.width/6 + this.elapsed*.9) % this.width)-this.width/2,
          2.6 + Math.sin(this.elapsed*.38+phase)*.2, this.shore-4.5-(bird%3)*2+Math.sin(this.elapsed*.16+phase)*.4);
        this.euler.set(0,Math.PI/2,side*(.18+Math.sin(this.elapsed*2.8+phase)*.28));
        this.rotation.setFromEuler(this.euler);
        wing.setMatrixAt(bird,this.matrix.compose(this.position,this.rotation,this.scale));
      }
      wing.instanceMatrix.needsUpdate = true;
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.wings.forEach(wing => { wing.geometry.dispose(); wing.dispose(); });
    this.material.dispose(); this.group.removeFromParent(); this.group.clear();
  }
}
