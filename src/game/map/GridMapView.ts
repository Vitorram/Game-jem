import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { GRID_CONFIG } from '../config';
import { GridMap, TILE_TYPES, type TileKind } from './GridMap';
import { ROAD_LAYOUT } from './roadLayout';
import { TextureLibrary, type TextureKey } from './proceduralTextures';

/** Cor do tampo de cada objeto sólido (fica 0,05 acima do topo; itens pousam 0,08 acima). */
const TOP_ACCENT: Partial<Record<TileKind, string>> = {
  counter: '#f6e2b8',
  itemBox: '#2f4b6b',
  station: '#c6f5de',
  wall: '#b3a5c8',
};

const MARK_COLORS = {
  dash: '#f7e9b0',
  edge: '#f4f1ea',
  bike: '#fbe6da',
  electric: '#178568',
} as const;

type MarkKind = keyof typeof MARK_COLORS;

/** Textura procedural colorida usada por cada tile. */
const TILE_TEXTURE: Record<TileKind, TextureKey> = {
  ground: 'sand',
  promenade: 'promenade',
  cycleway: 'cycleway',
  road: 'road',
  sea: 'sea',
  wall: 'plaster',
  counter: 'panel',
  itemBox: 'crate',
  station: 'panel',
};

/**
 * Relevo propositalmente discreto. Em visão superior, valores altos deixam o
 * piso cintilando e criam ruído visual em vez de dar materialidade.
 */
const BUMP_SCALE: Partial<Record<TextureKey, number>> = {
  sand: 0.018,
  wetSand: 0.01,
  promenade: 0.012,
  road: 0.01,
  cycleway: 0.008,
  sea: 0.006,
  plaster: 0.015,
  crate: 0.012,
  panel: 0.006,
  grain: 0.004,
};

/** Cores dos seixos e conchas espalhados na areia. */
const PEBBLE_COLORS = ['#fff6e0', '#f1d8b4', '#dcc09a', '#c9ad86', '#f7efe2'];

const SEA_LOW = new Color('#22a3bf');
const SEA_HIGH = new Color('#55d0e2');

/** O mar fica mais baixo que a areia, o que desenha a borda da praia. */
const SEA_DROP = 0.12;

/** Quanto o chão se estende além do mapa, para não aparecer o vazio do fundo. */
const APRON = 30;

/** Objetos ocupam 94% do tile: ficam como blocos separados, estilo brinquedo. */
const OBJECT_FILL = 0.94;

/** Fração do tile de areia coberta pela faixa molhada junto ao mar. */
const WET_SAND_DEPTH = 0.42;

/** Decoração visual da orla: não participa da colisão do GridMap. */
const PALM_COLORS = {
  trunk: '#8e613d',
  trunkLight: '#b98550',
  leaf: '#4c8c58',
  leafLight: '#6cad66',
} as const;

const UMBRELLA_COLORS = ['#e76b5f', '#e8ad4b', '#4b91ae', '#e67c9a', '#6d9b72'];

const BENCH_COLORS = {
  wood: '#9b6b43',
  metal: '#53636a',
} as const;

const BEACH_DECORATION_COUNT = {
  palms: 14,
  umbrellas: 9,
  shells: 80,
} as const;

/** Colunas da calçada que recebem abrigo de ônibus (índices já no mapa 22 × 12). */
const BUS_STOP_COLUMNS = [4, 17];

/** Colunas da calçada que recebem lixeira; evita as ocupadas pelos abrigos. */
const SIDEWALK_BIN_COLUMNS = [2, 8, 13, 20];

/** Casco de barco: perfil lateral extrudado, com proa pontuda apontando para +X. */
function makeBoatHullGeometry(): ExtrudeGeometry {
  const profile = new Shape();
  profile.moveTo(-0.6, 0);
  profile.lineTo(0.5, 0);
  profile.lineTo(0.74, 0.24);
  profile.lineTo(-0.6, 0.24);
  profile.closePath();

  const geometry = new ExtrudeGeometry(profile, { depth: 0.36, bevelEnabled: false });
  geometry.translate(0, 0, -0.18);
  return geometry;
}

/** Gerador linear com seed fixa: a disposição das pedrinhas não muda entre partidas. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** Dona da geometria e dos materiais compartilhados pelos tiles. */
export class GridMapView {
  readonly group = new Group();

  private readonly flat = new BoxGeometry(1, 1, 1);
  private readonly pebble = new SphereGeometry(1, 7, 5);
  private readonly roundedBoxes = new Map<string, RoundedBoxGeometry>();
  private readonly materials = new Map<string, MeshStandardMaterial>();
  private readonly textures = new TextureLibrary();

  private readonly palmTrunk = new CylinderGeometry(0.09, 0.14, 1, 7);
  /** Frond: base na origem, ponta em +Z, para girar no pivô de cada folha. */
  private readonly palmFrond = (() => {
    const geometry = new BoxGeometry(0.16, 0.025, 0.95);
    geometry.translate(0, 0, 0.475);
    return geometry;
  })();
  private readonly umbrellaPole = new CylinderGeometry(0.035, 0.045, 1, 8);
  private readonly umbrellaTop = new ConeGeometry(0.58, 0.24, 12);
  private readonly chairGeometry = new BoxGeometry(0.34, 0.06, 0.52);
  private readonly benchSeat = new BoxGeometry(0.82, 0.09, 0.26);
  private readonly benchLeg = new BoxGeometry(0.07, 0.35, 0.08);
  private readonly lampPole = new CylinderGeometry(0.045, 0.07, 1.85, 8);
  private readonly lampHead = new SphereGeometry(0.14, 10, 8);
  private readonly binBody = new CylinderGeometry(0.13, 0.16, 0.42, 10);
  private readonly binLid = new CylinderGeometry(0.175, 0.175, 0.05, 10);
  private readonly buoyGeometry = new TorusGeometry(0.17, 0.055, 8, 14);
  private readonly boatHull = makeBoatHullGeometry();
  private readonly boatCabin = new BoxGeometry(0.36, 0.2, 0.28);

  /** Abrigo de ônibus: montante, cobertura, fundo translúcido e placa. */
  private readonly busPost = new CylinderGeometry(0.05, 0.06, 2.1, 8);
  private readonly busRoof = new BoxGeometry(2.5, 0.09, 1.05);
  private readonly busBack = new BoxGeometry(2.4, 1.25, 0.05);
  private readonly busSign = new BoxGeometry(0.52, 0.36, 0.04);

  /** Academia ao ar livre: barras, montantes e plataforma. */
  private readonly gymPost = new CylinderGeometry(0.055, 0.07, 1, 8);
  private readonly gymBar = new CylinderGeometry(0.04, 0.04, 1, 8);
  private readonly gymPlate = new BoxGeometry(0.56, 0.07, 0.34);
  private readonly gymPedal = new BoxGeometry(0.18, 0.06, 0.1);

  private readonly ambienceMaterials = {
    palmTrunk: new MeshStandardMaterial({ color: PALM_COLORS.trunk, roughness: 0.88 }),
    palmTrunkLight: new MeshStandardMaterial({ color: PALM_COLORS.trunkLight, roughness: 0.86 }),
    palmLeaf: new MeshStandardMaterial({ color: PALM_COLORS.leaf, roughness: 0.82 }),
    palmLeafLight: new MeshStandardMaterial({ color: PALM_COLORS.leafLight, roughness: 0.82 }),
    benchWood: new MeshStandardMaterial({ color: BENCH_COLORS.wood, roughness: 0.82 }),
    benchMetal: new MeshStandardMaterial({ color: BENCH_COLORS.metal, roughness: 0.7 }),
    lamp: new MeshStandardMaterial({ color: '#485960', roughness: 0.66 }),
    lampLight: new MeshStandardMaterial({
      color: '#fff1b8',
      emissive: '#f2bd59',
      emissiveIntensity: 0.45,
      roughness: 0.45,
    }),
    bin: new MeshStandardMaterial({ color: '#4f7b73', roughness: 0.75 }),
    binLid: new MeshStandardMaterial({ color: '#2f4b46', roughness: 0.68 }),
    lifeguard: new MeshStandardMaterial({ color: '#e58a4f', roughness: 0.76 }),
    lifeguardLight: new MeshStandardMaterial({ color: '#f6e2b8', roughness: 0.78 }),
    buoy: new MeshStandardMaterial({ color: '#f1d85c', roughness: 0.6 }),
    boat: new MeshStandardMaterial({ color: '#f5f0df', roughness: 0.7 }),
    boatStripe: new MeshStandardMaterial({ color: '#4e91ab', roughness: 0.68 }),
    busMetal: new MeshStandardMaterial({ color: '#3f545e', roughness: 0.62 }),
    busRoof: new MeshStandardMaterial({ color: '#4e91ab', roughness: 0.6 }),
    busGlass: new MeshStandardMaterial({
      color: '#cfe8ef',
      roughness: 0.22,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    busSign: new MeshStandardMaterial({
      color: '#f6e2b8',
      emissive: '#8a6a24',
      emissiveIntensity: 0.18,
      roughness: 0.55,
    }),
    gymFrame: new MeshStandardMaterial({ color: '#d1d6cf', roughness: 0.58 }),
    gymAccent: new MeshStandardMaterial({ color: '#2f6f7e', roughness: 0.62 }),
    gymGrip: new MeshStandardMaterial({ color: '#2b3236', roughness: 0.88 }),
  };

  /** Criados uma vez só; sem isto cada guarda-sol vazaria um material. */
  private readonly umbrellaMaterials = UMBRELLA_COLORS.map(
    color => new MeshStandardMaterial({ color, roughness: 0.72 }),
  );

  /** Todo material de mar (mapa e apron) entra aqui para receber a mesma animação. */
  private readonly seaMaterials: { material: MeshStandardMaterial; inverse: boolean }[] = [];
  private readonly seaWaves: [MeshStandardMaterial, MeshStandardMaterial];

  private readonly foam: {
    mesh: Mesh;
    baseZ: number;
    phase: number;
    amplitude: number;
  }[] = [];

  private readonly floatingDecorations: {
    mesh: Group;
    baseY: number;
    phase: number;
    amplitude: number;
  }[] = [];

  private time = 0;
  private disposed = false;

  constructor(private readonly map: GridMap) {
    this.group.name = 'orla-ground';

    this.seaWaves = [
      this.seaMaterial('wave:0', 1, 1, false),
      this.seaMaterial('wave:1', 1, 1, true),
    ];

    const slab = GRID_CONFIG.floorThickness;

    for (let row = 0; row < map.rows; row++) {
      for (let column = 0; column < map.columns; column++) {
        const kind = map.tileAt(column, row)!;
        const type = TILE_TYPES[kind];
        const center = map.cellCenter(column, row);
        const isObject = type.height > 0;

        // Objetos sólidos apoiam-se num piso de calçadão; a faixa entre ciclovia
        // e pistas é desenhada como calçada, apesar de continuar sendo tile de rua.
        const floorKind = this.visualKind(column, row);

        const floor = new Mesh(
          this.flat,
          this.floorMaterial(floorKind, column, row),
        );

        floor.name = isObject
          ? `floor-${column}-${row}`
          : `tile-${column}-${row}-${kind}`;

        floor.scale.set(map.tileSize, slab, map.tileSize);

        floor.position.set(
          center.x,
          -slab / 2 - (kind === 'sea' ? SEA_DROP : 0),
          center.z,
        );

        floor.receiveShadow = true;

        this.group.add(floor);

        if (isObject) {
          this.addContactShadow(column, row, center);
          this.addObject(kind, column, row, center);
        } else if (this.isSidewalk(column, row)) {
          // Meio-fio na divisa com a pista, do lado de baixo da calçada.
          this.addCurb(column, row, center);
        } else {
          this.addMarkings(kind, column, row, center);
          if (kind === 'ground' && map.tileAt(column, row - 1) === 'sea') {
            this.addWetSand(column, row, center);
          }
        }

        if (kind === 'promenade' && map.tileAt(column, row + 1) === 'cycleway') {
          this.addCurb(column, row, center);
        } else if (kind === 'cycleway' && this.isSidewalk(column, row + 1)) {
          this.addCurb(column, row, center);
        }

        if (kind === 'sea') this.addFoam(column, row, center);
      }
    }

    this.scatterPebbles();
    this.addBeachAmbience();
    this.addPromenadeAmbience();
    this.addSidewalkFurniture();
    this.addRoadMedian();
    this.addSouthSidewalk();
    this.addOutdoorGym();
    this.addSeaAmbience();
    this.addApron();
  }

  /** Anima a cor e a textura do mar e a espuma. Chame uma vez por frame, com dt em segundos. */
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;

    this.time += dt;

    const wave = (Math.sin(this.time * 1.2) + 1) / 2;
    const offsetX = (this.time * 0.016) % 1;
    const offsetY = (Math.sin(this.time * 0.45) * 0.012 + 1) % 1;

    for (const { material, inverse } of this.seaMaterials) {
      material.color.lerpColors(SEA_LOW, SEA_HIGH, inverse ? 1 - wave : wave);

      if (material.map) {
        material.map.offset.set(offsetX, offsetY);
      }

      if (material.bumpMap) {
        material.bumpMap.offset.set(offsetX, offsetY);
      }
    }

    for (const piece of this.foam) {
      piece.mesh.position.z = piece.baseZ
        + Math.sin(this.time * 1.6 + piece.phase) * piece.amplitude;
    }

    for (const decoration of this.floatingDecorations) {
      decoration.mesh.position.y = decoration.baseY
        + Math.sin(this.time * 1.15 + decoration.phase) * decoration.amplitude;

      decoration.mesh.rotation.z = Math.sin(this.time * 0.9 + decoration.phase)
        * decoration.amplitude * 0.42;
    }
  }

  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;

    this.flat.dispose();
    this.pebble.dispose();

    [
      this.palmTrunk,
      this.palmFrond,
      this.umbrellaPole,
      this.umbrellaTop,
      this.chairGeometry,
      this.benchSeat,
      this.benchLeg,
      this.lampPole,
      this.lampHead,
      this.binBody,
      this.binLid,
      this.buoyGeometry,
      this.boatHull,
      this.boatCabin,
      this.busPost,
      this.busRoof,
      this.busBack,
      this.busSign,
      this.gymPost,
      this.gymBar,
      this.gymPlate,
      this.gymPedal,
    ].forEach(geometry => geometry.dispose());

    Object.values(this.ambienceMaterials).forEach(material => material.dispose());
    this.umbrellaMaterials.forEach(material => material.dispose());

    this.roundedBoxes.forEach(geometry => geometry.dispose());
    this.roundedBoxes.clear();

    this.materials.forEach(material => material.dispose());
    this.materials.clear();

    this.textures.dispose();

    this.seaMaterials.length = 0;
    this.foam.length = 0;
    this.floatingDecorations.length = 0;
    this.group.clear();
  }

  /**
   * Linha entre a ciclovia (Row 7) e o início da avenida (Row 9).
   * Restringe a ciclovia a 2m (Row 7) e desenha o Row 8 como Calçada Norte.
   */
  private isSidewalk(column: number, row: number): boolean {
    return this.map.tileAt(column, row) === 'cycleway'
      && this.map.tileAt(column, row + 1) === 'road';
  }

  /** Índice da linha usada como calçada, ou null se o mapa não tiver uma. */
  private sidewalkRow(): number | null {
    for (let row = 1; row < this.map.rows; row++) {
      if (this.isSidewalk(0, row)) return row;
    }
    return null;
  }

  /** Rua de verdade: exclui a linha usada como calçada. */
  private isRoadSurface(column: number, row: number): boolean {
    return this.map.tileAt(column, row) === 'road';
  }

  /** Tile usado para escolher textura de piso, já aplicando objetos e calçada. */
  private visualKind(column: number, row: number): TileKind {
    const kind = this.map.tileAt(column, row);
    if (kind === undefined) return 'promenade';
    if (TILE_TYPES[kind].height > 0) return 'promenade';
    return this.isSidewalk(column, row) ? 'promenade' : kind;
  }

  private material(
    key: string,
    color: string | Color,
    extra: {
      transparent?: boolean;
      opacity?: number;
      depthWrite?: boolean;
      texture?: TextureKey;
      repeatX?: number;
      repeatY?: number;
      coloredTexture?: boolean;
    } = {},
  ): MeshStandardMaterial {
    let material = this.materials.get(key);

    if (!material) {
      const {
        texture,
        repeatX = 1,
        repeatY = 1,
        coloredTexture = true,
        ...options
      } = extra;

      material = new MeshStandardMaterial({
        color,
        roughness: GRID_CONFIG.roughness,
        ...options,
      });

      if (texture) {
        const repeatNeeded = repeatX !== 1 || repeatY !== 1;

        const map = repeatNeeded
          ? this.textures.getRepeated(texture, repeatX, repeatY)
          : this.textures.get(texture);

        const bumpMap = repeatNeeded
          ? this.textures.getRepeated(texture, repeatX, repeatY, true)
          : this.textures.getBump(texture);

        if (map) material.map = map;
        if (bumpMap) material.bumpMap = bumpMap;

        material.bumpScale = BUMP_SCALE[texture] ?? 0.008;

        /**
         * Texturas coloridas já possuem a paleta final. Deixar a cor branca
         * evita a multiplicação material.color × map, que escurecia o cenário.
         */
        if (coloredTexture) material.color.set('#ffffff');
      }

      this.materials.set(key, material);
    }

    return material;
  }

  /** Material do mar: a cor oscila e a textura desliza. `inverse` cria a onda defasada. */
  private seaMaterial(key: string, repeatX: number, repeatY: number, inverse: boolean): MeshStandardMaterial {
    const material = this.material(key, SEA_LOW, {
      texture: 'sea',
      repeatX,
      repeatY,
      coloredTexture: false,
    });
    if (!this.seaMaterials.some(entry => entry.material === material)) {
      this.seaMaterials.push({ material, inverse });
    }
    return material;
  }

  private floorMaterial(
    kind: TileKind,
    column: number,
    row: number,
  ): MeshStandardMaterial {
    if (kind === 'sea') return this.seaWaves[(column + row) % 2];

    return this.material(
      `floor:${kind}`,
      '#ffffff',
      { texture: TILE_TEXTURE[kind] },
    );
  }

  private roundedBox(
    width: number,
    height: number,
    depth: number,
    radius: number,
  ): RoundedBoxGeometry {
    const key = `${width}|${height}|${depth}|${radius}`;

    let geometry = this.roundedBoxes.get(key);

    if (!geometry) {
      geometry = new RoundedBoxGeometry(width, height, depth, 3, radius);
      this.roundedBoxes.set(key, geometry);
    }

    return geometry;
  }

  /** Sombra de contato: disco translúcido logo abaixo do objeto, para dar peso ao bloco. */
  private addContactShadow(
    column: number,
    row: number,
    center: { x: number; z: number },
  ): void {
    const size = this.map.tileSize * 1.08;
    const shadow = new Mesh(
      this.flat,
      this.material('contact-shadow', '#ffffff', {
        texture: 'shadow',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
        coloredTexture: false,
      }),
    );

    shadow.name = `contact-shadow-${column}-${row}`;
    shadow.scale.set(size, 0.01, size);
    shadow.position.set(center.x, 0.006, center.z);
    shadow.renderOrder = 1;

    this.group.add(shadow);
  }

  private addObject(
    kind: TileKind,
    column: number,
    row: number,
    center: { x: number; z: number },
  ): void {
    const type = TILE_TYPES[kind];
    const size = this.map.tileSize * OBJECT_FILL;

    const body = new Mesh(
      this.roundedBox(size, type.height, size, 0.14),
      this.material(
        `solid:${kind}`,
        '#ffffff',
        { texture: TILE_TEXTURE[kind] },
      ),
    );

    body.name = `tile-${column}-${row}-${kind}`;
    body.position.set(center.x, type.height / 2, center.z);
    body.castShadow = true;
    body.receiveShadow = true;

    const top = new Mesh(
      this.roundedBox(size * 0.82, 0.05, size * 0.82, 0.02),
      this.material(
        `top:${kind}`,
        TOP_ACCENT[kind] ?? type.color,
        {
          texture: 'grain',
          coloredTexture: false,
        },
      ),
    );

    top.name = `top-${column}-${row}`;
    top.position.set(center.x, type.height + 0.025, center.z);
    top.receiveShadow = true;

    this.group.add(body, top);
  }

  /** Faixa de areia molhada entre a areia seca e o mar. */
  private addWetSand(
    column: number,
    row: number,
    center: { x: number; z: number },
  ): void {
    const size = this.map.tileSize;
    const mesh = new Mesh(
      this.flat,
      this.material('wet-sand', '#ffffff', {
        texture: 'wetSand',
        repeatX: 1,
        repeatY: 1,
      }),
    );

    mesh.name = `wet-sand-${column}-${row}`;
    mesh.scale.set(size, GRID_CONFIG.floorThickness * 1.02, size * WET_SAND_DEPTH);
    mesh.position.set(
      center.x,
      0.004,
      center.z - size / 2 + size * WET_SAND_DEPTH / 2,
    );
    mesh.receiveShadow = true;

    this.group.add(mesh);
  }

  /** Meio-fio na borda inferior do tile: calçadão/ciclovia e calçada/pista (interrompido na travessia). */
  private addCurb(
    column: number,
    row: number,
    center: { x: number; z: number },
  ): void {
    if (column === 11) return;
    const size = this.map.tileSize;
    const mesh = new Mesh(
      this.flat,
      this.material('curb', '#e8e4da', {
        texture: 'grain',
        coloredTexture: false,
      }),
    );

    mesh.name = `curb-${column}-${row}`;
    mesh.scale.set(size, 0.09, 0.12);
    mesh.position.set(center.x, 0.045, center.z + size / 2 - 0.06);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    this.group.add(mesh);
  }

  /** Pedrinhas e conchas espalhadas em areia seca, com InstancedMesh (uma draw call). */
  private scatterPebbles(): void {
    const candidates: { x: number; z: number }[] = [];

    for (let row = 0; row < this.map.rows; row++) {
      for (let column = 0; column < this.map.columns; column++) {
        if (this.map.tileAt(column, row) !== 'ground') continue;
        candidates.push(this.map.cellCenter(column, row));
      }
    }

    if (candidates.length === 0) return;

    const random = makeRandom(4663);
    const count = Math.min(candidates.length * 6, 1400);
    const size = this.map.tileSize;

    const mesh = new InstancedMesh(
      this.pebble,
      this.material('pebbles', '#ffffff', {
        texture: 'grain',
        coloredTexture: false,
      }),
      count,
    );

    mesh.name = 'ground-pebbles';
    mesh.receiveShadow = true;

    const matrix = new Matrix4();
    const quaternion = new Quaternion();
    const scale = new Vector3();
    const position = new Vector3();
    const color = new Color();

    for (let i = 0; i < count; i++) {
      const cell = candidates[Math.floor(random() * candidates.length)];
      const radius = 0.018 + random() * 0.03;

      position.set(
        cell.x + (random() - 0.5) * size * 0.9,
        radius * 0.45,
        cell.z + (random() - 0.5) * size * 0.9,
      );

      quaternion.setFromEuler(
        new Euler(random() * Math.PI, random() * Math.PI, random() * Math.PI),
      );

      scale.set(radius * (1 + random() * 0.6), radius * 0.45, radius * (1 + random() * 0.4));
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(i, matrix);

      color.set(PEBBLE_COLORS[Math.floor(random() * PEBBLE_COLORS.length)]);
      mesh.setColorAt(i, color);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    this.group.add(mesh);
  }

  /** Seleciona tiles de areia que podem receber decoração sem sobrepor a arrebentação. */
  private beachCells(minRow = 1): { column: number; row: number; x: number; z: number }[] {
    const cells: { column: number; row: number; x: number; z: number }[] = [];

    for (let row = minRow; row < this.map.rows; row++) {
      for (let column = 0; column < this.map.columns; column++) {
        if (this.map.tileAt(column, row) !== 'ground') continue;

        const center = this.map.cellCenter(column, row);
        cells.push({ column, row, x: center.x, z: center.z });
      }
    }

    return cells;
  }

  /** Decoração da faixa de areia: coqueiros, guarda-sóis, cadeiras e torre de guarda-vidas. */
  private addBeachAmbience(): void {
    const cells = this.beachCells(3).filter(cell => cell.column < 13 || cell.column > 19);
    if (!cells.length) return;

    const random = makeRandom(9187);
    const used = new Set<string>();
    const takeCell = (minimumDistance: number): { column: number; row: number; x: number; z: number } | null => {
      for (let attempt = 0; attempt < 80; attempt++) {
        const cell = cells[Math.floor(random() * cells.length)];
        const key = `${cell.column}:${cell.row}`;

        if (used.has(key)) continue;

        const closeToUsed = [...used].some(item => {
          const [column, row] = item.split(':').map(Number);
          return Math.hypot(column - cell.column, row - cell.row) < minimumDistance;
        });

        if (closeToUsed) continue;

        used.add(key);
        return cell;
      }

      return null;
    };

    for (let index = 0; index < BEACH_DECORATION_COUNT.palms; index++) {
      const cell = takeCell(1.35);
      if (!cell) break;

      this.addPalm(
        cell.x + (random() - 0.5) * this.map.tileSize * 0.55,
        cell.z + (random() - 0.5) * this.map.tileSize * 0.55,
        0.8 + random() * 0.55,
        random() * Math.PI * 2,
      );
    }

    for (let index = 0; index < BEACH_DECORATION_COUNT.umbrellas; index++) {
      const cell = takeCell(1.1);
      if (!cell) break;

      this.addUmbrella(
        cell.x + (random() - 0.5) * this.map.tileSize * 0.42,
        cell.z + (random() - 0.5) * this.map.tileSize * 0.42,
        index % this.umbrellaMaterials.length,
        random() * Math.PI * 2,
      );
    }

    const towerCell = cells.find(cell => cell.column === 3 && cell.row === 4)
      ?? cells[Math.floor(cells.length * 0.28)];

    if (towerCell) this.addLifeguardTower(towerCell.x, towerCell.z);
  }

  private addPalm(x: number, z: number, scale: number, rotation: number): void {
    const palm = new Group();
    palm.name = 'beach-palm';
    this.map.addObstacle(x, z, 0.2 * scale);
    palm.position.set(x, 0, z);
    palm.rotation.y = rotation;
    palm.scale.setScalar(scale);

    const trunk = new Mesh(
      this.palmTrunk,
      scale > 1.08 ? this.ambienceMaterials.palmTrunkLight : this.ambienceMaterials.palmTrunk,
    );

    trunk.position.y = 0.5;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    palm.add(trunk);

    // Copa no topo do tronco. Cada folha é um pivô girado em Y e curvado em X.
    const crown = new Group();
    crown.position.y = 1;

    const fronds = 7;
    for (let index = 0; index < fronds; index++) {
      const pivot = new Group();
      pivot.rotation.y = index * Math.PI * 2 / fronds;

      const frond = new Mesh(
        this.palmFrond,
        index % 2 ? this.ambienceMaterials.palmLeaf : this.ambienceMaterials.palmLeafLight,
      );

      frond.rotation.x = 0.5 + (index % 3) * 0.08;
      frond.castShadow = true;

      pivot.add(frond);
      crown.add(pivot);
    }

    palm.add(crown);
    this.group.add(palm);
  }

  private addUmbrella(x: number, z: number, colorIndex: number, rotation: number): void {
    const umbrella = new Group();
    umbrella.name = 'beach-umbrella';
    this.map.addObstacle(x, z, 0.32);
    umbrella.position.set(x, 0, z);
    umbrella.rotation.y = rotation;

    const pole = new Mesh(this.umbrellaPole, this.ambienceMaterials.benchMetal);
    pole.position.y = 0.5;
    pole.castShadow = true;

    const top = new Mesh(this.umbrellaTop, this.umbrellaMaterials[colorIndex]);
    top.position.y = 1.05;
    top.rotation.y = Math.PI / 12;
    top.castShadow = true;

    const chairA = new Mesh(this.chairGeometry, this.ambienceMaterials.lifeguardLight);
    chairA.position.set(-0.38, 0.12, 0.34);
    chairA.rotation.set(-0.3, 0.28, 0);
    chairA.castShadow = true;

    const chairB = new Mesh(this.chairGeometry, this.ambienceMaterials.lifeguardLight);
    chairB.position.set(0.35, 0.12, 0.3);
    chairB.rotation.set(-0.3, -0.25, 0);
    chairB.castShadow = true;

    umbrella.add(pole, top, chairA, chairB);
    this.group.add(umbrella);
  }

  private addLifeguardTower(x: number, z: number): void {
    const tower = new Group();
    tower.name = 'lifeguard-tower';
    this.map.addObstacle(x, z, 0.8);
    tower.position.set(x, 0, z);

    for (const dx of [-0.34, 0.34]) {
      for (const dz of [-0.3, 0.3]) {
        const leg = new Mesh(this.benchLeg, this.ambienceMaterials.lifeguard);
        leg.position.set(dx, 0.38, dz);
        leg.castShadow = true;
        tower.add(leg);
      }
    }

    const platform = new Mesh(this.benchSeat, this.ambienceMaterials.lifeguardLight);
    platform.scale.set(1.18, 1, 1.65);
    platform.position.y = 0.74;
    platform.castShadow = true;

    const seat = new Mesh(this.benchSeat, this.ambienceMaterials.lifeguard);
    seat.position.set(0, 0.98, 0.12);
    seat.rotation.x = -0.15;
    seat.castShadow = true;

    const roof = new Mesh(this.umbrellaTop, this.ambienceMaterials.lifeguard);
    roof.position.y = 1.34;
    roof.scale.set(1.05, 0.65, 0.88);
    roof.castShadow = true;

    tower.add(platform, seat, roof);
    this.group.add(tower);
  }

  /** Bancos, lixeiras e postes em tiles de calçadão próximos à ciclovia. */
  private addPromenadeAmbience(): void {
    const row = 6;
    const promenadeRow = this.map.tileAt(0, row) === 'promenade' ? row : 5;

    for (let column = 1; column < this.map.columns; column += 3) {
      if (this.map.tileAt(column, promenadeRow) !== 'promenade') continue;
      if (column >= 8 && column <= 13) continue;

      const center = this.map.cellCenter(column, promenadeRow);
      this.addBench(center.x, center.z + this.map.tileSize * 0.21, column % 2 === 0);

      if (column % 6 === 1) {
        this.addLamp(center.x - this.map.tileSize * 0.33, center.z - this.map.tileSize * 0.25);
      }

      if (column % 6 === 4) {
        this.addBin(center.x + this.map.tileSize * 0.34, center.z - this.map.tileSize * 0.18);
      }
    }
  }

  /**
   * Mobiliário da calçada entre ciclovia e pistas: lixeiras ao longo do trecho
   * e abrigos de ônibus encostados no meio-fio, com a cobertura voltada à via.
   */
  private addSidewalkFurniture(): void {
    const row = this.sidewalkRow();
    if (row === null) return;

    const size = this.map.tileSize;

    for (const column of SIDEWALK_BIN_COLUMNS) {
      if (!this.isSidewalk(column, row)) continue;

      const center = this.map.cellCenter(column, row);
      this.addBin(center.x, center.z - size * 0.26);
    }

    for (const column of BUS_STOP_COLUMNS) {
      if (!this.isSidewalk(column, row)) continue;

      const center = this.map.cellCenter(column, row);
      this.addBusStop(center.x, center.z - size * 0.08);
    }
  }

  private addBench(x: number, z: number, flip: boolean): void {
    const bench = new Group();
    bench.name = 'promenade-bench';
    this.map.addObstacle(x, z, 0.45);
    bench.position.set(x, 0, z);
    bench.rotation.y = flip ? Math.PI : 0;

    const seat = new Mesh(this.benchSeat, this.ambienceMaterials.benchWood);
    seat.position.y = 0.38;
    seat.castShadow = true;

    const back = new Mesh(this.benchSeat, this.ambienceMaterials.benchWood);
    back.position.set(0, 0.62, 0.1);
    back.rotation.x = -0.2;
    back.castShadow = true;

    for (const dx of [-0.29, 0.29]) {
      const leg = new Mesh(this.benchLeg, this.ambienceMaterials.benchMetal);
      leg.position.set(dx, 0.18, 0);
      leg.castShadow = true;
      bench.add(leg);
    }

    bench.add(seat, back);
    this.group.add(bench);
  }

  private addLamp(x: number, z: number): void {
    const lamp = new Group();
    lamp.name = 'promenade-lamp';
    this.map.addObstacle(x, z, 0.12);
    lamp.position.set(x, 0, z);

    const pole = new Mesh(this.lampPole, this.ambienceMaterials.lamp);
    pole.position.y = 0.925;
    pole.castShadow = true;

    const head = new Mesh(this.lampHead, this.ambienceMaterials.lampLight);
    head.position.y = 1.86;

    lamp.add(pole, head);
    this.group.add(lamp);
  }

  private addBin(x: number, z: number): void {
    const bin = new Group();
    bin.name = 'promenade-bin';
    this.map.addObstacle(x, z, 0.2);
    bin.position.set(x, 0, z);

    const body = new Mesh(this.binBody, this.ambienceMaterials.bin);
    body.position.y = 0.21;
    body.castShadow = true;
    body.receiveShadow = true;

    const lid = new Mesh(this.binLid, this.ambienceMaterials.binLid);
    lid.position.y = 0.44;
    lid.castShadow = true;

    bin.add(body, lid);
    this.group.add(bin);
  }

  /** Abrigo de ônibus: dois montantes, cobertura inclinada, fundo de vidro e banco. */
  private addBusStop(x: number, z: number): void {
    const stop = new Group();
    stop.name = 'bus-stop';
    stop.position.set(x, 0, z);

    for (const dx of [-1.1, 1.1]) {
      const post = new Mesh(this.busPost, this.ambienceMaterials.busMetal);
      post.position.set(dx, 1.05, -0.4);
      post.castShadow = true;
      post.receiveShadow = true;
      stop.add(post);
    }

    const roof = new Mesh(this.busRoof, this.ambienceMaterials.busRoof);
    roof.position.set(0, 2.14, -0.08);
    roof.rotation.x = -0.07;
    roof.castShadow = true;
    roof.receiveShadow = true;

    const back = new Mesh(this.busBack, this.ambienceMaterials.busGlass);
    back.position.set(0, 1.1, -0.44);
    back.renderOrder = 2;

    const bench = new Mesh(this.benchSeat, this.ambienceMaterials.benchWood);
    bench.scale.set(2.4, 1, 1);
    bench.position.set(0, 0.42, -0.26);
    bench.castShadow = true;
    bench.receiveShadow = true;

    for (const dx of [-0.85, 0.85]) {
      const leg = new Mesh(this.benchLeg, this.ambienceMaterials.busMetal);
      leg.position.set(dx, 0.2, -0.26);
      leg.castShadow = true;
      stop.add(leg);
    }

    const sign = new Mesh(this.busSign, this.ambienceMaterials.busSign);
    sign.position.set(1.32, 1.72, -0.4);
    sign.rotation.y = -Math.PI / 2;
    sign.castShadow = true;

    const signPost = new Mesh(this.busPost, this.ambienceMaterials.busMetal);
    signPost.scale.set(0.6, 0.82, 0.6);
    signPost.position.set(1.32, 0.86, -0.4);
    signPost.castShadow = true;

    stop.add(roof, back, bench, sign, signPost);
    this.group.add(stop);
  }

  /**
   * Academia ao ar livre na faixa de areia junto ao calçadão: barra fixa,
   * barras paralelas e bicicleta estacionária, sobre uma plataforma de piso.
   */
  private addOutdoorGym(): void {
    const sandRows: number[] = [];

    for (let row = 0; row < this.map.rows; row++) {
      if (this.map.tileAt(16, row) === 'ground') sandRows.push(row);
    }

    const row = sandRows[sandRows.length - 1];
    if (row === undefined) return;

    const base = this.map.cellCenter(16, row);
    const size = this.map.tileSize;

    const gym = new Group();
    gym.name = 'outdoor-gym';
    gym.position.set(base.x, 0, base.z);

    // Piso técnico, só para separar visualmente o equipamento da areia solta.
    const deck = new Mesh(
      this.flat,
      this.material('gym-deck', '#ffffff', {
        texture: 'promenade',
        repeatX: 3,
        repeatY: 1,
      }),
    );
    deck.scale.set(size * 2.9, 0.045, size * 0.92);
    deck.position.set(0, 0.024, 0);
    deck.receiveShadow = true;
    gym.add(deck);

    gym.add(this.makePullUpStation(-size * 0.95));
    gym.add(this.makeParallelBars(0));
    gym.add(this.makeStationaryBike(size * 0.95));

    this.group.add(gym);
  }

  /** Barra fixa: dois montantes altos e uma barra horizontal de pegada. */
  private makePullUpStation(offsetX: number): Group {
    const station = new Group();
    station.name = 'gym-pull-up';
    station.position.x = offsetX;

    for (const dx of [-0.52, 0.52]) {
      const post = new Mesh(this.gymPost, this.ambienceMaterials.gymFrame);
      post.scale.set(1, 2.05, 1);
      post.position.set(dx, 1.025, 0);
      post.castShadow = true;
      post.receiveShadow = true;
      station.add(post);
    }

    const bar = new Mesh(this.gymBar, this.ambienceMaterials.gymGrip);
    bar.scale.set(1, 1.1, 1);
    bar.rotation.z = Math.PI / 2;
    bar.position.y = 2.02;
    bar.castShadow = true;
    station.add(bar);

    const brace = new Mesh(this.gymBar, this.ambienceMaterials.gymAccent);
    brace.scale.set(0.8, 1.05, 0.8);
    brace.rotation.z = Math.PI / 2;
    brace.position.y = 1.42;
    brace.castShadow = true;
    station.add(brace);

    return station;
  }

  /** Barras paralelas: quatro montantes baixos e dois trilhos longitudinais. */
  private makeParallelBars(offsetX: number): Group {
    const bars = new Group();
    bars.name = 'gym-parallel-bars';
    bars.position.x = offsetX;

    for (const dz of [-0.33, 0.33]) {
      for (const dx of [-0.6, 0.6]) {
        const post = new Mesh(this.gymPost, this.ambienceMaterials.gymFrame);
        post.scale.set(0.9, 1.18, 0.9);
        post.position.set(dx, 0.59, dz);
        post.castShadow = true;
        post.receiveShadow = true;
        bars.add(post);
      }

      const rail = new Mesh(this.gymBar, this.ambienceMaterials.gymGrip);
      rail.scale.set(0.95, 1.5, 0.95);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(0, 1.17, dz);
      rail.castShadow = true;
      bars.add(rail);
    }

    return bars;
  }

  /** Bicicleta estacionária simplificada: base, coluna, selim, guidão e pedais. */
  private makeStationaryBike(offsetX: number): Group {
    const bike = new Group();
    bike.name = 'gym-bike';
    bike.position.x = offsetX;

    const base = new Mesh(this.gymPlate, this.ambienceMaterials.gymAccent);
    base.scale.set(1.5, 1, 1.3);
    base.position.y = 0.06;
    base.castShadow = true;
    base.receiveShadow = true;

    const column = new Mesh(this.gymPost, this.ambienceMaterials.gymFrame);
    column.scale.set(1, 0.86, 1);
    column.position.set(-0.1, 0.49, 0);
    column.rotation.z = 0.16;
    column.castShadow = true;

    const seat = new Mesh(this.gymPlate, this.ambienceMaterials.gymGrip);
    seat.scale.set(0.62, 0.9, 0.78);
    seat.position.set(-0.22, 0.94, 0);
    seat.castShadow = true;

    const stem = new Mesh(this.gymPost, this.ambienceMaterials.gymFrame);
    stem.scale.set(0.85, 0.78, 0.85);
    stem.position.set(0.3, 0.45, 0);
    stem.rotation.z = -0.14;
    stem.castShadow = true;

    const handlebar = new Mesh(this.gymBar, this.ambienceMaterials.gymGrip);
    handlebar.scale.set(0.85, 0.62, 0.85);
    handlebar.rotation.x = Math.PI / 2;
    handlebar.position.set(0.36, 0.86, 0);
    handlebar.castShadow = true;

    for (const dz of [-0.17, 0.17]) {
      const pedal = new Mesh(this.gymPedal, this.ambienceMaterials.gymGrip);
      pedal.position.set(0.04, 0.2, dz);
      pedal.castShadow = true;
      bike.add(pedal);
    }

    bike.add(base, column, seat, stem, handlebar);
    return bike;
  }

  /** Boias e barcos no mar; são decorativos e flutuam na atualização da view. */
  private addSeaAmbience(): void {
    const seaCells: { x: number; z: number }[] = [];

    for (let row = 0; row < this.map.rows; row++) {
      for (let column = 0; column < this.map.columns; column++) {
        if (this.map.tileAt(column, row) !== 'sea') continue;
        seaCells.push(this.map.cellCenter(column, row));
      }
    }

    if (!seaCells.length) return;

    const random = makeRandom(3451);

    for (let index = 0; index < 8; index++) {
      const cell = seaCells[Math.floor(random() * seaCells.length)];
      this.addBuoy(
        cell.x + (random() - 0.5) * this.map.tileSize * 0.7,
        cell.z + (random() - 0.5) * this.map.tileSize * 0.5,
        index * 0.9,
      );
    }

    const boatCells = [seaCells[Math.floor(seaCells.length * 0.22)], seaCells[Math.floor(seaCells.length * 0.74)]];
    boatCells.forEach((cell, index) => {
      if (cell) this.addBoat(cell.x, cell.z, index * 2.1, index % 2 === 0);
    });
  }

  private addBuoy(x: number, z: number, phase: number): void {
    const buoy = new Group();
    buoy.name = 'sea-buoy';
    buoy.position.set(x, -SEA_DROP + 0.12, z);
    buoy.rotation.x = Math.PI / 2;

    const ring = new Mesh(this.buoyGeometry, this.ambienceMaterials.buoy);
    ring.castShadow = true;
    buoy.add(ring);

    this.floatingDecorations.push({
      mesh: buoy,
      baseY: -SEA_DROP + 0.12,
      phase,
      amplitude: 0.025,
    });

    this.group.add(buoy);
  }

  private addBoat(x: number, z: number, phase: number, reversed: boolean): void {
    const boat = new Group();
    boat.name = 'sea-boat';

    // Casco submerso um pouco abaixo da superfície do mar, para não flutuar acima da água.
    const baseY = -SEA_DROP - 0.02;
    boat.position.set(x, baseY, z);
    boat.rotation.y = reversed ? Math.PI : 0;
    boat.scale.setScalar(0.8);

    const hull = new Mesh(this.boatHull, this.ambienceMaterials.boat);
    hull.castShadow = true;
    hull.receiveShadow = true;

    const cabin = new Mesh(this.boatCabin, this.ambienceMaterials.boatStripe);
    cabin.position.set(-0.12, 0.34, 0);
    cabin.castShadow = true;

    boat.add(hull, cabin);

    this.floatingDecorations.push({
      mesh: boat,
      baseY,
      phase,
      amplitude: 0.035,
    });

    this.group.add(boat);
  }

  private addFoam(
    column: number,
    row: number,
    center: { x: number; z: number },
  ): void {
    const below = this.map.tileAt(column, row + 1);

    if (below === undefined || below === 'sea') return;

    const size = this.map.tileSize;

    // Primeira linha de arrebentação, mais próxima da areia, com movimento um pouco mais lento.
    const mesh = new Mesh(
      this.flat,
      this.material('foam', '#ffffff', {
        transparent: true,
        opacity: 0.85,
        texture: 'grain',
        coloredTexture: false,
      }),
    );

    const baseZ = center.z + size / 2 - 0.16;

    mesh.name = `foam-${column}-${row}`;
    mesh.scale.set(size, 0.02, 0.16);
    mesh.position.set(center.x, -SEA_DROP + 0.011, baseZ);

    this.foam.push({
      mesh,
      baseZ,
      phase: column * 0.7,
      amplitude: 0.07,
    });

    // Segunda onda, mais fina e mais afastada, para dar a sensação de arrebentação em camadas.
    const second = new Mesh(
      this.flat,
      this.material('foam-far', '#ffffff', {
        transparent: true,
        opacity: 0.5,
        texture: 'grain',
        coloredTexture: false,
      }),
    );

    const secondBaseZ = center.z + size / 2 - 0.34;

    second.name = `foam-far-${column}-${row}`;
    second.scale.set(size, 0.02, 0.1);
    second.position.set(center.x, -SEA_DROP + 0.009, secondBaseZ);

    this.foam.push({
      mesh: second,
      baseZ: secondBaseZ,
      phase: column * 0.7 + 1.9,
      amplitude: 0.045,
    });

    this.group.add(mesh, second);
  }

  private line(
    name: string,
    mark: MarkKind,
    x: number,
    z: number,
    width: number,
    depth: number,
  ): void {
    const mesh = new Mesh(
      this.flat,
      this.material(`mark:${mark}`, MARK_COLORS[mark], {
        texture: 'grain',
        coloredTexture: false,
      }),
    );

    mesh.name = name;
    mesh.scale.set(width, 0.025, depth);
    mesh.position.set(x, 0.0135, z);
    mesh.receiveShadow = true;

    this.group.add(mesh);
  }

  /** Rua: faixas amplas, avenida verde elétrica e travessia limpa. Ciclovia: 2m no Row 7. */
  private addMarkings(
    kind: TileKind,
    column: number,
    row: number,
    center: { x: number; z: number },
  ): void {
    const size = this.map.tileSize;
    const crossingX = 1.0;

    if (kind === 'road' && !this.isRoadSurface(column, row - 1)) {
      const roadNorthZ = center.z - size / 2;

      // Linhas de bordo contínuas (Norte e Sul da avenida), interrompidas na faixa de pedestres
      if (column !== 11) {
        this.line(`edge-top-${column}-${row}`, 'edge', center.x, roadNorthZ + 0.06, size, 0.08);
        this.line(`edge-bottom-${column}-${row}`, 'edge', center.x, roadNorthZ + ROAD_LAYOUT.bottomEdge, size, 0.08);
      }

      // Avenida Verde (Z = 6.00 a 6.92): faixa exclusiva, com símbolos de elétrico.
      if (column !== 1 && column !== 11 && column !== 20) {
        const { greenCenter, greenWidth } = ROAD_LAYOUT;
        this.line(`electric-lane-${column}`, 'electric', center.x, roadNorthZ + greenCenter, size, greenWidth);
        this.line(`electric-lane-edge-${column}`, 'edge', center.x, roadNorthZ + 0.06, size, 0.055);
        this.line(`electric-lane-edge-south-${column}`, 'edge', center.x, roadNorthZ + greenCenter + greenWidth / 2 - 0.04, size, 0.055);
        if (column % 4 === 2) this.addElectricPictogram(center.x, roadNorthZ + greenCenter);
      }

      // Divisórias tracejadas brancas entre Faixa 1 e Faixa 2 (Leste em Z=7.88, Oeste em Z=10.24)
      for (const dx of [-0.25, 0.25]) {
        const dashX = center.x + dx * size;
        if (Math.abs(dashX - crossingX) < 1.85) continue;
        this.line(`lane-east-dash-${column}-${dx}`, 'edge', dashX, roadNorthZ + ROAD_LAYOUT.eastDash, size * 0.28, 0.065);
        this.line(`lane-west-dash-${column}-${dx}`, 'edge', dashX, roadNorthZ + ROAD_LAYOUT.westDash, size * 0.28, 0.065);
      }
    } else if (kind === 'cycleway' && !this.isSidewalk(column, row)) {
      if (column !== 11) {
        this.line(`bike-edge-top-${column}-${row}`, 'edge', center.x, center.z - size / 2 + 0.08, size, 0.065);
        this.line(`bike-edge-bottom-${column}-${row}`, 'edge', center.x, center.z + size / 2 - 0.08, size, 0.065);
      }
      for (const dx of [-0.25, 0.25]) {
        const dashX = center.x + dx * size;
        if (Math.abs(dashX - crossingX) < 1.35) continue;
        this.line(`bike-dash-${column}-${row}-${dx}`, 'dash', dashX, center.z, size * 0.24, 0.065);
      }
      if (column % 4 === 2 && column !== 11) {
        this.addBikePictogram(center.x, center.z - 0.48, -1);
        this.addBikePictogram(center.x, center.z + 0.48, 1);
      }
    }
  }

  private addElectricPictogram(x: number, z: number): void {
    const material = this.material('mark:electric-pictogram', '#f2fae9', { texture: 'grain', coloredTexture: false });
    const icon = new Group();
    icon.name = 'electric-car-pictogram';
    icon.position.set(x, 0.033, z);
    // Dimensionado para a faixa de 1,2 m: ~0,8 m de carro, legível na câmera do jogo.
    icon.scale.setScalar(1.3);
    const body = new Mesh(this.flat, material);
    body.scale.set(0.5, 0.024, 0.23);
    const cabin = new Mesh(this.flat, material);
    cabin.position.set(0, 0.002, -0.01);
    cabin.scale.set(0.29, 0.025, 0.15);
    const bolt = new Mesh(this.flat, this.material('mark:electric-bolt', '#f3d16c', { texture: 'grain', coloredTexture: false }));
    bolt.position.set(0, 0.004, 0.01);
    bolt.scale.set(0.08, 0.028, 0.2);
    bolt.rotation.y = 0.2;
    icon.add(body, cabin, bolt);
    this.group.add(icon);
  }

  /** Pictograma de bicicleta dimensionado para caber dentro de cada faixa de 1.0m da ciclovia. */
  private addBikePictogram(x: number, z: number, direction: 1 | -1): void {
    const mat = this.material('mark:bike', MARK_COLORS.bike, { texture: 'grain', coloredTexture: false });
    const icon = new Group();
    icon.name = 'cycleway-pictogram';
    icon.position.set(x, 0.015, z);
    icon.scale.setScalar(0.76);
    for (const wx of [-0.24, 0.24]) {
      const wheel = new Mesh(this.buoyGeometry, mat);
      wheel.rotation.x = Math.PI / 2;
      wheel.scale.set(0.95, 0.95, 0.35);
      wheel.position.set(wx * direction, 0, 0);
      icon.add(wheel);
    }
    const frame = new Mesh(this.flat, mat);
    frame.scale.set(0.38, 0.015, 0.055);
    icon.add(frame);
    const arrowShaft = new Mesh(this.flat, mat);
    arrowShaft.scale.set(0.32, 0.015, 0.06);
    arrowShaft.position.set(0.58 * direction, 0, 0);
    icon.add(arrowShaft);
    for (const side of [-1, 1]) {
      const wing = new Mesh(this.flat, mat);
      wing.scale.set(0.18, 0.015, 0.055);
      wing.position.set(0.7 * direction, 0, side * 0.06);
      wing.rotation.y = side * direction * 0.65;
      icon.add(wing);
    }
    this.group.add(icon);
  }

  /** Canteiro central paisagístico entre os sentidos Leste e Oeste da avenida, com refúgio na travessia. */
  private addRoadMedian(): void {
    const size = this.map.tileSize;
    const medianZ = this.map.depth / 2 - this.map.tileSize * 3 + ROAD_LAYOUT.median;
    const curbMat = this.material('curb', '#e8e4da', { texture: 'grain', coloredTexture: false });
    const yellowMat = this.material('mark:dash', MARK_COLORS.dash, { texture: 'grain', coloredTexture: false });
    const curbGeo = this.roundedBox(size * 0.97, 0.11, 0.38, 0.032);
    const grassGeo = this.roundedBox(size * 0.89, 0.045, 0.27, 0.015);
    const lampHoodGeo = this.roundedBox(0.24, 0.055, 0.34, 0.018);

    for (let column = 0; column < this.map.columns; column++) {
      const center = this.map.cellCenter(column, this.map.rows - 1);
      if (column === 11) {
        const refuge = new Mesh(this.flat, curbMat);
        refuge.name = `median-refuge-${column}`;
        refuge.scale.set(size * 0.86, 0.028, 0.38);
        refuge.position.set(center.x, 0.014, medianZ);
        refuge.receiveShadow = true;
        this.group.add(refuge);
        continue;
      }

      for (const side of [-1, 1]) {
        const edgeLine = new Mesh(this.flat, yellowMat);
        edgeLine.name = `median-line-${column}-${side}`;
        edgeLine.scale.set(size, 0.022, 0.055);
        edgeLine.position.set(center.x, 0.013, medianZ + side * 0.23);
        edgeLine.receiveShadow = true;
        this.group.add(edgeLine);
      }

      const curb = new Mesh(curbGeo, curbMat);
      curb.name = `median-curb-${column}`;
      curb.position.set(center.x, 0.055, medianZ);
      curb.castShadow = true;
      curb.receiveShadow = true;

      const grass = new Mesh(grassGeo, this.ambienceMaterials.palmLeaf);
      grass.name = `median-grass-${column}`;
      grass.position.set(center.x, 0.118, medianZ);
      grass.receiveShadow = true;

      this.group.add(curb, grass);

      // Maciços arbustivos tropicais orgânicos com folhagens em camadas e floração costeira
      for (const [idx, dx] of [-0.46, 0.46].entries()) {
        const cluster = new Group();
        cluster.name = `median-bush-${column}-${dx}`;
        cluster.position.set(center.x + dx, 0.14, medianZ);

        const mainFoliage = new Mesh(
          this.pebble,
          (column + idx) % 2 === 0 ? this.ambienceMaterials.palmLeafLight : this.ambienceMaterials.palmLeaf,
        );
        mainFoliage.scale.set(0.24, 0.17, 0.13);
        mainFoliage.position.set(0, 0.04, 0);
        mainFoliage.castShadow = true;
        mainFoliage.receiveShadow = true;
        cluster.add(mainFoliage);

        for (const side of [-1, 1]) {
          const lobe = new Mesh(
            this.pebble,
            (column + idx) % 2 === 0 ? this.ambienceMaterials.palmLeaf : this.ambienceMaterials.palmLeafLight,
          );
          lobe.scale.set(0.16, 0.13, 0.11);
          lobe.position.set(side * 0.14, 0.02, side * 0.02);
          lobe.castShadow = true;
          cluster.add(lobe);
        }

        if ((column + idx) % 2 === 0) {
          const flowerMat = this.umbrellaMaterials[(column + idx) % this.umbrellaMaterials.length];
          for (const fx of [-0.07, 0.07]) {
            const blossom = new Mesh(this.pebble, flowerMat);
            blossom.scale.set(0.065, 0.055, 0.065);
            blossom.position.set(fx, 0.15, fx * 0.25);
            cluster.add(blossom);
          }
        }

        this.group.add(cluster);
      }

      // Postes de iluminação dupla estilo boulevard costeiro
      if (column % 5 === 2) {
        const lamp = new Group();
        lamp.name = `median-lamp-${column}`;
        lamp.position.set(center.x, 0.11, medianZ);

        const pedestal = new Mesh(this.binBody, this.ambienceMaterials.lamp);
        pedestal.scale.set(0.68, 0.65, 0.68);
        pedestal.position.y = 0.13;
        pedestal.castShadow = true;

        const pole = new Mesh(this.lampPole, this.ambienceMaterials.lamp);
        pole.scale.set(0.88, 1.32, 0.88);
        pole.position.y = 1.22;
        pole.castShadow = true;

        lamp.add(pedestal, pole);

        for (const side of [-1, 1]) {
          const arm = new Mesh(this.gymBar, this.ambienceMaterials.lamp);
          arm.scale.set(0.68, 0.62, 0.68);
          arm.rotation.x = side * 1.28;
          arm.position.set(0, 2.34, side * 0.29);
          arm.castShadow = true;

          const hood = new Mesh(lampHoodGeo, this.ambienceMaterials.lamp);
          hood.position.set(0, 2.41, side * 0.62);
          hood.castShadow = true;

          const head = new Mesh(this.lampHead, this.ambienceMaterials.lampLight);
          head.scale.set(0.72, 0.34, 0.98);
          head.position.set(0, 2.37, side * 0.62);

          lamp.add(arm, hood, head);
        }
        this.group.add(lamp);
      }
    }
  }

  /** Calçada Sul / Passeio Inferior com meio-fio de granito, piso de calçadão e mobiliário urbano. */
  private addSouthSidewalk(): void {
    const { columns, rows, width, depth, tileSize } = this.map;
    const southRow = rows - 1;
    if (this.map.tileAt(0, southRow) !== 'road') return;

    const southEdgeZ = depth / 2;
    const sidewalkDepth = 0.8;
    const sidewalkCenterZ = southEdgeZ - sidewalkDepth / 2;
    const curbZ = southEdgeZ - sidewalkDepth + 0.06;
    const curbMat = this.material('curb', '#e8e4da', { texture: 'grain', coloredTexture: false });
    const sidewalkMat = this.floorMaterial('promenade', 0, southRow);

    for (let column = 0; column < columns; column++) {
      const center = this.map.cellCenter(column, southRow);

      const pavement = new Mesh(this.flat, sidewalkMat);
      pavement.name = `south-sidewalk-${column}`;
      pavement.scale.set(tileSize, 0.036, sidewalkDepth);
      pavement.position.set(center.x, 0.018, sidewalkCenterZ);
      pavement.receiveShadow = true;
      this.group.add(pavement);

      if (column !== 11) {
        const curb = new Mesh(this.flat, curbMat);
        curb.name = `south-curb-${column}`;
        curb.scale.set(tileSize, 0.095, 0.12);
        curb.position.set(center.x, 0.048, curbZ);
        curb.castShadow = true;
        curb.receiveShadow = true;
        this.group.add(curb);
      }
    }

    // Estende a calçada sul e o meio-fio para as bordas oeste e leste do apron
    for (const [side, x] of [['w', -width / 2 - APRON / 2], ['e', width / 2 + APRON / 2]] as const) {
      const apronMat = this.material(
        `apron:promenade:${Math.round(APRON)}x${Math.round(tileSize)}`,
        '#ffffff',
        { texture: TILE_TEXTURE.promenade, repeatX: Math.max(1, Math.round(APRON / tileSize)), repeatY: 1 },
      );
      const extPavement = new Mesh(this.flat, apronMat);
      extPavement.name = `south-sidewalk-apron-${side}`;
      extPavement.scale.set(APRON, 0.036, sidewalkDepth);
      extPavement.position.set(x, 0.018, sidewalkCenterZ);
      extPavement.receiveShadow = true;

      const extCurb = new Mesh(this.flat, curbMat);
      extCurb.name = `south-curb-apron-${side}`;
      extCurb.scale.set(APRON, 0.095, 0.12);
      extCurb.position.set(x, 0.048, curbZ);
      extCurb.receiveShadow = true;

      this.group.add(extPavement, extCurb);
    }

    // Mobiliário urbano da calçada inferior (bancos voltados à via, postes de pedestre e lixeiras)
    for (const column of [3, 9, 15, 20]) {
      const center = this.map.cellCenter(column, southRow);
      this.addLamp(center.x, southEdgeZ - 0.3);
    }
    for (const column of [5, 13, 18]) {
      const center = this.map.cellCenter(column, southRow);
      this.addBench(center.x, southEdgeZ - 0.26, false);
    }
    for (const column of [7, 16]) {
      const center = this.map.cellCenter(column, southRow);
      this.addBin(center.x, southEdgeZ - 0.34);
    }
  }

  private addApron(): void {
    const { columns, rows, width, depth, tileSize } = this.map;
    const slab = GRID_CONFIG.floorThickness;

    const strip = (
      name: string,
      column: number,
      row: number,
      x: number,
      z: number,
      w: number,
      d: number,
    ) => {
      const kind = this.map.tileAt(column, row)!;
      const isSouthApron = name.startsWith('s');
      const floorKind: TileKind = isSouthApron ? 'promenade' : this.visualKind(column, row);

      const material = kind === 'sea'
        ? this.seaMaterial(
          `apron-sea:${Math.round(w)}x${Math.round(d)}`,
          Math.max(1, Math.round(w / tileSize)),
          Math.max(1, Math.round(d / tileSize)),
          (column + row) % 2 === 1,
        )
        : this.material(
          `apron:${floorKind}:${Math.round(w)}x${Math.round(d)}`,
          '#ffffff',
          {
            texture: TILE_TEXTURE[floorKind],
            repeatX: Math.max(1, Math.round(w / tileSize)),
            repeatY: Math.max(1, Math.round(d / tileSize)),
          },
        );

      const mesh = new Mesh(this.flat, material);

      mesh.name = `apron-${name}`;
      mesh.scale.set(w, slab, d);
      mesh.position.set(x, -slab / 2 - (kind === 'sea' ? SEA_DROP : 0), z);
      mesh.receiveShadow = true;

      this.group.add(mesh);
    };

    const west = -width / 2 - APRON / 2;
    const east = width / 2 + APRON / 2;
    const north = -depth / 2 - APRON / 2;
    const south = depth / 2 + APRON / 2;

    for (let row = 0; row < rows; row++) {
      const z = this.map.cellCenter(0, row).z;
      strip(`w-${row}`, 0, row, west, z, APRON, tileSize);
      strip(`e-${row}`, columns - 1, row, east, z, APRON, tileSize);
    }

    for (let column = 0; column < columns; column++) {
      const x = this.map.cellCenter(column, 0).x;
      strip(`n-${column}`, column, 0, x, north, tileSize, APRON);
      strip(`s-${column}`, column, rows - 1, x, south, tileSize, APRON);
    }

    strip('nw', 0, 0, west, north, APRON, APRON);
    strip('ne', columns - 1, 0, east, north, APRON, APRON);
    strip('sw', 0, rows - 1, west, south, APRON, APRON);
    strip('se', columns - 1, rows - 1, east, south, APRON, APRON);
  }
}
