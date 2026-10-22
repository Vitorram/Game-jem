import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from 'three';
import type { BufferGeometry } from 'three';
import { ITEM_VIEW_CONFIG } from '../config';
import { TILE_TYPES, type GridMap, type TileCell } from '../map/GridMap';
import { ITEM_TYPES, type ItemId } from './itemData';
import type { ItemInteractions } from './ItemInteractions';

type ItemMesh = Mesh<BufferGeometry, MeshStandardMaterial>;

/** Meshes fixos: mudar o item troca o material, sem alocar GPU durante a ação. */
export class ItemVisuals {
  private readonly geometry = new BoxGeometry(ITEM_VIEW_CONFIG.size, ITEM_VIEW_CONFIG.size, ITEM_VIEW_CONFIG.size);
  private readonly carriedConeGeometry = new ConeGeometry(0.21, 0.62, 8);
  private readonly coneBandBottomGeometry = new CylinderGeometry(0.125, 0.16, 0.09, 8, 1, true);
  private readonly coneBandTopGeometry = new CylinderGeometry(0.05, 0.08, 0.09, 8, 1, true);
  private readonly materials = new Map<ItemId, MeshStandardMaterial>();
  private readonly meshes: ItemMesh[] = [];
  private readonly groups: Group[] = [];
  private readonly carried = new Map<number, ItemMesh>();
  private readonly carriedDetails = new Map<number, Group>();
  private readonly counters: { cell: TileCell; mesh: ItemMesh }[] = [];
  private readonly crateMaterial = new MeshStandardMaterial({ color: '#e8753d', roughness: 0.78 });
  private readonly crateTrimMaterial = new MeshStandardMaterial({ color: '#9c482e', roughness: 0.82 });
  private readonly reflectiveMaterial = new MeshStandardMaterial({ color: '#fff1c9', roughness: 0.45, emissive: '#554322', emissiveIntensity: 0.12 });
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
      if (source.item === 'cone') {
        this.createConeCrate(map, parent, source);
        return;
      }
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
      const details = new Group();
      details.name = `carried-cone-details-${player.id}`;
      details.visible = false;
      const base = new Mesh(this.geometry, this.crateTrimMaterial);
      base.scale.set(0.84, 0.12, 0.84);
      base.position.y = -0.28;
      const lowBand = new Mesh(this.coneBandBottomGeometry, this.reflectiveMaterial);
      lowBand.position.y = -0.08;
      const highBand = new Mesh(this.coneBandTopGeometry, this.reflectiveMaterial);
      highBand.position.y = 0.15;
      [base, lowBand, highBand].forEach(part => { part.castShadow = true; part.receiveShadow = true; details.add(part); this.meshes.push(part); });
      mesh.add(details);
      player.mesh.add(mesh);
      this.carried.set(player.id, mesh);
      this.carriedDetails.set(player.id, details);
    });
  }

  private createConeCrate(map: GridMap, parent: Group, cell: TileCell): void {
    const center = map.cellCenter(cell.column, cell.row);
    const group = new Group();
    group.name = `item-source-${cell.column}-${cell.row}`;
    group.position.set(center.x, TILE_TYPES.itemBox.height + 0.015, center.z);
    this.groups.push(group);
    parent.add(group);
    const part = (name: string, geometry: BufferGeometry, material: MeshStandardMaterial, position: [number, number, number], scale: [number, number, number]) => {
      const mesh = new Mesh(geometry, material);
      mesh.name = `cone-crate-${name}`;
      mesh.position.set(...position);
      mesh.scale.set(...scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    // An open field chest with a few cones ready to grab.
    part('base', this.geometry, this.crateTrimMaterial, [0, 0.13, 0], [1.9, 0.48, 1.55]);
    part('front', this.geometry, this.crateMaterial, [0, 0.31, 0.34], [1.9, 0.66, 0.2]);
    part('back', this.geometry, this.crateMaterial, [0, 0.31, -0.34], [1.9, 0.66, 0.2]);
    part('left', this.geometry, this.crateMaterial, [-0.43, 0.31, 0], [0.2, 0.66, 1.15]);
    part('right', this.geometry, this.crateMaterial, [0.43, 0.31, 0], [0.2, 0.66, 1.15]);
    for (const x of [-0.25, 0, 0.25]) {
      const cone = part(`spare-${x}`, this.carriedConeGeometry, this.materials.get('cone')!, [x, 0.58, 0], [0.54, 0.54, 0.54]);
      cone.rotation.y = x * 2;
      for (const [suffix, geometry, y] of [['lower', this.coneBandBottomGeometry, -0.08], ['upper', this.coneBandTopGeometry, 0.15]] as const) {
        const stripe = new Mesh(geometry, this.reflectiveMaterial);
        stripe.name = `cone-crate-${suffix}-stripe-${x}`;
        stripe.position.y = y;
        stripe.castShadow = true;
        stripe.receiveShadow = true;
        cone.add(stripe);
        this.meshes.push(stripe);
      }
    }
    part('front-mark', this.geometry, this.crateTrimMaterial, [0, 0.31, 0.445], [0.62, 0.27, 0.035]);
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
    this.carried.forEach((mesh, id) => {
      const item = state.heldBy(id);
      show(mesh, item);
      const isCone = item === 'cone';
      mesh.geometry = isCone ? this.carriedConeGeometry : this.geometry;
      mesh.scale.setScalar(1);
      this.carriedDetails.get(id)!.visible = isCone;
      if (item !== null) mesh.material = this.materials.get(item)!;
    });
    this.counters.forEach(({ cell, mesh }) => show(mesh, state.onCounter(cell)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.meshes.forEach(mesh => mesh.removeFromParent());
    this.meshes.length = 0;
    this.groups.forEach(group => group.removeFromParent());
    this.groups.length = 0;
    this.carried.clear();
    this.carriedDetails.clear();
    this.counters.length = 0;
    this.geometry.dispose();
    this.carriedConeGeometry.dispose();
    this.coneBandBottomGeometry.dispose();
    this.coneBandTopGeometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.crateMaterial.dispose();
    this.crateTrimMaterial.dispose();
    this.reflectiveMaterial.dispose();
  }
}
