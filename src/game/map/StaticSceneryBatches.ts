import { Group, InstancedMesh, Matrix4, Mesh } from 'three';

/** Batches only static opaque leaf meshes. Source nodes remain for map queries. */
export class StaticSceneryBatches {
  readonly meshes: InstancedMesh[] = [];
  private readonly sources: Mesh[] = [];
  private disposed = false;
  constructor(root: Group, animatedRoots: ReadonlySet<object> = new Set()) {
    root.updateMatrixWorld(true);
    const inverseRoot = root.matrixWorld.clone().invert();
    const buckets = new Map<string, Mesh[]>();
    const placement = new Matrix4();
    root.traverse(object => {
      if (!(object instanceof Mesh) || object instanceof InstancedMesh || object.children.length
        || Array.isArray(object.material) || object.material.transparent || object.material.opacity < 1) return;
      for (let ancestor: typeof object | typeof object.parent = object; ancestor; ancestor = ancestor.parent) {
        if (!ancestor.visible || animatedRoots.has(ancestor)) return;
      }
      if (object.matrixWorld.determinant() <= 0) return;
      placement.multiplyMatrices(inverseRoot, object.matrixWorld);
      const cell = `${Math.floor(placement.elements[12] / 16)}:${Math.floor(placement.elements[14] / 16)}`;
      const key = `${cell}:${object.geometry.uuid}:${object.material.uuid}:${object.castShadow}:${object.receiveShadow}:${object.renderOrder}:${object.layers.mask}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(object); buckets.set(key, bucket);
    });
    const local = new Matrix4();
    for (const bucket of buckets.values()) {
      if (bucket.length < 4) continue;
      const source = bucket[0];
      const batch = new InstancedMesh(source.geometry, source.material, bucket.length);
      batch.name = `static-batch-${this.meshes.length}`;
      batch.castShadow = source.castShadow; batch.receiveShadow = source.receiveShadow;
      batch.renderOrder = source.renderOrder; batch.layers.mask = source.layers.mask;
      bucket.forEach((mesh, index) => {
        batch.setMatrixAt(index, local.multiplyMatrices(inverseRoot, mesh.matrixWorld));
        mesh.visible = false; this.sources.push(mesh);
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      root.add(batch); this.meshes.push(batch);
    }
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const mesh of this.meshes) { mesh.removeFromParent(); mesh.dispose(); }
    // Geometry/materials belong to GridMapView and are disposed there exactly once.
    for (const source of this.sources) source.visible = true;
    this.meshes.length = 0; this.sources.length = 0;
  }
}
