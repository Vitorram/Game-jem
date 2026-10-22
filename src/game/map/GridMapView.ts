import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, TorusGeometry } from 'three';
import { GRID_CONFIG } from '../config';
import { GridMap, TILE_TYPES, type TileKind } from './GridMap';

const CROSSING_X = 1;
const CROSSING_CLEAR_HALF_X = 1.65;
const RAMP_HALF_X = 0.98;

/** Dona da geometria e dos materiais compartilhados pelos tiles, calçadas, ciclovia e via. */
export class GridMapView {
  readonly group = new Group();
  private readonly geometry = new BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new CylinderGeometry(0.08, 0.08, 1, 10);
  private readonly bikeWheelGeometry = new TorusGeometry(0.16, 0.028, 6, 16);
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private disposed = false;

  constructor(map: GridMap) {
    this.group.name = 'orla-ground';
    this.group.receiveShadow = true;

    const roadRows = Array.from({ length: map.rows }, (_, row) => row)
      .filter(row => Array.from({ length: map.columns }, (_, column) => map.tileAt(column, row)).includes('road'));
    const firstRoadRow = roadRows.length ? Math.min(...roadRows) : -1;
    const northSidewalkRow = firstRoadRow > 0 ? firstRoadRow - 1 : -1;

    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column++) {
        const kind = map.tileAt(column, row)!;
        const isNorthSidewalk = row === northSidewalkRow && kind === 'cycleway';
        const surfaceOffset = this.getSurfaceOffset(kind, isNorthSidewalk);
        const type = TILE_TYPES[kind];
        const height = Math.max(0.05, GRID_CONFIG.floorThickness + type.height + surfaceOffset);
        const matKey = isNorthSidewalk ? 'north-sidewalk' : kind;
        const color = isNorthSidewalk ? '#d7d3c8' : type.color;
        const roughness = kind === 'sea' ? 0.35 : kind === 'road' ? 0.92 : GRID_CONFIG.roughness;

        const tile = new Mesh(this.geometry, this.getMaterial(matKey, color, roughness));
        const center = map.cellCenter(column, row);
        tile.name = `tile-${column}-${row}-${kind}`;
        tile.scale.set(map.tileSize, height, map.tileSize);
        tile.position.set(center.x, height / 2 - GRID_CONFIG.floorThickness, center.z);
        tile.castShadow = type.height > 0;
        tile.receiveShadow = true;
        this.group.add(tile);
      }
    }

    if (roadRows.length) {
      this.buildSeaAndBeachDetails(map);
      this.buildPromenadeDetails(map);
      this.buildCyclewayDetails(map, northSidewalkRow - 1);
      this.buildNorthSidewalk(map, northSidewalkRow);
      this.buildRoadMarkings(map, roadRows);
      this.buildSouthSidewalk(map, Math.max(...roadRows));
    }
  }

  private getSurfaceOffset(kind: TileKind, isNorthSidewalk: boolean): number {
    if (isNorthSidewalk) return 0.02;
    switch (kind) {
      case 'sea': return -0.12;
      case 'ground': return -0.05;
      case 'promenade': return 0;
      case 'cycleway': return -0.012;
      case 'road': return -0.03;
      default: return 0;
    }
  }

  private getMaterial(key: string, color: string, roughness: number = GRID_CONFIG.roughness, emissive?: string, emissiveIntensity = 0): MeshStandardMaterial {
    let material = this.materials.get(key);
    if (!material) {
      material = new MeshStandardMaterial({
        color,
        roughness,
        ...(emissive ? { emissive, emissiveIntensity } : {}),
      });
      this.materials.set(key, material);
    }
    return material;
  }

  private addBox(
    name: string,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    castShadow = false,
  ): Mesh {
    const mesh = new Mesh(this.geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildSeaAndBeachDetails(map: GridMap): void {
    const foamMat = this.getMaterial('sea-foam', '#e8f6f8', 0.45);
    const wetSandMat = this.getMaterial('wet-sand', '#cfa15a', 0.65);

    // Faixa de areia úmida na transição entre o mar (Z = -6) e a areia seca
    this.addBox('beach-wet-sand', wetSandMat, 0, -0.075, -5.85, map.width, 0.02, 0.48);

    // Linhas de espuma das ondas quebrando na costa
    for (let i = 0; i < 8; i++) {
      const segWidth = map.width / 8 - 0.35;
      const x = -map.width / 2 + (i + 0.5) * (map.width / 8);
      const zOffset = (i % 2 === 0 ? -0.06 : 0.05);
      this.addBox(`sea-foam-primary-${i}`, foamMat, x, -0.108, -6.12 + zOffset, segWidth, 0.016, 0.14);
      this.addBox(`sea-foam-secondary-${i}`, foamMat, x + 0.25, -0.112, -6.65 - zOffset, segWidth * 0.72, 0.012, 0.08);
    }
  }

  private buildPromenadeDetails(map: GridMap): void {
    const wallMat = this.getMaterial('promenade-low-wall', '#d2ccc0', 0.82);
    const capMat = this.getMaterial('promenade-wall-cap', '#e8e3d8', 0.75);
    const darkStoneMat = this.getMaterial('promenade-mosaic-dark', '#454950', 0.88);
    const lightStoneMat = this.getMaterial('promenade-mosaic-light', '#ebe6dc', 0.85);
    const curbMat = this.getMaterial('granite-curb', '#9ea4aa', 0.8);

    // Mureta costeira entre a areia (Z = -2) e o calçadão, com aberturas de acesso à praia
    const wallZ = -2.0;
    for (let col = 0; col < map.columns; col++) {
      // Aberturas de escadaria/rampa nas colunas 4 e 12
      if (col === 4 || col === 12) {
        const cx = map.cellCenter(col, 3).x;
        this.addBox(`beach-step-1-${col}`, capMat, cx, -0.015, wallZ - 0.12, map.tileSize * 0.9, 0.03, 0.22);
        this.addBox(`beach-step-2-${col}`, lightStoneMat, cx, -0.035, wallZ - 0.32, map.tileSize * 0.9, 0.03, 0.22);
        continue;
      }
      const cx = map.cellCenter(col, 4).x;
      this.addBox(`seawall-body-${col}`, wallMat, cx, 0.055, wallZ, map.tileSize, 0.11, 0.16, true);
      this.addBox(`seawall-cap-${col}`, capMat, cx, 0.12, wallZ, map.tileSize + 0.02, 0.025, 0.2, true);

      if (col % 2 === 0) {
        const post = new Mesh(this.cylinderGeometry, capMat);
        post.name = `seawall-post-${col}`;
        post.scale.set(1, 0.24, 1);
        post.position.set(cx - map.tileSize / 2 + 0.08, 0.12, wallZ);
        post.castShadow = true;
        post.receiveShadow = true;
        this.group.add(post);
      }
    }

    // Paginação de mosaico português nos tiles de calçadão (rows 4 e 5)
    for (const row of [4, 5]) {
      for (let col = 0; col < map.columns; col++) {
        if (map.tileAt(col, row) !== 'promenade') continue;
        const center = map.cellCenter(col, row);
        // Faixas de onda/geométricas inspiradas em calçadão de orla
        this.addBox(`promenade-band-a-${col}-${row}`, darkStoneMat, center.x, 0.004, center.z - 0.55, map.tileSize * 0.92, 0.008, 0.14);
        this.addBox(`promenade-band-b-${col}-${row}`, darkStoneMat, center.x, 0.004, center.z + 0.55, map.tileSize * 0.92, 0.008, 0.14);
        const diamondMat = (col + row) % 2 === 0 ? darkStoneMat : lightStoneMat;
        this.addBox(`promenade-center-tile-${col}-${row}`, diamondMat, center.x, 0.005, center.z, 0.58, 0.009, 0.58);
      }
    }

    // Meio-fio sul do calçadão na divisa com a ciclovia (Z = +1.96)
    this.addBox('promenade-south-curb', curbMat, 0, 0.018, 1.96, map.width, 0.045, 0.09);
  }

  private buildCyclewayDetails(map: GridMap, cycleRow: number): void {
    if (cycleRow < 0) return;
    const cycleZ = map.cellCenter(0, cycleRow).z; // Z = 3.0
    const northEdgeZ = cycleZ - map.tileSize / 2; // Z = 2.0
    const southEdgeZ = cycleZ + map.tileSize / 2; // Z = 4.0

    const borderWhiteMat = this.getMaterial('cycle-border-white', '#f5f2e6', 0.78);
    const centerLineMat = this.getMaterial('cycle-center-yellow', '#f2c94c', 0.78);
    const studBodyMat = this.getMaterial('cycle-stud-yellow', '#ebb434', 0.65, '#593e00', 0.15);

    // Linhas contínuas brancas de bordo (norte e sul da ciclovia)
    this.addBox('cycleway-border-north', borderWhiteMat, 0, -0.003, northEdgeZ + 0.14, map.width, 0.012, 0.07);
    this.addBox('cycleway-border-south', borderWhiteMat, 0, -0.003, southEdgeZ - 0.14, map.width, 0.012, 0.07);

    // Linha tracejada central dividindo as duas mãos da ciclovia e tachões segregadores
    const studCount = map.columns * 2;
    for (let i = 0; i < studCount; i++) {
      const x = -map.width / 2 + (i + 0.5) * (map.width / studCount);
      if (Math.abs(x - CROSSING_X) < RAMP_HALF_X + 0.25) continue;

      // Tracejado central da ciclovia
      this.addBox(`cycleway-center-dash-${i}`, centerLineMat, x, -0.002, cycleZ, 0.44, 0.012, 0.055);

      // Tachões refletivos (tartarugas) nas duas bordas da ciclovia
      this.addBox(`cycleway-stud-n-${i}`, studBodyMat, x, 0.012, northEdgeZ + 0.04, 0.14, 0.028, 0.08);
      this.addBox(`cycleway-stud-s-${i}`, studBodyMat, x, 0.012, southEdgeZ - 0.04, 0.14, 0.028, 0.08);
    }

    // Pictogramas de bicicleta pintados no piso vermelho a cada trecho
    for (const bx of [-11.5, -5.0, 5.5, 11.5]) {
      this.buildBikePictogram(bx, cycleZ - 0.44, 1, borderWhiteMat);
      this.buildBikePictogram(bx, cycleZ + 0.44, -1, borderWhiteMat);
    }
  }

  private buildBikePictogram(x: number, z: number, dir: 1 | -1, material: MeshStandardMaterial): void {
    const y = -0.001;
    for (const wx of [-0.22, 0.22]) {
      const wheel = new Mesh(this.bikeWheelGeometry, material);
      wheel.name = `cycleway-pictogram-wheel-${x}-${z}-${wx}`;
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x + wx, y, z);
      wheel.scale.set(0.85, 0.85, 0.4);
      wheel.receiveShadow = true;
      this.group.add(wheel);
    }
    // Quadro e guidão estilizados no chão
    this.addBox(`cycleway-pictogram-frame-${x}-${z}`, material, x, y, z, 0.34, 0.008, 0.045);
    this.addBox(`cycleway-pictogram-handle-${x}-${z}`, material, x + dir * 0.16, y, z, 0.045, 0.008, 0.24);
  }

  private buildNorthSidewalk(map: GridMap, row: number): void {
    if (row < 0) return;
    const centerZ = map.cellCenter(0, row).z; // Z = 5.0
    const roadEdgeZ = centerZ + map.tileSize / 2; // Z = 6.0

    const jointMat = this.getMaterial('sidewalk-joint', '#b5b0a4', 0.9);
    const curbMat = this.getMaterial('granite-curb', '#9ea4aa', 0.8);
    const gutterMat = this.getMaterial('concrete-gutter', '#787f85', 0.88);
    const grateMat = this.getMaterial('drain-grate', '#23282d', 0.7);
    const planterMat = this.getMaterial('sidewalk-planter-border', '#8e887c', 0.85);
    const grassMat = this.getMaterial('sidewalk-grass', '#4f8a4b', 0.85);

    // Juntas de dilatação das placas de concreto da calçada norte
    for (let i = 1; i < map.columns * 2; i++) {
      const x = -map.width / 2 + i * (map.tileSize / 2);
      this.addBox(`north-sidewalk-joint-x-${i}`, jointMat, x, 0.022, centerZ, 0.025, 0.006, map.tileSize - 0.14);
    }
    this.addBox('north-sidewalk-joint-z', jointMat, 0, 0.022, centerZ, map.width, 0.006, 0.025);

    // Meio-fio de granito e sarjeta ao longo de Z = 6.0 (interrompidos na rampa da faixa de pedestres)
    const leftSpan = (CROSSING_X - RAMP_HALF_X) - (-map.width / 2);
    const leftCenterX = -map.width / 2 + leftSpan / 2;
    const rightSpan = (map.width / 2) - (CROSSING_X + RAMP_HALF_X);
    const rightCenterX = (CROSSING_X + RAMP_HALF_X) + rightSpan / 2;

    this.addBox('north-curb-west', curbMat, leftCenterX, 0.042, roadEdgeZ - 0.06, leftSpan, 0.065, 0.12, true);
    this.addBox('north-curb-east', curbMat, rightCenterX, 0.042, roadEdgeZ - 0.06, rightSpan, 0.065, 0.12, true);

    // Sarjeta de concreto rente ao meio-fio
    this.addBox('north-gutter', gutterMat, 0, -0.022, roadEdgeZ + 0.08, map.width, 0.016, 0.16);

    // Grelhas de bueiro de águas pluviais
    for (const drainX of [-12, -4, 6, 13]) {
      this.addBox(`north-drain-${drainX}`, grateMat, drainX, -0.012, roadEdgeZ + 0.08, 0.56, 0.018, 0.15);
    }

    // Pequenos canteiros gramados nivelados junto à borda da calçada (fora do caminho de pedestres e longe do poste quebrado em X=-9)
    for (const px of [-13.5, -3.5, 7.5, 13.5]) {
      this.addBox(`north-planter-frame-${px}`, planterMat, px, 0.032, roadEdgeZ - 0.34, 0.92, 0.028, 0.42);
      this.addBox(`north-planter-grass-${px}`, grassMat, px, 0.042, roadEdgeZ - 0.34, 0.78, 0.02, 0.28);
    }
  }

  private buildRoadMarkings(map: GridMap, roadRows: number[]): void {
    const roadMinZ = Math.min(...roadRows.map(row => map.cellCenter(0, row).z - map.tileSize / 2)); // Z = 6.0
    const roadMaxZ = Math.max(...roadRows.map(row => map.cellCenter(0, row).z + map.tileSize / 2)); // Z = 10.0
    const spanZ = roadMaxZ - roadMinZ; // 4.0

    const whiteMarkingMat = this.getMaterial('road-marking-white', '#eef0eb', 0.8);
    const yellowMarkingMat = this.getMaterial('road-marking-yellow', '#f0be37', 0.78);
    const escapeDashMat = this.getMaterial('road-marking-escape', '#b8d8cc', 0.8);

    // Divisórias das 5 faixas (1 escape + 2 leste + 2 oeste):
    // divider 1 (Z = 6.8): separa faixa de escape (6.4) da Leste 1 (7.2)
    // divider 2 (Z = 7.6): separa Leste 1 (7.2) da Leste 2 (8.0)
    // divider 3 (Z = 8.4): eixo central duplo amarelo entre Leste (8.0) e Oeste (8.8)
    // divider 4 (Z = 9.2): separa Oeste 1 (8.8) da Oeste 2 (9.6)
    const laneCount = 5;
    for (let column = 0; column < map.columns; column++) {
      const x = map.cellCenter(column, roadRows[0]).x;
      if (Math.abs(x - CROSSING_X) < CROSSING_CLEAR_HALF_X) continue;

      const zEscape = roadMinZ + spanZ * (1 / laneCount);
      this.addBox(`road-lane-divider-${column}-1`, escapeDashMat, x, -0.01, zEscape, map.tileSize * 0.46, 0.02, 0.04);

      for (const divider of [2, 4]) {
        const z = roadMinZ + spanZ * (divider / laneCount);
        this.addBox(`road-lane-divider-${column}-${divider}`, whiteMarkingMat, x, -0.01, z, map.tileSize * 0.44, 0.02, 0.045);
      }
    }

    // Dupla linha amarela contínua central em Z = 8.4 (interrompida na faixa de pedestres)
    const centerZ = roadMinZ + spanZ * (3 / laneCount);
    const leftSpan = (CROSSING_X - CROSSING_CLEAR_HALF_X) - (-map.width / 2);
    const leftCenterX = -map.width / 2 + leftSpan / 2;
    const rightSpan = (map.width / 2) - (CROSSING_X + CROSSING_CLEAR_HALF_X);
    const rightCenterX = (CROSSING_X + CROSSING_CLEAR_HALF_X) + rightSpan / 2;

    for (const offsetZ of [-0.045, 0.045]) {
      this.addBox(`road-double-yellow-w-${offsetZ}`, yellowMarkingMat, leftCenterX, -0.009, centerZ + offsetZ, leftSpan, 0.022, 0.042);
      this.addBox(`road-double-yellow-e-${offsetZ}`, yellowMarkingMat, rightCenterX, -0.009, centerZ + offsetZ, rightSpan, 0.022, 0.042);
    }
  }

  private buildSouthSidewalk(map: GridMap, lastRoadRow: number): void {
    const roadSouthEdgeZ = map.cellCenter(0, lastRoadRow).z + map.tileSize / 2; // Z = 10.0
    const sidewalkDepth = 2.2;
    const sidewalkCenterZ = roadSouthEdgeZ + sidewalkDepth / 2; // Z = 11.1

    const sidewalkMat = this.getMaterial('south-sidewalk', '#d7d3c8', 0.88);
    const jointMat = this.getMaterial('sidewalk-joint', '#b5b0a4', 0.9);
    const curbMat = this.getMaterial('granite-curb', '#9ea4aa', 0.8);
    const gutterMat = this.getMaterial('concrete-gutter', '#787f85', 0.88);
    const grateMat = this.getMaterial('drain-grate', '#23282d', 0.7);
    const borderTrimMat = this.getMaterial('south-lot-border', '#b8b2a4', 0.85);

    // Base da Calçada Sul (do outro lado da avenida)
    const slabHeight = GRID_CONFIG.floorThickness + 0.02;
    this.addBox('south-sidewalk-slab', sidewalkMat, 0, slabHeight / 2 - GRID_CONFIG.floorThickness, sidewalkCenterZ, map.width, slabHeight, sidewalkDepth);

    // Juntas das placas da Calçada Sul
    for (let i = 1; i < map.columns * 2; i++) {
      const x = -map.width / 2 + i * (map.tileSize / 2);
      this.addBox(`south-sidewalk-joint-x-${i}`, jointMat, x, 0.022, sidewalkCenterZ, 0.025, 0.006, sidewalkDepth - 0.16);
    }
    this.addBox('south-sidewalk-joint-z', jointMat, 0, 0.022, sidewalkCenterZ, map.width, 0.006, 0.025);

    // Sarjeta Sul (Z = 9.92) + Bueiros
    this.addBox('south-gutter', gutterMat, 0, -0.022, roadSouthEdgeZ - 0.08, map.width, 0.016, 0.16);
    for (const drainX of [-10, -2, 8, 14]) {
      this.addBox(`south-drain-${drainX}`, grateMat, drainX, -0.012, roadSouthEdgeZ - 0.08, 0.56, 0.018, 0.15);
    }

    // Meio-fio de granito Sul (interrompido na rampa da faixa de pedestres)
    const leftSpan = (CROSSING_X - RAMP_HALF_X) - (-map.width / 2);
    const leftCenterX = -map.width / 2 + leftSpan / 2;
    const rightSpan = (map.width / 2) - (CROSSING_X + RAMP_HALF_X);
    const rightCenterX = (CROSSING_X + RAMP_HALF_X) + rightSpan / 2;

    this.addBox('south-curb-west', curbMat, leftCenterX, 0.042, roadSouthEdgeZ + 0.06, leftSpan, 0.065, 0.12, true);
    this.addBox('south-curb-east', curbMat, rightCenterX, 0.042, roadSouthEdgeZ + 0.06, rightSpan, 0.065, 0.12, true);

    // Guia de fechamento sul (alinhamento predial em Z = 12.15)
    this.addBox('south-building-line-curb', borderTrimMat, 0, 0.045, roadSouthEdgeZ + sidewalkDepth - 0.05, map.width, 0.05, 0.1);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.geometry.dispose();
    this.cylinderGeometry.dispose();
    this.bikeWheelGeometry.dispose();
    this.materials.forEach(material => material.dispose());
    this.materials.clear();
    this.group.clear();
  }
}
