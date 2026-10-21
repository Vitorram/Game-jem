import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GRID_CONFIG } from '../config';
import { GridMap, TILE_TYPES, type TileKind } from './GridMap';

/** Dona da geometria e dos materiais compartilhados pelos tiles. */
export class GridMapView {
  readonly group = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly materials = new Map<TileKind, MeshStandardMaterial>();
  private disposed = false;

  constructor(map: GridMap) {
    this.group.name = 'orla-ground';
    this.group.receiveShadow = true;
    for (let row = 0; row < map.rows; row++) for (let column = 0; column < map.columns; column++) {
      const kind = map.tileAt(column, row)!;
      const type = TILE_TYPES[kind];
      let material = this.materials.get(kind);
      if (!material) {
        material = new MeshStandardMaterial({ color: type.color, roughness: GRID_CONFIG.roughness });
        this.materials.set(kind, material);
      }
      const height = GRID_CONFIG.floorThickness + type.height;
      const tile = new Mesh(this.geometry, material);
      const center = map.cellCenter(column, row);
      tile.name = `tile-${column}-${row}-${kind}`;
      tile.scale.set(map.tileSize, height, map.tileSize);
      tile.position.set(center.x, height / 2 - GRID_CONFIG.floorThickness, center.z);
      tile.castShadow = type.height > 0;
      tile.receiveShadow = true;
      this.group.add(tile);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.group.clear();
  }
}
