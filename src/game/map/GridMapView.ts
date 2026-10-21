import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import { GRID_CONFIG } from '../config';
import { GridMap, TILE_TYPES, type TileKind } from './GridMap';

/** Dona da geometria e dos materiais compartilhados pelos tiles. */
export class GridMapView {
  readonly group = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly markingMaterial = new MeshStandardMaterial({ color: '#e9dca9', roughness: 0.85 });
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

    const roadRows = Array.from({ length: map.rows }, (_, row) => row)
      .filter(row => Array.from({ length: map.columns }, (_, column) => map.tileAt(column, row)).includes('road'));
    if (roadRows.length) {
      const roadMinZ = Math.min(...roadRows.map(row => map.cellCenter(0, row).z - map.tileSize / 2));
      const roadMaxZ = Math.max(...roadRows.map(row => map.cellCenter(0, row).z + map.tileSize / 2));
      const laneCount = 5; // faixa de escape mais quatro faixas principais
      for (let column = 0; column < map.columns; column++) {
        const x = map.cellCenter(column, roadRows[0]).x;
        for (let divider = 1; divider < laneCount; divider++) {
          const marking = new Mesh(this.geometry, this.markingMaterial);
          marking.name = `road-lane-divider-${column}-${divider}`;
          marking.scale.set(map.tileSize * 0.42, 0.025, 0.035);
          marking.position.set(x, 0.018, roadMinZ + (roadMaxZ - roadMinZ) * divider / laneCount);
          this.group.add(marking);
        }
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.markingMaterial.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.group.clear();
  }
}
