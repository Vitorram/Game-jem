export const TILE_TYPES = {
  ground: { color: '#eeb65a', height: 0, solid: false },
  promenade: { color: '#ded8cc', height: 0, solid: false },
  cycleway: { color: '#d75c50', height: 0, solid: false },
  sea: { color: '#398fa8', height: 0, solid: true },
  wall: { color: '#657184', height: 1.8, solid: true },
  counter: { color: '#b77b48', height: 0.9, solid: true },
  station: { color: '#66b890', height: 1.2, solid: true },
} as const;
export type TileKind = keyof typeof TILE_TYPES;
export type Point = { x: number; z: number };
export type TileCell = { column: number; row: number };
export type MapDefinition = {
  rows: readonly string[];
  legend: Readonly<Record<string, TileKind>>;
  spawns: readonly TileCell[];
};

/** Centro da grade na origem; colunas crescem em +X e linhas em +Z. */
export class GridMap {
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly depth: number;
  readonly tiles: readonly TileKind[];
  readonly spawns: readonly Point[];

  constructor(definition: MapDefinition, readonly tileSize: number, readonly playerRadius: number) {
    if (!Number.isFinite(tileSize) || tileSize <= 0) throw new Error('Tamanho de tile inválido.');
    if (!Number.isFinite(playerRadius) || playerRadius <= 0 || playerRadius * 2 >= tileSize) throw new Error('Raio do jogador inválido.');
    this.rows = definition.rows.length;
    this.columns = definition.rows[0]?.length ?? 0;
    if (!this.rows || !this.columns || definition.rows.some(row => row.length !== this.columns)) throw new Error('Mapa deve ser retangular e não vazio.');
    this.width = this.columns * tileSize;
    this.depth = this.rows * tileSize;
    this.tiles = Object.freeze(definition.rows.flatMap(row => Array.from(row, symbol => {
      const kind = definition.legend[symbol];
      if (!Object.hasOwn(TILE_TYPES, kind)) throw new Error(`Tile desconhecido: ${symbol}`);
      return kind;
    })));
    if (!definition.spawns.length) throw new Error('Mapa precisa de spawn.');
    this.spawns = Object.freeze(definition.spawns.map(cell => {
      if (!Number.isInteger(cell.column) || !Number.isInteger(cell.row) || this.isSolid(cell.column, cell.row)) throw new Error('Spawn inválido ou bloqueado.');
      return Object.freeze(this.cellCenter(cell.column, cell.row));
    }));
  }

  tileAt(column: number, row: number): TileKind | undefined {
    if (!Number.isInteger(column) || !Number.isInteger(row) || column < 0 || row < 0 || column >= this.columns || row >= this.rows) return undefined;
    return this.tiles[row * this.columns + column];
  }

  isSolid(column: number, row: number): boolean {
    const kind = this.tileAt(column, row);
    return kind === undefined || TILE_TYPES[kind].solid;
  }

  cellCenter(column: number, row: number): Point {
    return { x: (column + 0.5) * this.tileSize - this.width / 2, z: (row + 0.5) * this.tileSize - this.depth / 2 };
  }

  worldToCell(point: Point): TileCell {
    return { column: Math.floor((point.x + this.width / 2) / this.tileSize), row: Math.floor((point.z + this.depth / 2) / this.tileSize) };
  }

  /** Varredura contínua por eixo (AABB): impede tunneling e preserva o eixo livre. */
  resolveMovement(from: Point, to: Point): Point {
    if (![from.x, from.z, to.x, to.z].every(Number.isFinite)) return { ...from };
    const r = this.playerRadius;
    const xLimit = this.width / 2 - r, zLimit = this.depth / 2 - r;
    let x = Math.max(-xLimit, Math.min(xLimit, to.x));
    let z = Math.max(-zLimit, Math.min(zLimit, to.z));
    for (let row = 0; row < this.rows; row++) for (let column = 0; column < this.columns; column++) {
      if (!this.isSolid(column, row)) continue;
      const center = this.cellCenter(column, row), half = this.tileSize / 2;
      const left = center.x - half - r, right = center.x + half + r;
      const top = center.z - half - r, bottom = center.z + half + r;
      if (from.z <= top || from.z >= bottom) continue;
      if (from.x <= left && x > left) x = Math.min(x, left);
      if (from.x >= right && x < right) x = Math.max(x, right);
    }
    for (let row = 0; row < this.rows; row++) for (let column = 0; column < this.columns; column++) {
      if (!this.isSolid(column, row)) continue;
      const center = this.cellCenter(column, row), half = this.tileSize / 2;
      const left = center.x - half - r, right = center.x + half + r;
      const top = center.z - half - r, bottom = center.z + half + r;
      if (x <= left || x >= right) continue;
      if (from.z <= top && z > top) z = Math.min(z, top);
      if (from.z >= bottom && z < bottom) z = Math.max(z, bottom);
    }
    return { x, z };
  }
}
