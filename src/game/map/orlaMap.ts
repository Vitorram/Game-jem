import type { MapDefinition } from './GridMap';

/** Protótipo 16 × 10. Edite os dados sem alterar o construtor da cena. */
export const ORLA_MAP = {
  legend: { '.': 'ground', '=': 'promenade', '-': 'cycleway', '~': 'sea', '#': 'wall', B: 'counter', E: 'station', C: 'itemBox' },
  rows: [
    '~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~',
    '................',
    '................',
    '==C=BBC=C=E=====',
    '================',
    '----------------',
    '----------------',
    '....##..........',
    '................',
  ],
  itemSources: [{ column: 2, row: 4, item: 'sensor' }, { column: 6, row: 4, item: 'sign' }, { column: 8, row: 4, item: 'barrier' }],
  spawns: [{ column: 5, row: 5 }, { column: 7, row: 5 }, { column: 9, row: 5 }],
} as const satisfies MapDefinition;
