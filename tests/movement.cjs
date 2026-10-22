const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const|function) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const|function) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { CharacterMotor } = require('../src/game/core/CharacterMotor.ts');
const { ORLA_MOVEMENT } = require('../src/game/config.ts');
const { GridMap } = require('../src/game/map/GridMap.ts');
const free = (_from, to) => to;
const simulate = (fps, axis, sprint = false) => {
  const motor = new CharacterMotor(ORLA_MOVEMENT);
  let position = { x: 0, z: 0 };
  for (let i = 0; i < fps; i++) position = motor.step(1 / fps, position, axis, sprint, free);
  return { motor, position };
};

test('aceleração é gradual, diagonal não ganha velocidade e 30/60/120 FPS são equivalentes', () => {
  const motor = new CharacterMotor(ORLA_MOVEMENT);
  const first = motor.step(1 / 60, { x: 0, z: 0 }, { x: 1, z: 0 }, false, free);
  assert.ok(first.x > 0 && first.x < ORLA_MOVEMENT.speed / 60);
  const distances = [30, 60, 120].map(fps => {
    const straight = simulate(fps, { x: 1, z: 0 }).position.x;
    const diagonal = simulate(fps, { x: 1, z: 1 }).position;
    assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - straight) < 1e-9);
    return straight;
  });
  assert.ok(Math.abs(distances[0] - distances[2]) < 1e-9);
});

test('correr aumenta velocidade; soltar freia em curta distância; stop elimina inércia', () => {
  const walk = simulate(60, { x: 1, z: 0 });
  const run = simulate(60, { x: 1, z: 0 }, true);
  assert.ok(Math.abs(run.position.x / walk.position.x - ORLA_MOVEMENT.sprintMultiplier) < 1e-9);
  let position = run.position;
  for (let i = 0; i < 60; i++) position = run.motor.step(1 / 60, position, { x: 0, z: 0 }, false, free);
  assert.ok(position.x - run.position.x < 0.25, 'não pode escorregar além de 1/8 de tile');
  assert.deepEqual(run.motor.step(1, position, { x: 0, z: 0 }, false, free), position);
  walk.motor.stop();
  assert.deepEqual(walk.motor.step(1, walk.position, { x: 0, z: 0 }, false, free), walk.position);
});

test('motor desliza junto à parede, não acumula impulso contra obstáculo e aceita inversão', () => {
  const map = new GridMap({ rows: ['..#..', '..#..', '..#..', '..#..', '..#..'], legend: { '.': 'ground', '#': 'wall' }, spawns: [{ column: 0, row: 0 }] }, 2, 0.3);
  const motor = new CharacterMotor(ORLA_MOVEMENT);
  const resolve = map.resolveMovement.bind(map);
  let position = { x: -1.3, z: -3 };
  for (let i = 0; i < 60; i++) position = motor.step(1 / 60, position, { x: 1, z: 1 }, true, resolve);
  assert.ok(Math.abs(position.x + 1.3) < 1e-8);
  assert.ok(position.z > 0);
  const reversed = motor.step(1 / 60, position, { x: -1, z: 0 }, false, resolve);
  assert.ok(reversed.x < position.x, 'parede não armazena velocidade contra o jogador');
});

test('delta zero/inválido e entradas inválidas não corrompem posição', () => {
  const motor = new CharacterMotor(ORLA_MOVEMENT);
  const start = { x: 2, z: 3 };
  for (const dt of [0, -1, NaN, Infinity]) assert.deepEqual(motor.step(dt, start, { x: 1, z: 1 }, true, free), start);
  assert.deepEqual(motor.step(0.05, start, { x: NaN, z: Infinity }, true, free), start);
});
