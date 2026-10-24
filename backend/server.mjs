import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { ProtocolError, reject, ROLES, validateMessage, authorizeAction } from './protocol.mjs';

export function readConfig(env = process.env) {
  const integer = (key, fallback, min, max) => {
    const value = env[key] === undefined ? fallback : Number(env[key]);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('Configuração inválida: ' + key);
    return value;
  };
  const origins = (env.COOP_ALLOWED_ORIGINS || '').split(',').map(item => item.trim()).filter(Boolean);
  for (const origin of origins) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('COOP_ALLOWED_ORIGINS deve conter origens HTTP(S) completas.');
  }
  const production = env.NODE_ENV === 'production';
  if (production && !origins.length) throw new Error('Defina COOP_ALLOWED_ORIGINS em produção.');
  return {
    host: env.COOP_HOST || '0.0.0.0', port: integer('COOP_PORT', 3001, 1, 65535),
    maxPeers: integer('COOP_MAX_CONNECTIONS', 256, 3, 10000),
    maxRooms: integer('COOP_MAX_ROOMS', 128, 1, 2000),
    maxPerIp: integer('COOP_MAX_CONNECTIONS_PER_IP', 32, 3, 1000),
    origins, production,
  };
}

export function createCoopServer(options = {}) {
  const config = {
    host: '127.0.0.1', port: 0, maxPeers: 256, maxRooms: 128, maxPerIp: 32,
    origins: [], production: false, maxPayload: 16 * 1024, maxBuffered: 512 * 1024,
    heartbeatMs: 30000, idleMs: 300000, rate: 120, burst: 240,
    startDelayMs: 1400, tutorialDelayMs: 500, logger: console, ...options,
  };
  const rooms = new Map();
  const peers = new Set();
  const attempts = new Map();
  let closing = false;
  let directoryTimer;
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxPayload, perMessageDeflate: false });

  function send(peer, message) {
    if (peer.ws.readyState !== WebSocket.OPEN) return;
    if (peer.ws.bufferedAmount > config.maxBuffered) { peer.ws.terminate(); return; }
    peer.ws.send(JSON.stringify(message), error => { if (error) peer.ws.terminate(); });
  }
  function broadcast(room, message, except) {
    for (const peer of room.players.values()) if (peer !== except) send(peer, message);
  }
  const roster = room => [...room.players.values()].map(peer => ({
    id: peer.id, name: peer.name, role: peer.role, ready: peer.ready,
    tutorialReady: peer.tutorialReady, host: peer === room.host,
  }));
  function publishRoom(room) {
    broadcast(room, { type: 'room', code: room.code, phase: room.phase, isPublic: room.isPublic, paused: room.paused, players: roster(room) });
  }
  function directory() {
    return [...rooms.values()].filter(room => room.isPublic && room.phase === 'lobby' && room.players.size < 3)
      .map(room => ({ code: room.code, phase: room.phase, players: roster(room) }));
  }
  function publishDirectory() {
    if (directoryTimer || closing) return;
    directoryTimer = setTimeout(() => {
      directoryTimer = undefined;
      const message = { type: 'rooms', rooms: directory() };
      for (const peer of peers) if (peer.subscribed && !peer.room) send(peer, message);
    }, 50);
    directoryTimer.unref();
  }
  function detach(peer) {
    const room = peer.room;
    peer.room = null;
    if (!room) return;
    room.players.delete(peer.id);
    if (!room.players.size) rooms.delete(room.code);
    else if (room.phase !== 'lobby') {
      // No complete authoritative snapshot exists to resume or replace a player safely.
      rooms.delete(room.code);
      for (const member of room.players.values()) {
        member.room = null;
        send(member, { type: 'session-ended', code: 'PLAYER_LEFT', message: peer.name + ' saiu. A partida foi encerrada; reúna a equipe em uma nova sala.' });
      }
      room.players.clear();
    } else {
      if (room.host === peer) room.host = room.players.values().next().value;
      publishRoom(room);
    }
    publishDirectory();
  }
  function remove(peer) {
    if (!peers.delete(peer)) return;
    detach(peer);
  }
  function addPlayer(peer, room, message) {
    if (room.phase !== 'lobby') reject('GAME_STARTED', 'A partida desta sala já começou.');
    if (room.players.size >= 3) reject('ROOM_FULL', 'A sala já tem três pessoas.');
    if ([...room.players.values()].some(player => player.role === message.role)) reject('ROLE_TAKEN', 'Esse papel já está ocupado. Escolha outra personagem.');
    Object.assign(peer, { room, name: message.name, role: message.role, ready: false, tutorialReady: false, introDone: false });
    room.players.set(peer.id, peer);
    if (!room.host) room.host = peer;
    send(peer, { type: 'joined', id: peer.id, role: peer.role, code: room.code, host: room.host === peer });
    publishRoom(room);
    publishDirectory();
  }
  function requirePhase(room, ...phases) {
    if (!phases.includes(room.phase)) reject('INVALID_PHASE', 'Essa ação não está disponível nesta etapa da partida.');
  }
  function advanceTutorial(room) {
    if (room.players.size !== 3 || ![...room.players.values()].every(player => player.introDone)) return;
    room.phase = 'tutorial';
    if ([...room.players.values()].every(player => player.tutorialReady)) {
      room.phase = 'playing';
      room.startAt = Date.now() + config.tutorialDelayMs;
      broadcast(room, { type: 'tutorial-start', startDelayMs: config.tutorialDelayMs });
    }
  }
  function dispatch(peer, message) {
    if (message.type === 'list-rooms') {
      peer.subscribed = true;
      send(peer, { type: 'rooms', rooms: directory() }); return;
    }
    if (message.type === 'leave') {
      detach(peer); send(peer, { type: 'left' }); return;
    }
    if (['create-room', 'join', 'join-open'].includes(message.type)) {
      if (peer.room) reject('ALREADY_JOINED', 'Você já está em uma sala.');
      if (message.type === 'create-room') {
        if (rooms.size >= config.maxRooms) reject('SERVER_FULL', 'O servidor atingiu o limite de salas. Tente novamente mais tarde.');
        let code;
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        do { code = [...randomBytes(8)].map(byte => alphabet[byte % alphabet.length]).join(''); } while (rooms.has(code));
        const room = { code, phase: 'lobby', isPublic: message.isPublic, paused: false, startAt: 0, players: new Map(), host: null };
        rooms.set(code, room);
        addPlayer(peer, room, message); return;
      }
      const room = rooms.get(message.code);
      if (!room || (message.type === 'join-open' && !room.isPublic)) reject('ROOM_NOT_FOUND', 'Sala indisponível. Confira o código ou atualize a lista.');
      addPlayer(peer, room, message); return;
    }
    const room = peer.room;
    if (!room || room.players.get(peer.id) !== peer) reject('NOT_IN_ROOM', 'Entre em uma sala antes de enviar ações.');
    switch (message.type) {
      case 'ready':
        requirePhase(room, 'lobby'); peer.ready = message.ready; publishRoom(room); return;
      case 'set-public':
        if (peer !== room.host) reject('FORBIDDEN', 'Somente a anfitriã pode alterar a visibilidade.');
        requirePhase(room, 'lobby'); room.isPublic = message.isPublic;
        publishRoom(room); publishDirectory(); return;
      case 'start':
        if (peer !== room.host) reject('FORBIDDEN', 'Somente a anfitriã pode iniciar a partida.');
        requirePhase(room, 'lobby');
        if (room.players.size !== 3 || new Set(roster(room).map(player => player.role)).size !== ROLES.length) reject('TEAM_INCOMPLETE', 'Reúna Analista, Mobilidade e Infraestrutura para iniciar.');
        if (roster(room).some(player => !player.ready)) reject('TEAM_NOT_READY', 'Todas precisam marcar “Pronta”.');
        for (const member of room.players.values()) { member.introDone = false; member.tutorialReady = false; }
        room.phase = 'story';
        broadcast(room, { type: 'game-start', room: room.code, startDelayMs: config.startDelayMs, players: roster(room) });
        publishRoom(room); publishDirectory(); return;
      case 'tutorial-open':
        requirePhase(room, 'story', 'tutorial'); peer.introDone = true; advanceTutorial(room); publishRoom(room); return;
      case 'tutorial-ready':
        requirePhase(room, 'story', 'tutorial');
        if (!peer.introDone) reject('INTRO_REQUIRED', 'Conclua o prólogo antes de confirmar o tutorial.');
        peer.tutorialReady = message.ready; advanceTutorial(room); publishRoom(room); return;
      case 'pause':
        requirePhase(room, 'playing');
        if (room.paused !== message.paused) {
          room.paused = message.paused;
          broadcast(room, { type: 'pause', paused: room.paused, by: peer.name });
          publishRoom(room);
        }
        return;
      case 'move':
      case 'action':
        requirePhase(room, 'playing');
        if (message.type === 'action') authorizeAction(peer.role, message.action);
        if (room.paused || Date.now() < room.startAt) {
          if (message.type === 'action') reject('GAME_PAUSED', 'A partida ainda não está liberada para essa ação.');
          return; // Transient movement frames can safely be discarded across pause/start.
        }
        if (message.type === 'move') broadcast(room, { type: 'move', id: peer.id, role: peer.role, x: message.x, z: message.z, yaw: message.yaw }, peer);
        else broadcast(room, { type: 'action', id: peer.id, role: peer.role, action: message.action }, peer);
        return;
    }
  }
  function receive(peer, data, binary) {
    const now = Date.now();
    peer.tokens = Math.min(config.burst, peer.tokens + (now - peer.tokenAt) * config.rate / 1000);
    peer.tokenAt = now; peer.lastMessage = now;
    if (peer.tokens < 1) { send(peer, { type: 'error', code: 'RATE_LIMITED', message: 'Muitas mensagens. Reconecte à sala.' }); peer.ws.close(1008, 'Rate limit'); return; }
    peer.tokens--;
    // Gameplay sends poses frequently; lobby/control operations have a separate, smaller budget.
    // The total bucket above also covers malformed JSON and unknown commands.
    if (binary) { peer.ws.close(1003, 'Text JSON required'); return; }
    let raw;
    try { raw = JSON.parse(data.toString('utf8')); }
    catch { send(peer, { type: 'error', code: 'INVALID_JSON', message: 'Mensagem JSON inválida.' }); return; }
    let message;
    let result;
    const requestId = typeof raw?.requestId === 'string' && raw.requestId.length <= 64 ? raw.requestId : undefined;
    try {
      message = validateMessage(raw);
      if (!['move', 'action'].includes(message.type)) {
        peer.controlTokens = Math.min(30, peer.controlTokens + (now - peer.controlAt) * 5 / 1000);
        peer.controlAt = now;
        if (peer.controlTokens < 1) reject('RATE_LIMITED', 'Aguarde um momento antes de enviar outro comando.');
        peer.controlTokens--;
      }
      const previous = requestId && peer.requests.get(requestId);
      if (previous) {
        if (previous.body !== JSON.stringify(message)) reject('REQUEST_CONFLICT', 'Identificador de comando já utilizado.');
        send(peer, previous.result); return;
      }
      dispatch(peer, message);
      result = { type: 'ack', requestId };
    } catch (error) {
      if (!(error instanceof ProtocolError)) config.logger.error('Falha interna no comando coop', error);
      result = { type: 'error', code: error instanceof ProtocolError ? error.code : 'INTERNAL_ERROR',
        message: error instanceof ProtocolError ? error.message : 'Falha interna no servidor. Tente novamente.', ...(requestId ? { requestId } : {}) };
    }
    if (requestId || result.type === 'error') send(peer, result);
    if (requestId && message && !peer.requests.has(requestId)) {
      peer.requests.set(requestId, { body: JSON.stringify(message), result });
      if (peer.requests.size > 128) peer.requests.delete(peer.requests.keys().next().value);
    }
  }
  const json = (response, status, data, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers });
    response.end(JSON.stringify(data));
  };
  const server = createServer((request, response) => {
    let path;
    try { path = new URL(request.url, 'http://localhost').pathname; }
    catch { json(response, 400, { error: { code: 'BAD_REQUEST', message: 'URL inválida.' } }); return; }
    if (path !== '/health' && path !== '/coop') { json(response, 404, { error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }); return; }
    if (!['GET', 'HEAD'].includes(request.method)) { json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' } }, { Allow: 'GET, HEAD' }); return; }
    if (path === '/coop') { json(response, 426, { error: { code: 'UPGRADE_REQUIRED', message: 'Use WebSocket em /coop.' } }, { Upgrade: 'websocket' }); return; }
    json(response, closing ? 503 : 200, { ok: !closing, rooms: rooms.size, players: [...peers].filter(peer => peer.room).length, connections: peers.size });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    const deny = (status, reason) => socket.end('HTTP/1.1 ' + status + ' ' + reason + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    if (closing) { deny(503, 'Service Unavailable'); return; }
    if (request.url !== '/coop') { deny(404, 'Not Found'); return; }
    const origin = request.headers.origin;
    let originAllowed = !origin && !config.production;
    if (origin) {
      try {
        const parsed = new URL(origin);
        originAllowed = config.origins.length ? config.origins.includes(origin)
          : !config.production && ['http:', 'https:'].includes(parsed.protocol) && parsed.hostname === new URL('http://' + request.headers.host).hostname;
      } catch { originAllowed = false; }
    }
    if (!originAllowed) { deny(403, 'Forbidden'); return; }
    const ip = request.socket.remoteAddress;
    const now = Date.now();
    let attempt = attempts.get(ip);
    if (!attempt && attempts.size >= 10000) { deny(503, 'Service Unavailable'); return; }
    if (!attempt || now - attempt.since >= 60000) { attempt = { since: now, count: 0 }; attempts.set(ip, attempt); }
    attempt.count++;
    if (attempt.count > 60 || [...peers].filter(peer => peer.ip === ip).length >= config.maxPerIp) { deny(429, 'Too Many Requests'); return; }
    if (peers.size >= config.maxPeers) { deny(503, 'Service Unavailable'); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      const peer = { ws, ip, id: randomUUID(), room: null, subscribed: false, alive: true, lastMessage: now, tokenAt: now, tokens: config.burst, controlAt: now, controlTokens: 30, requests: new Map() };
      peers.add(peer);
      ws.on('pong', () => { peer.alive = true; });
      ws.on('message', (data, binary) => receive(peer, data, binary));
      ws.on('close', () => remove(peer));
      ws.on('error', () => { remove(peer); ws.terminate(); });
    });
  });
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const [ip, attempt] of attempts) if (now - attempt.since >= 60000) attempts.delete(ip);
    for (const peer of peers) {
      if (!peer.alive || (!peer.room && now - peer.lastMessage > config.idleMs)) { peer.ws.terminate(); continue; }
      peer.alive = false; peer.ws.ping();
    }
  }, config.heartbeatMs);
  heartbeat.unref();
  return {
    server,
    listen: () => new Promise((resolve, rejectListen) => {
      const onError = error => { server.off('listening', onListening); rejectListen(error); };
      const onListening = () => { server.off('error', onError); resolve(server.address()); };
      server.once('error', onError); server.once('listening', onListening); server.listen(config.port, config.host);
    }),
    close: async () => {
      closing = true; clearInterval(heartbeat); clearTimeout(directoryTimer);
      for (const peer of peers) { send(peer, { type: 'session-ended', code: 'SERVER_SHUTDOWN', message: 'O servidor foi encerrado.' }); peer.ws.terminate(); }
      await Promise.all([new Promise(resolve => wss.close(resolve)), new Promise(resolve => server.close(resolve))]);
      rooms.clear(); peers.clear(); attempts.clear();
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const app = createCoopServer(readConfig());
    await app.listen();
    console.log('SUBURBAN coop server listening on', app.server.address());
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
  } catch (error) {
    console.error('Falha ao iniciar o servidor coop:', error.message);
    process.exitCode = 1;
  }
}
