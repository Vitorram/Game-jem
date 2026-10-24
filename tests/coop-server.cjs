const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');

async function fixture(t, options = {}) {
  const { createCoopServer } = await import('../backend/server.mjs');
  const app = createCoopServer({ startDelayMs: 0, tutorialDelayMs: 0, ...options });
  const address = await app.listen();
  const url = 'ws://127.0.0.1:' + address.port + '/coop';
  const connections = [];
  t.after(async () => { for (const peer of connections) peer.ws.terminate(); await app.close(); });
  async function connect(settings = {}) {
    const ws = new WebSocket(url, settings);
    const events = [];
    const inbox = [];
    const waiters = [];
    let seq = 0;
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      events.push(message);
      const index = waiters.findIndex(waiter => waiter.match(message));
      if (index >= 0) { const waiter = waiters.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(message); }
      else inbox.push(message);
    });
    const next = (match, timeout = 1500) => {
      const predicate = typeof match === 'string' ? message => message.type === match : match;
      const index = inbox.findIndex(predicate);
      if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match: predicate, resolve, timer: setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1); reject(new Error('Mensagem esperada não chegou: ' + String(match)));
        }, timeout) };
        waiters.push(waiter);
      });
    };
    const request = async message => {
      const requestId = message.requestId || 'test-' + ++seq;
      ws.send(JSON.stringify({ ...message, requestId }));
      return next(item => item.requestId === requestId && ['ack', 'error'].includes(item.type));
    };
    const peer = { ws, events, next, request };
    connections.push(peer);
    await once(ws, 'open');
    return peer;
  }
  return { app, url, http: 'http://127.0.0.1:' + address.port, connect };
}
const create = (peer, role = 'analista', isPublic = true) => peer.request({ type: 'create-room', name: 'Ana', role, isPublic });
const join = (peer, code, role) => peer.request({ type: 'join', name: role, code, role });

test('Limite de salas, limpeza por queda de socket e deduplicação de criação', async t => {
  const f = await fixture(t, { maxRooms: 1 }), a = await f.connect(), b = await f.connect();
  const payload = { type: 'create-room', name: 'Ana', role: 'analista', isPublic: true, requestId: 'create-once' };
  await a.request(payload); await a.request(payload);
  const code = (await a.next('joined')).code;
  assert.equal(a.events.filter(event => event.type === 'joined').length, 1);
  assert.equal((await create(b, 'mobilidade')).code, 'SERVER_FULL');
  await join(b, code, 'mobilidade');
  a.ws.terminate();
  const promoted = await b.next(message => message.type === 'room' && message.players.length === 1);
  assert.equal(promoted.players[0].host, true);
  await b.request({ type: 'leave' });
  assert.equal((await create(b)).type, 'ack');
});

test('Autorizações cobrem todas as ações por papel e limites dos payloads de interação', async () => {
  const { authorizeAction, validateMessage } = await import('../backend/protocol.mjs');
  const matrix = {
    analista: ['interact', 'analyze', 'dispatch', 'archive', 'call-tow', 'problem-select'],
    mobilidade: ['interact', 'mobility-hotkey'], infraestrutura: ['interact', 'repair-complete'],
  };
  const actions = [...new Set(Object.values(matrix).flat())];
  for (const [role, allowed] of Object.entries(matrix)) for (const type of actions) {
    if (allowed.includes(type)) assert.doesNotThrow(() => authorizeAction(role, { type }));
    else assert.throws(() => authorizeAction(role, { type }), error => error.code === 'FORBIDDEN');
  }
  for (const axis of [null, { x: 2, z: 0 }, { x: 0, z: NaN }]) {
    assert.throws(() => validateMessage({ type: 'action', action: { type: 'interact', axis, pose: { x: 0, z: 0, yaw: 0 } } }), /inválido/);
  }
  assert.throws(() => validateMessage({ type: 'action', action: { type: 'mobility-hotkey', key: 'Digit9', pose: { x: 0, z: 0, yaw: 0 } } }), /inválido/);
});

async function team(fixture) {
  const a = await fixture.connect(), m = await fixture.connect(), i = await fixture.connect();
  assert.equal((await create(a)).type, 'ack');
  const code = (await a.next('joined')).code;
  assert.equal((await join(m, code, 'mobilidade')).type, 'ack');
  assert.equal((await join(i, code, 'infraestrutura')).type, 'ack');
  for (const peer of [a, m, i]) await peer.request({ type: 'ready', ready: true });
  await a.request({ type: 'start' });
  return { a, m, i, code };
}
async function playing(peers) {
  for (const peer of peers) {
    await peer.request({ type: 'tutorial-open' });
    await peer.request({ type: 'tutorial-ready', ready: true });
  }
  for (const peer of peers) await peer.next('tutorial-start');
}

test('HTTP: saúde, contagem real, 404, 405 e upgrade obrigatório', async t => {
  const f = await fixture(t);
  const watcher = await f.connect();
  await watcher.request({ type: 'list-rooms' });
  assert.deepEqual(await (await fetch(f.http + '/health')).json(), { ok: true, rooms: 0, players: 0, connections: 1 });
  assert.equal((await fetch(f.http + '/missing')).status, 404);
  const method = await fetch(f.http + '/health', { method: 'POST' });
  assert.equal(method.status, 405); assert.equal(method.headers.get('allow'), 'GET, HEAD');
  assert.equal((await fetch(f.http + '/coop')).status, 426);
  assert.equal((await fetch(f.http + '/health', { method: 'HEAD' })).status, 200);
});

test('Salas: criação separada, códigos únicos, acesso privado e papel sem troca silenciosa', async t => {
  const f = await fixture(t), a = await f.connect(), b = await f.connect(), watcher = await f.connect();
  assert.equal((await join(a, 'NOPE1234', 'analista')).code, 'ROOM_NOT_FOUND');
  await create(a, 'analista', false);
  const code = (await a.next('joined')).code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  await watcher.request({ type: 'list-rooms' });
  assert.equal((await watcher.next('rooms')).rooms.length, 0);
  assert.equal((await b.request({ type: 'join-open', code, name: 'Bia', role: 'mobilidade' })).code, 'ROOM_NOT_FOUND');
  assert.equal((await join(b, code, 'analista')).code, 'ROLE_TAKEN');
  assert.equal((await join(b, code, 'mobilidade')).type, 'ack');
  await b.next('joined');
  assert.equal((await b.request({ type: 'set-public', isPublic: true })).code, 'FORBIDDEN');
  await a.request({ type: 'set-public', isPublic: true });
  const listing = await watcher.next(message => message.type === 'rooms' && message.rooms.length === 1);
  assert.equal(listing.rooms[0].players.length, 2);
  assert.equal((await create(a)).code, 'ALREADY_JOINED');
  await b.request({ type: 'leave' });
  await create(b, 'infraestrutura');
  assert.notEqual((await b.next('joined')).code, code);
});

test('Validação rejeita tipos, campos desconhecidos, JSON inválido e valores perigosos sem mutação', async t => {
  const f = await fixture(t), a = await f.connect();
  for (const payload of [
    { type: 'create-room', name: '', role: 'analista', isPublic: true },
    { type: 'create-room', name: 'Ana', role: 'admin', isPublic: true },
    { type: 'create-room', name: { x: 1 }, role: 'analista', isPublic: true },
    { type: 'create-room', name: 'Ana', role: 'analista', isPublic: 'false' },
    { type: 'create-room', name: 'A'.repeat(25), role: 'analista', isPublic: true },
    { type: 'join', code: 'A-B-C-D', name: 'Ana', role: 'analista' },
    { type: 'ready', ready: 'false' },
    { type: 'move', x: 1e99, z: 0, yaw: 0 },
    { type: 'action', action: { type: 'dispatch', team: 'admin' } },
    { type: 'start', host: true },
  ]) assert.equal((await a.request(payload)).code, 'INVALID_MESSAGE');
  assert.equal((await a.request({ type: 'hack' })).code, 'UNKNOWN_COMMAND');
  assert.equal((await a.request({ type: 'start' })).code, 'NOT_IN_ROOM');
  a.ws.send('{');
  assert.equal((await a.next(message => message.code === 'INVALID_JSON')).type, 'error');
  assert.equal((await (await fetch(f.http + '/health')).json()).rooms, 0);
  assert.equal((await create(a)).type, 'ack');
});

test('Negócio: três papéis, anfitriã, prontidão e barreira individual do prólogo/tutorial', async t => {
  const f = await fixture(t);
  const a = await f.connect(), m = await f.connect(), i = await f.connect(), fourth = await f.connect();
  await create(a); const code = (await a.next('joined')).code;
  assert.equal((await a.request({ type: 'start' })).code, 'TEAM_INCOMPLETE');
  await join(m, code, 'mobilidade'); await join(i, code, 'infraestrutura');
  assert.equal((await join(fourth, code, 'analista')).code, 'ROOM_FULL');
  assert.equal((await m.request({ type: 'start' })).code, 'FORBIDDEN');
  assert.equal((await a.request({ type: 'start' })).code, 'TEAM_NOT_READY');
  for (const p of [a, m, i]) await p.request({ type: 'ready', ready: true });
  await a.request({ type: 'start' });
  assert.equal((await a.request({ type: 'start' })).code, 'INVALID_PHASE');
  assert.equal((await m.request({ type: 'tutorial-ready', ready: true })).code, 'INTRO_REQUIRED');
  await a.request({ type: 'tutorial-open' }); await a.request({ type: 'tutorial-ready', ready: true });
  await m.request({ type: 'tutorial-open' }); await m.request({ type: 'tutorial-ready', ready: true });
  assert.equal(a.events.filter(event => event.type === 'tutorial-start').length, 0);
  assert.equal((await a.request({ type: 'move', x: 0, z: 0, yaw: 0 })).code, 'INVALID_PHASE');
  await i.request({ type: 'tutorial-open' }); await i.request({ type: 'tutorial-ready', ready: true });
  for (const p of [a, m, i]) await p.next('tutorial-start');
  assert.equal((await join(fourth, code, 'analista')).code, 'GAME_STARTED');
});

test('Ações: papel vinculado ao socket, isolamento entre salas, pausa e deduplicação', async t => {
  const f = await fixture(t), { a, m, i } = await team(f);
  await playing([a, m, i]);
  const other = await f.connect(); await create(other);
  assert.equal((await m.request({ type: 'action', action: { type: 'repair-complete' } })).code, 'FORBIDDEN');
  assert.equal((await i.request({ type: 'action', action: { type: 'analyze', problemId: 'orla-1' } })).code, 'FORBIDDEN');
  assert.equal((await m.request({ type: 'move', role: 'analista', x: 2, z: 0, yaw: 0 })).code, 'INVALID_MESSAGE');
  await m.request({ type: 'move', x: 2, z: 0, yaw: 0 });
  assert.equal((await a.next('move')).role, 'mobilidade');
  const message = { type: 'action', requestId: 'repair-once', action: { type: 'repair-complete' } };
  await i.request(message); await i.request(message);
  await a.next('action');
  assert.equal((await i.request({ ...message, action: { type: 'interact', axis: { x: 0, z: 0 }, pose: { x: 0, z: 0, yaw: 0 } } })).code, 'REQUEST_CONFLICT');
  await a.request({ type: 'pause', paused: true });
  await m.next('pause');
  assert.equal((await i.request({ type: 'action', action: { type: 'repair-complete' } })).code, 'GAME_PAUSED');
  await i.request({ type: 'move', x: 5, z: 5, yaw: 0 });
  await a.request({ type: 'list-rooms' }); // Round-trip fence after all preceding messages.
  assert.equal(a.events.filter(event => event.type === 'action').length, 1);
  assert.equal(a.events.filter(event => event.type === 'move').length, 1);
  assert.equal(other.events.filter(event => ['move', 'action'].includes(event.type)).length, 0);
  await m.request({ type: 'pause', paused: false });
  await i.request({ type: 'move', x: 5, z: 5, yaw: 0 });
  assert.equal((await a.next(message => message.type === 'move' && message.role === 'infraestrutura')).x, 5);
});

test('Saída: transfere anfitriã no lobby e encerra sessão iniciada sem reabrir estado parcial', async t => {
  const f = await fixture(t), a = await f.connect(), m = await f.connect();
  await create(a); const code = (await a.next('joined')).code;
  await join(m, code, 'mobilidade');
  await a.request({ type: 'leave' });
  const promoted = await m.next(event => event.type === 'room' && event.players.length === 1);
  assert.equal(promoted.players[0].host, true);
  await m.request({ type: 'leave' });
  assert.equal((await (await fetch(f.http + '/health')).json()).rooms, 0);
  const started = await team(f);
  await started.i.request({ type: 'leave' });
  assert.equal((await started.a.next('session-ended')).code, 'PLAYER_LEFT');
  assert.equal((await started.m.request({ type: 'ready', ready: true })).code, 'NOT_IN_ROOM');
  assert.equal((await join(m, started.code, 'infraestrutura')).code, 'ROOM_NOT_FOUND');
});

test('Transporte: fragmentos válidos, máscara obrigatória, limite de payload e binário rejeitado', async t => {
  const f = await fixture(t, { maxPayload: 1024 });
  const a = await f.connect();
  a.ws.send('{"type":"list-', { fin: false });
  a.ws.send('rooms","requestId":"fragment"}', { fin: true });
  assert.equal((await a.next(event => event.requestId === 'fragment')).type, 'ack');
  const large = await f.connect(); const largeClosed = once(large.ws, 'close');
  large.ws.send('x'.repeat(1025));
  assert.equal((await largeClosed)[0], 1009);
  const binary = await f.connect(); const binaryClosed = once(binary.ws, 'close');
  binary.ws.send(Buffer.from([1, 2]));
  assert.equal((await binaryClosed)[0], 1003);
  const unmasked = await f.connect(); const unmaskedClosed = once(unmasked.ws, 'close');
  unmasked.ws.send('{}', { mask: false });
  assert.equal((await unmaskedClosed)[0], 1002);
});

test('Proteção: origem não autorizada, limites de conexão e frequência', async t => {
  const f = await fixture(t, { maxPerIp: 3 });
  const bad = new WebSocket(f.url, { origin: 'https://outro-site.example' });
  const [error] = await once(bad, 'error');
  assert.match(error.message, /403/);
  for (let n = 0; n < 3; n++) await f.connect({ origin: f.http });
  const excess = new WebSocket(f.url); const [capacity] = await once(excess, 'error');
  assert.match(capacity.message, /429/);
  const limited = await fixture(t, { burst: 2, rate: 0 });
  const peer = await limited.connect();
  await peer.request({ type: 'list-rooms' }); await peer.request({ type: 'list-rooms' });
  const closed = once(peer.ws, 'close'); peer.ws.send('{"type":"list-rooms"}');
  assert.equal((await closed)[0], 1008);
});

test('Heartbeat libera conexões sem pong; configuração de produção exige origem explícita', async t => {
  const f = await fixture(t, { heartbeatMs: 25 });
  const peer = await f.connect({ autoPong: false });
  const closed = once(peer.ws, 'close'); await closed;
  assert.equal((await (await fetch(f.http + '/health')).json()).connections, 0);
  const { readConfig } = await import('../backend/server.mjs');
  assert.throws(() => readConfig({ NODE_ENV: 'production' }), /COOP_ALLOWED_ORIGINS/);
  assert.throws(() => readConfig({ COOP_PORT: 'NaN' }), /COOP_PORT/);
  assert.throws(() => readConfig({ COOP_ALLOWED_ORIGINS: 'https://example.com/path' }), /origens/);
  assert.deepEqual(readConfig({ NODE_ENV: 'production', COOP_ALLOWED_ORIGINS: 'https://example.com' }).origins, ['https://example.com']);
});
