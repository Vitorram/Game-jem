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

test('fase limpa treino, avisa antes de apagar e permite reparo só de Infra', () => {
  const game = phase();
  try {
    assert.equal(suburbanGameState.snapshot().problems.length, 0);
    assert.equal(game.scene.traffic.getRoadStates().some(road => road.conesActive), false);
    game.jump(30_000);
    assert.equal(problem('broken-light-pole-1').stage, 'warning');
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(-9, 4.7);
    game.scene.interact();
    assert.equal(game.opened(), 0);
    game.jump(37_000);
    assert.deepEqual(problem('broken-light-pole-1').requiredTeams, ['infraestrutura']);
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(-9, 4.7);
    game.scene.interact();
    assert.equal(game.opened(), 0);
    game.scene.selectPlayer(1);
    game.scene.interact();
    assert.equal(game.opened(), 1);
    game.scene.completePoleRepair();
    assert.equal(problem('broken-light-pole-1').status, 'RESOLVED');
    assert.equal(game.session.snapshot().completedOrders, 1);
    assert.equal(game.session.snapshot().status, 'playing');
  } finally { game.scene.dispose(); }
});

test('travessia acumula pedestres, espera travessia real e só encerra ao liberar fluxo', () => {
  const game = phase();
  try {
    game.jump(85_000);
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(1, 5);
    game.run(20);
    assert.ok(suburbanGameState.snapshot().phase.waitingPedestrians >= 3);
    assert.equal(problem('unsafe-crossing').status, 'ACTIVE');
    game.scene.useMobilityHotkey('Digit1');
    assert.equal(problem('unsafe-crossing').status, 'ACTIVE');
    game.scene.useMobilityHotkey('Digit3');
    assert.equal(game.scene.traffic.isCrossingGuarded(), true);
    game.run(22);
    const order = game.session.snapshot().orders.find(order => order.definitionId === 'unsafe-crossing');
    assert.equal(order.completedSteps, 1);
    game.scene.useMobilityHotkey('Digit1');
    assert.equal(problem('unsafe-crossing').status, 'RESOLVED');
    assert.equal(game.scene.traffic.isCrossingGuarded(), false);
  } finally { game.scene.dispose(); }
});

test('pico exige fluxo sustentado e sensor exige Infra no ponto por quatro segundos', () => {
  const game = phase();
  try {
    game.jump(160_000);
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(-16, 8.2);
    game.scene.useMobilityHotkey('Digit1');
    game.scene.useMobilityHotkey('Digit4');
    game.run(7);
    assert.equal(problem('rush-hour').status, 'ACTIVE');
    game.run(3);
    assert.equal(problem('rush-hour').status, 'RESOLVED');
    game.jump(222_000);
    game.scene.player.setPosition(9, 4.7);
    game.scene.interact();
    game.run(5);
    assert.equal(problem('sensor-failure').status, 'ACTIVE');
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(9, 4.7);
    game.scene.interact();
    game.run(2);
    game.scene.player.setPosition(-9, 4.7);
    game.run(3);
    assert.equal(problem('sensor-failure').status, 'ACTIVE');
    game.scene.player.setPosition(9, 4.7);
    game.run(2.1);
    assert.equal(problem('sensor-failure').status, 'RESOLVED');
  } finally { game.scene.dispose(); }
});

test('colisão exige cone e desvio antes do serviço; recuperação preserva pendências', () => {
  const game = phase();
  try {
    game.jump(285_000);
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
    game.scene.useMobilityHotkey('Digit4');
    game.run(.05);
    assert.equal(game.scene.traffic.isIncidentProtected(), true);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(incident.x, incident.z - 1.1);
    game.scene.interact();
    game.run(3.1);
    assert.equal(problem('minor-collision').status, 'RESOLVED', JSON.stringify({ service: game.scene.phase.service, position: game.scene.player.position, incident, cones: game.scene.traffic.cones.map(c => ({x:c.x, lane:c.lane.id})), roads:game.scene.traffic.getRoadStates().map(r => ({id:r.id,status:r.status})) }));
    assert.equal(game.scene.traffic.getIncidentPosition(), null);
    game.jump(325_000);
    assert.equal(suburbanGameState.snapshot().phase.recovery, true);
    assert.equal(suburbanGameState.snapshot().problems.length, 6);
    assert.equal(problem('sensor-failure').status, 'ACTIVE');
    assert.equal(game.session.snapshot().status, 'playing');
  } finally { game.scene.dispose(); }
});

test('rodada contínua de seis minutos combina todos os eventos e permite recuperação final', () => {
  const game = phase();
  const until = seconds => game.run(seconds - game.session.snapshot().elapsedMs / 1000);
  try {
    until(37);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(-9, 4.7);
    game.scene.interact(); game.scene.completePoleRepair();
    game.scene.selectPlayer(3);
    until(105);
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(1, 5);
    game.scene.useMobilityHotkey('Digit3');
    for (let i = 0; i < 35; i++) {
      game.run(1);
      const order = game.session.snapshot().orders.find(order => order.definitionId === 'unsafe-crossing');
      if (order?.completedSteps === 1) break;
    }
    game.scene.useMobilityHotkey('Digit1');
    assert.equal(problem('unsafe-crossing').status, 'RESOLVED');
    game.scene.selectPlayer(3);
    until(160);
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(-16, 8.2);
    game.scene.useMobilityHotkey('Digit1'); game.scene.useMobilityHotkey('Digit4');
    game.run(10);
    assert.equal(problem('rush-hour').status, 'RESOLVED');
    game.scene.useMobilityHotkey('Digit1');
    game.scene.selectPlayer(3);
    until(198);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(0, 4.7);
    game.scene.interact();
    assert.equal(problem('traffic-signal-failure').status, 'RESOLVED');
    game.scene.selectPlayer(3);
    until(222);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(9, 4.7);
    game.scene.interact(); game.run(4.1);
    assert.equal(problem('sensor-failure').status, 'RESOLVED');
    game.scene.selectPlayer(3);
    until(285);
    const incident = game.scene.traffic.getIncidentPosition();
    assert.ok(incident);
    game.scene.selectPlayer(2);
    const crate = game.scene.map.cellCenter(11, 5);
    game.scene.player.setPosition(crate.x - 2, crate.z);
    game.scene.interact();
    const cone = game.scene.traffic.getIncidentConeTarget();
    game.scene.player.setPosition(cone.x, cone.z);
    game.scene.interact(); game.scene.useMobilityHotkey('Digit4'); game.run(.1);
    game.scene.selectPlayer(1);
    game.scene.player.setPosition(incident.x, incident.z - 1.1);
    game.scene.interact(); game.run(3.1);
    assert.equal(problem('minor-collision').status, 'RESOLVED', JSON.stringify({ service: game.scene.phase.service, position: game.scene.player.position, incident, cones: game.scene.traffic.cones.map(c => ({x:c.x, lane:c.lane.id})), roads:game.scene.traffic.getRoadStates().map(r => ({id:r.id,status:r.status})) }));
    assert.equal(game.session.snapshot().completedOrders, 6);
    assert.equal(game.session.snapshot().status, 'playing');
    game.scene.selectPlayer(2);
    game.scene.player.setPosition(cone.x, cone.z);
    game.scene.interact(); game.scene.useMobilityHotkey('Digit1');
    game.scene.player.setPosition(crate.x - 2, crate.z); game.scene.interact();
    game.scene.selectPlayer(3);
    until(325);
    assert.equal(suburbanGameState.snapshot().phase.recovery, true);
    assert.equal(game.session.snapshot().orders.length, 0);
    assert.equal(game.scene.traffic.getRoadStates().some(road => road.conesActive), false);
    until(360);
    assert.equal(game.session.snapshot().status, 'finished');
    assert.equal(game.session.snapshot().expiredOrders, 0);
    assert.equal(suburbanGameState.snapshot().problems.length, 6);
  } finally { game.scene.dispose(); }
});
