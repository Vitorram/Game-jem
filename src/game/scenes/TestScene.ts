import { Scene, Color, Fog, HemisphereLight, DirectionalLight, Mesh, PlaneGeometry, MeshStandardMaterial, GridHelper, Material } from 'three';
import { Player, type PlayerId } from '../entities/Player';
import type { Input } from '../core/Input';
import { AbilityLab, type AbilitySnapshot } from '../core/AbilityLab';
import { AbilityVisuals } from './AbilityVisuals';

export class TestScene {
  readonly scene = new Scene();
  readonly players = [new Player(1), new Player(2), new Player(3)];
  private selectedId: PlayerId = 1;
  readonly abilities: AbilityLab;
  private readonly abilityVisuals = new AbilityVisuals();

  get player() { return this.players[this.selectedId - 1]; }

  selectPlayer(id: PlayerId) { this.selectedId = id; this.abilities.selectRole(id); }

  constructor(onAbilities?: (state: AbilitySnapshot) => void) {
    this.abilities = new AbilityLab(state => {
      this.abilityVisuals.sync(state);
      onAbilities?.(state);
    });
    this.scene.add(this.abilityVisuals.group);
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
    this.scene.add(ground, grid);
    this.players.forEach((player, index) => {
      player.setPosition((index - 1) * 2.5, 0);
      player.mesh.rotation.y = (index - 1) * -0.15;
      this.scene.add(player.mesh);
    });
  }

  update(delta: number, input: Input) {
    const axis = this.abilities.movementBlocked ? { x: 0, z: 0 } : input.getAxis();
    for (const player of this.players) {
      player.update(delta, player === this.player ? axis : { x: 0, z: 0 });
    }
  }

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
