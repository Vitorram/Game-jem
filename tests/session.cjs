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
const { ORLA_RISKS } = require('../src/game/risks/riskData.ts');
const { RiskWorkflow } = require('../src/game/risks/RiskWorkflow.ts');
const definition = (overrides = {}) => ({
  id: 'test', title: 'Pedido de teste', riskIds: [1, 2], timeLimitMs: 10_000,
  basePoints: 100, maxSpeedBonus: 50, expirationPenalty: 30, ...overrides,
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
  game.advance(100_000);
  const finished = game.snapshot();
  assert.equal(finished.status, 'finished');
  assert.equal(finished.remainingMs, 0);
  assert.equal(finished.elapsedMs, 60_000);
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

test('bônus proporcional ao tempo restante, arredondado para baixo', () => {
  for (const [elapsed, bonus] of [[0, 50], [2_500, 37], [9_999, 0]]) {
    const game = playing();
    const id = head(game).id;
    game.advance(elapsed);
    game.resolveRisk(id, 1);
    const completion = game.resolveRisk(id, 2)[1];
    assert.equal(completion.speedBonus, bonus);
    assert.equal(game.snapshot().score, 100 + bonus);
    assert.deepEqual(game.advance(10_000 - elapsed), [], 'concluído não expira depois');
    assert.equal(game.snapshot().expiredOrders, 0);
  }
});

test('expira no instante exato, desconta uma vez e descarta progresso parcial', () => {
  const game = playing();
  const id = head(game).id;
  game.resolveRisk(id, 1);
  game.advance(9_999);
  assert.equal(head(game).remainingMs, 1);
  assert.deepEqual(game.advance(1), [{ type: 'order-expired', orderId: id, penalty: 30, reason: 'deadline' }]);
  assert.deepEqual(game.resolveRisk(id, 2), []);
  assert.deepEqual(game.advance(1), []);
  assert.equal(game.snapshot().score, -30);
  assert.equal(game.snapshot().expiredOrders, 1);
  assert.equal(game.snapshot().completedOrders, 0);
});

test('pedido esperando na fila também expira, mesmo antes do primeiro', () => {
  const game = playing({ orderIntervalMs: 5_000, orders: [
    definition({ id: 'long', timeLimitMs: 30_000 }),
    definition({ id: 'short', timeLimitMs: 2_000 }),
  ] });
  const first = head(game).id;
  game.advance(5_000);
  const second = game.snapshot().orders[1].id;
  assert.equal(game.advance(2_000)[0].orderId, second);
  assert.equal(head(game).id, first);
  assert.equal(game.snapshot().orders.length, 1);
  assert.equal(game.snapshot().score, -30);
});

test('expiração e chegada simultâneas processam a expiração primeiro', () => {
  const game = playing({ orderIntervalMs: 10_000 });
  const events = game.advance(10_000);
  assert.deepEqual(events.map(e => e.type), ['order-expired', 'order-arrived']);
  assert.equal(head(game).remainingMs, 10_000);
  assert.equal(head(game).completedSteps, 0);
});

test('fim da fase expira pendências uma vez e não cria pedido no instante final', () => {
  const game = playing({ phaseDurationMs: 10_000, orderIntervalMs: 5_000,
    orders: [definition(), definition({ id: 'long', timeLimitMs: 20_000, expirationPenalty: 40 })] });
  game.advance(5_000);
  const events = game.advance(50_000);
  assert.deepEqual(events.map(e => e.type), ['order-expired', 'order-expired', 'status']);
  assert.deepEqual(events.slice(0, 2).map(e => e.reason), ['deadline', 'phase-ended']);
  assert.equal(game.snapshot().score, -70);
  assert.equal(game.snapshot().expiredOrders, 2);
  assert.equal(game.snapshot().orders.length, 0);
  game.advance(1);
  assert.equal(game.snapshot().score, -70);
});

test('avanço grande equivale a vários avanços pequenos, inclusive no encerramento', () => {
  const settings = { firstOrderDelayMs: 1_300, orderIntervalMs: 2_700, phaseDurationMs: 25_000,
    orders: [definition({ id: 'a', timeLimitMs: 4_900 }), definition({ id: 'b', timeLimitMs: 9_100 })] };
  const whole = playing(settings), split = playing(settings);
  const events = whole.advance(100_000), splitEvents = [];
  for (let i = 0; i < 250; i++) splitEvents.push(...split.advance(100));
  assert.deepEqual(whole.snapshot(), split.snapshot());
  assert.deepEqual(events, splitEvents);
});

test('pontuação combina conclusão e expiração sem dar pontos por etapas isoladas', () => {
  const game = playing({ orderIntervalMs: 5_000 });
  const id = head(game).id;
  game.advance(5_000);
  game.resolveRisk(id, 1);
  assert.equal(game.snapshot().score, 0);
  game.resolveRisk(id, 2);
  assert.equal(game.snapshot().score, 125);
  game.advance(10_000);
  assert.equal(game.snapshot().score, 95);
  assert.equal(game.snapshot().completedOrders, 1);
  assert.equal(game.snapshot().expiredOrders, 1);
});

test('reiniciar e voltar ao menu limpam a sessão sem reutilizar IDs de pedidos antigos', () => {
  const game = playing({ phaseDurationMs: 10_000 });
  const oldId = head(game).id;
  game.advance(10_000);
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

test('Orla emite cinco eventos nos horários exatos e mantém os seis minutos após resoluções', () => {
  const game = new GameSession(ORLA_SESSION_CONFIG);
  game.start();
  assert.equal(game.snapshot().remainingMs, 360_000);
  assert.equal(game.snapshot().orders.length, 0);
  for (const [index, at] of [30_000, 85_000, 150_000, 215_000, 280_000].entries()) {
    game.advance(at - game.snapshot().elapsedMs - 1);
    assert.equal(game.snapshot().orders.length, 0);
    const arrivals = game.advance(1).filter(event => event.type === 'order-arrived');
    assert.equal(arrivals.length, 1);
    const order = head(game);
    assert.equal(order.definitionId, ORLA_SESSION_CONFIG.orders[index].id);
    assert.equal(order.createdAtMs, at);
    for (const step of order.riskIds) game.resolveRisk(order.id, step);
    const score = game.snapshot().score;
    assert.deepEqual(game.resolveRisk(order.id, order.riskIds.at(-1)), []);
    assert.equal(game.snapshot().score, score);
    assert.deepEqual(game.finish(), []);
    assert.equal(game.snapshot().status, 'playing');
  }
  assert.equal(game.snapshot().completedOrders, 5);
  assert.deepEqual(game.advance(45_000), []);
  assert.equal(game.snapshot().elapsedMs, 325_000);
  assert.deepEqual(game.advance(34_999), []);
  assert.equal(game.snapshot().status, 'playing');
  game.advance(1);
  assert.equal(game.snapshot().status, 'finished');
  assert.equal(game.snapshot().expiredOrders, 0);
});

test('eventos da Orla podem ser resolvidos fora de ordem e pendências só expiram no fim', () => {
  const game = new GameSession(ORLA_SESSION_CONFIG);
  game.start();
  game.advance(325_000);
  const orders = game.snapshot().orders;
  assert.equal(orders.length, 5);
  assert.equal(game.snapshot().expiredOrders, 0);
  const sensor = orders.find(order => order.definitionId === 'sensor-failure');
  assert.equal(game.resolveRisk(sensor.id, 401).at(-1).type, 'order-completed');
  assert.equal(game.snapshot().orders[0].definitionId, 'broken-light-pole-1');
  game.pause();
  const paused = game.snapshot();
  game.advance(100_000);
  assert.deepEqual(game.snapshot(), paused);
  game.resume();
  game.advance(35_000);
  assert.equal(game.snapshot().expiredOrders, 4);
  assert.equal(game.snapshot().completedOrders, 1);
  assert.deepEqual(game.finish(), []);
  game.start();
  assert.equal(game.snapshot().elapsedMs, 0);
  assert.equal(game.snapshot().orders.length, 0);
});
