import type { GridMap, Point, TileCell } from '../map/GridMap';
import type { ItemId } from './itemData';

export type Facing = Readonly<{ x: number; z: number }>;
type CharacterItems = { facing: Facing; held: ItemId | null };
const cellKey = (cell: TileCell) => `${cell.column},${cell.row}`;

/** Estado e regras de itens. Não conhece Three, React, teclado ou personagem 3D. */
export class ItemInteractions {
  private readonly characters = new Map<number, CharacterItems>();
  private readonly counters = new Map<string, ItemId | null>();
  private readonly sources = new Map<string, ItemId>();

  constructor(private readonly map: GridMap, playerIds: readonly number[]) {
    playerIds.forEach(id => this.characters.set(id, { facing: { x: 0, z: 1 }, held: null }));
    for (let row = 0; row < map.rows; row++) for (let column = 0; column < map.columns; column++) {
      if (map.tileAt(column, row) === 'counter') this.counters.set(cellKey({ column, row }), null);
    }
    map.itemSources.forEach(source => this.sources.set(cellKey(source), source.item));
  }

  heldBy(playerId: number): ItemId | null { return this.characters.get(playerId)?.held ?? null; }
  onCounter(cell: TileCell): ItemId | null { return this.counters.get(cellKey(cell)) ?? null; }
  facingOf(playerId: number): Facing | undefined { return this.characters.get(playerId)?.facing; }

  /** Eixo dominante resolve diagonais; soltar o controle preserva a direção. */
  face(playerId: number, axis: Point): void {
    const character = this.characters.get(playerId);
    if (!character || !Number.isFinite(axis.x) || !Number.isFinite(axis.z) || (!axis.x && !axis.z)) return;
    character.facing = Object.freeze(Math.abs(axis.x) > Math.abs(axis.z)
      ? { x: Math.sign(axis.x), z: 0 }
      : { x: 0, z: Math.sign(axis.z) });
  }

  tileInFront(playerId: number, position: Point): TileCell | undefined {
    const facing = this.facingOf(playerId);
    if (!facing || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return undefined;
    const cell = this.map.worldToCell(position);
    return { column: cell.column + facing.x, row: cell.row + facing.z };
  }

  /** Retorna true só quando houve transferência. Ações incompatíveis são no-op. */
  interact(playerId: number, position: Point): boolean {
    const character = this.characters.get(playerId);
    const cell = this.tileInFront(playerId, position);
    if (!character || !cell) return false;
    const key = cellKey(cell);
    const tile = this.map.tileAt(cell.column, cell.row);
    if (tile === 'itemBox') {
      const item = this.sources.get(key);
      if (character.held !== null || !item) return false;
      character.held = item;
      return true;
    }
    if (tile !== 'counter' || !this.counters.has(key)) return false;
    const stored = this.counters.get(key)!;
    if (character.held !== null && stored === null) {
      this.counters.set(key, character.held);
      character.held = null;
      return true;
    }
    if (character.held === null && stored !== null) {
      character.held = stored;
      this.counters.set(key, null);
      return true;
    }
    return false;
  }
}
