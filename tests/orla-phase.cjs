const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');

require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const|function) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const|function) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};

const { Fase1OrlaScene } = require('../src/game/scenes/Fase1OrlaScene.ts');
const { suburbanGameState } = require('../src/game/core/GameState.ts');
const { GameSession } = require('../src/game/session/GameSession.ts');
const { ORLA_SESSION_CONFIG } = require('../src/game/session/sessionData.ts');
const { ORLA_EVENTS } = require('../src/game/session/orlaEvents.ts');
beforeEach(() => suburbanGameState.reset());
const problem = id => suburbanGameState.snapshot().problems.find(item => item.id === id);
function phase() {
  let opened = 0;
  let scene;
  scene = new Fase1OrlaScene(undefined, undefined, undefined, type => { opened++; if (type && type !== 'pole') scene.completeRepairPuzzle(type); });
  const session = new GameSession(ORLA_SESSION_CONFIG);
  session.start();
  scene.startPhase((id, step) => {
    const order = session.snapshot().orders.find(order => order.definitionId === id);
    if (order) session.resolveRisk(order.id, step);
  });
  return { scene, session, opened: () => opened,
    jump(at) { session.advance(at - session.snapshot().elapsedMs); scene.advancePhase(session.snapshot().elapsedMs); scene.update(0); },
    run(seconds) { for (let i = 0; i < Math.round(seconds * 20); i++) { session.advance(50); scene.advancePhase(session.snapshot().elapsedMs); scene.update(.05); } },
  };
}


const eventAt = id => ORLA_EVENTS.find(event => event.id === id).atMs;
const sessionOrder = (game, id) => game.session.snapshot().orders.find(order => order.definitionId === id);

/** Conclui os chamados anteriores a `id` pela sessão e pela fase, sem jogar cada um. */
function skipTo(game, id) {
  for (const event of ORLA_EVENTS) {
    if (event.id === id) break;
    game.jump(Math.max(game.session.snapshot().elapsedMs, event.atMs));
    const order = sessionOrder(game, event.id);
    assert.ok(order, 'chamado anterior deve estar na fila: ' + event.id);
    for (const step of order.riskIds) game.session.resolveRisk(order.id, step);
    game.session.archiveCompleted(order.id);
    game.scene.expirePhaseOrder(event.id);
  }
  game.jump(Math.max(game.session.snapshot().elapsedMs, eventAt(id)));
  assert.ok(problem(id), 'chamado alvo deve ter sido emitido: ' + id);
  assert.equal(problem(id).stage, 'warning');
}

/** Analista confere o relatório e aciona as equipes: o chamado passa a ativo. */
function dispatch(game, id) {
  game.scene.selectPlayer(3);
  assert.equal(game.scene.analyzeProblem(id), true);
  assert.equal(game.scene.requestReinforcements(id), true);
  game.scene.advancePhase(game.session.snapshot().elapsedMs);
  assert.equal(problem(id).stage, 'active');
}

test('poste: o aviso antecede o reparo e só Infra repara', () => {
  const game = phase();
  try {
    skipTo(game, 'broken-light-pole-1');
    const before = game.session.snapshot().completedOrders;
    assert.deepEqual(problem('broken-light-pole-1').requiredTeams, ['infraestrutura']);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(-9, 4.7);
    game.scene.interact();
    assert.equal(game.opened(), 0, 'sem acionamento da equipe não há reparo');
    dispatch(game, 'broken-light-pole-1');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(-9, 4.7);
    game.scene.interact();
    assert.equal(game.opened(), 0);
    game.scene.selectPlayer(1);
    game.scene.interact();
    assert.equal(game.opened(), 1);
    game.scene.completePoleRepair();
    assert.equal(problem('broken-light-pole-1').status, 'RESOLVED');
    assert.equal(game.session.snapshot().completedOrders, before + 1);
    assert.equal(game.session.snapshot().status, 'playing');
  } finally { game.scene.dispose(); }
});

test('semáforo quebrado: pedestres se reúnem, travessia protegida, reparo e liberação da via', () => {
  const game = phase();
  try {
    skipTo(game, 'traffic-signal-failure');
    dispatch(game, 'traffic-signal-failure');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(1, 5);
    game.run(9);
    assert.ok(suburbanGameState.snapshot().phase.waitingPedestrians >= 3);
    assert.equal(problem('traffic-signal-failure').status, 'ACTIVE');
    game.scene.useMobilityHotkey('Digit1');
    assert.equal(problem('traffic-signal-failure').status, 'ACTIVE', 'liberar antes da travessia não resolve');
    game.scene.useMobilityHotkey('Digit3');
    assert.equal(game.scene.traffic.isCrossingGuarded(), true);
    for (let i = 0; i < 40 && sessionOrder(game, 'traffic-signal-failure')?.completedSteps < 1; i++) game.run(1);
    assert.ok(sessionOrder(game, 'traffic-signal-failure'), 'o chamado não pode expirar durante a travessia');
    assert.equal(sessionOrder(game, 'traffic-signal-failure').completedSteps, 1, 'travessia concluída é o primeiro passo');
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(0, 4.7);
    game.scene.interact();
    assert.equal(game.opened(), 1);
    assert.equal(sessionOrder(game, 'traffic-signal-failure').completedSteps, 2, 'reparo é o segundo passo');
    game.scene.selectPlayer(2);
    game.scene.useMobilityHotkey('Digit1');
    assert.equal(problem('traffic-signal-failure').status, 'RESOLVED');
    assert.equal(game.scene.traffic.isCrossingGuarded(), false);
  } finally { game.scene.dispose(); }
});

test('fluxo intenso exige fluxo sustentado nas vias principais', () => {
  const game = phase();
  try {
    skipTo(game, 'rush-hour');
    dispatch(game, 'rush-hour');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(-16, 8.2);
    game.scene.useMobilityHotkey('Digit1');
    game.scene.useMobilityHotkey('Digit4');
    game.run(7);
    assert.equal(problem('rush-hour').status, 'ACTIVE');
    game.run(3);
    assert.equal(problem('rush-hour').status, 'RESOLVED');
  } finally { game.scene.dispose(); }
});

test('sensor exige Infra no ponto até concluir a instalação', () => {
  const game = phase();
  try {
    skipTo(game, 'sensor-failure');
    dispatch(game, 'sensor-failure');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(9, 4.7);
    game.scene.interact();
    game.run(5);
    assert.equal(problem('sensor-failure').status, 'ACTIVE', 'Mobilidade não instala o sensor');
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(9, 4.7);
    game.scene.interact();
    game.run(.5);
    game.scene.player.setPosition(-9, 4.7);
    game.run(3);
    assert.equal(problem('sensor-failure').status, 'ACTIVE', 'sem Infra no ponto o serviço pausa');
    game.scene.player.setPosition(9, 4.7);
    game.run(1);
    assert.equal(problem('sensor-failure').status, 'RESOLVED');
  } finally { game.scene.dispose(); }
});

test('colisão exige cone e desvio antes do serviço', () => {
  const game = phase();
  try {
    skipTo(game, 'minor-collision');
    dispatch(game, 'minor-collision');
    const incident = game.scene.traffic.getIncidentPosition();
    assert.ok(incident);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(incident.x, incident.z - 1.1);
    game.scene.interact();
    game.run(4);
    assert.equal(problem('minor-collision').status, 'ACTIVE');
    game.scene.selectPlayer(2);
    const crate = game.scene.map.cellCenter(11, 5);
    game.scene.player.setPosition(crate.x - 2, crate.z);
    game.scene.interact();
    assert.equal(game.scene.items.heldBy(2), 'cone');
    const target = game.scene.traffic.getIncidentConeTarget();
    game.scene.player.setPosition(target.x, target.z);
    game.scene.interact();
    assert.equal(game.scene.traffic.isIncidentProtected(), false);
    game.scene.useMobilityHotkey('Digit2');
    game.run(.05);
    assert.equal(game.scene.traffic.isIncidentProtected(), true);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(incident.x, incident.z - 1.1);
    game.scene.interact();
    game.run(3.1);
    assert.equal(problem('minor-collision').status, 'RESOLVED');
    assert.equal(game.scene.traffic.getIncidentPosition(), null);
    const resolvedDiagnostics = game.scene.getTrafficDiagnostics();
    assert.ok(resolvedDiagnostics.traffic.lanes.filter(lane => lane.id !== 'orla-green')
      .every(lane => lane.status === 'open'), 'resolver a colisão remove a interdição temporária');
    const exitedAtResolution = resolvedDiagnostics.traffic.exitedVehicles;
    game.run(35);
    const afterRecovery = game.scene.getTrafficDiagnostics();
    assert.ok(afterRecovery.traffic.exitedVehicles > exitedAtResolution, 'veículos voltam a percorrer e sair do mapa');
    assert.deepEqual(afterRecovery.persistentInvalidBlocks, []);
    assert.equal(game.session.snapshot().status, 'playing');
  } finally { game.scene.dispose(); }
});

const orderIds = new Map();

/** Avança a sessão e a fase em passos de 50 ms, repassando expirações à cena como o sessionStore faz. */
function stepRound(game, onTick) {
  for (const event of game.session.advance(50)) {
    if (event.type === 'order-expired') game.scene.expirePhaseOrder(orderIds.get(event.orderId));
  }
  game.scene.advancePhase(game.session.snapshot().elapsedMs);
  game.scene.update(.05);
  onTick(game.session.snapshot());
}

test('rodada contínua: jogador resolve os 10 chamados em série e a fase encerra sem travar a fila', () => {
  const game = phase();
  orderIds.clear();
  const arrivedAt = new Map();
  try {
    let guard = 0;
    while (game.session.snapshot().status === 'playing' && guard++ < 360 * 20) {
      stepRound(game, snapshot => {
        for (const order of snapshot.orders) {
          orderIds.set(order.id, order.definitionId);
          if (!arrivedAt.has(order.id)) arrivedAt.set(order.id, snapshot.elapsedMs);
          // O "jogador" leva 15 s para concluir cada chamado e depois arquiva.
          if (snapshot.elapsedMs - arrivedAt.get(order.id) >= 15_000) {
            if (order.completedSteps < order.riskIds.length) for (const step of order.riskIds) game.session.resolveRisk(order.id, step);
            game.session.archiveCompleted(order.id);
            game.scene.expirePhaseOrder(order.definitionId);
          }
        }
      });
    }
    const result = game.session.snapshot();
    assert.equal(result.status, 'finished');
    assert.equal(result.completedOrders, ORLA_EVENTS.length);
    assert.equal(result.expiredOrders, 0);
    assert.ok(result.elapsedMs < 360_000, 'fila em série termina antes do limite de seis minutos');
    assert.equal(suburbanGameState.snapshot().problems.length, 0);
  } finally { game.scene.dispose(); }
});

test('rodada contínua sem ações: expirações são repassadas à fase e a sessão encerra no limite', () => {
  const game = phase();
  orderIds.clear();
  try {
    const seen = [];
    let guard = 0;
    while (game.session.snapshot().status === 'playing' && guard++ < 360 * 20) {
      stepRound(game, snapshot => {
        for (const order of snapshot.orders) {
          orderIds.set(order.id, order.definitionId);
          if (!seen.includes(order.definitionId)) seen.push(order.definitionId);
        }
      });
    }
    const result = game.session.snapshot();
    assert.equal(result.status, 'finished');
    assert.equal(result.expiredOrders, ORLA_SESSION_CONFIG.maxExpiredOrders);
    assert.equal(result.completedOrders, 0);
    assert.deepEqual(seen, ORLA_EVENTS.slice(0, ORLA_SESSION_CONFIG.maxExpiredOrders).map(event => event.id));
  } finally { game.scene.dispose(); }
});

test('checagem do semáforo: só Infra abre o controlador junto ao semáforo', () => {
  const game = phase();
  try {
    skipTo(game, 'signal-check');
    dispatch(game, 'signal-check');
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(0, 4.7);
    game.scene.interact();
    assert.equal(game.opened(), 1);
    assert.equal(problem('signal-check').status, 'RESOLVED');
  } finally { game.scene.dispose(); }
});

test('cone na ciclovia: recolher e guardar na caixa de cones', () => {
  const game = phase();
  try {
    skipTo(game, 'bike-lane-cone');
    dispatch(game, 'bike-lane-cone');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(-12, 2.4);
    game.scene.interact();
    assert.equal(game.scene.items.heldBy(2), 'cone');
    assert.equal(problem('bike-lane-cone').status, 'ACTIVE', 'só recolher não encerra');
    const crate = game.scene.map.cellCenter(11, 5);
    game.scene.player.setPosition(crate.x - 2, crate.z);
    game.scene.interact();
    assert.equal(game.scene.items.heldBy(2), null);
    assert.equal(problem('bike-lane-cone').status, 'RESOLVED');
  } finally { game.scene.dispose(); }
});

test('carregador elétrico: exige o desvio com 4 antes do reparo de Infra', () => {
  const game = phase();
  try {
    skipTo(game, 'ev-charger-repair');
    dispatch(game, 'ev-charger-repair');
    const charger = problem('ev-charger-repair').position;
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(charger.x, charger.z);
    game.scene.interact();
    game.run(3);
    assert.equal(problem('ev-charger-repair').status, 'ACTIVE', 'sem o desvio o reparo não começa');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(charger.x, charger.z);
    game.scene.useMobilityHotkey('Digit4');
    game.run(.1);
    assert.equal(sessionOrder(game, 'ev-charger-repair').completedSteps, 1, 'desvio é o primeiro passo');
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(charger.x, charger.z);
    game.scene.interact();
    game.run(2);
    assert.equal(problem('ev-charger-repair').status, 'RESOLVED');
  } finally { game.scene.dispose(); }
});

test('resgate do entregador: proteger a travessia e só reabrir a via quando ele estiver seguro', () => {
  const game = phase();
  try {
    skipTo(game, 'cyclist-assist');
    dispatch(game, 'cyclist-assist');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(0, 4.7);
    game.scene.useMobilityHotkey('Digit1');
    assert.equal(problem('cyclist-assist').status, 'ACTIVE', 'reabrir antes do resgate não resolve');
    game.scene.useMobilityHotkey('Digit3');
    assert.equal(game.scene.traffic.isCrossingGuarded(), true);
    for (let i = 0; i < 40 && sessionOrder(game, 'cyclist-assist')?.completedSteps < 1; i++) game.run(1);
    assert.ok(sessionOrder(game, 'cyclist-assist'), 'o chamado não pode expirar durante o resgate');
    assert.equal(sessionOrder(game, 'cyclist-assist').completedSteps, 1, 'travessia do entregador é o primeiro passo');
    // O prazo do chamado é de 60 s; o laço só limita o teste, o que importa é resolver antes de expirar.
    for (let i = 0; i < 55 && problem('cyclist-assist').status !== 'RESOLVED'; i++) {
      game.run(1);
      game.scene.useMobilityHotkey('Digit1');
    }
    assert.equal(problem('cyclist-assist').status, 'RESOLVED');
    assert.equal(game.scene.traffic.isCrossingGuarded(), false);
    assert.equal(game.scene.getTrafficDiagnostics().mobility.roadBatchHeld, false,
      'o resgate não deixa os próximos lotes de pedestres congelados');
    const before = game.scene.getTrafficDiagnostics();
    game.run(45);
    const after = game.scene.getTrafficDiagnostics();
    assert.ok(after.mobility.entities.some(entity => entity.kind === 'pedestrian'), 'pedestres continuam sendo gerados');
    assert.ok(after.traffic.exitedVehicles > before.traffic.exitedVehicles, 'tráfego continua após o resgate');
    assert.deepEqual(after.persistentInvalidBlocks, []);
  } finally { game.scene.dispose(); }
});

test('CT-6.2: sessão de ~6 minutos a 60 fps mantém objetos limitados, posições finitas e custo por quadro baixo', () => {
  const game = phase();
  orderIds.clear();
  const dt = 1 / 60, arrivedAt = new Map();
  const sceneObjects = () => { let count = 0; game.scene.scene.traverse(() => count++); return count; };
  const samples = [];
  let frames = 0, elapsedWork = 0, maxVehicles = 0, maxWalkers = 0;
  try {
    // Jogador lento (33 s por chamado) para que os 10 eventos preencham quase todo o tempo.
    while (game.session.snapshot().status === 'playing' && frames < 360 * 60) {
      const started = performance.now();
      for (const event of game.session.advance(dt * 1000)) {
        if (event.type === 'order-expired') game.scene.expirePhaseOrder(orderIds.get(event.orderId));
      }
      const snapshot = game.session.snapshot();
      game.scene.advancePhase(snapshot.elapsedMs);
      game.scene.update(dt);
      elapsedWork += performance.now() - started;
      for (const order of snapshot.orders) {
        orderIds.set(order.id, order.definitionId);
        if (!arrivedAt.has(order.id)) arrivedAt.set(order.id, snapshot.elapsedMs);
        if (snapshot.elapsedMs - arrivedAt.get(order.id) >= 33_000) {
          for (const step of order.riskIds) game.session.resolveRisk(order.id, step);
          game.session.archiveCompleted(order.id);
          game.scene.expirePhaseOrder(order.definitionId);
        }
      }
      maxVehicles = Math.max(maxVehicles, game.scene.traffic.vehicles.length);
      maxWalkers = Math.max(maxWalkers, game.scene.activeMobility.walkers.length);
      if (frames % 600 === 0) samples.push(sceneObjects());
      frames++;
    }
    const result = game.session.snapshot();
    assert.ok(result.elapsedMs > 300_000, `a sessão cobre quase os seis minutos (${result.elapsedMs} ms)`);
    assert.equal(result.expiredOrders, 0);
    assert.equal(result.completedOrders, ORLA_EVENTS.length);
    assert.ok(maxVehicles <= 80, `veículos limitados (${maxVehicles})`);
    assert.ok(maxWalkers <= 12, `pedestres limitados (${maxWalkers})`);
    assert.ok(game.scene.traffic.vehicles.every(v => Number.isFinite(v.mesh.position.x) && Number.isFinite(v.mesh.position.z) && Number.isFinite(v.speed)));
    assert.ok(game.scene.activeMobility.walkers.every(w => Number.isFinite(w.x) && Number.isFinite(w.z)));
    // Sem vazamento de objetos na cena: o último ponto não passa muito do pior ponto da primeira metade.
    const firstHalf = Math.max(...samples.slice(0, Math.ceil(samples.length / 2)));
    assert.ok(samples.at(-1) <= firstHalf * 1.25, `objetos na cena cresceram: ${samples.join(', ')}`);
    const msPerFrame = elapsedWork / frames;
    assert.ok(msPerFrame < 16, `custo médio por quadro ${msPerFrame.toFixed(2)} ms`);
  } finally { game.scene.dispose(); }
});

test('D11: rodadas com outras sementes e quadros irregulares (inclusive picos) concluem sem travar nem gerar NaN', () => {
  const frames = [1 / 60, 1 / 60, 1 / 30, 1 / 45, 0.1, 1 / 60, 0.25, 1 / 120];
  for (const [trafficSeed, walkerSeed] of [[7, 991], [31337, 5], [424242, 77777]]) {
    suburbanGameState.reset(); // como o Game.start faz a cada partida
    const game = phase();
    orderIds.clear();
    game.scene.traffic.trafficRandomSeed = trafficSeed;
    game.scene.activeMobility.randomSeed = walkerSeed;
    const arrivedAt = new Map();
    try {
      let frame = 0;
      while (game.session.snapshot().status === 'playing' && frame < 40_000) {
        const dt = frames[frame++ % frames.length];
        for (const event of game.session.advance(dt * 1000)) {
          if (event.type === 'order-expired') game.scene.expirePhaseOrder(orderIds.get(event.orderId));
        }
        const snapshot = game.session.snapshot();
        game.scene.advancePhase(snapshot.elapsedMs);
        game.scene.update(dt);
        for (const order of snapshot.orders) {
          orderIds.set(order.id, order.definitionId);
          if (!arrivedAt.has(order.id)) arrivedAt.set(order.id, snapshot.elapsedMs);
          if (snapshot.elapsedMs - arrivedAt.get(order.id) >= 15_000) {
            for (const step of order.riskIds) game.session.resolveRisk(order.id, step);
            game.session.archiveCompleted(order.id);
            game.scene.expirePhaseOrder(order.definitionId);
          }
        }
        if (frame % 300 === 0) {
          assert.ok(game.scene.traffic.vehicles.every(v => Number.isFinite(v.mesh.position.x) && Number.isFinite(v.speed)), `semente ${trafficSeed}: carro com NaN`);
          assert.ok(game.scene.activeMobility.walkers.every(w => Number.isFinite(w.x) && Number.isFinite(w.z)), `semente ${walkerSeed}: pedestre com NaN`);
        }
      }
      const result = game.session.snapshot();
      assert.equal(result.status, 'finished', `sementes ${trafficSeed}/${walkerSeed}: a fase termina`);
      assert.equal(result.completedOrders, ORLA_EVENTS.length);
      assert.equal(result.expiredOrders, 0);
      assert.equal(suburbanGameState.snapshot().problems.length, 0, 'nenhum chamado fica pendurado na fase');
    } finally { game.scene.dispose(); }
  }
});
