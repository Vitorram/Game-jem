import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GRID_CONFIG } from '../config';
import { GridMap, TILE_TYPES, type TileKind } from './GridMap';

/** Cor do tampo de cada objeto sólido (fica 0,05 acima do topo; itens pousam 0,08 acima). */
const TOP_ACCENT: Partial<Record<TileKind, string>> = {
  counter: '#f6e2b8',
  itemBox: '#2f4b6b',
  station: '#c6f5de',
  wall: '#b3a5c8',
};
const MARK_COLORS = { dash: '#f7e9b0', edge: '#f4f1ea', bike: '#fbe6da' } as const;
type MarkKind = keyof typeof MARK_COLORS;

const SEA_LOW = new Color('#22a3bf');
const SEA_HIGH = new Color('#55d0e2');
/** O mar fica mais baixo que a areia, o que desenha a borda da praia. */
const SEA_DROP = 0.12;
/** Quanto o chão se estende além do mapa, para não aparecer o vazio do fundo. */
const APRON = 30;
/** Objetos ocupam 94% do tile: ficam como blocos separados, estilo brinquedo. */
const OBJECT_FILL = 0.94;

/** Dona da geometria e dos materiais compartilhados pelos tiles. */
export class GridMapView {
  readonly group = new Group();
  private readonly flat = new BoxGeometry(1, 1, 1);
  private readonly roundedBoxes = new Map<string, RoundedBoxGeometry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly seaWaves: [MeshStandardMaterial, MeshStandardMaterial];
  private readonly foam: { mesh: Mesh; baseZ: number; phase: number }[] = [];
  private time = 0;
  private disposed = false;

  constructor(private readonly map: GridMap) {
    this.group.name = 'orla-ground';
    this.seaWaves = [this.material('sea:0', SEA_LOW), this.material('sea:1', SEA_HIGH)];
    const slab = GRID_CONFIG.floorThickness;

    for (let row = 0; row < map.rows; row++) for (let column = 0; column < map.columns; column++) {
      const kind = map.tileAt(column, row)!;
      const type = TILE_TYPES[kind];
      const center = map.cellCenter(column, row);
<<<<<<< feat/visual-orla-e-hud
      const isObject = type.height > 0;
      // Objetos sólidos apoiam-se num piso de calçadão.
      const floorKind: TileKind = isObject ? 'promenade' : kind;
      const floor = new Mesh(this.flat, this.floorMaterial(floorKind, column, row));
      floor.name = isObject ? `floor-${column}-${row}` : `tile-${column}-${row}-${kind}`;
      floor.scale.set(map.tileSize, slab, map.tileSize);
      floor.position.set(center.x, -slab / 2 - (kind === 'sea' ? SEA_DROP : 0), center.z);
      floor.receiveShadow = true;
      this.group.add(floor);

      if (isObject) this.addObject(kind, column, row, center);
      else this.addMarkings(kind, column, row, center);
      if (kind === 'sea') this.addFoam(column, row, center);
=======
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
>>>>>>> main
    }
    this.addApron();
  }

  /** Anima só a cor do mar e a espuma. Chame uma vez por frame, com dt em segundos. */
  update(dt: number): void {
    if (this.disposed) return;
    this.time += dt;
    const wave = (Math.sin(this.time * 1.2) + 1) / 2;
    this.seaWaves[0].color.lerpColors(SEA_LOW, SEA_HIGH, wave);
    this.seaWaves[1].color.lerpColors(SEA_LOW, SEA_HIGH, 1 - wave);
    for (const piece of this.foam) piece.mesh.position.z = piece.baseZ + Math.sin(this.time * 1.6 + piece.phase) * 0.07;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flat.dispose();
    this.roundedBoxes.forEach(geometry => geometry.dispose());
    this.roundedBoxes.clear();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.foam.length = 0;
    this.group.clear();
  }

  private material(
    key: string,
    color: string | Color,
    extra: { transparent?: boolean; opacity?: number } = {},
  ): MeshStandardMaterial {
    let material = this.materials.get(key);
    if (!material) {
      material = new MeshStandardMaterial({ color, roughness: GRID_CONFIG.roughness, ...extra });
      this.materials.set(key, material);
    }
    return material;
  }

  private floorMaterial(kind: TileKind, column: number, row: number): MeshStandardMaterial {
    if (kind === 'sea') return this.seaWaves[(column + row) % 2];
    // Xadrez bem sutil: dá textura ao chão sem precisar de imagem.
    const alt = (column + row) % 2;
    const color = new Color(TILE_TYPES[kind].color);
    if (alt) color.offsetHSL(0, 0, 0.035);
    return this.material(`floor:${kind}:${alt}`, color);
  }

  private roundedBox(width: number, height: number, depth: number, radius: number): RoundedBoxGeometry {
    const key = `${width}|${height}|${depth}|${radius}`;
    let geometry = this.roundedBoxes.get(key);
    if (!geometry) {
      geometry = new RoundedBoxGeometry(width, height, depth, 3, radius);
      this.roundedBoxes.set(key, geometry);
    }
    return geometry;
  }

  private addObject(kind: TileKind, column: number, row: number, center: { x: number; z: number }): void {
    const type = TILE_TYPES[kind];
    const size = this.map.tileSize * OBJECT_FILL;
    const body = new Mesh(this.roundedBox(size, type.height, size, 0.14), this.material(`solid:${kind}`, type.color));
    body.name = `tile-${column}-${row}-${kind}`;
    body.position.set(center.x, type.height / 2, center.z);
    body.castShadow = true;
    body.receiveShadow = true;

    const top = new Mesh(
      this.roundedBox(size * 0.82, 0.05, size * 0.82, 0.02),
      this.material(`top:${kind}`, TOP_ACCENT[kind] ?? type.color),
    );
    top.name = `top-${column}-${row}`;
    top.position.set(center.x, type.height + 0.025, center.z);
    top.receiveShadow = true;
    this.group.add(body, top);
  }

  private addFoam(column: number, row: number, center: { x: number; z: number }): void {
    const below = this.map.tileAt(column, row + 1);
    if (below === undefined || below === 'sea') return;
    const mesh = new Mesh(this.flat, this.material('foam', '#ffffff', { transparent: true, opacity: 0.85 }));
    const baseZ = center.z + this.map.tileSize / 2 - 0.16;
    mesh.name = `foam-${column}-${row}`;
    mesh.scale.set(this.map.tileSize, 0.02, 0.16);
    mesh.position.set(center.x, -SEA_DROP + 0.011, baseZ);
    this.foam.push({ mesh, baseZ, phase: column * 0.7 });
    this.group.add(mesh);
  }

  private line(name: string, mark: MarkKind, x: number, z: number, width: number, depth: number): void {
    const mesh = new Mesh(this.flat, this.material(`mark:${mark}`, MARK_COLORS[mark]));
    mesh.name = name;
    mesh.scale.set(width, 0.025, depth);
    mesh.position.set(x, 0.0135, z);
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Rua: linhas laterais e tracejado central. Ciclovia: tracejado claro entre as faixas. */
  private addMarkings(kind: TileKind, column: number, row: number, center: { x: number; z: number }): void {
    const size = this.map.tileSize;
    const above = this.map.tileAt(column, row - 1);
    const below = this.map.tileAt(column, row + 1);
    if (kind === 'road') {
      if (above !== 'road') this.line(`edge-top-${column}-${row}`, 'edge', center.x, center.z - size / 2 + 0.12, size, 0.09);
      if (below !== 'road') this.line(`edge-bottom-${column}-${row}`, 'edge', center.x, center.z + size / 2 - 0.12, size, 0.09);
      else for (const dx of [-0.25, 0.25]) this.line(`dash-${column}-${row}-${dx}`, 'dash', center.x + dx * size, center.z + size / 2, size * 0.3, 0.1);
    } else if (kind === 'cycleway' && below === 'cycleway') {
      for (const dx of [-0.25, 0.25]) this.line(`bike-dash-${column}-${row}-${dx}`, 'bike', center.x + dx * size, center.z + size / 2, size * 0.2, 0.07);
    }
  }

  /** Estende cada tile de borda para fora do mapa (mar continua, rua continua). */
  private addApron(): void {
    const { columns, rows, width, depth, tileSize } = this.map;
    const slab = GRID_CONFIG.floorThickness;
    const strip = (name: string, kind: TileKind, x: number, z: number, w: number, d: number) => {
      const floorKind: TileKind = TILE_TYPES[kind].height > 0 ? 'promenade' : kind;
      const mesh = new Mesh(this.flat, this.floorMaterial(floorKind, 0, 0));
      mesh.name = `apron-${name}`;
      mesh.scale.set(w, slab, d);
      mesh.position.set(x, -slab / 2 - (kind === 'sea' ? SEA_DROP : 0), z);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    };
    const west = -width / 2 - APRON / 2, east = width / 2 + APRON / 2;
    const north = -depth / 2 - APRON / 2, south = depth / 2 + APRON / 2;
    for (let row = 0; row < rows; row++) {
      const z = this.map.cellCenter(0, row).z;
      strip(`w-${row}`, this.map.tileAt(0, row)!, west, z, APRON, tileSize);
      strip(`e-${row}`, this.map.tileAt(columns - 1, row)!, east, z, APRON, tileSize);
    }
    for (let column = 0; column < columns; column++) {
      const x = this.map.cellCenter(column, 0).x;
      strip(`n-${column}`, this.map.tileAt(column, 0)!, x, north, tileSize, APRON);
      strip(`s-${column}`, this.map.tileAt(column, rows - 1)!, x, south, tileSize, APRON);
    }
    strip('nw', this.map.tileAt(0, 0)!, west, north, APRON, APRON);
    strip('ne', this.map.tileAt(columns - 1, 0)!, east, north, APRON, APRON);
    strip('sw', this.map.tileAt(0, rows - 1)!, west, south, APRON, APRON);
    strip('se', this.map.tileAt(columns - 1, rows - 1)!, east, south, APRON, APRON);
  }
}
