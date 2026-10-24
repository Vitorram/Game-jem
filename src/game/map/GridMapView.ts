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
import { GRID_CONFIG, ORLA_CROSSING, ORLA_SCENERY_MARGIN } from '../config';
import { GridMap, TILE_TYPES, type TileKind } from './GridMap';
import { ROAD_LAYOUT } from './roadLayout';
import { TextureLibrary, type TextureKey } from './proceduralTextures';
import { BeachSurface } from './BeachSurface';
import { StaticSceneryBatches } from './StaticSceneryBatches';

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
  electricRoad: 0.01,
  cycleway: 0.008,
  sea: 0.006,
  plaster: 0.015,
  crate: 0.012,
  panel: 0.006,
  grain: 0.004,
};

/**
 * Quantos tiles uma textura cobre em cada direção. O calçadão usa 2: as ondas
 * ficam longas como na orla de verdade, e cada tile mostra só o seu recorte.
 */
const TEXTURE_SPAN: Partial<Record<TextureKey, number>> = {
  promenade: 2,
};

/** Cores dos seixos e conchas espalhados na areia. */
const PEBBLE_COLORS = ['#fff6e0', '#f1d8b4', '#dcc09a', '#c9ad86', '#f7efe2'];

const SEA_LOW = new Color('#22a3bf');
const SEA_HIGH = new Color('#55d0e2');

/** O mar fica mais baixo que a areia, o que desenha a borda da praia. */
const SEA_DROP = 0.12;

/** Chão liso além do cenário estendido (ORLA_SCENERY_MARGIN), para não aparecer o vazio do fundo. */
const APRON = 30;

/** Folga entre a calçada sul andável e a faixa de grama das árvores. */
const SOUTH_VERGE_GAP = 0.05;

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

/** Resto sempre positivo: as colunas além da borda oeste são negativas. */
function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
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
  private beachSurface: BeachSurface | null = null;
  private staticBatches: StaticSceneryBatches | null = null;
  private disposed = false;

  /**
   * Colunas desenhadas, incluindo o cenário além da grade (ORLA_SCENERY_MARGIN em
   * cada lado): faixas, canteiro e calçadas seguem até sair do enquadramento.
   */
  private readonly firstColumn: number;
  private readonly endColumn: number;

  constructor(private readonly map: GridMap) {
    this.group.name = 'orla-ground';
    const extraColumns = Math.ceil(ORLA_SCENERY_MARGIN / map.tileSize);
    this.firstColumn = -extraColumns;
    this.endColumn = map.columns + extraColumns;

    this.seaWaves = [
      this.seaMaterial('wave:0', 1, 1, false),
      this.seaMaterial('wave:1', 1, 1, true),
    ];

    const slab = GRID_CONFIG.floorThickness;

    for (let row = 0; row < map.rows; row++) {
      for (let column = this.firstColumn; column < this.endColumn; column++) {
        const kind = this.tileAt(column, row)!;
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

        // Fora da grade é só cenário: não conta como tile do mapa.
        const inGrid = column >= 0 && column < map.columns;
        floor.name = isObject
          ? `floor-${column}-${row}`
          : `${inGrid ? 'tile' : 'scenery'}-${column}-${row}-${kind}`;

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
          if (kind === 'ground' && this.tileAt(column, row - 1) === 'sea') {
            this.addWetSand(column, row, center);
          }
        }

        if (kind === 'promenade' && this.tileAt(column, row + 1) === 'cycleway') {
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
    this.addElectricLane();
    this.addRoadMedian();
    this.addSouthSidewalk();
    this.addSouthCityFront();
    this.addOutdoorGym();
    this.addSeaAmbience();
    this.addApron();
    const shoreRow = Array.from({ length: map.rows }, (_, row) => row)
      .find(row => row > 0 && map.tileAt(0, row) === 'ground' && map.tileAt(0, row - 1) === 'sea');
    if (shoreRow !== undefined) {
      const shore = map.cellCenter(0, shoreRow).z - map.tileSize / 2;
      this.beachSurface = new BeachSurface(map.width + ORLA_SCENERY_MARGIN * 2 + 128, -map.depth / 2 - 64,
        shore + map.tileSize * 3, shore);
      this.group.traverse(object => {
        if (object instanceof Mesh && (object.name.endsWith('-sea') || object.name.startsWith('wet-sand-')
          || object.name.startsWith('foam-') || object.name.startsWith('apron-n')
          || ((object.name.endsWith('-ground') || object.name.startsWith('apron-'))
            && object.position.z >= shore && object.position.z < shore + map.tileSize * 3)
          || this.seaMaterials.some(entry => entry.material === object.material))) object.visible = false;
      });
      this.foam.length = 0;
      this.group.add(this.beachSurface.mesh);
    }
    const animated = new Set<object>([...this.floatingDecorations.map(item => item.mesh), ...this.foam.map(item => item.mesh)]);
    if (this.beachSurface) animated.add(this.beachSurface.mesh);
    this.staticBatches = new StaticSceneryBatches(this.group, animated);
  }

  /** Anima a cor e a textura do mar e a espuma. Chame uma vez por frame, com dt em segundos. */
  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt <= 0) return;

    this.time += dt;
    this.beachSurface?.update(dt);

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
    this.staticBatches?.dispose();
    this.beachSurface?.dispose();

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
    return this.tileAt(column, row) === 'cycleway'
      && this.tileAt(column, row + 1) === 'road';
  }

  /** Tile da grade; fora dela repete a coluna da borda, que é igual em todas as linhas. */
  private tileAt(column: number, row: number): TileKind | undefined {
    return this.map.tileAt(Math.min(Math.max(column, 0), this.map.columns - 1), row);
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
    return this.tileAt(column, row) === 'road';
  }

  /** Tile usado para escolher textura de piso, já aplicando objetos e calçada. */
  private visualKind(column: number, row: number): TileKind {
    const kind = this.tileAt(column, row);
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
      offsetX?: number;
      offsetY?: number;
      coloredTexture?: boolean;
    } = {},
  ): MeshStandardMaterial {
    let material = this.materials.get(key);

    if (!material) {
      const {
        texture,
        repeatX = 1,
        repeatY = 1,
        offsetX = 0,
        offsetY = 0,
        coloredTexture = true,
        ...options
      } = extra;

      material = new MeshStandardMaterial({
        color,
        roughness: GRID_CONFIG.roughness,
        ...options,
      });

      if (texture) {
        const repeatNeeded = repeatX !== 1 || repeatY !== 1 || offsetX !== 0 || offsetY !== 0;

        const map = repeatNeeded
          ? this.textures.getRepeated(texture, repeatX, repeatY, false, offsetX, offsetY)
          : this.textures.get(texture);

        const bumpMap = repeatNeeded
          ? this.textures.getRepeated(texture, repeatX, repeatY, true, offsetX, offsetY)
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
    if (kind === 'sea') return this.seaWaves[mod(column + row, 2)];

    const texture = TILE_TEXTURE[kind];
    const span = TEXTURE_SPAN[texture] ?? 1;
    if (span === 1) return this.material(`floor:${kind}`, '#ffffff', { texture });

    // Cada tile mostra o seu pedaço da textura maior, para o desenho atravessar os tiles.
    const sliceX = mod(column, span);
    const sliceY = mod(row, span);
    return this.material(`floor:${kind}:${sliceX}:${sliceY}`, '#ffffff', {
      texture,
      repeatX: 1 / span,
      repeatY: 1 / span,
      offsetX: sliceX / span,
      offsetY: sliceY / span,
    });
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
      for (let column = this.firstColumn; column < this.endColumn; column++) {
        if (this.tileAt(column, row) !== 'ground') continue;
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
      for (let column = this.firstColumn; column < this.endColumn; column++) {
        if (this.tileAt(column, row) !== 'ground') continue;

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
    const density = (this.endColumn - this.firstColumn) / this.map.columns;
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

    for (let index = 0; index < Math.round(BEACH_DECORATION_COUNT.palms * density); index++) {
      const cell = takeCell(1.35);
      if (!cell) break;

      this.addPalm(
        cell.x + (random() - 0.5) * this.map.tileSize * 0.55,
        cell.z + (random() - 0.5) * this.map.tileSize * 0.55,
        0.8 + random() * 0.55,
        random() * Math.PI * 2,
      );
    }

    for (let index = 0; index < Math.round(BEACH_DECORATION_COUNT.umbrellas * density); index++) {
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
    const promenadeRow = this.tileAt(0, row) === 'promenade' ? row : 5;

    for (let column = 1 - 3 * Math.floor((1 - this.firstColumn) / 3); column < this.endColumn; column += 3) {
      if (this.tileAt(column, promenadeRow) !== 'promenade') continue;
      if (column >= 8 && column <= 13) continue;

      const center = this.map.cellCenter(column, promenadeRow);
      this.addBench(center.x, center.z + this.map.tileSize * 0.21, mod(column, 2) === 0);

      if (mod(column, 6) === 1) {
        this.addLamp(center.x - this.map.tileSize * 0.33, center.z - this.map.tileSize * 0.25);
      }

      if (mod(column, 6) === 4) {
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
      if (this.tileAt(16, row) === 'ground') sandRows.push(row);
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
        repeatX: 2.9 / (TEXTURE_SPAN.promenade ?? 1),
        repeatY: 0.92 / (TEXTURE_SPAN.promenade ?? 1),
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
      for (let column = this.firstColumn; column < this.endColumn; column++) {
        if (this.tileAt(column, row) !== 'sea') continue;
        seaCells.push(this.map.cellCenter(column, row));
      }
    }

    if (!seaCells.length) return;

    const random = makeRandom(3451);
    const buoys = Math.round(8 * (this.endColumn - this.firstColumn) / this.map.columns);

    for (let index = 0; index < buoys; index++) {
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
    const below = this.tileAt(column, row + 1);

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

      // Avenida Verde: o piso pintado é contínuo (addElectricLane); aqui só bordas e símbolos.
      if (column !== 11) {
        const { greenCenter, greenWidth } = ROAD_LAYOUT;
        this.line(`electric-lane-edge-${column}`, 'edge', center.x, roadNorthZ + 0.06, size, 0.055);
        this.line(`electric-lane-edge-south-${column}`, 'edge', center.x, roadNorthZ + greenCenter + greenWidth / 2 - 0.04, size, 0.055);
        if (mod(column, 4) === 2) this.addElectricPictogram(center.x, roadNorthZ + greenCenter);
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
      if (mod(column, 4) === 2 && column !== 11) {
        this.addBikePictogram(center.x, center.z - 0.48, -1);
        this.addBikePictogram(center.x, center.z + 0.48, 1);
      }
    }
  }

  /**
   * Faixa exclusiva de elétricos: asfalto pintado de verde, rente às outras pistas
   * e numa peça só de ponta a ponta do cenário, inclusive sob a travessia.
   */
  private addElectricLane(): void {
    const { tileSize, rows } = this.map;
    if (this.tileAt(0, rows - 1) !== 'road') return;
    const { greenCenter, greenWidth } = ROAD_LAYOUT;
    const roadNorthZ = this.map.depth / 2 - tileSize * 3;
    const length = (this.endColumn - this.firstColumn) * tileSize;
    const lane = new Mesh(this.flat, this.material('electric-lane', '#ffffff', {
      texture: 'electricRoad',
      repeatX: length / tileSize,
      repeatY: greenWidth / tileSize,
    }));
    lane.name = 'electric-lane';
    // 2 mm acima do asfalto: só o bastante para não disputar profundidade com o tile.
    lane.scale.set(length, 0.002, greenWidth);
    lane.position.set(this.map.cellCenter(this.firstColumn, 0).x - tileSize / 2 + length / 2, 0.001, roadNorthZ + greenCenter);
    lane.receiveShadow = true;
    this.group.add(lane);
  }

  private addElectricPictogram(x: number, z: number): void {
    const material = this.material('mark:electric-pictogram', '#f2fae9', { texture: 'grain', coloredTexture: false });
    const icon = new Group();
    icon.name = 'electric-car-pictogram';
    icon.position.set(x, 0.018, z);
    // Dimensionado para a faixa de 1,2 m: ~0,8 m de carro, legível na câmera do jogo.
    icon.scale.setScalar(1.3);
    const body = new Mesh(this.flat, material);
    body.scale.set(0.5, 0.024, 0.23);
    const cabin = new Mesh(this.flat, material);
    cabin.position.set(0, 0.002, -0.01);
    cabin.scale.set(0.29, 0.025, 0.15);
    // Âmbar escuro: o raio fica sobre o corpo claro do carro e precisa de contraste ≥ 3:1 com ele.
    const bolt = new Mesh(this.flat, this.material('mark:electric-bolt', '#b97400', { texture: 'grain', coloredTexture: false }));
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

    for (let column = this.firstColumn; column < this.endColumn; column++) {
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
          mod(column + idx, 2) === 0 ? this.ambienceMaterials.palmLeafLight : this.ambienceMaterials.palmLeaf,
        );
        mainFoliage.scale.set(0.24, 0.17, 0.13);
        mainFoliage.position.set(0, 0.04, 0);
        mainFoliage.castShadow = true;
        mainFoliage.receiveShadow = true;
        cluster.add(mainFoliage);

        for (const side of [-1, 1]) {
          const lobe = new Mesh(
            this.pebble,
            mod(column + idx, 2) === 0 ? this.ambienceMaterials.palmLeaf : this.ambienceMaterials.palmLeafLight,
          );
          lobe.scale.set(0.16, 0.13, 0.11);
          lobe.position.set(side * 0.14, 0.02, side * 0.02);
          lobe.castShadow = true;
          cluster.add(lobe);
        }

        if (mod(column + idx, 2) === 0) {
          const flowerMat = this.umbrellaMaterials[mod(column + idx, this.umbrellaMaterials.length)];
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
      if (mod(column, 5) === 2) {
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
    if (this.tileAt(0, southRow) !== 'road') return;

    // A avenida ocupa ROAD_LAYOUT.bottomEdge a partir do seu bordo norte.
    // Começávamos o passeio 24 cm antes desse limite, cobrindo a faixa externa
    // e deixando parte dos carros por cima da calçada.
    const roadNorthZ = depth / 2 - tileSize * 3;
    const roadSouthEdgeZ = roadNorthZ + ROAD_LAYOUT.bottomEdge;
    // Uma peça só, do meio-fio até a grama das árvores e de ponta a ponta do cenário:
    // recortes por tile ou emendas com o apron quebravam as ondas do calçadão.
    const sidewalkSouthZ = Math.max(roadSouthEdgeZ + 0.8, depth / 2 + this.map.southWalkway + SOUTH_VERGE_GAP);
    const sidewalkDepth = sidewalkSouthZ - roadSouthEdgeZ;
    const sidewalkWidth = width + 2 * (ORLA_SCENERY_MARGIN + APRON);
    const sidewalkSpan = (TEXTURE_SPAN[TILE_TEXTURE.promenade] ?? 1) * tileSize;
    const pavement = new Mesh(this.flat, this.material('south-sidewalk', '#ffffff', {
      texture: TILE_TEXTURE.promenade,
      repeatX: sidewalkWidth / sidewalkSpan,
      repeatY: sidewalkDepth / sidewalkSpan,
    }));
    pavement.name = 'south-sidewalk';
    pavement.scale.set(sidewalkWidth, 0.036, sidewalkDepth);
    pavement.position.set(0, 0.018, roadSouthEdgeZ + sidewalkDepth / 2);
    pavement.receiveShadow = true;
    this.group.add(pavement);

    // Meio-fio contínuo, interrompido só na rampa da travessia (coluna 11).
    const curbMat = this.material('curb', '#e8e4da', { texture: 'grain', coloredTexture: false });
    const crossing = this.map.cellCenter(11, southRow).x;
    for (const [side, from, to] of [
      ['w', -sidewalkWidth / 2, crossing - tileSize / 2],
      ['e', crossing + tileSize / 2, sidewalkWidth / 2],
    ] as const) {
      const curb = new Mesh(this.flat, curbMat);
      curb.name = `south-curb-${side}`;
      curb.scale.set(to - from, 0.095, 0.12);
      curb.position.set((from + to) / 2, 0.048, roadSouthEdgeZ + 0.06);
      curb.castShadow = true;
      curb.receiveShadow = true;
      this.group.add(curb);
    }

    // Postes continuam no cenário estendido, no mesmo passo de 6 tiles.
    for (let column = this.firstColumn; column < this.endColumn; column++) {
      if ((column < 0 || column >= columns) && mod(column - 3, 6) === 0) {
        this.addLamp(this.map.cellCenter(column, southRow).x, roadSouthEdgeZ + 0.3);
      }
    }

    // Mobiliário urbano da calçada inferior (bancos voltados à via, postes de pedestre e lixeiras)
    for (const column of [3, 9, 15, 20]) {
      const center = this.map.cellCenter(column, southRow);
      this.addLamp(center.x, roadSouthEdgeZ + 0.3);
    }
    for (const column of [5, 13, 18]) {
      const center = this.map.cellCenter(column, southRow);
      this.addBench(center.x, roadSouthEdgeZ + 0.26, false);
    }
    for (const column of [7, 16]) {
      const center = this.map.cellCenter(column, southRow);
      this.addBin(center.x, roadSouthEdgeZ + 0.34);
    }
  }

  /**
   * Frente urbana ao sul da avenida, fora da área jogável, ocupando o vazio do
   * enquadramento. A câmera olha do sul para baixo (inclinação 0,75): cada unidade
   * de altura esconde ~0,75 do chão ao norte, então tudo é baixo e o destaque fica
   * nos telhados (solar, verde, caixa d'água). A faixa onde os pedestres saem da
   * travessia (z = borda + 0,75) e a praça em frente à faixa ficam livres.
   */
  private addSouthCityFront(): void {
    const southEdgeZ = this.map.depth / 2;
    const crossingX = ORLA_CROSSING.centerX;
    const frontZ = southEdgeZ + 2.65;
    const lotDepth = 4.6;
    const reach = this.map.width / 2 + ORLA_SCENERY_MARGIN;
    const plazaHalf = 2.6;
    const facades = ['#e9b872', '#7fb7a4', '#e58f6f', '#9fb6d8', '#f1e3c8'];
    const awnings = ['#c4553f', '#2f7f74', '#d89b2b', '#41658f'];
    const widths = [5.2, 4.4, 6, 3.8];
    const heights = [0.85, 1.05, 0.95, 1.1];

    let x = -reach, index = 0;
    while (x < reach) {
      const width = widths[index % widths.length];
      if (x < crossingX + plazaHalf && x + width > crossingX - plazaHalf) {
        x = crossingX + plazaHalf + 0.6;
        continue;
      }
      this.addCityBuilding(index, x + width / 2, frontZ, width, lotDepth, heights[index % heights.length],
        facades[index % facades.length], awnings[index % awnings.length], index % 3);
      x += width + 0.6;
      index++;
    }

    // Praça em frente à travessia: piso claro, bancos e árvores marcando a chegada.
    const plaza = new Mesh(this.flat, this.material('city:plaza', '#efe6d2', { texture: 'grain', coloredTexture: false }));
    plaza.name = 'city-plaza';
    // Começa onde termina a calçada sul, sem deixar fresta do apron entre as duas.
    const plazaNorth = southEdgeZ + this.map.southWalkway + SOUTH_VERGE_GAP;
    plaza.scale.set(plazaHalf * 2, 0.02, frontZ + lotDepth - plazaNorth);
    plaza.position.set(crossingX, 0.01, (plazaNorth + frontZ + lotDepth) / 2);
    plaza.receiveShadow = true;
    this.group.add(plaza);
    this.addBench(crossingX - 1.1, frontZ + 1.4, false);
    this.addBench(crossingX + 1.1, frontZ + 1.4, false);

    const treeZ = southEdgeZ + 1.75;
    // Faixa de grama sob as árvores: marca o fim da calçada andável (map.southWalkway).
    const vergeNorth = southEdgeZ + this.map.southWalkway + SOUTH_VERGE_GAP, vergeDepth = 0.8;
    const verge = this.material('city:verge', '#7fae5d', { texture: 'grain', coloredTexture: false });
    for (const [name, from, to] of [['w', -reach, crossingX - plazaHalf], ['e', crossingX + plazaHalf, reach]] as const) {
      const strip = new Mesh(this.flat, verge);
      strip.name = `south-verge-${name}`;
      strip.scale.set(to - from, 0.03, vergeDepth);
      strip.position.set((from + to) / 2, 0.015, vergeNorth + vergeDepth / 2);
      strip.receiveShadow = true;
      this.group.add(strip);
    }
    for (let treeX = -reach + 2; treeX < reach; treeX += 4.4) {
      if (Math.abs(treeX - crossingX) < plazaHalf) continue;
      this.addStreetTree(treeX, treeZ);
    }
  }

  private addCityBuilding(index: number, x: number, frontZ: number, width: number, depth: number,
    height: number, facade: string, awning: string, roofKind: number): void {
    const building = new Group();
    building.name = `city-building-${index}`;
    building.position.set(x, 0, frontZ + depth / 2);
    const front = -depth / 2;
    const flatMaterial = (key: string, color: string) =>
      this.material(`city:${key}:${color}`, color, { texture: 'grain', coloredTexture: false });
    const box = (name: string, material: MeshStandardMaterial, size: [number, number, number],
      at: [number, number, number], cast = true) => {
      const mesh = new Mesh(this.flat, material);
      mesh.name = name;
      mesh.scale.set(...size);
      mesh.position.set(...at);
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      building.add(mesh);
      return mesh;
    };

    box('facade', flatMaterial('facade', facade), [width, height, depth], [0, height / 2, 0]);
    box('roof', flatMaterial('roof', '#d8d0c0'), [width + 0.08, 0.06, depth + 0.08], [0, height + 0.03, 0]);

    // Térreo com lojas: vitrine escura e toldo listrado voltados para a avenida.
    const shops = Math.max(1, Math.round(width / 1.6));
    const glass = flatMaterial('glass', '#2f4b57');
    for (let shop = 0; shop < shops; shop++) {
      const shopX = (shop + 0.5) * width / shops - width / 2;
      box('shop-window', glass, [width / shops * 0.62, 0.36, 0.04], [shopX, 0.3, front - 0.02], false);
      box('awning', flatMaterial('awning', shop % 2 ? '#f4efe4' : awning), [width / shops * 0.78, 0.04, 0.32], [shopX, 0.56, front - 0.16]);
    }
    if (height > 0.95) {
      for (let window = 0; window < shops * 2; window++) {
        const windowX = (window + 0.5) * width / (shops * 2) - width / 2;
        box('window', glass, [0.22, 0.14, 0.03], [windowX, height - 0.2, front - 0.015], false);
      }
    }

    // Telhados sustentáveis: o que a câmera mais enxerga.
    const roofY = height + 0.06;
    if (roofKind === 0) {
      const solar = flatMaterial('solar', '#2f4a6b');
      const span = width - 0.4;
      const panels = Math.max(1, Math.floor(span / 0.95));
      for (let row = 0; row < 2; row++) for (let panel = 0; panel < panels; panel++) {
        const mesh = box('solar-panel', solar, [0.82, 0.035, 0.55], [(panel + 0.5) * span / panels - span / 2, roofY + 0.09, -0.6 + row * 1.2]);
        mesh.rotation.x = -0.32;
      }
    } else if (roofKind === 1) {
      box('green-roof', this.ambienceMaterials.palmLeaf, [width * 0.82, 0.05, depth * 0.72], [0, roofY + 0.025, 0], false);
      for (const [dx, dz] of [[-0.3, -0.2], [0.25, 0.3], [0.05, -0.05]]) {
        const bush = new Mesh(this.pebble, this.ambienceMaterials.palmLeafLight);
        bush.name = 'green-roof-bush';
        bush.scale.set(0.2, 0.09, 0.2);
        bush.position.set(dx * width, roofY + 0.09, dz * depth);
        bush.castShadow = true;
        building.add(bush);
      }
    } else {
      const tank = new Mesh(this.binBody, flatMaterial('tank', '#4d7ea8'));
      tank.name = 'water-tank';
      tank.scale.set(1.7, 0.45, 1.7);
      tank.position.set(width * 0.25, roofY + 0.095, depth * 0.15);
      tank.castShadow = true;
      building.add(tank);
      box('ac-unit', flatMaterial('ac', '#bfc6c7'), [0.32, 0.14, 0.24], [-width * 0.25, roofY + 0.07, -depth * 0.1]);
    }
    this.group.add(building);
  }

  /** Árvore baixa de calçada em canteiro: sombra para quem anda, sem cobrir a via na câmera. */
  private addStreetTree(x: number, z: number): void {
    const tree = new Group();
    tree.name = 'street-tree';
    this.map.addObstacle(x, z, 0.3);
    tree.position.set(x, 0, z);
    const planter = new Mesh(this.flat, this.material('curb', '#e8e4da', { texture: 'grain', coloredTexture: false }));
    planter.scale.set(0.7, 0.12, 0.7);
    planter.position.y = 0.06;
    planter.receiveShadow = true;
    const trunk = new Mesh(this.palmTrunk, this.ambienceMaterials.palmTrunk);
    trunk.scale.set(0.8, 0.55, 0.8);
    trunk.position.y = 0.39;
    trunk.castShadow = true;
    tree.add(planter, trunk);
    const crowns = [[0, 0.78, 0, 0.36, false], [0.18, 0.72, 0.1, 0.24, true], [-0.16, 0.74, -0.08, 0.22, true]] as const;
    for (const [dx, dy, dz, size, light] of crowns) {
      const crown = new Mesh(this.pebble, light ? this.ambienceMaterials.palmLeafLight : this.ambienceMaterials.palmLeaf);
      crown.scale.set(size, size * 0.8, size);
      crown.position.set(dx, dy, dz);
      crown.castShadow = true;
      tree.add(crown);
    }
    this.group.add(tree);
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
      const kind = this.tileAt(column, row)!;
      const isSouthApron = name.startsWith('s');
      const floorKind: TileKind = isSouthApron ? 'promenade' : this.visualKind(column, row);

      const material = kind === 'sea'
        ? this.seaMaterial(
          `apron-sea:${Math.round(w)}x${Math.round(d)}`,
          Math.max(1, Math.round(w / tileSize)),
          Math.max(1, Math.round(d / tileSize)),
          mod(column + row, 2) === 1,
        )
        : this.material(
          `apron:${floorKind}:${Math.round(w)}x${Math.round(d)}`,
          '#ffffff',
          {
            texture: TILE_TEXTURE[floorKind],
            repeatX: Math.max(1, Math.round(w / tileSize)) / (TEXTURE_SPAN[TILE_TEXTURE[floorKind]] ?? 1),
            repeatY: Math.max(1, Math.round(d / tileSize)) / (TEXTURE_SPAN[TILE_TEXTURE[floorKind]] ?? 1),
          },
        );

      const mesh = new Mesh(this.flat, material);

      mesh.name = `apron-${name}`;
      mesh.scale.set(w, slab, d);
      mesh.position.set(x, -slab / 2 - (kind === 'sea' ? SEA_DROP : 0), z);
      mesh.receiveShadow = true;

      this.group.add(mesh);
    };

    // O apron começa onde termina o cenário estendido pelas colunas extras.
    const reach = width / 2 + ORLA_SCENERY_MARGIN;
    const west = -reach - APRON / 2;
    const east = reach + APRON / 2;
    const north = -depth / 2 - APRON / 2;
    const south = depth / 2 + APRON / 2;

    for (let row = 0; row < rows; row++) {
      const z = this.map.cellCenter(0, row).z;
      strip(`w-${row}`, 0, row, west, z, APRON, tileSize);
      strip(`e-${row}`, columns - 1, row, east, z, APRON, tileSize);
    }

    for (let column = this.firstColumn; column < this.endColumn; column++) {
      const x = this.map.cellCenter(column, 0).x;
      strip(`n-${column}`, column, 0, x, north, tileSize, APRON);
    }

    strip('nw', 0, 0, west, north, APRON, APRON);
    strip('ne', columns - 1, 0, east, north, APRON, APRON);
    // Ao sul, uma faixa só: por tile, cada recorte repetia a mesma metade das ondas.
    strip('s', 0, rows - 1, 0, south, 2 * (reach + APRON), APRON);
  }
}

