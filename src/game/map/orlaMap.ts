import type { MapDefinition } from './GridMap';

/** Orla original ampliada apenas nas laterais: 20 × 10, com 2 faixas por sentido. */
export const ORLA_MAP = {
  legend: { '.': 'ground', '=': 'promenade', '-': 'cycleway', R: 'road', '~': 'sea', '#': 'wall', B: 'counter', E: 'station', C: 'itemBox' },
  rows: [
    '~~~~~~~~~~~~~~~~~~~~',
    '....................',
    '....................',
    '....................',
    '======BB==C=E=======',
    '====================',
    '--------------------',
    '--------------------',
    'RRRRRRRRRRRRRRRRRRRR',
    'RRRRRRRRRRRRRRRRRRRR',
  ],
  itemSources: [{ column: 10, row: 4, item: 'cone' }],
  spawns: [{ column: 7, row: 5 }, { column: 9, row: 5 }, { column: 11, row: 5 }],
} as const satisfies MapDefinition;
