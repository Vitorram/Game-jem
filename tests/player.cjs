// Execute com Node 22.13+ ou 24: node --test tests/player.cjs
const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Vector3 } = require('three');

// Carrega apenas os módulos locais do motor, sem navegador ou compilação em disco.
require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'));
  const names = [...source.matchAll(/export (?:class|const) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*'([^']+)';/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { Player } = require('../src/game/entities/Player.ts');
const { TestScene } = require('../src/game/scenes/TestScene.ts');
const { GAME_CONFIG } = require('../src/game/config.ts');
const idle = { x: 0, z: 0 };
const tick = (player, axis, frames = 120, dt = 1 / 60) => {
  for (let i = 0; i < frames; i++) player.update(dt, axis);
};

for (const id of [1, 2, 3]) {
  test(`personagem ${id}: articulações, pés no chão e cabelo em movimento`, () => {
    const player = new Player(id);
    for (const side of [-1, 1]) {
      assert.equal(player.mesh.getObjectByName(`foot-${side}`).parent.name, `knee-${side}`);
      assert.equal(player.mesh.getObjectByName(`hand-${side}`).parent.name, `elbow-${side}`);
    }
    const hair = player.mesh.getObjectByName('hair-0');
    tick(player, idle);
    assert.ok(Math.abs(hair.rotation.x) > 0.001, 'cabelo deve se mover em repouso');
    assert.equal(player.mesh.position.length(), 0, 'repouso não desloca a personagem');
    const foot = new Vector3();
    let highest = 0;
    for (let i = 0; i < 240; i++) {
      player.update(1 / 60, { x: 0, z: 1 });
      player.mesh.updateMatrixWorld(true);
      for (const side of [-1, 1]) {
        player.mesh.getObjectByName(`foot-${side}`).getWorldPosition(foot);
        // O tornozelo fica a 10,5 cm do chão e a sola a 0,5 cm.
        assert.ok(foot.y >= 0.104 * player.mesh.scale.y, `pé atravessou o chão: ${foot.y}`);
        highest = Math.max(highest, foot.y);
      }
    }
    assert.ok(highest > 0.2 * player.mesh.scale.y, 'o pé deve levantar durante a passada');
    tick(player, idle);
    assert.ok(Math.abs(player.mesh.getObjectByName('shoulder-1').rotation.x) < 0.04);
    player.dispose();
  });
}

test('velocidade diagonal, limites do mundo e estabilidade em diferentes FPS', () => {
  const positions = [];
  for (const fps of [30, 60, 120]) {
    const player = new Player(2);
    tick(player, { x: 1, z: 1 }, fps, 1 / fps);
    assert.ok(Math.abs(player.mesh.position.length() - GAME_CONFIG.playerSpeed) < 1e-9);
    positions.push(player.mesh.position.clone());
    tick(player, { x: 1, z: 1 }, fps * 15, 1 / fps);
    assert.equal(player.mesh.position.x, GAME_CONFIG.worldLimit);
    assert.equal(player.mesh.position.z, GAME_CONFIG.worldLimit);
    player.mesh.traverse(object => {
      assert.ok([...object.position, object.rotation.x, object.rotation.y, object.rotation.z].every(Number.isFinite));
    });
    player.dispose();
  }
  assert.ok(positions[0].distanceTo(positions[2]) < 1e-9);
});

test('rotação faz o caminho curto; delta zero congela animações', () => {
  const player = new Player(1);
  player.mesh.rotation.y = Math.PI - 0.01;
  player.update(1 / 60, { x: -0.01, z: -1 });
  assert.ok(Math.abs(player.mesh.rotation.y) > 3);
  const before = player.mesh.getObjectByName('hair-0').rotation.clone();
  player.update(0, idle);
  assert.ok(player.mesh.getObjectByName('hair-0').rotation.equals(before));
  player.dispose();
});

test('WASD move apenas Infraestrutura ou Mobilidade selecionada; Análise usa o mouse', () => {
  const scene = new TestScene();
  for (const id of [1, 2, 3]) {
    scene.selectPlayer(id);
    const before = scene.players.map(player => player.mesh.position.clone());
    scene.update(0.05, { getAxis: () => ({ x: 1, z: 0 }) });
    scene.players.forEach((player, index) => {
      assert.equal(player.mesh.position.equals(before[index]), player.id !== id || id === 3);
    });
  }
  scene.dispose();
  assert.equal(scene.scene.children.length, 0);
});

test('geometrias compartilhadas são liberadas apenas uma vez', () => {
  const player = new Player(3);
  const resources = new Set();
  player.mesh.traverse(object => {
    if (object.geometry) resources.add(object.geometry);
    if (object.material) resources.add(object.material);
  });
  let disposed = 0;
  for (const resource of resources) resource.addEventListener('dispose', () => disposed++);
  player.dispose();
  player.dispose();
  assert.equal(disposed, resources.size);
});

const { AbilityLab } = require('../src/game/core/AbilityLab.ts');
test('sensores respeitam limite e distância; iluminação alterna sem mudar de lugar', () => {
  const lab = new AbilityLab();
  for (const x of [-4, -2, 0, 2, 4]) lab.activate({ x, z: 0 });
  lab.activate({ x: 6, z: 0 });
  assert.equal(lab.snapshot().sensors.length, 5);
  lab.setTool('light');
  lab.activate({ x: 1, z: 1 });
  assert.equal(lab.snapshot().light.level, 1);
  lab.activate({ x: 5, z: 5 });
  assert.deepEqual(lab.snapshot().light, { x: 1, z: 1, level: 2 });
  lab.activate({ x: 5, z: 5 });
  assert.equal(lab.snapshot().light.level, 0);
  lab.reset();
  lab.activate({ x: 0, z: 0 });
  lab.activate({ x: 0.2, z: 0 });
  assert.equal(lab.snapshot().sensors.length, 1);
});
test('rota só é aplicada ao confirmar; trocar de papel descarta rascunho', () => {
  const lab = new AbilityLab();
  lab.selectRole(2);
  const original = lab.snapshot().stops;
  lab.activate({ x: 0, z: 0 });
  assert.ok(lab.movementBlocked);
  lab.selectStop(1);
  lab.mapClick({ x: -6, z: -5 });
  assert.deepEqual(lab.snapshot().stops, original);
  lab.activate({ x: 0, z: 0 });
  assert.deepEqual(lab.snapshot().stops[1], { x: -6, z: -5 });
  assert.equal(lab.movementBlocked, false);
  lab.activate({ x: 0, z: 0 });
  lab.mapClick({ x: 6, z: 5 });
  lab.selectRole(1);
  assert.deepEqual(lab.snapshot().draft, lab.snapshot().stops);
});
test('análise exige inspeção antes de marcar; equipe recebe marcação; reset limpa tudo', () => {
  const lab = new AbilityLab();
  lab.inspect(1);
  assert.equal(lab.snapshot().issues[0].revealed, false);
  lab.selectRole(3);
  lab.inspect(1, true);
  assert.equal(lab.snapshot().issues[0].marked, false);
  lab.mapClick({ x: -3, z: -2 });
  lab.mapClick({ x: -3, z: -2 }, true);
  assert.equal(lab.snapshot().issues[0].marked, true);
  lab.selectRole(1);
  assert.equal(lab.snapshot().issues[0].marked, true);
  lab.reset();
  assert.equal(lab.snapshot().issues[0].marked, false);
  assert.equal(lab.snapshot().role, 1);
});
test('editar rota bloqueia movimento e indicadores podem ser recriados e descartados', () => {
  const scene = new TestScene();
  scene.abilities.activate({ x: 0, z: 0 });
  scene.abilities.setTool('light');
  scene.abilities.activate({ x: 2, z: 0 });
  scene.selectPlayer(2);
  scene.abilities.activate({ x: 0, z: 0 });
  const before = scene.player.mesh.position.clone();
  scene.update(0.05, { getAxis: () => ({ x: 1, z: 1 }) });
  assert.ok(scene.player.mesh.position.equals(before));
  scene.abilities.mapClick({ x: -6, z: 4 });
  scene.abilities.reset();
  scene.dispose();
  assert.equal(scene.scene.children.length, 0);
});

