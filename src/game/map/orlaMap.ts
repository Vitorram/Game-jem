import type { MapDefinition } from './GridMap';

/**
 * Orla ampliada: 22 × 12. O crescimento é simétrico (uma coluna em cada lado,
 * uma linha no topo e uma na base), o que preserva todas as coordenadas de
 * mundo já existentes e apenas desloca os índices de coluna/linha em +1.
 *
 * Linhas: 0-1 mar · 2-4 areia · 5-6 calçadão · 7-8 ciclovia · 9 calçada · 10-11 pistas.
 * A linha 9 é tile de rua, mas o TrafficSystem monta as faixas a partir de
 * `z(última linha) − 1,5 × tileSize`, então ela fica livre de veículos e é
 * desenhada como calçada pela GridMapView.
 */
export const ORLA_MAP = {
  legend: { '.': 'ground', '=': 'promenade', '-': 'cycleway', R: 'road', '~': 'sea', '#': 'wall', B: 'counter', E: 'station', C: 'itemBox' },
  rows: [
    '~~~~~~~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~~~~~~~',
    '......................',
    '......................',
    '......................',
    '=======BB==C=E========',
    '======================',
    '----------------------',
    '----------------------',
    'RRRRRRRRRRRRRRRRRRRRRR',
    'RRRRRRRRRRRRRRRRRRRRRR',
    'RRRRRRRRRRRRRRRRRRRRRR',
  ],
  itemSources: [{ column: 11, row: 5, item: 'cone' }],
  spawns: [{ column: 8, row: 6 }, { column: 10, row: 6 }, { column: 12, row: 6 }],
  // A calçada sul continua 1,3 m além da grade, até a faixa de grama das árvores (GridMapView).
  southWalkway: 1.3,
} as const satisfies MapDefinition;