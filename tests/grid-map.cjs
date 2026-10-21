const fs = require('node:fs');
const Module = require('node:module');
const { stripTypeScriptTypes } = Module;
const assert = require('node:assert/strict');
const { test } = require('node:test');
const three = require('three');

// Mesmo carregamento dos testes de personagens; transform aceita o construtor do Game.
require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { GridMap, TILE_TYPES } = require('../src/game/map/GridMap.ts');
const { GridMapView } = require('../src/game/map/GridMapView.ts');
const { ORLA_MAP } = require('../src/game/map/orlaMap.ts');
const { GRID_CONFIG } = require('../src/game/config.ts');
const definition = (rows = ['.....', '..#..', '.....', '.....', '.....']) => ({ rows, legend: { '.': 'ground', '#': 'wall' }, spawns: [{ column: 0, row: 0 }] });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('lê 16x10, oito tipos, spawns livres e conversão entre grade e mundo', () => {
  const map = new GridMap(ORLA_MAP, GRID_CONFIG.tileSize, GRID_CONFIG.playerRadius);
  assert.equal(map.columns, 16);
  assert.equal(map.rows, 10);
  assert.equal(map.width, 32);
  assert.equal(map.depth, 20);
  assert.deepEqual(new Set(map.tiles), new Set(Object.keys(TILE_TYPES)));
  assert.equal(map.spawns.length, 3);
  for (let row = 0; row < map.rows; row++) for (let column = 0; column < map.columns; column++) {
    assert.deepEqual(map.worldToCell(map.cellCenter(column, row)), { column, row });
  }
  map.spawns.forEach(point => {
    const cell = map.worldToCell(point);
    assert.equal(map.isSolid(cell.column, cell.row), false);
  });
  assert.equal(map.tileAt(-1, 0), undefined);
  assert.equal(map.isSolid(16, 0), true);
});

test('rejeita mapas vazios, irregulares, símbolos e spawns inválidos', () => {
  for (const rows of [[], [''], ['..', '.'], ['?']]) assert.throws(() => new GridMap(definition(rows), 1, 0.2));
  for (const size of [0, -1, NaN, Infinity]) assert.throws(() => new GridMap(definition(), size, 0.2));
  for (const radius of [0, -1, NaN, Infinity, 0.5]) assert.throws(() => new GridMap(definition(), 1, radius));
  for (const spawn of [{ column: 2, row: 1 }, { column: -1, row: 0 }, { column: 0.5, row: 0 }]) {
    assert.throws(() => new GridMap({ ...definition(), spawns: [spawn] }, 1, 0.2));
  }
  assert.throws(() => new GridMap({ ...definition(), spawns: [] }, 1, 0.2));
});

test('colisão contínua nos quatro lados, raio e deslizamento sem atravessar parede', () => {
  const map = new GridMap(definition(), 1, 0.2);
  near(map.resolveMovement({ x: -2, z: -1 }, { x: 2, z: -1 }).x, -0.7);
  near(map.resolveMovement({ x: 2, z: -1 }, { x: -2, z: -1 }).x, 0.7);
  near(map.resolveMovement({ x: 0, z: -2 }, { x: 0, z: 2 }).z, -1.7);
  near(map.resolveMovement({ x: 0, z: 2 }, { x: 0, z: -2 }).z, -0.3);
  const slide = map.resolveMovement({ x: -0.8, z: -1 }, { x: -0.4, z: -0.9 });
  near(slide.x, -0.7); near(slide.z, -0.9);
  const still = map.resolveMovement(slide, { x: 0, z: -0.8 });
  near(still.x, -0.7); near(still.z, -0.8);
});

test('bloqueia mar, bancada e estação; chão, calçadão e ciclovia são livres', () => {
  for (const kind of Object.keys(TILE_TYPES)) {
    const map = new GridMap({ ...definition(), legend: { '.': 'ground', '#': kind }, itemSources: kind === 'itemBox' ? [{ column: 2, row: 1, item: 'sensor' }] : [] }, 1, 0.2);
    const moved = map.resolveMovement({ x: -2, z: -1 }, { x: 2, z: -1 });
    near(moved.x, TILE_TYPES[kind].solid ? -0.7 : 2);
  }
});

test('limites externos respeitam raio; movimento livre e dt zero preservam posição', () => {
  const map = new GridMap(definition(['.....', '.....', '.....']), 2, 0.3);
  assert.deepEqual(map.resolveMovement({ x: 0, z: 0 }, { x: 100, z: -100 }), { x: 4.7, z: -2.7 });
  assert.deepEqual(map.resolveMovement({ x: 0, z: 0 }, { x: 0.1, z: 0.2 }), { x: 0.1, z: 0.2 });
  assert.deepEqual(map.resolveMovement({ x: 1, z: 1 }, { x: 1, z: 1 }), { x: 1, z: 1 });
});

test('construtor cria um bloco por tile, topo correto, sombras e dispose único', () => {
  const map = new GridMap(ORLA_MAP, 2, 0.3);
  const view = new GridMapView(map);
  assert.equal(view.group.children.length, 160);
  const resources = new Map();
  view.group.traverse(object => {
    for (const resource of [object.geometry, object.material].filter(Boolean)) {
      if (resources.has(resource)) continue;
      resources.set(resource, 0);
      resource.addEventListener('dispose', () => resources.set(resource, resources.get(resource) + 1));
    }
  });
  assert.equal(resources.size, Object.keys(TILE_TYPES).length + 1);
  for (const tile of view.group.children) {
    const kind = tile.name.split('-').at(-1);
    near(tile.position.y + tile.scale.y / 2, TILE_TYPES[kind].height);
    assert.equal(tile.receiveShadow, true);
  }
  view.dispose(); view.dispose();
  assert.ok([...resources.values()].every(count => count === 1));
  assert.equal(view.group.children.length, 0);
});

test('Player anima deslocamento resolvido e não anda no lugar contra obstáculo', () => {
  const { Player } = require('../src/game/entities/Player.ts');
  const map = new GridMap(definition(), 1, 0.2);
  const player = new Player(1);
  player.setPosition(-0.7, -1);
  const resolve = map.resolveMovement.bind(map);
  for (let i = 0; i < 100; i++) player.update(0.05, { x: 1, z: 0 }, resolve);
  near(player.mesh.position.x, -0.7);
  near(player.gait, 0);
  player.update(0, { x: 0, z: 1 }, resolve);
  near(player.mesh.position.z, -1);
  player.dispose();
});

test('deslocamentos repetidos não penetram quinas ou emendas entre tiles sólidos', () => {
  const map = new GridMap(ORLA_MAP, 2, 0.3);
  let position = map.spawns[0];
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let i = 0; i < 5000; i++) {
    position = map.resolveMovement(position, { x: position.x + (random() - 0.5) * 4, z: position.z + (random() - 0.5) * 4 });
    assert.ok(Math.abs(position.x) <= map.width / 2 - map.playerRadius + 1e-9);
    assert.ok(Math.abs(position.z) <= map.depth / 2 - map.playerRadius + 1e-9);
    for (let row = 0; row < map.rows; row++) for (let col = 0; col < map.columns; col++) {
      if (!map.isSolid(col, row)) continue;
      const center = map.cellCenter(col, row);
      const half = map.tileSize / 2 + map.playerRadius - 1e-8;
      assert.ok(Math.abs(position.x - center.x) >= half || Math.abs(position.z - center.z) >= half);
    }
  }
});
