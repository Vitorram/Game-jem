import { Scene, Color, Fog, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry, MeshStandardMaterial, GridHelper, Material } from 'three';
import { Player } from '../entities/Player';
import type { Input } from '../core/Input';

export class TestScene {
  readonly scene = new Scene();
  readonly player = new Player();

  constructor() {
    this.scene.background = new Color('#111a20');
    this.scene.fog = new Fog('#111a20', 22, 55);
    this.scene.add(new HemisphereLight('#dcecff', '#36443b', 2.5));
    const sun = new DirectionalLight('#fff1d4', 3);
    sun.position.set(6, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14 });
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun);
    const ground = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: '#253736', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    const grid = new GridHelper(20, 20, '#65806b', '#344947');
    grid.position.y = 0.01;
    this.scene.add(ground, grid, this.player.mesh);
  }

  update(delta: number, input: Input) { this.player.update(delta, input.getAxis()); }

  dispose() {
    // Esta cena é dona dos recursos; cache de assets compartilhados deve ter outro dono.
    const geometries = new Set<{ dispose(): void }>();
    const materials = new Set<Material>();
    this.scene.traverse(object => {
      const drawable = object as Mesh;
      if (drawable.geometry) geometries.add(drawable.geometry);
      if (drawable.material) {
        for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) materials.add(material);
      }
      if (object instanceof DirectionalLight) object.shadow.dispose();
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.scene.clear();
  }
}
