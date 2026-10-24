const { test, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const swc = require('next/dist/build/swc');
let CoopClient, CoopClientModule;
const realWebSocket = global.WebSocket;
class FakeSocket extends EventTarget {
  static OPEN = 1; static CONNECTING = 0; static CLOSING = 2; static CLOSED = 3;
  static instances = [];
  readyState = 0;
  sent = [];
  constructor(url) { super(); this.url = url; FakeSocket.instances.push(this); }
  send(value) { if (this.readyState !== 1) throw new Error('not open'); this.sent.push(JSON.parse(value)); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  message(value) {
    const event = new Event('message');
    Object.defineProperty(event, 'data', { value: typeof value === 'string' ? value : JSON.stringify(value) });
    this.dispatchEvent(event);
  }
}
before(async () => {
  await swc.loadBindings();
  const filename = path.join(__dirname, '../src/game/coop/CoopClient.ts');
  const { code } = swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const module = new Module(filename);
  module._compile(code, filename);
  CoopClientModule = module.exports;
  CoopClient = module.exports.CoopClient;
});
beforeEach(() => { global.WebSocket = FakeSocket; FakeSocket.instances = []; });
afterEach(() => { global.WebSocket = realWebSocket; });
async function connected(timeout = 1000) {
  const client = new CoopClient('ws://localhost:3001/coop', timeout);
  const pending = client.connect();
  const ws = FakeSocket.instances.at(-1);
  ws.open(); await pending;
  return { client, ws };
}
const player = { id: 'id1', name: 'Ana', role: 'analista', ready: true, tutorialReady: false, host: true };
function session(ws, phase = 'lobby') {
  ws.message({ type: 'joined', id: 'id1', role: 'analista', code: 'ABCD1234', host: true });
  ws.message({ type: 'room', code: 'ABCD1234', phase, isPublic: true, paused: false, players: [player] });
}
test('Client: conexões simultâneas esperam o mesmo handshake real', async () => {
  const client = new CoopClient('ws://localhost:3001/coop');
  const first = client.connect(), second = client.connect();
  assert.equal(first, second); assert.equal(FakeSocket.instances.length, 1);
  let resolved = false; void first.then(() => { resolved = true; });
  await Promise.resolve(); assert.equal(resolved, false);
  FakeSocket.instances[0].open(); await first;
  assert.equal(client.state, 'connected'); client.disconnect();
});
test('Client: conexão cancelada e eventos atrasados não derrubam o socket seguinte', async () => {
  const client = new CoopClient('ws://localhost:3001/coop');
  const first = client.connect(); const rejected = assert.rejects(first, /encerrada/);
  const stale = FakeSocket.instances[0]; client.disconnect(); await rejected;
  const second = client.connect(), current = FakeSocket.instances[1];
  current.open(); await second; stale.dispatchEvent(new Event('close'));
  assert.equal(client.state, 'connected'); client.disconnect();
});
test('Client: timeout de conexão rejeita; sem fila de comandos offline', async () => {
  const client = new CoopClient('ws://localhost:3001/coop', 15);
  await assert.rejects(client.connect(), /demorou/);
  await assert.rejects(client.createRoom('Ana', 'analista'), /Conecte/);
  assert.equal(client.state, 'disconnected'); assert.equal(FakeSocket.instances[0].sent.length, 0);
});
test('Client: confirmação explícita, erro correlacionado e timeout invalidam operação pendente', async () => {
  const { client, ws } = await connected(30);
  const request = client.createRoom('Ana', 'analista');
  let resolved = false; void request.then(() => { resolved = true; });
  session(ws); await Promise.resolve(); assert.equal(resolved, false);
  ws.message({ type: 'ack', requestId: ws.sent.at(-1).requestId }); await request;
  assert.equal(client.hasSession('id1', 'ABCD1234'), true);
  const invalid = client.ready(true);
  const denied = assert.rejects(invalid, error => error.code === 'FORBIDDEN' && /Permissão/.test(error.message));
  ws.message({ type: 'error', code: 'FORBIDDEN', message: 'Permissão negada.', requestId: ws.sent.at(-1).requestId });
  await denied; assert.equal(client.state, 'connected');
  await assert.rejects(client.start(), /não confirmou/);
  assert.equal(client.state, 'disconnected'); assert.equal(client.hasSession('id1', 'ABCD1234'), false);
});
test('Client: falha de protocolo visível e queda rejeitam todos os pedidos', async () => {
  const { client, ws } = await connected();
  const events = []; client.on(event => events.push(event));
  const list = client.requestRooms(), ready = client.ready(true);
  const errors = Promise.all([assert.rejects(list, /incompatível/), assert.rejects(ready, /incompatível/)]);
  ws.message({ type: 'rooms', rooms: [{ code: 'oops' }] });
  await errors;
  assert.equal(events.at(-1).state, 'disconnected');
});
test('Client: JSON inválido não é ignorado nem mantém pedidos pendentes', async () => {
  const { client, ws } = await connected();
  const pending = client.requestRooms(); const rejected = assert.rejects(pending, /Resposta inválida/);
  ws.message('{'); await rejected; assert.equal(client.state, 'disconnected');
});
test('Client: movimentos e ações só saem durante partida válida e nunca falsificam papel', async () => {
  const { client, ws } = await connected();
  session(ws, 'tutorial'); client.move('infraestrutura', 1, 2, 0); client.action({ type: 'repair-complete' });
  assert.equal(ws.sent.length, 0);
  session(ws, 'playing'); client.move('infraestrutura', 1, 2, 0);
  assert.deepEqual(ws.sent.at(-1), { type: 'move', x: 1, z: 2, yaw: 0 });
  ws.message({ type: 'pause', paused: true, by: 'Bia' });
  client.action({ type: 'repair-complete' }); assert.equal(ws.sent.length, 1);
  ws.message({ type: 'session-ended', code: 'PLAYER_LEFT', message: 'A equipe saiu.' });
  assert.equal(client.hasSession('id1', 'ABCD1234'), false);
  client.move('analista', 2, 3, 0); assert.equal(ws.sent.length, 1); client.disconnect();
});
test('Client: composição da equipe espelha o servidor e permissões da central compartilhada', () => {
  const { coopTeamMode, coopHasAnalystAccess, COOP_MIN_PLAYERS, COOP_MAX_PLAYERS } = CoopClientModule;
  assert.equal(COOP_MIN_PLAYERS, 2); assert.equal(COOP_MAX_PLAYERS, 3);
  const as = (...roles) => roles.map(role => ({ role }));
  assert.equal(coopTeamMode(as('analista', 'mobilidade', 'infraestrutura')), 'trio');
  assert.equal(coopTeamMode(as('infraestrutura', 'mobilidade')), 'duo');
  for (const roles of [as(), as('mobilidade'), as('analista', 'mobilidade'), as('analista', 'infraestrutura')]) assert.equal(coopTeamMode(roles), null);
  assert.equal(coopHasAnalystAccess('mobilidade', true), true);
  assert.equal(coopHasAnalystAccess('infraestrutura', true), true);
  assert.equal(coopHasAnalystAccess('mobilidade', false), false, 'trio mantém o tablet só com a Analista');
  assert.equal(coopHasAnalystAccess('analista', false), true);
});
test('Client: troca de papel, modo da sala e despacho nomeado passam pela validação do protocolo', async () => {
  const { client, ws } = await connected();
  session(ws);
  const changing = client.setRole('mobilidade');
  assert.deepEqual(ws.sent.at(-1), { type: 'set-role', role: 'mobilidade', requestId: ws.sent.at(-1).requestId });
  ws.message({ type: 'ack', requestId: ws.sent.at(-1).requestId }); await changing;
  const duo = [{ ...player, role: 'mobilidade' }, { ...player, id: 'id2', role: 'infraestrutura', host: false }];
  ws.message({ type: 'room', code: 'ABCD1234', phase: 'playing', isPublic: true, paused: false, mode: 'duo', sharedAnalyst: true, players: duo });
  assert.equal(client.currentRoom.sharedAnalyst, true); assert.equal(client.currentRoom.mode, 'duo');
  const events = []; client.on(event => events.push(event));
  ws.message({ type: 'action', id: 'id2', role: 'infraestrutura', action: { type: 'dispatch', team: 'mobilidade', problemId: 'traffic-signal-failure' } });
  assert.equal(events.at(-1).action.problemId, 'traffic-signal-failure');
  client.action({ type: 'analyze', problemId: 'traffic-signal-failure' });
  assert.deepEqual(ws.sent.at(-1), { type: 'action', action: { type: 'analyze', problemId: 'traffic-signal-failure' } });
  ws.message({ type: 'room', code: 'ABCD1234', phase: 'lobby', isPublic: true, paused: false, mode: 'quarteto', players: duo });
  assert.equal(client.state, 'disconnected', 'modo desconhecido é protocolo incompatível');
});
test('Client e servidor reais: dupla inicia, entra no tutorial e recebe análise da parceira', async t => {
  global.WebSocket = realWebSocket;
  const { createCoopServer } = await import('../backend/server.mjs');
  const app = createCoopServer({ startDelayMs: 0, tutorialDelayMs: 0 }); const address = await app.listen();
  const m = new CoopClient('ws://127.0.0.1:' + address.port + '/coop');
  const i = new CoopClient(m.url);
  t.after(async () => { m.disconnect(); i.disconnect(); await app.close(); });
  await Promise.all([m.connect(), i.connect()]);
  const wait = (client, predicate) => new Promise(resolve => {
    const listener = message => { if (predicate(message)) { client.off(listener); resolve(message); } };
    client.on(listener);
  });
  await m.createRoom('Bia', 'analista');
  await i.join(m.currentRoom.code, 'Cris', 'infraestrutura');
  await assert.rejects(Promise.all([m.ready(true), i.ready(true)]).then(() => m.start()), error => error.code === 'TEAM_INCOMPLETE');
  await m.setRole('mobilidade');
  assert.equal(m.currentRoom.mode, 'duo');
  const started = wait(i, message => message.type === 'game-start');
  await m.ready(true); await m.start();
  assert.equal((await started).sharedAnalyst, true);
  const tutorial = Promise.all([wait(m, message => message.type === 'tutorial-start'), wait(i, message => message.type === 'tutorial-start')]);
  for (const client of [m, i]) { await client.tutorialOpen(); await client.tutorialReady(true); }
  await tutorial;
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(m.currentRoom.phase, 'playing'); assert.equal(m.currentRoom.sharedAnalyst, true);
  const received = wait(i, message => message.type === 'action');
  m.action({ type: 'analyze', problemId: 'traffic-signal-failure' });
  const action = await received;
  assert.equal(action.role, 'mobilidade'); assert.equal(action.action.type, 'analyze');
});
test('Client e servidor reais: criação, listagem, papel ocupado e confirmação de entrada', async t => {
  global.WebSocket = realWebSocket;
  const { createCoopServer } = await import('../backend/server.mjs');
  const app = createCoopServer(); const address = await app.listen();
  const a = new CoopClient('ws://127.0.0.1:' + address.port + '/coop');
  const b = new CoopClient(a.url);
  t.after(async () => { a.disconnect(); b.disconnect(); await app.close(); });
  await Promise.all([a.connect(), b.connect()]);
  await a.createRoom('Ana', 'analista');
  const code = a.currentRoom.code;
  const rooms = []; b.on(message => { if (message.type === 'rooms') rooms.push(...message.rooms); });
  await b.requestRooms(); assert.equal(rooms[0].code, code);
  await assert.rejects(b.join(code, 'Bia', 'analista'), /ocupado/);
  await b.join(code, 'Bia', 'mobilidade');
  assert.equal(b.currentRoom.players.length, 2);
});
