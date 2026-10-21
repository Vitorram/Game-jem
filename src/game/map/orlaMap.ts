import type { MapDefinition } from './GridMap';

/** Protótipo 16 × 10. Edite os dados sem alterar o construtor da cena. */
export const ORLA_MAP = {
  legend: { '.': 'ground', '=': 'promenade', '-': 'cycleway', '~': 'sea', '#': 'wall', B: 'counter', E: 'station' },
  rows: [
    '~~~~~~~~~~~~~~~~',
    '~~~~~~~~~~~~~~~~',
    '................',
    '................',
    '====BB====E=====',
    '================',
    '----------------',
    '----------------',
    '....##..........',
    '................',
  ],
  spawns: [{ column: 5, row: 5 }, { column: 7, row: 5 }, { column: 9, row: 5 }],
} as const satisfies MapDefinition;
