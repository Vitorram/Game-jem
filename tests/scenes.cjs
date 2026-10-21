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

test('uma cena já descartada não pode voltar ao manager nem receber dispose duas vezes', () => {
  const calls = [];
  const manager = new SceneManager();
  const first = stubScene('first', calls);
  const second = stubScene('second', calls);
  manager.setScene(first);
  manager.setScene(second);
  assert.throws(() => manager.setScene(first), /cena já foi descartada/i);
  assert.equal(manager.current, second);
  manager.dispose();
  assert.deepEqual(calls, [['first', 'dispose'], ['second', 'dispose']]);
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
  lab.abilities.activate({ x: 0, z: 0 });
  lab.abilities.setTool('light');
  lab.abilities.activate({ x: 2, z: 0 });
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

function gameHarness(t, animation) {
  const created = [];
  const tweens = [];
  const observers = [];
  class TrackedTarget extends EventTarget {
    listeners = new Map();
    addEventListener(type, callback, options) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(callback);
      super.addEventListener(type, callback, options);
    }
    removeEventListener(type, callback, options) {
      this.listeners.get(type)?.delete(callback);
      super.removeEventListener(type, callback, options);
    }
    get listenerCount() {
      return [...this.listeners.values()].reduce((sum, callbacks) => sum + callbacks.size, 0);
    }
  }
  class Element extends TrackedTarget {
    style = {};
    children = [];
    setAttribute() {}
    remove() {
      this.removed = true;
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    }
    closest() { return null; }
    appendChild(child) { this.children.push(child); child.parent = this; }
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
    window: Object.assign(new TrackedTarget(), { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }),
    document: Object.assign(new TrackedTarget(), { hidden: false }),
    HTMLElement: Element,
    ResizeObserver: class {
      constructor() { observers.push(this); }
      observe() { this.connected = true; }
      disconnect() { this.connected = false; }
    },
  };
  for (const [key, value] of Object.entries(replacements)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const originalLoad = Module._load;
  t.mock.method(Module, '_load', function (id, ...args) {
    if (id === 'three') return { ...three, WebGLRenderer: Renderer };
    if (id === 'gsap' && animation) return { gsap: animation };
    if (id === 'gsap') return { gsap: { to: () => {
      const tween = {
        killed: false, paused: false,
        isActive() { return !this.killed && !this.paused; },
        kill() { this.killed = true; },
        pause() { this.paused = true; },
        resume() { this.paused = false; },
      };
      tweens.push(tween);
      return tween;
    } } };
    return originalLoad.call(this, id, ...args);
  });
  const gamePath = require.resolve('../src/game/core/Game.ts');
  delete require.cache[gamePath];
  t.after(() => delete require.cache[gamePath]);
  const { Game } = require(gamePath);
  return { Game, Element, created, tweens, observers };
}

test('Game abre Orla, pausa, volta ao laboratório e encerra sem recriar renderer', t => {
  const phaseUpdate = t.mock.method(Fase1OrlaScene.prototype, 'update');
  const { Game, Element, created } = gameHarness(t);
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

for (const sceneId of ['test', 'fase1-orla']) {
  test(`${sceneId}: Escape, blur e aba oculta pausam updates e tween sem retomar sozinhos`, t => {
    const { Game, Element, created, tweens } = gameHarness(t);
    const SceneType = sceneId === 'test' ? TestScene : Fase1OrlaScene;
    const updates = t.mock.method(SceneType.prototype, 'update');
    const statuses = [];
    const game = new Game(new Element(), status => statuses.push(status));
    t.after(() => game.dispose());
    game.start(sceneId);
    const renderer = created[0];
    const tween = tweens[0];
    let time = 100;
    for (const reason of ['escape', 'blur', 'hidden']) {
      renderer.loop(time += 16);
      const before = updates.mock.callCount();
      game.input.setTouch(1, 'KeyD');
      if (reason === 'escape') window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      if (reason === 'hidden') {
        document.hidden = true;
        document.dispatchEvent(new Event('visibilitychange'));
      }
      assert.equal(statuses.at(-1), 'paused');
      assert.equal(tween.paused, true);
      assert.deepEqual(game.input.getAxis(), { x: 0, z: 0 });
      renderer.loop(time += 16);
      assert.equal(updates.mock.callCount(), before);
      document.hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
      assert.equal(statuses.at(-1), 'paused');
      game.togglePause();
      renderer.loop(time += 16);
      assert.equal(updates.mock.callCount(), before + 1);
      assert.equal(updates.mock.calls.at(-1).arguments[0], 0, 'primeiro dt após retomar deve ser zero');
      assert.equal(tween.paused, false);
    }
    game.dispose();
    assert.equal(tween.killed, true);
  });
}

test('20 trocas e ciclo montar/desmontar/remontar não acumulam listeners, canvas ou tweens', t => {
  const { Game, Element, created, tweens, observers } = gameHarness(t);
  const host = new Element();
  const staleTicks = [];
  const sceneDisposals = new Map();
  for (const SceneType of [TestScene, Fase1OrlaScene]) {
    const dispose = SceneType.prototype.dispose;
    t.mock.method(SceneType.prototype, 'dispose', function () {
      sceneDisposals.set(this, (sceneDisposals.get(this) || 0) + 1);
      return dispose.call(this);
    });
  }
  // Reproduz setup -> cleanup -> setup do efeito de GameCanvas no Strict Mode.
  for (let mount = 0; mount < 3; mount++) {
    const statuses = [];
    const game = new Game(host, status => statuses.push(status));
    t.after(() => game.dispose());
    const renderer = created.at(-1);
    const listenerCount = window.listenerCount + document.listenerCount;
    assert.equal(listenerCount, 6);
    assert.equal(host.children.length, 1);
    if (mount > 0) {
      for (let cycle = 0; cycle < 10; cycle++) {
        game.start(cycle % 2 === 0 ? 'fase1-orla' : 'test');
        renderer.loop(100 + cycle * 32);
        const counts = watchResources(renderer.lastScene);
        game.togglePause();
        assert.equal(tweens.at(-1).paused, true);
        game.returnToMenu();
        assert.equal(statuses.at(-1), 'ready');
        assert.equal(tweens.at(-1).killed, true);
        assert.ok([...counts.values()].every(count => count === 1));
        assert.equal(window.listenerCount + document.listenerCount, listenerCount);
        assert.equal(host.children.length, 1);
      }
      game.start();
      window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
      assert.deepEqual(statuses.slice(-2), ['playing', 'paused'], 'apenas um handler de Escape por jogo');
    }
    staleTicks.push(renderer.loop);
    game.dispose();
    game.dispose();
    assert.equal(window.listenerCount + document.listenerCount, 0);
    assert.equal(host.children.length, 0);
    assert.equal(renderer.loop, null);
    assert.equal(renderer.disposeCount, 1);
    assert.ok(observers.every(observer => !observer.connected));
    assert.ok(tweens.every(tween => tween.killed));
    const before = statuses.length;
    staleTicks.forEach(tick => tick(2000));
    window.dispatchEvent(new Event('blur'));
    assert.equal(statuses.length, before);
  }
  assert.ok(sceneDisposals.size > 20);
  assert.ok([...sceneDisposals.values()].every(count => count === 1));
});

test('zoom seguido de pausa não ressuscita o tween de entrada cancelado (GSAP real)', t => {
  const { gsap } = require('gsap');
  gsap.ticker.wake();
  let game;
  t.after(() => { game?.dispose(); gsap.ticker.sleep(); });
  const { Game, Element } = gameHarness(t, gsap);
  game = new Game(new Element(), () => {});
  game.start();
  const tween = gsap.globalTimeline.getChildren().find(child => child.targets().some(target => target instanceof three.Vector3));
  assert.ok(tween, 'a entrada cria um tween real da câmera');
  game.setCloseView(true);
  assert.equal(gsap.globalTimeline.getChildren().includes(tween), false);
  game.togglePause();
  game.togglePause();
  assert.equal(gsap.globalTimeline.getChildren().includes(tween), false, 'o tween cancelado deve continuar fora da timeline');
});
