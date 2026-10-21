import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import type { Group } from 'three';
import { ITEM_VIEW_CONFIG } from '../config';
import { TILE_TYPES, type GridMap, type TileCell } from '../map/GridMap';
import { ITEM_TYPES, type ItemId } from './itemData';
import type { ItemInteractions } from './ItemInteractions';

type ItemMesh = Mesh<BoxGeometry, MeshStandardMaterial>;

/** Meshes fixos: mudar o item troca o material, sem alocar GPU durante a ação. */
export class ItemVisuals {
  private readonly geometry = new BoxGeometry(ITEM_VIEW_CONFIG.size, ITEM_VIEW_CONFIG.size, ITEM_VIEW_CONFIG.size);
  private readonly materials = new Map<ItemId, MeshStandardMaterial>();
  private readonly meshes: ItemMesh[] = [];
  private readonly carried = new Map<number, ItemMesh>();
  private readonly counters: { cell: TileCell; mesh: ItemMesh }[] = [];
  private disposed = false;

  constructor(map: GridMap, parent: Group, players: readonly { id: number; mesh: Group }[]) {
    for (const item of Object.keys(ITEM_TYPES) as ItemId[]) {
      this.materials.set(item, new MeshStandardMaterial({ color: ITEM_TYPES[item].color, roughness: ITEM_VIEW_CONFIG.roughness }));
    }
    const place = (cell: TileCell, height: number, name: string) => {
      const mesh = this.createMesh(name);
      const center = map.cellCenter(cell.column, cell.row);
      mesh.position.set(center.x, height + ITEM_VIEW_CONFIG.surfaceGap + ITEM_VIEW_CONFIG.size / 2, center.z);
      parent.add(mesh);
      return mesh;
    };
    map.itemSources.forEach(source => {
      const mesh = place(source, TILE_TYPES.itemBox.height, `item-source-${source.column}-${source.row}`);
      mesh.material = this.materials.get(source.item)!;
    });
    for (let row = 0; row < map.rows; row++) for (let column = 0; column < map.columns; column++) {
      if (map.tileAt(column, row) !== 'counter') continue;
      const cell = { column, row };
      const mesh = place(cell, TILE_TYPES.counter.height, `item-counter-${column}-${row}`);
      mesh.visible = false;
      this.counters.push({ cell, mesh });
    }
    players.forEach(player => {
      const mesh = this.createMesh(`item-carried-${player.id}`);
      mesh.position.y = ITEM_VIEW_CONFIG.carriedHeight;
      mesh.visible = false;
      player.mesh.add(mesh);
      this.carried.set(player.id, mesh);
    });
  }

  private createMesh(name: string): ItemMesh {
    const mesh = new Mesh(this.geometry, this.materials.get('sensor')!);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.meshes.push(mesh);
    return mesh;
  }

  sync(state: ItemInteractions): void {
    if (this.disposed) return;
    const show = (mesh: ItemMesh, item: ItemId | null) => {
      mesh.visible = item !== null;
      if (item !== null) mesh.material = this.materials.get(item)!;
    };
    this.carried.forEach((mesh, id) => show(mesh, state.heldBy(id)));
    this.counters.forEach(({ cell, mesh }) => show(mesh, state.onCounter(cell)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.meshes.forEach(mesh => mesh.removeFromParent());
    this.meshes.length = 0;
    this.carried.clear();
    this.counters.length = 0;
    this.geometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
  }
}
