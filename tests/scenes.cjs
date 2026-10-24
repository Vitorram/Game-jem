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
        // Ao sul, a calçada andável passa da borda do mapa; a câmera pode mostrar até ela e um pouco além.
        const south = orla.map.depth / 2 + (close ? orla.map.southWalkway + ORLA_CAMERA.southViewMargin : ORLA_CAMERA.groundApron);
        assert.ok(hit.z <= south + 1e-8 && hit.z >= -orla.map.depth / 2 - (close ? 0 : ORLA_CAMERA.groundApron) - 1e-8);
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
    orla.players.forEach((player, i) => assert.equal(player.mesh.position.equals(before[i]), player.id !== id));
    for (let frame = 0; frame < 300; frame++) orla.update(0.05);
    assert.ok(Math.abs(orla.player.mesh.position.x) <= orla.map.width / 2 - orla.map.playerRadius);
    const playerZ = orla.player.mesh.position.z;
    assert.ok(playerZ >= -orla.map.depth / 2 + orla.map.playerRadius && playerZ <= orla.map.depth / 2 + orla.map.southWalkway - orla.map.playerRadius);
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

test('CT-3.1: veículos parados são sólidos para as três equipes', () => {
  for (const id of [1, 2, 3]) {
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
    const props = new Set(['beach-palm', 'beach-umbrella', 'lifeguard-tower', 'promenade-bench', 'promenade-lamp', 'promenade-bin', 'traffic-signal', 'street-tree']);
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
    const stripe = orla.scene.getObjectByName('electric-lane');
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
    assert.ok(stopped.length >= 1, `o veículo do acidente permanece sólido enquanto os demais podem desviar (${stopped.length})`);
    const radius = orla.map.playerRadius, halfLength = 1.35 / 2 + radius, halfWidth = 0.36 + radius;
    const insideAny = point => stopped.some(other => Math.abs(point.x - other.mesh.position.x) < halfLength - 1e-6
      && Math.abs(point.z - other.mesh.position.z) < halfWidth - 1e-6);
    let checked = 0;
    // A fila pode seguir pelo cenário estendido; ali a Mobilidade não chega.
    for (const vehicle of stopped.filter(item => Math.abs(item.mesh.position.x) <= orla.map.width / 2)) {
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

test('A2: frente urbana ao sul ocupa o vazio sem esconder a avenida nem a saída dos pedestres', () => {
  const orla = new Fase1OrlaScene();
  try {
    const southEdge = orla.map.depth / 2, crossingX = 1, exitZ = southEdge + 0.75;
    // A câmera fica ao sul olhando para baixo (inclinação 0,75): cada unidade de altura cobre 0,75 do chão ao norte.
    const shadowReach = 0.75;
    const box = new three.Box3();
    const buildings = [], trees = [];
    orla.scene.traverse(object => {
      if (object.name.startsWith('city-building-')) buildings.push(object);
      if (object.name === 'street-tree') trees.push(object);
    });
    assert.ok(buildings.length >= 8, `prédios na frente urbana: ${buildings.length}`);
    assert.ok(trees.length >= 6, `árvores na calçada sul: ${trees.length}`);
    let minX = Infinity, maxX = -Infinity;
    for (const building of buildings) {
      box.setFromObject(building);
      minX = Math.min(minX, box.min.x); maxX = Math.max(maxX, box.max.x);
      assert.ok(box.max.y <= 1.36, `${building.name} alto demais (${box.max.y.toFixed(2)})`);
      assert.ok(box.min.z - shadowReach * box.max.y >= southEdge + 1.3, `${building.name} esconde a faixa de saída dos pedestres`);
      assert.ok(box.max.x < crossingX - 2.3 || box.min.x > crossingX + 2.3, `${building.name} fecha a praça em frente à travessia`);
    }
    assert.ok(minX <= -orla.map.width / 2 - 4 && maxX >= orla.map.width / 2 + 4, 'o quarteirão cobre a largura visível, além das bordas do mapa');
    for (const tree of trees) {
      box.setFromObject(tree);
      assert.ok(box.max.y <= 1.1, 'árvore baixa o bastante para não cobrir a calçada');
      assert.ok(tree.position.z - shadowReach * box.max.y >= exitZ + 0.15, 'copa não cobre quem sai da travessia');
    }
    for (const obstacle of orla.map.obstacles) {
      assert.ok(Math.abs(obstacle.z - exitZ) >= obstacle.radius + 0.2, `obstáculo em (${obstacle.x.toFixed(1)}, ${obstacle.z.toFixed(1)}) na faixa de saída`);
    }
  } finally { orla.dispose(); }
});

test('A3: com o personagem na calçada norte, a avenida fica acima da barra de controles', () => {
  for (const [width, height] of [[1280, 720], [1920, 1080], [1024, 768]]) {
    for (const closeView of [false, true]) {
      const orla = new Fase1OrlaScene();
      try {
        const camera = new three.PerspectiveCamera();
        orla.selectPlayer(2);
        orla.player.setPosition(1, 5);
        orla.configureCamera(camera, width / height, closeView);
        for (let frame = 0; frame < 120; frame++) orla.updateCamera(camera, 0.05, closeView);
        // A barra de habilidades e de personagens ocupa ~22% da base da tela (NDC y < -0,56).
        const lanes = orla.traffic.lanes.filter(lane => lane.type === 'PRINCIPAL').map(lane => lane.z);
        const avenueCenter = (Math.min(...lanes) + Math.max(...lanes)) / 2;
        const projected = new three.Vector3(1, 0, avenueCenter).project(camera);
        assert.ok(projected.y > -0.56, `${width}x${height} ${closeView ? 'perto' : 'ampla'}: eixo da avenida em NDC y=${projected.y.toFixed(2)}`);
        const player = orla.player.mesh.position.clone().project(camera);
        assert.ok(player.y > -0.56 && player.y < 0.9, 'o personagem continua visível e fora da barra');
      } finally { orla.dispose(); }
    }
  }
});

test('D12: com o mobiliário real, todo caminho de pedestre chega ao destino', () => {
  const orla = new Fase1OrlaScene();
  try {
    const mobility = orla.activeMobility;
    mobility.spawnWalkerTimer = Infinity;
    mobility.setRoadBatchHold(true); // filas param na espera: medimos só a chegada
    const walker = mobility.walkers[0];
    const park = () => mobility.walkers.slice(1).forEach(other => { other.state = 'exit'; other.x = mobility.maxX + 50; other.z = mobility.southWalkZ; });
    const runUntil = (done, seconds) => { for (let frame = 0; frame < seconds * 20; frame++) { orla.update(0.05); if (done()) return frame * 0.05; } return Infinity; };

    for (const direction of [1, -1]) {
      park();
      Object.assign(walker, { state: 'exit', exitDirection: direction, speed: 0.8, z: mobility.southWalkZ,
        x: direction === 1 ? mobility.minX + 0.6 : mobility.maxX - 0.6 });
      // Some só depois do cenário estendido, fora da tela (ORLA_SCENERY_MARGIN além da grade).
      const time = runUntil(() => !mobility.walkers.includes(walker), 120);
      assert.ok(Number.isFinite(time), `saída sul no sentido ${direction > 0 ? 'leste' : 'oeste'} ficou presa (x=${walker.x.toFixed(2)})`);
      mobility.walkers.unshift(walker); // devolve o pedestre para a próxima rodada
    }

    for (const [state, arrived, z] of [['approach-cycle', 'wait-cycle', mobility.beachSpawnZ], ['approach-road', 'wait-road', mobility.northSidewalkZ - 0.5]]) {
      for (let x = mobility.minX + 0.6; x < mobility.maxX; x += 3.7) {
        park();
        Object.assign(walker, { state, x, z, speed: 0.8, roadSlot: null });
        const time = runUntil(() => walker.state === arrived, 60);
        assert.ok(Number.isFinite(time), `${state} a partir de x=${x.toFixed(1)} não chegou à fila (parou em ${walker.x.toFixed(2)}, ${walker.z.toFixed(2)})`);
      }
    }
  } finally { orla.dispose(); }
});

test('calçada sul ampliada: o personagem anda até a faixa de grama e a câmera o acompanha', () => {
  for (const closeView of [true, false]) {
    const orla = new Fase1OrlaScene({ isSprinting: () => true, getAxis: () => ({ x: 0, z: 1 }) });
    try {
      orla.setTutorialCollisionProtection(true);
      orla.selectPlayer(2);
      const camera = new three.PerspectiveCamera();
      orla.configureCamera(camera, 16 / 9, closeView);
      for (let frame = 0; frame < 240; frame++) { orla.update(0.05); orla.updateCamera(camera, 0.05, closeView); }
      const southEdge = orla.map.depth / 2, z = orla.player.mesh.position.z;
      assert.ok(z >= southEdge + 0.9, `calçada sul com pelo menos ~2 m andáveis (parou em z=${z.toFixed(2)})`);
      const box = new three.Box3();
      const verges = [];
      orla.scene.traverse(object => { if (object.name.startsWith('south-verge')) verges.push(box.setFromObject(object).clone()); });
      assert.ok(verges.length > 0, 'faixa de grama marca o fim da calçada');
      assert.ok(verges.every(verge => z + orla.map.playerRadius <= verge.min.z + 1e-6), 'o personagem para antes da grama, sem parede invisível');
      const onScreen = orla.player.mesh.position.clone().project(camera);
      assert.ok(onScreen.y > -0.56 && onScreen.y < 1, `${closeView ? 'perto' : 'ampla'}: personagem visível e acima da barra (NDC y=${onScreen.y.toFixed(2)})`);
    } finally { orla.dispose(); }
  }
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
  assert.equal(tweens.length, 1, 'só a aproximação de entrada da Orla; o acompanhamento não depende de tween');
  game.togglePause();
  host.clientWidth = 390;
  host.clientHeight = 844;
  observers[0].callback();
  assert.equal(camera.aspect, 390 / 844);
  assert.ok(Number.isFinite(camera.position.length()));
  game.returnToMenu();
  game.start();
  assert.equal(tweens.length, 2, 'a entrada animada continua no laboratório');
  game.dispose();
});

test('Orla usa óptica de perto do laboratório e suavização independente do FPS', () => {
  const run = steps => {
    const orla = new Fase1OrlaScene();
    const camera = new three.PerspectiveCamera();
    orla.player.setPosition(0, 0);
    orla.configureCamera(camera, 1);
    assert.equal(camera.position.y, ORLA_CAMERA.closeHeight);
    // A mira fica ao sul do personagem (followOffsetZ) para a avenida sair de baixo da barra de controles.
    assert.equal(camera.position.z, ORLA_CAMERA.followOffsetZ + ORLA_CAMERA.closeHeight * ORLA_CAMERA.tilt);
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

test('coop: reparo remoto não abre puzzle nem bloqueia a personagem local; conclusão é aplicada uma vez', t => {
  for (const localId of [2, 3]) {
    const { Game, Element } = gameHarness(t);
    const puzzleChanges = [];
    const game = new Game(new Element(), () => {}, undefined, undefined, undefined, undefined,
      open => puzzleChanges.push(open));
    try {
      game.startCoopOrlaTutorial(localId);
      game.finishCoopTutorial();
      const scene = game.scenes.current;
      const completed = [];
      t.mock.method(scene, 'interact', () => game.openRepairPuzzle('pole'));
      t.mock.method(scene, 'completeRepairPuzzle', type => completed.push({ type, actor: scene.player.role }));
      game.applyCoopAction('infraestrutura', { type: 'interact', axis: { x: 0, z: 0 }, pose: { x: 1, z: 2, yaw: 0 } });
      assert.equal(game.repairPuzzleOpen, false);
      assert.equal(scene.tutorialMovementEnabled, true);
      assert.equal(puzzleChanges.includes(true), false);
      game.completeRepairPuzzle();
      assert.equal(completed.length, 0, 'participante local não conclui reparo da outra equipe');
      game.applyCoopAction('infraestrutura', { type: 'repair-complete' });
      game.applyCoopAction('infraestrutura', { type: 'repair-complete' });
      assert.deepEqual(completed, [{ type: 'pole', actor: 'infraestrutura' }]);
      assert.equal(suburbanGameState.activeCharacter, localId);
    } finally { game.dispose(); }
  }
});

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

test('A4: chamados selecionam a Analista uma vez e o tablet aguarda abertura manual', t => {
  const run = (renderer, from, to) => { for (let time = from; time <= to; time += 50) renderer.loop(time); return to; };
  // Sem interferência: ao fim da cena de câmera do chamado novo, a Analista assume.
  {
    const { Game, Element, created } = gameHarness(t);
    const game = new Game(new Element(), () => {});
    try {
      game.start('fase1-orla');
      const orla = game.scenes.current, renderer = created.at(-1);
      let time = run(renderer, 0, ORLA_EVENTS[0].atMs + 100);
      assert.equal(orla.phaseIsCinematic(), true, 'o chamado novo começa com a cena de câmera');
      time = run(renderer, time + 50, time + 4000);
      assert.equal(orla.phaseIsCinematic(), false);
      assert.equal(orla.player.id, 3, 'a Analista assume para analisar o chamado');
      assert.equal(game.isAnalystTabletOpen, false, 'receber um chamado não imobiliza a Analista');
    } finally { game.dispose(); }
  }
  // Escolha manual durante a cena é respeitada; chamado resolvido puxa a Analista uma vez só.
  {
    const { Game, Element, created } = gameHarness(t);
    const game = new Game(new Element(), () => {});
    try {
      game.start('fase1-orla');
      const orla = game.scenes.current, renderer = created.at(-1);
      let time = run(renderer, 0, ORLA_EVENTS[0].atMs + 100);
      game.selectPlayer(2);
      time = run(renderer, time + 50, time + 4000);
      assert.equal(orla.player.id, 2, 'quem escolheu a Mobilidade durante a cena continua nela');
      assert.equal(game.analystNeedsAttention(), true, 'o botão da Analista avisa que há chamado esperando análise');
      suburbanGameState.setProblemStatus(ORLA_EVENTS[0].id, 'RESOLVED');
      time = run(renderer, time + 50, time + 500);
      assert.equal(orla.player.id, 3, 'chamado resolvido leva à Analista para arquivar');
      game.selectPlayer(2);
      time = run(renderer, time + 50, time + 3000);
      assert.equal(orla.player.id, 2, 'depois de sair, o jogador não é puxado de volta a cada quadro');
      assert.equal(game.analystNeedsAttention(), true, 'o lembrete continua no botão da Analista');
      game.selectPlayer(3);
      assert.equal(game.analystNeedsAttention(), true, 'andando com o tablet guardado ainda há lembrete');
      game.toggleAnalystTablet();
      assert.equal(game.analystNeedsAttention(), false, 'o lembrete some ao abrir o tablet');
    } finally { game.dispose(); }
  }
});

test('Analista móvel: Q abre no local, bloqueia teclado e toque, e não pausa o mundo', t => {
  const { Game, Element, created } = gameHarness(t);
  const changes = [];
  const game = new Game(new Element(), () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, open => changes.push(open));
  t.after(() => game.dispose());
  game.start('fase1-orla');
  game.selectPlayer(3);
  const scene = game.scenes.current, player = scene.player, renderer = created[0];
  const key = (code, extra = {}) => window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code, ...extra }));
  const spawn = player.position.clone();
  assert.equal(player.seated, false);
  assert.ok(spawn.x > scene.map.spawns[2].x + 1.18, 'nasce fora da cabine');
  key('KeyD');
  renderer.loop(0); renderer.loop(50); renderer.loop(100);
  assert.ok(player.position.x > spawn.x, 'WASD movimenta a Analista');
  const stop = player.position.clone();
  key('KeyQ');
  assert.equal(game.isAnalystTabletOpen, true);
  assert.deepEqual(player.position, stop, 'abrir não teleporta');
  assert.equal(player.mesh.getObjectByName('analyst-handheld-tablet').visible, true);
  key('KeyQ', { repeat: true });
  key('KeyQ', { ctrlKey: true });
  assert.equal(game.isAnalystTabletOpen, true, 'repetição e atalhos do navegador não alternam');
  key('KeyD'); game.input.setTouch(1, 'KeyS'); game.input.setTouch(2, 'ShiftLeft');
  const trafficUpdate = t.mock.method(scene.traffic, 'update');
  const before = game.session.snapshot().elapsedMs;
  for (let time = 150; time <= 1000; time += 50) renderer.loop(time);
  assert.deepEqual(player.position, stop, 'nenhum input move enquanto usa o tablet');
  assert.ok(trafficUpdate.mock.callCount() > 0, 'trânsito continua atualizando');
  assert.ok(game.session.snapshot().elapsedMs > before, 'relógio continua correndo');
  key('KeyQ');
  assert.equal(game.isAnalystTabletOpen, false);
  assert.equal(player.mesh.getObjectByName('analyst-handheld-tablet').visible, false);
  assert.deepEqual(game.input.getAxis(), { x: 0, z: 0 }, 'não reaproveita comandos pressionados no tablet');
  renderer.loop(1050);
  assert.deepEqual(player.position, stop, 'guardar também não teleporta');
  game.input.setTouch(3, 'KeyD');
  renderer.loop(1100);
  assert.ok(player.position.x > stop.x, 'toque volta a movimentar');
  assert.deepEqual(changes, [true, false]);
});

test('Analista móvel: tutorial, pausa, troca e menu mantêm tablet e movimento consistentes', t => {
  const { Game, Element } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  t.after(() => game.dispose());
  game.startOrlaWithAnalystTutorial();
  assert.equal(game.isAnalystTabletOpen, true);
  game.toggleAnalystTablet();
  assert.equal(game.isAnalystTabletOpen, true, 'treino guiado mantém o tablet aberto');
  game.startMobilityTutorial();
  assert.equal(game.isAnalystTabletOpen, false);
  assert.equal(game.scenes.current.analystTabletOpen, false);
  game.skipTutorial();
  game.selectPlayer(3);
  game.toggleAnalystTablet();
  game.togglePause();
  game.toggleAnalystTablet();
  assert.equal(game.isAnalystTabletOpen, true, 'pausa não altera o estado do tablet');
  game.togglePause();
  game.selectPlayer(2);
  assert.equal(game.isAnalystTabletOpen, false);
  game.toggleAnalystTablet();
  assert.equal(game.isAnalystTabletOpen, false, 'outras equipes não abrem o tablet');
  game.selectPlayer(3);
  game.toggleAnalystTablet();
  game.returnToMenu();
  assert.equal(game.isAnalystTabletOpen, false);
  game.startOrlaWithAnalystTutorial();
  game.skipTutorial();
  assert.equal(game.isAnalystTabletOpen, false, 'pular direto o treino libera a Analista para andar');
});

test('Analista móvel: ações exigem tablet aberto e atalhos enviam despacho no coop', t => {
  const { Game, Element } = gameHarness(t);
  const actions = [];
  const game = new Game(new Element(), () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, action => actions.push(action));
  t.after(() => game.dispose());
  game.startCoopOrlaTutorial(3);
  game.toggleAnalystTablet();
  assert.equal(game.isAnalystTabletOpen, false, 'aguarda início coletivo');
  game.finishCoopTutorial();
  const scene = game.scenes.current;
  const interact = t.mock.method(scene, 'interact', () => {});
  const dispatch = t.mock.method(scene, 'dispatchTeam', () => true);
  const analyze = t.mock.method(scene, 'analyzeProblem', () => true);
  const key = code => window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { code }));
  game.interact(); key('Digit1'); key('Digit2');
  assert.equal(game.analyzeProblem('test'), false);
  assert.equal(interact.mock.callCount(), 0);
  assert.equal(dispatch.mock.callCount(), 0);
  assert.equal(analyze.mock.callCount(), 0);
  assert.equal(actions.length, 0);
  key('KeyQ');
  key('Digit1'); key('Digit2');
  assert.equal(dispatch.mock.callCount(), 2);
  assert.deepEqual(actions, [
    { type: 'tablet', open: true },
    { type: 'dispatch', team: 'infraestrutura' }, { type: 'dispatch', team: 'mobilidade' },
  ]);
  game.interact();
  assert.equal(interact.mock.callCount(), 1);
  assert.equal(game.analyzeProblem('test'), true);
  assert.equal(scene.player.id, 3, 'coop preserva o próprio papel');
  game.toggleAnalystTablet();
  const before = game.getCoopPose();
  game.input.setTouch(1, 'KeyD');
  scene.update(0.05);
  assert.ok(game.getCoopPose().x > before.x, 'movimento entra na pose enviada ao coop');
});

test('Analista móvel: usar tablet na rua mantém colisões e não bloqueia ações remotas', t => {
  const { Game, Element } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  t.after(() => game.dispose());
  game.startCoopOrlaTutorial(3);
  game.finishCoopTutorial();
  const scene = game.scenes.current;
  const road = scene.map.cellCenter(6, 10);
  scene.player.setPosition(road.x, road.z);
  game.toggleAnalystTablet();
  const collision = t.mock.method(scene.traffic, 'getPlayerCollision', () => ({ x: 1, z: 0 }));
  scene.update(0.05);
  assert.ok(collision.mock.callCount() > 0, 'tablet não dá imunidade na rua');
  assert.equal(scene.collisionRecovery.player.id, 3);
  const interact = t.mock.method(scene, 'interact', () => {});
  game.applyCoopAction('infraestrutura', { type: 'interact', axis: { x: 0, z: 0 }, pose: { x: 0, z: 0, yaw: 0 } });
  assert.equal(interact.mock.callCount(), 1);
  assert.equal(scene.player.id, 3);
  assert.equal(game.isAnalystTabletOpen, true);
});

const runUntil = (renderer, from, to) => { for (let time = from; time <= to; time += 50) renderer.loop(time); return to; };
const pressKey = (code, extra = {}) => {
  const event = Object.assign(new Event('keydown', { cancelable: true }), { code, ...extra });
  window.dispatchEvent(event);
  return event;
};

test('coop em dupla: a Mobilidade opera o tablet da central sem perder a própria personagem nem as habilidades', t => {
  const { Game, Element, created } = gameHarness(t);
  const actions = [];
  const game = new Game(new Element(), () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, action => actions.push(action));
  try {
    game.startCoopOrlaTutorial(2, { sharedAnalyst: true });
    assert.equal(game.hasSharedAnalyst, true);
    game.toggleAnalystTablet();
    assert.equal(game.isAnalystTabletOpen, false, 'tutorial coletivo ainda não liberou o tablet');
    game.finishCoopTutorial();
    const scene = game.scenes.current, renderer = created.at(-1), id = ORLA_EVENTS[0].id;
    runUntil(renderer, 0, ORLA_EVENTS[0].atMs + 100);
    assert.ok(suburbanGameState.findProblem(id), 'chamado emitido sem uma Analista na sala');
    assert.equal(game.analystNeedsAttention(), true, 'o botão do tablet avisa a dupla');
    assert.equal(game.analyzeProblem(id), false, 'tablet guardado não analisa');
    const hotkey = t.mock.method(scene, 'useMobilityHotkey', () => true);
    pressKey('KeyQ');
    assert.equal(game.isAnalystTabletOpen, true);
    assert.equal(scene.player.id, 2, 'quem abre o tablet continua controlando a Mobilidade');
    const tablet = player => player.mesh.getObjectByName('analyst-handheld-tablet').visible;
    assert.equal(tablet(scene.players[1]), true, 'o tablet aparece na mão de quem o abriu');
    assert.equal(tablet(scene.players[2]), false);
    pressKey('KeyE');
    assert.equal(suburbanGameState.findProblem(id).analyzed, true, 'E com o tablet aberto analisa como a Analista');
    pressKey('Digit1'); pressKey('Digit2'); pressKey('Digit3');
    assert.deepEqual(suburbanGameState.findProblem(id).dispatchedTeams, ['infraestrutura', 'mobilidade']);
    assert.equal(hotkey.mock.callCount(), 0, 'com o tablet aberto os números acionam equipes, não habilidades');
    assert.deepEqual(actions, [
      { type: 'tablet', open: true },
      { type: 'analyze', problemId: id },
      { type: 'dispatch', team: 'infraestrutura', problemId: id },
      { type: 'dispatch', team: 'mobilidade', problemId: id },
    ]);
    assert.equal(suburbanGameState.activeCharacter, 2, 'a central não toma o controle da personagem');
    pressKey('KeyQ');
    assert.equal(game.isAnalystTabletOpen, false);
    assert.equal(tablet(scene.players[1]), false);
    assert.deepEqual(actions.at(-1), { type: 'tablet', open: false }, 'a parceira vê o tablet ser guardado');
    pressKey('Digit3');
    assert.equal(hotkey.mock.callCount(), 1, 'guardado o tablet, a Mobilidade volta às próprias habilidades');
    assert.equal(actions.at(-1).type, 'mobility-hotkey');
  } finally { game.dispose(); }
});

test('coop em dupla: Infraestrutura mantém o reparo e recebe as análises da parceira uma vez só', t => {
  const { Game, Element, created } = gameHarness(t);
  const actions = [];
  const game = new Game(new Element(), () => {}, undefined, undefined, undefined, undefined,
    undefined, undefined, action => actions.push(action));
  try {
    game.startCoopOrlaTutorial(1, { sharedAnalyst: true });
    game.finishCoopTutorial();
    const scene = game.scenes.current, renderer = created.at(-1), id = ORLA_EVENTS[0].id;
    // A agenda roda no relógio de cada cliente: a análise da parceira pode chegar antes do chamado.
    game.applyCoopAction('mobilidade', { type: 'analyze', problemId: id });
    assert.equal(suburbanGameState.findProblem(id), undefined);
    runUntil(renderer, 0, ORLA_EVENTS[0].atMs + 100);
    assert.equal(suburbanGameState.findProblem(id).analyzed, true, 'análise adiada é aplicada quando o chamado chega');
    assert.equal(suburbanGameState.activeCharacter, 1);
    assert.equal(game.isAnalystTabletOpen, false, 'ação remota não abre nem bloqueia o tablet local');
    // As duas acionam a Infraestrutura quase juntas: o efeito acontece uma única vez.
    game.toggleAnalystTablet();
    assert.equal(game.dispatchTeam('infraestrutura'), true);
    game.applyCoopAction('mobilidade', { type: 'dispatch', team: 'infraestrutura', problemId: id });
    game.applyCoopAction('mobilidade', { type: 'dispatch', team: 'mobilidade', problemId: id });
    game.applyCoopAction('mobilidade', { type: 'dispatch', team: 'mobilidade', problemId: id });
    assert.deepEqual(suburbanGameState.findProblem(id).dispatchedTeams, ['infraestrutura', 'mobilidade']);
    game.toggleAnalystTablet();
    const interact = t.mock.method(scene, 'interact', () => {});
    game.interact();
    assert.equal(interact.mock.callCount(), 1, 'tablet guardado: E volta a ser a ação de Infraestrutura');
    // Puzzle aberto e pausa local não podem fazer este cliente perder ações remotas.
    game.repairPuzzleOpen = true;
    game.togglePause();
    const hotkey = t.mock.method(scene, 'useMobilityHotkey', () => true);
    game.applyCoopAction('mobilidade', { type: 'mobility-hotkey', key: 'Digit3', pose: { x: 0, z: 4.6, yaw: 0 } });
    assert.equal(hotkey.mock.callCount(), 1, 'habilidade remota aplicada mesmo com puzzle aberto aqui');
    suburbanGameState.setProblemStatus(id, 'RESOLVED');
    const archive = t.mock.method(scene.phase, 'archiveResolved');
    game.applyCoopAction('mobilidade', { type: 'archive', problemId: id });
    game.applyCoopAction('infraestrutura', { type: 'archive', problemId: id });
    assert.equal(archive.mock.callCount(), 1, 'arquivamento repetido não avança a agenda duas vezes');
    assert.equal(scene.phase.eventIndex, 1);
    assert.equal(suburbanGameState.findProblem(id), undefined);
    assert.equal(suburbanGameState.activeCharacter, 1);
    assert.equal(actions.filter(action => action.type === 'dispatch').length, 1, 'só o acionamento local é reenviado');
  } finally { game.dispose(); }
});

test('coop em trio: equipes de campo seguem sem tablet e aplicam a análise da Analista', t => {
  const { Game, Element, created } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  try {
    game.startCoopOrlaTutorial(2);
    assert.equal(game.hasSharedAnalyst, false);
    game.finishCoopTutorial();
    runUntil(created.at(-1), 0, ORLA_EVENTS[0].atMs + 100);
    game.toggleAnalystTablet();
    assert.equal(game.isAnalystTabletOpen, false, 'Mobilidade não abre o tablet quando há Analista');
    const id = ORLA_EVENTS[0].id;
    assert.equal(game.analyzeProblem(id), false);
    game.applyCoopAction('analista', { type: 'analyze', problemId: id });
    game.applyCoopAction('analista', { type: 'dispatch', team: 'mobilidade' });
    assert.equal(suburbanGameState.findProblem(id).analyzed, true);
    assert.deepEqual(suburbanGameState.findProblem(id).dispatchedTeams, ['mobilidade'], 'despacho antigo, sem chamado nomeado, continua aceito');
    assert.equal(suburbanGameState.activeCharacter, 2);
  } finally { game.dispose(); }
});

test('coop em dupla: tablet da parceira aparece nela; quem consulta fica parada sem travar a outra', t => {
  const { Game, Element, created } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  try {
    game.startCoopOrlaTutorial(2, { sharedAnalyst: true });
    game.finishCoopTutorial();
    const scene = game.scenes.current, renderer = created.at(-1);
    const tablet = id => scene.players[id - 1].mesh.getObjectByName('analyst-handheld-tablet').visible;
    game.applyCoopAction('infraestrutura', { type: 'tablet', open: true });
    assert.equal(tablet(1), true, 'a Infraestrutura remota aparece com o tablet');
    assert.equal(game.isAnalystTabletOpen, false, 'o tablet dela não abre o meu');
    game.toggleAnalystTablet();
    game.toggleAnalystTablet();
    assert.equal(tablet(1), true, 'abrir e guardar o meu não esconde o dela');
    game.toggleAnalystTablet();
    const start = scene.players[1].position.clone();
    game.input.setTouch(1, 'KeyD');
    runUntil(renderer, 0, 500);
    assert.deepEqual(scene.players[1].position, start, 'quem consulta o tablet fica parada');
    game.applyCoopPose('infraestrutura', 3, 2, 0);
    assert.equal(scene.players[0].position.x, 3, 'a parceira continua andando com o próprio tablet aberto');
    game.applyCoopAction('infraestrutura', { type: 'tablet', open: false });
    assert.equal(tablet(1), false);
    assert.equal(tablet(2), true);
  } finally { game.dispose(); }
});

test('coop: arquivamento da parceira converge a agenda mesmo quando a simulação local não resolveu', t => {
  const { Game, Element, created } = gameHarness(t);
  let now = 1_000;
  t.mock.method(performance, 'now', () => now);
  const game = new Game(new Element(), () => {});
  try {
    game.startCoopOrlaTutorial(1, { sharedAnalyst: true });
    game.finishCoopTutorial();
    const scene = game.scenes.current, renderer = created.at(-1), id = ORLA_EVENTS[0].id;
    let time = runUntil(renderer, 0, ORLA_EVENTS[0].atMs + 100);
    game.applyCoopAction('mobilidade', { type: 'analyze', problemId: id });
    for (const team of ORLA_EVENTS[0].teams) game.applyCoopAction('mobilidade', { type: 'dispatch', team, problemId: id });
    const scoreBefore = sessionStore.getSnapshot().snapshot.score;
    // Lá o semáforo foi consertado e a travessia terminou; aqui o trânsito ainda não concluiu.
    game.applyCoopAction('mobilidade', { type: 'archive', problemId: id });
    time = runUntil(renderer, time + 50, time + 500);
    assert.ok(suburbanGameState.findProblem(id), 'primeiro dá tempo para a simulação local resolver sozinha');
    assert.equal(scene.phase.eventIndex, 0);
    now += 4_000;
    runUntil(renderer, time + 50, time + 200);
    assert.equal(suburbanGameState.findProblem(id), undefined, 'depois da tolerância o chamado é concluído e arquivado aqui');
    assert.equal(scene.phase.eventIndex, 1, 'agenda alinhada com a parceira');
    assert.equal(scene.traffic.isCrossingGuarded(), false, 'efeitos do chamado desfeitos no mundo');
    assert.ok(sessionStore.getSnapshot().snapshot.score > scoreBefore, 'XP do chamado registrado também aqui');
    game.applyCoopAction('mobilidade', { type: 'archive', problemId: id });
    game.applyCoopAction('mobilidade', { type: 'analyze', problemId: id });
    assert.equal(scene.phase.eventIndex, 1, 'ações tardias de um chamado já encerrado são descartadas');
    assert.equal(game.deferredCoopActions.length, 0);
  } finally { game.dispose(); }
});

test('coop: Analista local não recebe modo compartilhado mesmo se a sala pedir', t => {
  const { Game, Element } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  try {
    game.startCoopOrlaTutorial(3, { sharedAnalyst: true });
    assert.equal(game.hasSharedAnalyst, false);
  } finally { game.dispose(); }
});

test('CT-5.1: durante o treino de Mobilidade e de Infraestrutura o jogador anda livremente', t => {
  const { Game, Element, created } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  try {
    game.startOrlaWithAnalystTutorial();
    const orla = game.scenes.current, renderer = created.at(-1);
    game.startMobilityTutorial();
    for (let step = 0; step <= 18; step++) {
      game.setMobilityTutorialStep(step);
      assert.equal(orla.tutorialMovementEnabled, true, `Mobilidade, etapa ${step}: movimento travado`);
    }
    game.startInfrastructureTutorial();
    for (let step = 0; step <= 6; step++) {
      game.setInfrastructureTutorialStep(step);
      assert.equal(orla.tutorialMovementEnabled, true, `Infraestrutura, etapa ${step}: movimento travado`);
    }
    // Movimento real com a lição aberta na tela.
    game.setInfrastructureTutorialStep(0);
    const before = orla.player.mesh.position.clone();
    game.input.setTouch(1, 'KeyD');
    let time = 0;
    for (let frame = 0; frame < 20; frame++) renderer.loop(time += 50);
    assert.ok(orla.player.mesh.position.x > before.x + 0.3, 'o personagem anda enquanto a instrução está aberta');
  } finally { game.dispose(); }
});

test('D11: sair no meio da partida e começar de novo devolve a Orla limpa', t => {
  const { Game, Element, created } = gameHarness(t);
  const game = new Game(new Element(), () => {});
  try {
    game.start('fase1-orla');
    let renderer = created.at(-1), time = 0;
    for (; time <= 60_000; time += 50) renderer.loop(time);
    assert.ok(suburbanGameState.snapshot().problems.length > 0, 'a partida estava com chamado ativo');
    game.togglePause();
    game.returnToMenu();
    assert.equal(sessionStore.getSnapshot().snapshot, null);
    game.start('fase1-orla');
    const orla = game.scenes.current;
    renderer = created.at(-1);
    renderer.loop(0);
    const fresh = sessionStore.getSnapshot().snapshot;
    assert.equal(fresh.elapsedMs, 0);
    assert.equal(fresh.orders.length, 0);
    assert.equal(fresh.score, 0);
    assert.equal(suburbanGameState.snapshot().problems.length, 0);
    assert.ok(suburbanGameState.snapshot().roads.every(road => !road.conesActive && road.status === 'open'));
    assert.equal(orla.traffic.isCrossingGuarded(), false);
    assert.equal(orla.player.id, 2);
    for (time = 50; time <= ORLA_EVENTS[0].atMs + 50; time += 50) renderer.loop(time);
    assert.equal(sessionStore.getSnapshot().snapshot.orders[0]?.definitionId, ORLA_EVENTS[0].id, 'o primeiro chamado chega no horário de novo');
  } finally { game.dispose(); }
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
