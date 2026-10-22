import { BoxGeometry, Color, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GRID_CONFIG, ORLA_CAMERA, ORLA_CROSSING } from '../config';
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

const SEA_LOW = new Color('#68cbd7');
const SEA_HIGH = new Color('#84dfe2');
const { centerX: CROSSING_X, rampHalfWidth: RAMP_HALF_X, roadClearHalfWidth: CROSSING_CLEAR_HALF_X } = ORLA_CROSSING;
/** O mar fica mais baixo que a areia, o que desenha a borda da praia. */
const SEA_DROP = 0.12;
/** Quanto o chão se estende além do mapa, para não aparecer o vazio do fundo. */
const APRON = ORLA_CAMERA.groundApron;
/** Objetos ocupam 94% do tile: ficam como blocos separados, estilo brinquedo. */
const OBJECT_FILL = 0.94;

/** Dona da geometria e dos materiais compartilhados pelos tiles. */
export class GridMapView {
  readonly group = new Group();
  private readonly flat = new BoxGeometry(1, 1, 1);
  private readonly cylinderGeometry = new CylinderGeometry(1, 1, 1, 12);
  private readonly foliageGeometry = new SphereGeometry(1, 12, 8);
  private readonly roundedBoxes = new Map<string, RoundedBoxGeometry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly seaWaves: [MeshStandardMaterial, MeshStandardMaterial];
  private readonly foam: { mesh: Mesh; baseZ: number; phase: number }[] = [];
  private seaSurfaceGeometry: PlaneGeometry | null = null;
  private seaSurfaceBase: Float32Array | null = null;
  private seaSurfaceTime = 0;
  private time = 0;
  private disposed = false;

  constructor(private readonly map: GridMap) {
    this.group.name = 'orla-ground';
    this.group.receiveShadow = true;
    this.seaWaves = [
      this.getMaterial('sea-low', SEA_LOW.getStyle(), 0.35),
      this.getMaterial('sea-high', SEA_HIGH.getStyle(), 0.35),
    ];

    const roadRows = Array.from({ length: map.rows }, (_, row) => row)
      .filter(row => Array.from({ length: map.columns }, (_, column) => map.tileAt(column, row)).includes('road'));
    const firstRoadRow = roadRows.length ? Math.min(...roadRows) : -1;
    const northSidewalkRow = firstRoadRow > 0 ? firstRoadRow - 1 : -1;

    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column++) {
        const kind = map.tileAt(column, row)!;
        const isNorthSidewalk = row === northSidewalkRow && kind === 'cycleway';
        const type = TILE_TYPES[kind];
        const surfaceHeight = kind === 'sea' ? -SEA_DROP : type.height;
        const height = Math.max(0.05, GRID_CONFIG.floorThickness + surfaceHeight);
        const seaShade = row % 2;
        const matKey = kind === 'sea' ? `sea-${seaShade}` : isNorthSidewalk ? 'north-sidewalk' : kind;
        const color = kind === 'sea' ? (seaShade ? SEA_LOW.getStyle() : SEA_HIGH.getStyle())
          : isNorthSidewalk ? '#d7d3c8' : type.color;
        const roughness = kind === 'sea' ? 0.35 : kind === 'road' ? 0.92 : GRID_CONFIG.roughness;

        const tile = new Mesh(this.flat, this.getMaterial(matKey, color, roughness));
        const center = map.cellCenter(column, row);
        tile.name = `tile-${column}-${row}-${kind}`;
        tile.scale.set(map.tileSize, height, map.tileSize);
        tile.position.set(center.x, surfaceHeight - height / 2, center.z);
        tile.castShadow = type.height > 0;
        tile.receiveShadow = true;
        this.group.add(tile);
      }
    }

    if (roadRows.length) {
      this.buildSeaAndBeachDetails(map);
      this.buildWaterRipples(map);
      this.buildPromenadeDetails(map);
      this.buildCyclewayDetails(map, northSidewalkRow - 1);
      this.buildNorthSidewalk(map, northSidewalkRow);
      this.buildEscapeMedian(map, roadRows);
      this.buildRoadMarkings(map, roadRows);
      this.buildSouthSidewalk(map, Math.max(...roadRows));
      this.buildCoastalGarden(map);
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

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.time += dt;
    this.animateOceanSurface(dt);
    for (const foam of this.foam) {
      foam.mesh.position.z = foam.baseZ + Math.sin(this.time * 1.4 + foam.phase) * 0.045;
    }
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
    const mesh = new Mesh(this.flat, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildSeaAndBeachDetails(map: GridMap): void {
    const foamMat = this.material('sea-foam', '#ecffff', { transparent: true, opacity: 0.82 });
    const wetSandMat = this.getMaterial('wet-sand', '#e5c590', 0.8);
    const firstSandRow = Array.from({ length: map.rows }, (_, row) => row).find(row => map.tileAt(0, row) === 'ground') ?? 2;
    const shoreZ = map.cellCenter(0, firstSandRow).z - map.tileSize / 2;
    this.buildOceanSurface(map, shoreZ);

    // A borda acompanha a faixa de areia ampliada, sem alterar a avenida.
    this.addBox('beach-wet-sand', wetSandMat, 0, .002, shoreZ + .32, map.width, .008, .64);

    // Linhas de espuma das ondas quebrando na costa
    for (let i = 0; i < 8; i++) {
      const segWidth = map.width / 8 - 0.35;
      const x = -map.width / 2 + (i + 0.5) * (map.width / 8);
      const zOffset = (i % 2 === 0 ? -0.06 : 0.05);
      const primary = this.addRoundedSurface(`sea-foam-primary-${i}`, foamMat, x, -0.059, shoreZ - .12 + zOffset, segWidth, 0.014, 0.12, 0.055);
      const secondary = this.addRoundedSurface(`sea-foam-secondary-${i}`, foamMat, x + 0.25, -0.061, shoreZ - .65 - zOffset, segWidth * 0.72, 0.012, 0.075, 0.035);
      this.foam.push({ mesh: primary, baseZ: primary.position.z, phase: i * 0.7 });
      this.foam.push({ mesh: secondary, baseZ: secondary.position.z, phase: i * 0.7 + 1.2 });
    }
  }

  private buildOceanSurface(map: GridMap, shoreZ: number): void {
    const depth = Math.max(map.tileSize * 11, 28);
    const geometry = new PlaneGeometry(map.width + Math.max(APRON * 2, 40), depth, 48, 20);
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const base = new Float32Array(position.count * 3);
    const shore = new Color('#8be0d4');
    const shallows = new Color('#46c3cf');
    const deep = new Color('#258fac');
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index), y = position.getY(index);
      base[index * 3] = x;
      base[index * 3 + 1] = y;
      base[index * 3 + 2] = 0;
      const distanceFromShore = (y + depth / 2) / depth;
      const color = distanceFromShore < 0.48
        ? shore.clone().lerp(shallows, distanceFromShore / 0.48)
        : shallows.clone().lerp(deep, (distanceFromShore - 0.48) / 0.52);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    const material = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.3, metalness: 0.04, flatShading: true });
    this.materials.set('ocean-surface', material);
    this.seaSurfaceGeometry = geometry;
    this.seaSurfaceBase = base;
    const ocean = new Mesh(geometry, material);
    ocean.name = 'stylized-ocean-surface';
    ocean.rotation.x = -Math.PI / 2;
    ocean.position.set(0, -0.095, shoreZ - depth / 2);
    ocean.receiveShadow = false;
    ocean.renderOrder = 1;
    this.group.add(ocean);
    this.animateOceanSurface(0);
  }

  private animateOceanSurface(delta: number): void {
    const geometry = this.seaSurfaceGeometry;
    const base = this.seaSurfaceBase;
    if (!geometry || !base) return;
    this.seaSurfaceTime += Math.max(0, delta);
    const positions = geometry.attributes.position;
    for (let index = 0; index < positions.count; index++) {
      const x = base[index * 3], y = base[index * 3 + 1];
      const swell = Math.sin(x * 0.22 + this.seaSurfaceTime * 0.55) * 0.012
        + Math.cos(y * 0.34 - this.seaSurfaceTime * 0.42) * 0.006;
      positions.setXYZ(index, x, y, swell);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
  }

  private addRoundedSurface(name: string, material: MeshStandardMaterial, x: number, y: number, z: number,
    width: number, height: number, depth: number, radius: number): Mesh {
    const mesh = new Mesh(this.roundedBox(width, height, depth, radius), material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    return mesh;
  }

  /** Ondas pequenas e suaves, com brilho pastel e movimento lento. */
  private buildWaterRipples(map: GridMap): void {
    const rippleMaterial = this.getMaterial('water-ripple', '#c3f4ed', 0.45, '#8cdee0', 0.12);
    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column += 2) {
        if (map.tileAt(column, row) !== 'sea') continue;
        const center = map.cellCenter(column, row);
        const length = 0.65 + (column % 3) * 0.12;
        const mesh = new Mesh(this.roundedBox(length, 0.018, 0.09, 0.035), rippleMaterial);
        mesh.name = `water-ripple-${column}-${row}`;
        mesh.position.set(center.x, -SEA_DROP + 0.055, center.z + ((column / 2) % 2 ? 0.28 : -0.28));
        mesh.rotation.y = (column % 3 - 1) * 0.12;
        mesh.receiveShadow = true;
        this.group.add(mesh);
        this.foam.push({ mesh, baseZ: mesh.position.z, phase: column * 0.48 + row });
      }
    }
  }

  private buildPromenadeDetails(map: GridMap): void {
    const paving = this.getMaterial('promenade-paving', '#eee5d2', .94);
    const joint = this.getMaterial('promenade-fine-joint', '#d9d2c0', .95);
    const edge = this.getMaterial('promenade-beach-edge', '#e3d5b7', .92);
    const promenadeRows = Array.from({ length: map.rows }, (_, row) => row)
      .filter(row => Array.from({ length: map.columns }, (_, column) => map.tileAt(column, row)).includes('promenade'));
    const firstRow = Math.min(...promenadeRows), lastRow = Math.max(...promenadeRows);
    const northEdgeZ = map.cellCenter(0, firstRow).z - map.tileSize / 2;
    const southEdgeZ = map.cellCenter(0, lastRow).z + map.tileSize / 2;
    const centerZ = (northEdgeZ + southEdgeZ) / 2;
    const depth = southEdgeZ - northEdgeZ;
    this.addBox('promenade-continuous-paving', paving, 0, .002, centerZ, map.width, .006, depth);
    for (let i = 1; i < map.columns; i++) {
      const x = -map.width / 2 + i * map.tileSize;
      this.addBox('promenade-paving-joint', joint, x, .006, centerZ, .012, .003, depth - 0.2);
    }
    this.addBox('promenade-paving-center-joint', joint, 0, .006, centerZ, map.width, .003, .012);
    this.addBox('beach-flush-border', edge, 0, .012, northEdgeZ, map.width, .025, .12);
    this.addBox('promenade-south-curb', edge, 0, .018, southEdgeZ - 0.04, map.width, .045, .09);
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

  }

  /** Coqueiros espaçados e bancos junto ao calçadão, com a areia aberta ao fundo. */
  private buildCoastalGarden(map: GridMap): void {
    const trunkMaterial = this.getMaterial('palm-trunk', '#bd936e');
    const leavesMaterial = this.getMaterial('palm-leaves', '#85ad7b');
    const wood = this.getMaterial('beach-bench', '#d8ac7d');
    const frame = this.getMaterial('bench-frame', '#7c9089');
    for (const x of [-17, -8, 6, 17]) {
      const trunk = new Mesh(this.cylinderGeometry, trunkMaterial);
      trunk.name = 'beach-palm-trunk'; trunk.position.set(x, .95, -4.4);
      trunk.scale.set(.09, 1.9, .09); trunk.castShadow = true; this.group.add(trunk);
      for (let leaf = 0; leaf < 6; leaf++) {
        const angle = leaf * Math.PI / 3;
        const mesh = new Mesh(this.foliageGeometry, leavesMaterial);
        mesh.name = 'beach-palm-leaf';
        mesh.position.set(x + Math.cos(angle) * .45, 1.95, -4.4 + Math.sin(angle) * .45);
        mesh.scale.set(.85, .09, .23); mesh.rotation.y = -angle;
        mesh.castShadow = true; this.group.add(mesh);
      }
      this.addBox('beach-bench-seat', wood, x, .33, -2.65, 1.25, .09, .36, true);
      this.addBox('beach-bench-back', wood, x, .56, -2.83, 1.25, .36, .065, true);
      for (const side of [-1, 1]) this.addBox('beach-bench-leg', frame, x + side * .46, .15, -2.65, .06, .3, .28, true);
    }
    // Fundo marítimo apenas visual; a área jogável continua com a mesma profundidade.
    this.addBox('ocean-horizon', this.getMaterial('ocean-horizon', '#68cbd7', .4), 0, -.22, -25, map.width + 40, .2, 30);
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
    const roadMinZ = Math.min(...roadRows.map(row => map.cellCenter(0, row).z - map.tileSize / 2));

    const whiteMarkingMat = this.getMaterial('road-marking-white', '#eef0eb', 0.8);
    const yellowMarkingMat = this.getMaterial('road-marking-yellow', '#f0be37', 0.78);
    const escapeEdgeMat = this.getMaterial('road-marking-escape-edge', '#d8e5d8', 0.8);

    // A faixa de escape tem pavimento mais largo e fica isolada pelo canteiro.
    for (let column = 0; column < map.columns; column++) {
      const x = map.cellCenter(column, roadRows[0]).x;
      if (Math.abs(x - CROSSING_X) < CROSSING_CLEAR_HALF_X) continue;

      this.addBox(`escape-lane-edge-${column}`, escapeEdgeMat, x, -0.009, roadMinZ + 0.14, map.tileSize * 0.82, 0.02, 0.045);
      for (const [divider, z] of [[2, roadMinZ + map.tileSize * 1.8], [4, roadMinZ + map.tileSize * 2.6]] as const) {
        this.addBox(`road-lane-divider-${column}-${divider}`, whiteMarkingMat, x, -0.01, z, map.tileSize * 0.44, 0.02, 0.045);
      }
    }

    // Dupla linha amarela contínua entre os sentidos (interrompida na faixa de pedestres).
    const centerZ = roadMinZ + map.tileSize * 2.2;
    const leftSpan = (CROSSING_X - CROSSING_CLEAR_HALF_X) - (-map.width / 2);
    const leftCenterX = -map.width / 2 + leftSpan / 2;
    const rightSpan = (map.width / 2) - (CROSSING_X + CROSSING_CLEAR_HALF_X);
    const rightCenterX = (CROSSING_X + CROSSING_CLEAR_HALF_X) + rightSpan / 2;

    for (const offsetZ of [-0.045, 0.045]) {
      this.addBox(`road-double-yellow-w-${offsetZ}`, yellowMarkingMat, leftCenterX, -0.009, centerZ + offsetZ, leftSpan, 0.022, 0.042);
      this.addBox(`road-double-yellow-e-${offsetZ}`, yellowMarkingMat, rightCenterX, -0.009, centerZ + offsetZ, rightSpan, 0.022, 0.042);
    }
  }

  /** Canteiro baixo separa visualmente a faixa de escape do fluxo principal. */
  private buildEscapeMedian(map: GridMap, roadRows: number[]): void {
    const roadMinZ = Math.min(...roadRows.map(row => map.cellCenter(0, row).z - map.tileSize / 2));
    const medianZ = roadMinZ + map.tileSize * 1.1;
    const curb = this.getMaterial('escape-median-curb', '#a9a494', 0.88);
    const soil = this.getMaterial('escape-median-soil', '#806246', 0.95);
    const greens = [
      this.getMaterial('escape-median-green-dark', '#31794c', 0.86),
      this.getMaterial('escape-median-green', '#53a35f', 0.84),
      this.getMaterial('escape-median-green-light', '#83bd68', 0.82),
    ];
    const crossingHalf = CROSSING_CLEAR_HALF_X + 0.6;
    const endOpening = 2.4; // deixa livres as ligações da via de escape nas pontas

    for (let column = 0; column < map.columns; column++) {
      const x = map.cellCenter(column, roadRows[0]).x;
      if (Math.abs(x - CROSSING_X) < crossingHalf || x < -map.width / 2 + endOpening || x > map.width / 2 - endOpening) continue;

      // Os módulos encostam para o canteiro parecer uma barreira contínua entre as pistas.
      const length = map.tileSize * 1.02;
      this.addBox(`escape-median-stone-${column}`, curb, x, 0.07, medianZ, length, 0.14, 0.32, true);
      this.addBox(`escape-median-planter-${column}`, soil, x, 0.155, medianZ, length - 0.12, 0.035, 0.22);

      for (let plant = 0; plant < 4; plant++) {
        const shrub = new Mesh(this.foliageGeometry, greens[(column + plant) % greens.length]);
        shrub.name = `escape-median-shrub-${column}-${plant}`;
        shrub.position.set(x + (plant - 1.5) * 0.42, 0.235 + (plant % 2) * 0.018, medianZ + (plant % 2 ? 0.055 : -0.055));
        shrub.scale.set(0.2, 0.21, 0.18);
        shrub.castShadow = true;
        shrub.receiveShadow = true;
        this.group.add(shrub);
      }
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
    this.flat.dispose();
    this.cylinderGeometry.dispose();
    this.foliageGeometry.dispose();
    this.seaSurfaceGeometry?.dispose();
    this.seaSurfaceGeometry = null;
    this.seaSurfaceBase = null;
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
