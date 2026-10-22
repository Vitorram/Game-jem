const fs = require('node:fs');
const Module = require('node:module');
const { stripTypeScriptTypes } = Module;
const assert = require('node:assert/strict');
const { test } = require('node:test');

// Mesmo carregamento dos testes de personagens; transform aceita o construtor do Game.
require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { GridMap } = require('../src/game/map/GridMap.ts');
const { ItemInteractions } = require('../src/game/items/ItemInteractions.ts');
const fixture = () => {
  const map = new GridMap({
    rows: ['CC.B.', '.....', '..E..'],
    legend: { C: 'itemBox', '.': 'ground', B: 'counter', E: 'station' },
    itemSources: [{ column: 0, row: 0, item: 'sensor' }, { column: 1, row: 0, item: 'sign' }],
    spawns: [{ column: 0, row: 1 }],
  }, 2, 0.3);
  const state = new ItemInteractions(map, [1, 2, 3]);
  const use = (id, column) => { state.face(id, { x: 0, z: -1 }); return state.interact(id, map.cellCenter(column, 1)); };
  return { map, state, use };
};

test('caixa entrega o tipo configurado infinitamente para mãos vazias', () => {
  const { state, use } = fixture();
  assert.equal(use(1, 0), true);
  assert.equal(state.heldBy(1), 'sensor');
  assert.equal(use(2, 0), true);
  assert.equal(state.heldBy(2), 'sensor');
  assert.equal(use(3, 1), true);
  assert.equal(state.heldBy(3), 'sign');
});

test('mão ocupada não pega outra caixa nem substitui o item', () => {
  const { state, use } = fixture();
  use(1, 0);
  assert.equal(use(1, 1), false);
  assert.equal(use(1, 0), false);
  assert.equal(state.heldBy(1), 'sensor');
});

test('bancada vazia recebe um item; mãos vazias pegam o mesmo item de volta', () => {
  const { state, use } = fixture();
  const counter = { column: 3, row: 0 };
  assert.equal(use(1, 3), false);
  use(1, 0);
  assert.equal(use(1, 3), true);
  assert.equal(state.heldBy(1), null);
  assert.equal(state.onCounter(counter), 'sensor');
  assert.equal(use(2, 3), true);
  assert.equal(state.heldBy(2), 'sensor');
  assert.equal(state.onCounter(counter), null);
});

test('bancada ocupada e mão ocupada não trocam nem perdem os itens', () => {
  const { state, use } = fixture();
  use(1, 0); use(1, 3); use(2, 1);
  assert.equal(use(2, 3), false);
  assert.equal(state.heldBy(2), 'sign');
  assert.equal(state.onCounter({ column: 3, row: 0 }), 'sensor');
});

test('direção cardinal persiste em repouso e é independente para cada personagem', () => {
  const { map, state } = fixture();
  const position = map.cellCenter(2, 1);
  for (const [axis, target] of [
    [{ x: 1, z: 0 }, { column: 3, row: 1 }],
    [{ x: -1, z: 0 }, { column: 1, row: 1 }],
    [{ x: 0, z: -1 }, { column: 2, row: 0 }],
    [{ x: 0, z: 1 }, { column: 2, row: 2 }],
    [{ x: 0.8, z: 0.2 }, { column: 3, row: 1 }],
    [{ x: 1, z: -1 }, { column: 2, row: 0 }],
  ]) {
    state.face(1, axis);
    state.face(1, { x: 0, z: 0 });
    assert.deepEqual(state.tileInFront(1, position), target);
  }
  assert.deepEqual(state.facingOf(2), { x: 0, z: 1 });
});

test('solo, estação, fora do mapa e entradas inválidas não executam ação', () => {
  const { map, state, use } = fixture();
  assert.equal(use(1, 2), false);
  state.face(1, { x: 0, z: 1 });
  assert.equal(state.interact(1, map.cellCenter(2, 1)), false);
  assert.equal(state.interact(1, map.cellCenter(0, 2)), false);
  assert.equal(state.interact(99, map.cellCenter(0, 1)), false);
  assert.equal(state.interact(1, { x: NaN, z: 0 }), false);
  state.face(1, { x: Infinity, z: 0 });
  assert.deepEqual(state.facingOf(1), { x: 0, z: 1 });
});

test('mapa rejeita caixa sem tipo, tipo inválido, duplicata ou fonte fora de caixa', () => {
  const base = { rows: ['C.'], legend: { C: 'itemBox', '.': 'ground' }, spawns: [{ column: 1, row: 0 }] };
  for (const itemSources of [[], [{ column: 0, row: 0, item: 'missing' }],
    [{ column: 1, row: 0, item: 'sensor' }],
    [{ column: 0, row: 0, item: 'sensor' }, { column: 0, row: 0, item: 'sign' }]]) {
    assert.throws(() => new GridMap({ ...base, itemSources }, 2, 0.3), /Caixa de itens/);
  }
});
