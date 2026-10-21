import type { MapDefinition } from './GridMap';

/** Protótipo 16 × 10 com via de escape ao lado da avenida principal. */
export const ORLA_MAP = {
  legend: { '.': 'ground', '=': 'promenade', '-': 'cycleway', R: 'road', '~': 'sea', '#': 'wall', B: 'counter', E: 'station', C: 'itemBox' },
  rows: [
    '~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~',
    '................',
    '................',
    '==C=BBC=C=E=====',
    '================',
    '----------------',
    '----------------',
    'RRRRRRRRRRRRRRRR',
    'RRRRRRRRRRRRRRRR',
  ],
  itemSources: [{ column: 2, row: 4, item: 'sensor' }, { column: 6, row: 4, item: 'sign' }, { column: 8, row: 4, item: 'barrier' }],
  spawns: [{ column: 5, row: 5 }, { column: 7, row: 5 }, { column: 9, row: 5 }],
} as const satisfies MapDefinition;
