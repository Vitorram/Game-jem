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
const { SceneManager } = require('../src/game/core/SceneManager.ts');
const { TestScene } = require('../src/game/scenes/TestScene.ts');
const { Fase1OrlaScene } = require('../src/game/scenes/Fase1OrlaScene.ts');

function stubScene(name, calls) {
  return {
    scene: new three.Scene(),
    update: dt => calls.push([name, 'update', dt]),
    dispose: () => calls.push([name, 'dispose']),
  };
}

function watchResources(scene) {
  const counts = new Map();
  scene.traverse(object => {
    const resources = [object.geometry, ...[object.material].flat()].filter(Boolean);
    for (const resource of resources) {
      if (counts.has(resource)) continue;
      counts.set(resource, 0);
      resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1));
    }
  });
  return counts;
}

test('manager vazio permite update e dispose repetido', () => {
  const manager = new SceneManager();
  assert.equal(manager.current, null);
  manager.update(0.1);
  manager.dispose();
  manager.dispose();
  manager.update(0.1);
  assert.equal(manager.current, null);
});

test('troca descarta a anterior antes de ativar a próxima; só a ativa recebe dt', () => {
  const calls = [];
  const manager = new SceneManager();
  const first = stubScene('first', calls);
  const second = stubScene('second', calls);
  first.dispose = () => {
    assert.equal(manager.current, null);
    calls.push(['first', 'dispose']);
  };
  manager.setScene(first);
  manager.update(0.016);
  manager.setScene(second);
  assert.equal(manager.current, second);
  manager.update(0.025);
  manager.dispose();
  manager.dispose();
  manager.update(1);
  assert.equal(manager.current, null);
  assert.deepEqual(calls, [
    ['first', 'update', 0.016], ['first', 'dispose'],
    ['second', 'update', 0.025], ['second', 'dispose'],
  ]);
});

test('selecionar a mesma instância ativa não a descarta', () => {
  const calls = [];
  const manager = new SceneManager();
  const scene = stubScene('same', calls);
  manager.setScene(scene);
  manager.setScene(scene);
  manager.update(0);
  assert.deepEqual(calls, [['same', 'update', 0]]);
  manager.dispose();
  assert.deepEqual(calls.at(-1), ['same', 'dispose']);
});

test('manager descartado rejeita cenas novas sem assumir sua propriedade', () => {
  const manager = new SceneManager();
  const calls = [];
  const scene = stubScene('new', calls);
  manager.dispose();
  assert.throws(() => manager.setScene(scene), /descartado/);
  assert.equal(manager.current, null);
  assert.deepEqual(calls, []);
  scene.dispose();
});

test('TestScene recebe input injetado por update(dt) e libera GPU ao trocar por Orla', t => {
  const manager = new SceneManager();
  const lab = new TestScene(undefined, { getAxis: () => ({ x: 1, z: 0 }) });
  const before = lab.player.mesh.position.clone();
  const counts = watchResources(lab.scene);
  const sun = lab.scene.children.find(object => object instanceof three.DirectionalLight);
  const shadowDispose = t.mock.method(sun.shadow, 'dispose');
  manager.setScene(lab);
  manager.update(0.05);
  assert.ok(lab.player.mesh.position.x > before.x);
  const phase = new Fase1OrlaScene();
  manager.setScene(phase);
  assert.equal(lab.scene.children.length, 0);
  assert.ok(counts.size > 0);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(shadowDispose.mock.callCount(), 1);
  assert.equal(phase.scene.children.length, 0);
  manager.update(0.05);
  manager.dispose();
  manager.dispose();
  lab.dispose();
  assert.equal(phase.scene.background, null);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(shadowDispose.mock.callCount(), 1);
});

test('Game abre Orla, pausa, volta ao laboratório e encerra sem recriar renderer', t => {
  const phaseUpdate = t.mock.method(Fase1OrlaScene.prototype, 'update');
  const created = [];
  class Element extends EventTarget {
    style = {};
    setAttribute() {}
    remove() { this.removed = true; }
    closest() { return null; }
    appendChild(child) { this.child = child; }
    clientWidth = 1024;
    clientHeight = 768;
  }
  class Renderer {
    shadowMap = {};
    domElement = new Element();
    constructor() { created.push(this); }
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop(callback) { this.loop = callback; }
    render(scene) { this.lastScene = scene; }
    dispose() { this.disposeCount = (this.disposeCount || 0) + 1; }
    forceContextLoss() { this.contextLost = true; }
  }
  const replacements = {
    window: Object.assign(new EventTarget(), { devicePixelRatio: 1, matchMedia: () => ({ matches: true }) }),
    document: Object.assign(new EventTarget(), { hidden: false }),
    HTMLElement: Element,
    ResizeObserver: class { observe() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'three') return { ...three, WebGLRenderer: Renderer };
    if (id === 'gsap') return { gsap: { to: () => ({ isActive: () => false, kill() {}, pause() {}, resume() {} }) } };
    return originalLoad.call(this, id, ...args);
  });
  const { Game } = require('../src/game/core/Game.ts');
  const statuses = [];
  let abilityEvents = 0;
  const game = new Game(new Element(), status => statuses.push(status), () => abilityEvents++);
  t.after(() => game.dispose());
  const renderer = created[0];
  renderer.loop(100);
  const laboratoryScene = renderer.lastScene;
  const counts = watchResources(laboratoryScene);
  game.input.setTouch(1, 'KeyD');
  game.start('fase1-orla');
  assert.deepEqual(game.input.getAxis(), { x: 0, z: 0 });
  renderer.loop(200);
  const phaseScene = renderer.lastScene;
  assert.notEqual(phaseScene, laboratoryScene);
  assert.equal(phaseScene.children.length, 0);
  assert.ok([...counts.values()].every(count => count === 1));
  const beforeEvents = abilityEvents;
  game.useAbility();
  game.selectPlayer(3);
  game.setCloseView(true);
  game.setAbilityTool('light');
  game.selectStop(0);
  game.clickAbilityMap({ x: 0, z: 0 }, true);
  game.inspectIssue(1);
  game.resetAbilities();
  window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'KeyE' }));
  renderer.loop(216);
  assert.equal(abilityEvents, beforeEvents);
  const updatesBeforePause = phaseUpdate.mock.callCount();
  game.togglePause();
  renderer.loop(232);
  assert.equal(phaseUpdate.mock.callCount(), updatesBeforePause);
  assert.equal(renderer.lastScene, phaseScene);
  game.togglePause();
  game.returnToMenu();
  assert.equal(phaseScene.background, null);
  renderer.loop(248);
  assert.ok(renderer.lastScene.children.length > 0);
  assert.notEqual(renderer.lastScene, laboratoryScene);
  game.start();
  // O laboratório restaurado aceita os controles e atualiza sem emitir snapshots por frame.
  game.selectPlayer(1);
  const eventsAfterSelection = abilityEvents;
  game.input.setTouch(2, 'KeyD');
  renderer.loop(264);
  renderer.loop(280);
  assert.equal(abilityEvents, eventsAfterSelection);
  const restoredCounts = watchResources(renderer.lastScene);
  const oldTick = renderer.loop;
  game.dispose();
  game.dispose();
  oldTick(296);
  game.start('fase1-orla');
  window.dispatchEvent(new Event('blur'));
  assert.equal(renderer.loop, null);
  assert.equal(renderer.disposeCount, 1);
  assert.equal(renderer.contextLost, true);
  assert.equal(renderer.domElement.removed, true);
  assert.equal(created.length, 1);
  assert.ok([...restoredCounts.values()].every(count => count === 1));
  assert.deepEqual(statuses, ['playing', 'paused', 'playing', 'ready', 'playing']);
});
