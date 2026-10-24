const fs = require('node:fs');
const { stripTypeScriptTypes } = require('node:module');
const assert = require('node:assert/strict');
const { test } = require('node:test');

require.extensions['.ts'] = (module, filename) => {
  let source = stripTypeScriptTypes(fs.readFileSync(filename, 'utf8'), { mode: 'transform' });
  const names = [...source.matchAll(/export (?:class|const) (\w+)/g)].map(match => match[1]);
  source = source.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g, 'const {$1} = require(\'$2\');')
    .replace(/export (class|const) /g, '$1 ');
  module._compile(source + '\nObject.assign(exports, {' + names.join(',') + '});', filename);
};

const { GameSession } = require('../src/game/session/GameSession.ts');
const { ORLA_SESSION_CONFIG } = require('../src/game/session/sessionData.ts');
const { ORLA_EVENTS } = require('../src/game/session/orlaEvents.ts');

const definition = (overrides = {}) => ({
  id: 'test', title: 'Pedido de teste', riskIds: [1, 2], timeLimitMs: 10_000,
  basePoints: 100, maxSpeedBonus: 50, ...overrides,
});
const config = (overrides = {}) => ({
  phaseDurationMs: 60_000, orderIntervalMs: 15_000, firstOrderDelayMs: 0,
  orders: [definition()], ...overrides,
});
const playing = (overrides = {}) => {
  const game = new GameSession(config(overrides));
  game.start();
  return game;
};
const head = game => game.snapshot().orders[0];

test('menu, pausa e fim bloqueiam tempo e resoluções; transições são idempotentes', () => {
  const game = new GameSession(config());
  assert.equal(game.snapshot().status, 'menu');
  assert.deepEqual(game.advance(500), []);
  assert.deepEqual(game.resolveRisk(1, 1), []);
  assert.deepEqual(game.pause(), []);
  assert.deepEqual(game.resume(), []);
  assert.equal(game.start()[0].status, 'playing');
  const id = head(game).id;
  assert.deepEqual(game.start(), []);
  game.advance(2_000);
  assert.deepEqual(game.pause(), [{ type: 'status', status: 'paused' }]);
  const paused = game.snapshot();
  assert.deepEqual(game.advance(100_000), []);
  assert.deepEqual(game.resolveRisk(id, 1), []);
  assert.deepEqual(game.pause(), []);
  assert.deepEqual(game.snapshot(), paused);
  game.resume();
  assert.deepEqual(game.resume(), []);
  game.advance(1_000);
  assert.equal(game.snapshot().elapsedMs, 3_000);
  assert.equal(head(game).remainingMs, 7_000);
  game.resolveRisk(id, 1);
  game.resolveRisk(id, 2);
  assert.deepEqual(game.finish(), [{ type: 'status', status: 'finished' }]);
  const finished = game.snapshot();
  assert.equal(finished.status, 'finished');
  assert.deepEqual(game.resolveRisk(id, 2), []);
  assert.deepEqual(game.advance(100_000), []);
  assert.deepEqual(game.pause(), []);
  assert.deepEqual(game.resume(), []);
  assert.deepEqual(game.snapshot(), finished);
});

test('pedidos chegam no intervalo configurado, repetindo o catálogo em ordem', () => {
  const game = playing({ firstOrderDelayMs: 2_000, orderIntervalMs: 3_000,
    orders: [definition({ id: 'a' }), definition({ id: 'b' })] });
  assert.equal(game.snapshot().orders.length, 0);
  assert.deepEqual(game.advance(1_999), []);
  assert.equal(game.advance(1)[0].order.definitionId, 'a');
  assert.equal(game.advance(3_000)[0].order.definitionId, 'b');
  assert.equal(game.advance(3_000)[0].order.definitionId, 'a');
  assert.deepEqual(game.snapshot().orders.map(o => o.createdAtMs), [2_000, 5_000, 8_000]);
  assert.deepEqual(game.snapshot().orders.map(o => o.remainingMs), [4_000, 7_000, 10_000]);
});

test('FIFO e ordem de riscos: ação errada ou repetida não rende progresso nem pontos', () => {
  const game = playing({ orderIntervalMs: 1_000 });
  game.advance(1_000);
  const [first, second] = game.snapshot().orders;
  for (const [orderId, riskId] of [[second.id, 1], [first.id, 2], [999, 1], [first.id, 999]]) {
    assert.deepEqual(game.resolveRisk(orderId, riskId), []);
  }
  game.resolveRisk(first.id, 1);
  assert.deepEqual(game.resolveRisk(first.id, 1), []);
  assert.equal(head(game).completedSteps, 1);
  assert.equal(head(game).nextRiskId, 2);
  assert.equal(game.snapshot().score, 0);
  const events = game.resolveRisk(first.id, 2);
  assert.deepEqual(events[1], { type: 'order-completed', orderId: first.id,
    basePoints: 100, speedBonus: 45, points: 145 });
  assert.equal(game.snapshot().score, 145);
  assert.equal(game.snapshot().completedOrders, 1);
  assert.equal(head(game).id, second.id);
  assert.deepEqual(game.resolveRisk(first.id, 2), []);
  assert.equal(head(game).completedSteps, 0);
});

test('bônus decresce conforme o tempo gasto, mantendo os pontos base mesmo após longo tempo', () => {
  for (const [elapsed, bonus] of [[0, 50], [2_500, 37], [9_999, 0], [10_000, 0], [120_000, 0]]) {
    const game = playing({ orderIntervalMs: 500_000 });
    const id = head(game).id;
    game.advance(elapsed);
    game.resolveRisk(id, 1);
    const completion = game.resolveRisk(id, 2)[1];
    assert.equal(completion.speedBonus, bonus);
    assert.equal(completion.points, 100 + bonus);
    assert.equal(game.snapshot().score, 100 + bonus);
    assert.ok(game.snapshot().score >= 0, 'pontuação nunca fica negativa');
    assert.equal(game.snapshot().expiredOrders, 0);
  }
});

test('chamados nunca expiram por tempo e nunca descontam pontos do jogador', () => {
  const game = playing({ orderIntervalMs: 500_000 });
  const id = head(game).id;
  game.resolveRisk(id, 1);
  assert.deepEqual(game.advance(10_000), []);
  assert.equal(head(game).id, id, 'chamado continua ativo após o tempo de referência do bônus');
  assert.equal(head(game).completedSteps, 1, 'progresso parcial é preservado');
  assert.equal(game.snapshot().score, 0, 'nenhum ponto é descontado');
  assert.equal(game.snapshot().expiredOrders, 0);
  const events = game.resolveRisk(id, 2);
  assert.equal(events[1].type, 'order-completed');
  assert.equal(events[1].points, 100);
  assert.equal(game.snapshot().score, 100);
  assert.equal(game.snapshot().completedOrders, 1);
});

test('pedidos esperando na fila não expiram e mantêm a pontuação intacta', () => {
  const game = playing({ orderIntervalMs: 5_000, orders: [
    definition({ id: 'long', timeLimitMs: 30_000 }),
    definition({ id: 'short', timeLimitMs: 2_000 }),
  ] });
  const first = head(game).id;
  game.advance(5_000);
  const second = game.snapshot().orders[1].id;
  game.advance(2_000);
  assert.equal(head(game).id, first);
  assert.equal(game.snapshot().orders[1].id, second);
  assert.equal(game.snapshot().orders.length, 2);
  assert.equal(game.snapshot().score, 0);
  assert.equal(game.snapshot().expiredOrders, 0);
});

test('avanço grande equivale a vários avanços pequenos', () => {
  const settings = { firstOrderDelayMs: 1_300, orderIntervalMs: 2_700, phaseDurationMs: 25_000,
    orders: [definition({ id: 'a', timeLimitMs: 4_900 }), definition({ id: 'b', timeLimitMs: 9_100 })] };
  const whole = playing(settings), split = playing(settings);
  const events = whole.advance(25_000), splitEvents = [];
  for (let i = 0; i < 250; i++) splitEvents.push(...split.advance(100));
  assert.deepEqual(whole.snapshot(), split.snapshot());
  assert.deepEqual(events, splitEvents);
});

test('pontuação só aumenta ao concluir todas as etapas e nunca diminui com o passar do tempo', () => {
  const game = playing({ orderIntervalMs: 5_000 });
  const id = head(game).id;
  game.advance(5_000);
  game.resolveRisk(id, 1);
  assert.equal(game.snapshot().score, 0);
  game.resolveRisk(id, 2);
  assert.equal(game.snapshot().score, 125);
  game.advance(60_000);
  assert.equal(game.snapshot().score, 125, 'passar o tempo jamais subtrai pontos já conquistados');
  assert.equal(game.snapshot().completedOrders, 1);
  assert.equal(game.snapshot().expiredOrders, 0);
});

test('reiniciar e voltar ao menu limpam a sessão sem reutilizar IDs de pedidos antigos', () => {
  const game = playing({ orderIntervalMs: 50_000 });
  const oldId = head(game).id;
  game.advance(10_000);
  game.resolveRisk(oldId, 1);
  game.resolveRisk(oldId, 2);
  game.finish();
  assert.equal(game.snapshot().status, 'finished');
  game.start();
  assert.equal(game.snapshot().elapsedMs, 0);
  assert.equal(game.snapshot().score, 0);
  assert.equal(game.snapshot().expiredOrders, 0);
  assert.notEqual(head(game).id, oldId);
  assert.deepEqual(game.resolveRisk(oldId, 1), []);
  game.pause();
  game.returnToMenu();
  assert.equal(game.snapshot().status, 'menu');
  assert.equal(game.snapshot().orders.length, 0);
  assert.deepEqual(game.returnToMenu(), []);
  game.start();
  assert.equal(game.snapshot().status, 'playing');
});

test('configuração, snapshots e eventos não expõem referências internas mutáveis', () => {
  const settings = config(), game = new GameSession(settings);
  settings.phaseDurationMs = 1;
  settings.orders[0].riskIds[0] = 99;
  const event = game.start()[1];
  event.order.riskIds[0] = 98;
  const snapshot = game.snapshot();
  snapshot.orders[0].riskIds[0] = 97;
  snapshot.orders[0].completedSteps = 99;
  snapshot.orders.length = 0;
  assert.equal(head(game).nextRiskId, 1);
  assert.equal(head(game).completedSteps, 0);
  assert.equal(game.snapshot().remainingMs, 60_000);
});

test('rejeita tempos, catálogo e pontuações inválidos; delta fracionário é aceito', () => {
  const invalid = [
    { phaseDurationMs: 0 }, { phaseDurationMs: Infinity }, { orderIntervalMs: 0 },
    { orderIntervalMs: NaN }, { firstOrderDelayMs: -1 }, { firstOrderDelayMs: 60_000 },
    { orders: [] }, { orders: [definition(), definition()] },
  ];
  for (const override of invalid) assert.throws(() => new GameSession(config(override)));
  for (const override of [
    { id: '' }, { title: ' ' }, { riskIds: [] }, { riskIds: [1, 1] }, { riskIds: [NaN] },
    { timeLimitMs: 0 }, { timeLimitMs: -1 }, { timeLimitMs: 1.5 },
    { basePoints: -1 }, { maxSpeedBonus: Infinity }, { expirationPenalty: -1 },
  ]) assert.throws(() => new GameSession(config({ orders: [definition(override)] })));
  const game = playing(), before = game.snapshot();
  for (const delta of [-1, NaN, Infinity]) assert.throws(() => game.advance(delta));
  assert.deepEqual(game.snapshot(), before);
  game.advance(0.5); game.advance(0.5);
  assert.equal(game.snapshot().elapsedMs, 1);
});

test('Orla libera os eventos em série nos horários programados e encerra ao concluir o último', () => {
  const game = new GameSession(ORLA_SESSION_CONFIG);
  game.start();
  assert.equal(game.snapshot().remainingMs, 360_000);
  assert.equal(game.snapshot().orders.length, 0);
  assert.equal(ORLA_SESSION_CONFIG.orders.length, ORLA_EVENTS.length);
  for (const [index, event] of ORLA_EVENTS.entries()) {
    const at = event.atMs;
    game.advance(at - game.snapshot().elapsedMs - 1);
    assert.equal(game.snapshot().orders.length, 0);
    const arrivals = game.advance(1).filter(item => item.type === 'order-arrived');
    assert.equal(arrivals.length, 1);
    const order = head(game);
    assert.equal(order.definitionId, event.id);
    assert.equal(order.definitionId, ORLA_SESSION_CONFIG.orders[index].id);
    assert.equal(order.createdAtMs, at);
    for (const step of order.riskIds) game.resolveRisk(order.id, step);
    const score = game.snapshot().score;
    assert.deepEqual(game.resolveRisk(order.id, order.riskIds.at(-1)), []);
    assert.equal(game.snapshot().score, score);
    assert.deepEqual(game.finish(), []);
    if (index < ORLA_EVENTS.length - 1) {
      // O chamado resolvido espera no tablet até ser arquivado; só então o próximo é liberado.
      assert.equal(game.snapshot().status, 'playing');
      assert.deepEqual(game.archiveCompleted(order.id), []);
    }
  }
  assert.equal(game.snapshot().completedOrders, ORLA_EVENTS.length);
  assert.equal(game.snapshot().expiredOrders, 0);
  assert.equal(game.snapshot().status, 'finished');
});

test('Orla não expira chamados nem encerra a partida por tempo limite', () => {
  const game = new GameSession(ORLA_SESSION_CONFIG);
  game.start();
  game.advance(ORLA_EVENTS[0].atMs);
  assert.equal(game.snapshot().orders.length, 1);
  const firstOrder = head(game);
  assert.equal(firstOrder.definitionId, ORLA_EVENTS[0].id);
  // Mesmo demorando 10 minutos, o chamado continua ativo e a pontuação não fica negativa.
  game.advance(600_000);
  assert.equal(game.snapshot().status, 'playing');
  assert.equal(game.snapshot().expiredOrders, 0);
  assert.equal(game.snapshot().score, 0);
  assert.equal(head(game).id, firstOrder.id);
  for (const step of firstOrder.riskIds) game.resolveRisk(firstOrder.id, step);
  assert.equal(game.snapshot().score, firstOrder.basePoints);
  assert.ok(game.snapshot().score > 0);
});
