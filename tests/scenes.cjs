const fs = require('node:fs');
const Module = require('node:module');
const { stripTypeScriptTypes } = Module;
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const three = require('three');

// Mesmo carregamento dos testes de personagens; transform aceita o construtor do Game.
require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const|function) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const|function) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};
const { SceneManager } = require('../src/game/core/SceneManager.ts');
const { TestScene } = require('../src/game/scenes/TestScene.ts');
const { Fase1OrlaScene } = require('../src/game/scenes/Fase1OrlaScene.ts');
const { suburbanGameState } = require('../src/game/core/GameState.ts');
beforeEach(() => suburbanGameState.reset());

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
  const lab = new TestScene(undefined, { isSprinting: () => false, getAxis: () => ({ x: 1, z: 0 }) });
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
  assert.equal(phase.players.length, 3);
  assert.ok(phase.scene.getObjectByName('orla-ground'));
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
    render(scene, camera) { this.lastScene = scene; this.lastCamera = camera; }
    dispose() { this.disposeCount = (this.disposeCount || 0) + 1; }
    forceContextLoss() { this.contextLost = true; }
  }
  const replacements = {
    window: Object.assign(new TrackedTarget(), { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) }),
    document: Object.assign(new TrackedTarget(), { hidden: false, createElement: () => ({ getContext: () => null }) }),
    HTMLElement: Element,
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
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
  assert.ok(phaseScene.getObjectByName('orla-ground'));
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
      if (tween) assert.equal(tween.paused, true);
      else assert.equal(tweens.length, 0, 'Orla não cria tween de câmera');
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
      if (tween) assert.equal(tween.paused, false);
    }
    game.dispose();
    if (tween) assert.equal(tween.killed, true);
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
        if (cycle % 2 !== 0) assert.equal(tweens.at(-1).paused, true);
        game.returnToMenu();
        assert.equal(statuses.at(-1), 'ready');
        assert.ok(tweens.every(tween => tween.killed));
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

const { ORLA_CONFIG, ORLA_CAMERA } = require('../src/game/config.ts');

for (const [width, height] of [[1920, 1080], [768, 1024], [390, 844], [844, 390], [320, 1000]]) {
  test(`Orla mantém os quatro cantos do viewport dentro do chão em ${width}x${height}`, () => {
    const orla = new Fase1OrlaScene();
    const camera = new three.PerspectiveCamera();
    const ray = new three.Raycaster();
    const floor = new three.Plane(new three.Vector3(0, 1, 0), 0);
    for (const close of [true, false]) for (const x of [-9, 0, 9]) for (const z of [-9, 0, 9]) {
      orla.player.setPosition(x, z);
      orla.configureCamera(camera, width / height, close);
      assert.equal(camera.fov, ORLA_CAMERA.fov);
      assert.ok(Math.abs(camera.rotation.x + Math.atan2(1, ORLA_CAMERA.tilt)) < 1e-9);
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        ray.setFromCamera(new three.Vector2(sx, sy), camera);
        const hit = ray.ray.intersectPlane(floor, new three.Vector3());
        assert.ok(hit);
        assert.ok(Math.abs(hit.x) <= orla.map.width / 2 + (close ? 0 : ORLA_CAMERA.groundApron) + 1e-8);
        assert.ok(Math.abs(hit.z) <= orla.map.depth / 2 + (close ? 0 : ORLA_CAMERA.groundApron) + 1e-8);
      }
    }
    orla.dispose();
  });
}

test('Orla move cada personagem selecionada, respeita o chão e libera recursos uma vez', t => {
  const orla = new Fase1OrlaScene({ isSprinting: () => false, getAxis: () => ({ x: 1, z: 1 }) });
  const counts = watchResources(orla.scene);
  const sun = orla.scene.children.find(child => child instanceof three.DirectionalLight);
  const shadowDispose = t.mock.method(sun.shadow, 'dispose');
  assert.ok(sun.castShadow);
  assert.ok(orla.scene.children.some(child => child instanceof three.HemisphereLight));
  assert.ok(orla.scene.getObjectByName('tile-0-0-sea').receiveShadow);
  for (const id of [1, 2, 3]) {
    orla.selectPlayer(id);
    const before = orla.players.map(player => player.mesh.position.clone());
    orla.update(0.05);
    orla.players.forEach((player, i) => assert.equal(player.mesh.position.equals(before[i]), player.id !== id || id === 3));
    for (let frame = 0; frame < 300; frame++) orla.update(0.05);
    assert.ok(Math.abs(orla.player.mesh.position.x) <= orla.map.width / 2 - orla.map.playerRadius);
    assert.ok(Math.abs(orla.player.mesh.position.z) <= orla.map.depth / 2 - orla.map.playerRadius);
  }
  orla.dispose();
  orla.dispose();
  const before = orla.player.mesh.position.clone();
  orla.update(0.05);
  assert.ok(orla.player.mesh.position.equals(before));
  assert.equal(orla.scene.children.length, 0);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(shadowDispose.mock.callCount(), 1);
});

test('CT-3.1: veículos parados são sólidos para Mobilidade e Infraestrutura', () => {
  for (const id of [1, 2]) {
    const orla = new Fase1OrlaScene({ isSprinting: () => false, getAxis: () => ({ x: 1, z: 0 }) });
    try {
      const [car, ...others] = orla.traffic.vehicles;
      others.forEach(vehicle => orla.traffic.removeVehicle(vehicle));
      orla.traffic.setScheduledDemand(0);
      // Carro parado (em recarga, acidentado ou na fila): nunca anda e fica no meio da via.
      car.maxSpeed = 0; car.speed = 0;
      car.mesh.position.set(0, 0.27, car.lane.z);
      orla.setTutorialCollisionProtection(true);
      orla.selectPlayer(id);
      orla.player.setPosition(-4, car.lane.z);
      for (let frame = 0; frame < 80; frame++) orla.update(0.05);
      const limit = car.mesh.position.x - 1.35 / 2 - orla.map.playerRadius;
      assert.ok(orla.player.mesh.position.x <= limit + 1e-6,
        `jogador ${id} atravessou o carro parado: x=${orla.player.mesh.position.x}, limite=${limit}`);
      assert.ok(orla.player.mesh.position.x > limit - 0.5, 'encosta no carro em vez de parar longe dele');
    } finally { orla.dispose(); }
  }
});

test('CT-3.2: mobiliário e vegetação da Orla são registrados como obstáculos para os pedestres', () => {
  const orla = new Fase1OrlaScene();
  try {
    const registered = orla.map.obstacles.length;
    const props = new Set(['beach-palm', 'beach-umbrella', 'lifeguard-tower', 'promenade-bench', 'promenade-lamp', 'promenade-bin']);
    let drawn = 0;
    orla.scene.traverse(object => { if (props.has(object.name)) drawn++; });
    assert.ok(drawn > 0, 'a Orla desenha mobiliário');
    assert.equal(registered, drawn, 'todo item desenhado vira obstáculo');
    assert.ok(orla.map.obstacles.every(item => item.radius > 0 && Number.isFinite(item.x) && Number.isFinite(item.z)));
  } finally { orla.dispose(); }
});

test('CT-4.1: faixa elétrica tem ~1,2 m e dá folga lateral ao veículo sem invadir as vizinhas', () => {
  const orla = new Fase1OrlaScene();
  try {
    const stripe = orla.scene.getObjectByName('electric-lane-2');
    assert.ok(stripe, 'a faixa elétrica é desenhada');
    const width = stripe.scale.z;
    assert.ok(width >= 1.2 && width <= 1.3, `largura da faixa elétrica: ${width}`);
    const lanes = orla.traffic.lanes;
    const green = lanes.find(lane => lane.type === 'GREEN');
    assert.ok(Math.abs(stripe.position.z - green.z) < 1e-6, 'a pintura é centrada na faixa por onde os carros andam');
    const vehicleWidth = 0.56;
    assert.ok((width - vehicleWidth) / 2 >= 0.3, 'folga lateral mínima de 30 cm para cada lado');
    // Nenhuma pista comum pode invadir a pintura: a lateral do carro fica fora da faixa verde.
    const southEdge = green.z + width / 2;
    for (const lane of lanes.filter(item => item.type === 'PRINCIPAL')) {
      assert.ok(lane.z - vehicleWidth / 2 >= southEdge || lane.z + vehicleWidth / 2 <= green.z - width / 2,
        `pista ${lane.id} invade a faixa elétrica`);
    }
    const ordered = lanes.filter(item => item.type === 'PRINCIPAL').map(lane => lane.z).sort((a, b) => a - b);
    ordered.slice(1).forEach((z, index) => assert.ok(z - ordered[index] >= 0.96 - 1e-6, 'pistas comuns mantêm 0,96 m entre eixos'));
    assert.ok(Math.max(...ordered) + vehicleWidth / 2 < orla.map.depth / 2, 'pistas ficam dentro do mapa');
    const charger = orla.traffic.getElectricChargerPosition();
    assert.ok(charger.z >= green.z + width / 2 && charger.z + 0.08 <= Math.min(...ordered) - vehicleWidth / 2,
      'carregador fica entre a faixa elétrica e a primeira pista comum');
  } finally { orla.dispose(); }
});

test('CT-4.1: nenhuma pista invade o canteiro central e o refúgio da travessia fica alinhado a ele', () => {
  const orla = new Fase1OrlaScene();
  try {
    const curb = orla.scene.getObjectByName('median-curb-2');
    assert.ok(curb, 'o canteiro central é desenhado');
    // Meia espessura do canteiro (0,38 m) somada às linhas amarelas, que ficam a ±0,23 m com 0,055 m de largura.
    const halfExtent = 0.23 + 0.055 / 2;
    const vehicleHalf = 0.56 / 2;
    for (const lane of orla.traffic.lanes.filter(item => item.type === 'PRINCIPAL')) {
      const gap = Math.abs(lane.z - curb.position.z) - vehicleHalf - halfExtent;
      assert.ok(gap >= 0.1, `pista ${lane.id} a ${gap.toFixed(3)} m do canteiro (mínimo 0,10 m)`);
    }
    const refuge = orla.scene.getObjectByName('tactile-median-refuge');
    assert.ok(refuge, 'o piso tátil do refúgio é desenhado');
    assert.ok(Math.abs(refuge.position.z - curb.position.z) < 1e-6, 'refúgio da travessia alinhado ao canteiro central');
    const principal = orla.traffic.lanes.filter(item => item.type === 'PRINCIPAL');
    const east = principal.filter(item => item.direction === 1).map(item => item.z);
    const west = principal.filter(item => item.direction === -1).map(item => item.z);
    assert.ok(Math.max(...east) < curb.position.z && Math.min(...west) > curb.position.z, 'cada sentido fica de um lado do canteiro');
    assert.ok(Math.abs((curb.position.z - Math.max(...east)) - (Math.min(...west) - curb.position.z)) < 0.05, 'canteiro centrado entre os sentidos');
  } finally { orla.dispose(); }
});

test('combinação CT-3.1 + acidente: nenhum veículo parado da fila pode ser atravessado pela Mobilidade', () => {
  const orla = new Fase1OrlaScene({ isSprinting: () => false, getAxis: () => ({ x: 0, z: 0 }) });
  try {
    orla.traffic.startCollision();
    for (let frame = 0; frame < 20 * 40; frame++) orla.update(0.05);
    const stopped = orla.traffic.vehicles.filter(vehicle => vehicle.speed < 0.05);
    assert.ok(stopped.length >= 2, `o acidente forma fila de carros parados (${stopped.length})`);
    const radius = orla.map.playerRadius, halfLength = 1.35 / 2 + radius, halfWidth = 0.36 + radius;
    const insideAny = point => stopped.some(other => Math.abs(point.x - other.mesh.position.x) < halfLength - 1e-6
      && Math.abs(point.z - other.mesh.position.z) < halfWidth - 1e-6);
    let checked = 0;
    for (const vehicle of stopped) {
      const { x, z } = vehicle.mesh.position;
      for (const from of [{ x: x - halfLength - 0.5, z }, { x: x + halfLength + 0.5, z }, { x, z: z - halfWidth - 0.5 }, { x, z: z + halfWidth + 0.5 }]) {
        // Na fila, o ponto de partida pode cair dentro do carro vizinho; só vale partir de fora de todos.
        if (insideAny(from)) continue;
        for (const target of [{ x, z }, { x: x + 0.2, z: z - 0.1 }, { x: x - 0.3, z: z + 0.1 }]) {
          const resolved = orla.traffic.resolveWorkerMovement(from, target, radius, true);
          assert.equal(insideAny(resolved), false,
            `entrou em um veículo parado partindo de (${from.x.toFixed(2)}, ${from.z.toFixed(2)}) rumo a (${target.x.toFixed(2)}, ${target.z.toFixed(2)})`);
          checked++;
        }
      }
    }
    assert.ok(checked >= 12, `pontos verificados: ${checked}`);
    // Carros em movimento continuam atropelando em vez de bloquear: só os parados são sólidos.
    const moving = orla.traffic.vehicles.find(vehicle => vehicle.speed > 0.05);
    if (moving) {
      const { x, z } = moving.mesh.position;
      assert.deepEqual(orla.traffic.resolveWorkerMovement({ x: x - 3, z }, { x, z }, radius, true), { x, z });
    }
  } finally { orla.dispose(); }
});

test('combinação CT-3.2 + travessia: com o mobiliário real da Orla os pedestres cruzam e ninguém fica preso', () => {
  const orla = new Fase1OrlaScene({ isSprinting: () => false, getAxis: () => ({ x: 0, z: 0 }) });
  try {
    assert.ok(orla.map.obstacles.length > 10, 'a Orla tem obstáculos registrados');
    orla.selectPlayer(3);
    const lastMoved = new Map();
    let groups = 0, previousCrossing = false;
    for (let frame = 0; frame < 20 * 240; frame++) {
      orla.update(0.05);
      const time = frame * 0.05;
      const walkers = orla.activeMobility.walkers;
      const crossing = walkers.some(walker => walker.state === 'cross-road');
      if (crossing && !previousCrossing) groups++;
      previousCrossing = crossing;
      for (const walker of walkers) {
        const last = lastMoved.get(walker);
        if (!last || Math.hypot(walker.x - last.x, walker.z - last.z) > 0.02) lastMoved.set(walker, { x: walker.x, z: walker.z, time });
        const waiting = ['wait-road', 'wait-cycle', 'form-road'].includes(walker.state);
        const idle = time - lastMoved.get(walker).time;
        assert.ok(waiting || idle < 12, `pedestre preso em '${walker.state}' por ${idle.toFixed(0)} s em (${walker.x.toFixed(2)}, ${walker.z.toFixed(2)})`);
      }
    }
    assert.ok(groups >= 2, `grupos que atravessaram a avenida: ${groups}`);
    assert.ok(orla.activeMobility.getCrossingProgress().crossed >= 6, 'pedestres concluem a travessia');
  } finally { orla.dispose(); }
});

test('Game segue seleção na Orla, reenquadra no resize pausado e restaura laboratório', t => {
  const { Game, Element, created, observers, tweens } = gameHarness(t);
  const host = new Element();
  const game = new Game(host, () => {});
  game.start('fase1-orla');
  const renderer = created[0];
  assert.equal(renderer.shadowMap.type, three.PCFShadowMap);
  renderer.loop(100);
  const camera = renderer.lastCamera;
  const fixed = camera.position.clone();
  const rotation = camera.quaternion.clone();
  game.selectPlayer(1);
  game.input.setTouch(1, 'KeyD');
  renderer.loop(150);
  renderer.loop(200);
  assert.ok(!camera.position.equals(fixed));
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-7);
  assert.equal(tweens.length, 0);
  game.togglePause();
  host.clientWidth = 390;
  host.clientHeight = 844;
  observers[0].callback();
  assert.equal(camera.aspect, 390 / 844);
  assert.ok(Number.isFinite(camera.position.length()));
  game.returnToMenu();
  game.start();
  assert.equal(tweens.length, 1, 'a entrada animada continua no laboratório');
  game.dispose();
});

test('Orla usa óptica de perto do laboratório e suavização independente do FPS', () => {
  const run = steps => {
    const orla = new Fase1OrlaScene();
    const camera = new three.PerspectiveCamera();
    orla.player.setPosition(0, 0);
    orla.configureCamera(camera, 1);
    assert.equal(camera.position.y, ORLA_CAMERA.closeHeight);
    assert.equal(camera.position.z, ORLA_CAMERA.closeHeight * ORLA_CAMERA.tilt);
    orla.player.setPosition(2, 0);
    orla.updateCamera(camera, 0, true);
    assert.equal(camera.position.x, 0);
    for (let frame = 0; frame < steps; frame++) orla.updateCamera(camera, 1 / steps, true);
    const result = camera.position.x;
    orla.dispose();
    return result;
  };
  const expected = 2 * (1 - Math.exp(-ORLA_CAMERA.followSmoothing));
  assert.ok(Math.abs(run(30) - expected) < 1e-9);
  assert.ok(Math.abs(run(120) - expected) < 1e-9);
});

test('Orla preserva item e direção ao selecionar outra personagem; meshes seguem o dono', () => {
  let axis = { x: 0, z: -1 };
  const orla = new Fase1OrlaScene({ isSprinting: () => false, getAxis: () => axis });
  orla.interact(); orla.interact(); orla.interact();
  orla.selectPlayer(2);
  const sourcePosition = orla.map.cellCenter(11, 6);
  orla.player.setPosition(sourcePosition.x, sourcePosition.z);
  orla.interact();
  assert.equal(orla.items.heldBy(2), 'cone');
  const carried = orla.player.mesh.getObjectByName('item-carried-2');
  assert.equal(carried.visible, true);
  assert.equal(carried.parent, orla.players[1].mesh);
  assert.ok(carried.position.y > 2);
  orla.selectPlayer(1);
  orla.player.setPosition(sourcePosition.x, sourcePosition.z);
  orla.interact();
  assert.equal(orla.items.heldBy(1), null, 'Infraestrutura não recolhe cones');
  orla.selectPlayer(3);
  assert.equal(orla.items.heldBy(3), null);
  orla.selectPlayer(2);
  assert.equal(orla.items.heldBy(2), 'cone');
  assert.deepEqual(orla.items.facingOf(2), { x: 0, z: -1 });
  orla.interact();
  assert.equal(orla.items.heldBy(2), null);
  assert.equal(carried.visible, false);
  axis = { x: 1, z: 0 };
  orla.update(0.05);
  assert.equal(carried.parent, orla.players[1].mesh);
  orla.dispose();
});

test('GPU dos itens é compartilhada e descartada uma vez, inclusive carregados e nas bancadas', () => {
  const orla = new Fase1OrlaScene({ isSprinting: () => false, getAxis: () => ({ x: 0, z: -1 }) });
  const counts = watchResources(orla.scene);
  const geometry = orla.scene.getObjectByName('item-carried-1').geometry;
  orla.selectPlayer(1);
  const source = orla.map.cellCenter(8, 5);
  orla.player.setPosition(source.x, source.z);
  orla.interact();
  const counter = orla.map.cellCenter(7, 5);
  orla.player.setPosition(counter.x, counter.z);
  orla.interact();
  orla.selectPlayer(2);
  orla.player.setPosition(source.x, source.z);
  orla.interact();
  orla.dispose(); orla.dispose(); orla.interact();
  assert.equal(counts.get(geometry), 1);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(orla.scene.children.length, 0);
});

test('Game: E/toque interagem, T cicla inventários e UI, pausa e repetição não acionam', t => {
  const { Game, Element, created } = gameHarness(t);
  const selected = [];
  const game = new Game(new Element(), () => {}, undefined, id => selected.push(id));
  t.after(() => game.dispose());
  game.start('fase1-orla');
  const phase = game.scenes.current;
  game.selectPlayer(2);
  const source = phase.map.cellCenter(11, 6);
  phase.player.setPosition(source.x, source.z);
  game.input.setTouch(1, 'KeyW');
  const key = (code, extra = {}) => {
    const event = Object.assign(new Event('keydown', { cancelable: true }), { code, ...extra });
    window.dispatchEvent(event);
    return event;
  };
  assert.equal(key('KeyE').defaultPrevented, true);
  assert.equal(phase.items.heldBy(2), 'cone');
  const firstItem = phase.player.mesh.getObjectByName('item-carried-2');
  assert.equal(key('KeyT').defaultPrevented, true);
  assert.equal(phase.player.id, 3);
  assert.equal(phase.items.heldBy(2), 'cone');
  assert.equal(firstItem.visible, true);
  assert.deepEqual(game.input.getAxis(), { x: 0, z: 0 });
  key('KeyT', { repeat: true });
  assert.equal(phase.player.id, 3);
  assert.equal(key('KeyT', { ctrlKey: true }).defaultPrevented, false);
  key('KeyT'); key('KeyT');
  assert.equal(phase.player.id, 2);
  // start() já notifica a Mobilidade (2); depois vêm a seleção explícita e o ciclo T: 3 → 1 → 2.
  assert.deepEqual(selected, [2, 2, 3, 1, 2]);
  phase.player.setPosition(source.x, source.z);
  game.togglePause();
  key('KeyE'); key('KeyT'); game.interact();
  assert.equal(phase.items.heldBy(2), 'cone');
  assert.equal(phase.player.id, 2);
  game.togglePause();
  game.interact();
  assert.equal(phase.items.heldBy(2), null);
  const callbacks = selected.length;
  created[0].loop(100); created[0].loop(116);
  assert.equal(selected.length, callbacks, 'sem callbacks de seleção por frame');
  game.returnToMenu();
  game.start('fase1-orla');
  assert.equal(game.scenes.current.items.onCounter({ column: 7, row: 4 }), null);
  assert.equal(game.scenes.current.items.heldBy(1), null);
  game.dispose();
});


const { sessionStore } = require('../src/game/session/sessionStore.ts');
const { ORLA_EVENTS } = require('../src/game/session/orlaEvents.ts');
const { ORLA_SESSION_CONFIG } = require('../src/game/session/sessionData.ts');

test('treino mantém o relógio em zero e libera a agenda somente ao terminar', t => {
  const { Game, Element, created } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  t.after(() => game.dispose());
  game.startOrlaWithAnalystTutorial();
  const renderer = created[0];
  renderer.loop(0); renderer.loop(120_000);
  assert.equal(sessionStore.getSnapshot().snapshot.elapsedMs, 0);
  assert.equal(sessionStore.getSnapshot().snapshot.orders.length, 0);
  game.finishTeamTutorials();
  assert.equal(suburbanGameState.snapshot().problems.length, 0);
  const treinoEndedAt = 120_000, firstEvent = ORLA_EVENTS[0];
  renderer.loop(treinoEndedAt + firstEvent.atMs - 1);
  assert.equal(sessionStore.getSnapshot().snapshot.orders.length, 0);
  renderer.loop(treinoEndedAt + firstEvent.atMs);
  assert.equal(sessionStore.getSnapshot().snapshot.orders[0].definitionId, firstEvent.id);
  game.dispose();
});

test('CT-5.3: pular o tutorial em qualquer etapa inicia a partida com tudo liberado', t => {
  const stages = {
    analista: game => {},
    mobilidade: game => game.startMobilityTutorial(),
    infraestrutura: game => { game.startMobilityTutorial(); game.startInfrastructureTutorial(); },
  };
  for (const [name, enter] of Object.entries(stages)) {
    const { Game, Element, created } = gameHarness(t);
    const game = new Game(new Element(), () => {});
    try {
      assert.equal(game.skipTutorial(), false, 'sem tutorial ativo pular não faz nada');
      game.startOrlaWithAnalystTutorial();
      enter(game);
      const renderer = created.at(-1);
      renderer.loop(0); renderer.loop(5_000);
      assert.equal(sessionStore.getSnapshot().snapshot.elapsedMs, 0, `${name}: relógio parado durante o tutorial`);
      assert.equal(game.canSelectPlayer(name === 'analista' ? 2 : 3), false, `${name}: troca de personagem travada no tutorial`);
      assert.equal(game.skipTutorial(), true);
      assert.equal(game.skipTutorial(), false, 'pular duas vezes é idempotente');
      assert.equal(suburbanGameState.snapshot().problems.length, 0);
      for (const id of [1, 2, 3]) assert.equal(game.canSelectPlayer(id), true, `${name}: personagem ${id} liberada depois de pular`);
      renderer.loop(6_000);
      assert.equal(sessionStore.getSnapshot().snapshot.elapsedMs, 1_000, `${name}: relógio corre depois de pular`);
      assert.equal(sessionStore.getSnapshot().snapshot.status, 'playing');
    } finally { game.dispose(); }
  }
});

test('fase real: aviso, reparo, tempo durante puzzle, fim por expirações e reinício', t => {
  const { Game, Element, created } = gameHarness(t);
  const statuses = [], puzzles = [];
  const game = new Game(new Element(), value => statuses.push(value), undefined, undefined, undefined, undefined, open => puzzles.push(open));
  t.after(() => game.dispose());
  game.start('fase1-orla');
  const orla = game.scenes.current;
  const renderer = created[0];
  const first = ORLA_EVENTS[0];
  renderer.loop(0);
  game.completeRepairPuzzle();
  assert.equal(sessionStore.getSnapshot().snapshot.score, 0);
  assert.equal(sessionStore.getSnapshot().snapshot.orders.length, 0);
  let time = first.atMs;
  renderer.loop(time);
  assert.equal(suburbanGameState.snapshot().problems[0].id, first.id);
  assert.equal(suburbanGameState.snapshot().problems[0].stage, 'warning');
  assert.deepEqual(suburbanGameState.snapshot().problems[0].dispatchedTeams, []);
  game.selectPlayer(1);
  orla.player.setPosition(first.position.x, first.position.z);
  game.interact();
  assert.equal(puzzles.includes(true), false, 'sem o acionamento da equipe não há reparo');
  // O analista confere o relatório e aciona as equipes; só então o chamado fica ativo.
  game.selectPlayer(3);
  assert.equal(orla.analyzeProblem(first.id), true);
  assert.equal(orla.requestReinforcements(first.id), true);
  renderer.loop(time += 3000);
  assert.equal(suburbanGameState.snapshot().problems[0].stage, 'active');
  // Infra só entra depois que a Mobilidade protege a faixa e o primeiro grupo começa a atravessar.
  game.selectPlayer(2);
  orla.player.setPosition(first.position.x, first.position.z);
  assert.equal(game.canSelectPlayer(1), false);
  game.useMobilityHotkey('Digit3');
  for (let i = 0; i < 400 && !game.canSelectPlayer(1); i++) renderer.loop(time += 50);
  assert.equal(game.canSelectPlayer(1), true, 'faixa protegida libera a Infraestrutura');
  game.selectPlayer(1);
  orla.player.setPosition(first.position.x, first.position.z);
  game.interact();
  assert.equal(puzzles.at(-1), true);
  // O store publica com atraso; o relógio exato está na própria sessão.
  const left = () => game.session.snapshot().remainingMs;
  const remaining = left();
  window.dispatchEvent(new Event('blur'));
  renderer.loop(time += 5000);
  assert.equal(statuses.at(-1), 'paused');
  assert.equal(left(), remaining);
  assert.equal(suburbanGameState.snapshot().problems[0].status, 'MAINTENANCE');
  game.togglePause();
  renderer.loop(time += 50);
  renderer.loop(time += 2000);
  assert.equal(left(), remaining - 2000, 'puzzle conta tempo real, não delta limitado da física');
  game.completeRepairPuzzle();
  assert.equal(statuses.at(-1), 'playing');
  assert.equal(puzzles.at(-1), false);
  // Só o reparo não conclui o chamado: a travessia protegida ainda é necessária.
  const result = sessionStore.getSnapshot().snapshot;
  assert.equal(result.completedOrders, 0);
  assert.equal(result.score, 0);
  game.completeRepairPuzzle(); game.interact();
  assert.equal(sessionStore.getSnapshot().snapshot.score, result.score);
  // Sem concluir nada, os chamados expiram em série até o limite e a fase encerra.
  renderer.loop(time += left());
  assert.equal(statuses.at(-1), 'finished');
  assert.equal(sessionStore.getSnapshot().snapshot.expiredOrders, ORLA_SESSION_CONFIG.maxExpiredOrders);
  const counts = watchResources(orla.scene);
  sessionStore.restart();
  assert.equal(statuses.at(-1), 'playing');
  assert.notEqual(game.scenes.current, orla);
  assert.ok([...counts.values()].every(count => count === 1));
  assert.equal(suburbanGameState.snapshot().problems.length, 0);
  assert.ok(suburbanGameState.snapshot().roads.every(road => !road.conesActive));
  assert.equal(sessionStore.getSnapshot().snapshot.remainingMs, 360000);
  assert.equal(sessionStore.getSnapshot().snapshot.score, 0);
  game.dispose();
  assert.equal(sessionStore.getSnapshot().snapshot, null);
});

test('troca e pausa param inércia; toque suporta correr e perder foco limpa comandos', t => {
  const { Game, Element, created } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  t.after(() => game.dispose());
  game.start('fase1-orla'); game.selectPlayer(2);
  const scene = game.scenes.current;
  const player = scene.player;
  const renderer = created[0];
  game.input.setTouch(1, 'KeyD'); game.input.setTouch(2, 'ShiftLeft');
  assert.equal(game.input.isSprinting(), true);
  renderer.loop(0); renderer.loop(50); renderer.loop(100);
  const moved = player.mesh.position.clone();
  game.selectPlayer(1);
  renderer.loop(150);
  assert.ok(player.mesh.position.equals(moved));
  game.selectPlayer(2);
  renderer.loop(200);
  assert.ok(player.mesh.position.equals(moved));
  game.input.setTouch(1, 'KeyD'); renderer.loop(250);
  const stopped = player.mesh.position.clone();
  window.dispatchEvent(new Event('blur'));
  assert.equal(game.input.isSprinting(), false);
  game.togglePause(); renderer.loop(300); renderer.loop(350);
  assert.ok(player.mesh.position.equals(stopped));
  game.dispose();
});

test('prazo encerra ações, relógio ignora pausa e menu desmonta a sessão', t => {
  const { Game, Element, created } = gameHarness(t);
  const statuses = [];
  const game = new Game(new Element(), value => statuses.push(value));
  t.after(() => game.dispose());
  game.start('fase1-orla');
  const renderer = created[0];
  renderer.loop(0); renderer.loop(2000);
  assert.equal(sessionStore.getSnapshot().snapshot.remainingMs, 358000);
  game.togglePause(); renderer.loop(100000);
  assert.equal(sessionStore.getSnapshot().snapshot.remainingMs, 358000);
  game.togglePause(); renderer.loop(100100); renderer.loop(458100);
  assert.equal(statuses.at(-1), 'finished');
  // Em série, cada chamado ignorado expira sozinho; ao atingir o limite a fase encerra.
  assert.equal(sessionStore.getSnapshot().snapshot.expiredOrders, ORLA_SESSION_CONFIG.maxExpiredOrders);
  game.interact();
  assert.equal(suburbanGameState.snapshot().selectedProblemId, null);
  game.returnToMenu();
  assert.equal(sessionStore.getSnapshot().snapshot, null);
  assert.equal(statuses.at(-1), 'ready');
  game.dispose();
});
