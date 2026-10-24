import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.COOP_PORT || 3001);
const HOST = process.env.COOP_HOST || '0.0.0.0';
const ROLES = ['analista', 'mobilidade', 'infraestrutura'];
const rooms = new Map();
const peers = new Set();

function frame(text) {
  const payload = Buffer.from(text);
  const size = payload.length;
  const header = size < 126 ? Buffer.from([0x81, size])
    : size < 65536 ? Buffer.from([0x81, 126, size >> 8, size & 255])
      : Buffer.from([0x81, 127, 0, 0, 0, 0, size >>> 24, size >>> 16 & 255, size >>> 8 & 255, size & 255]);
  return Buffer.concat([header, payload]);
}

function send(peer, message) {
  if (!peer.closed && !peer.socket.destroyed) peer.socket.write(frame(JSON.stringify(message)));
}

function broadcast(room, message, except) {
  for (const peer of room.players.values()) if (peer !== except) send(peer, message);
}

function roomSnapshot(room) {
  return [...room.players.values()].map(peer => ({
    id: peer.id, name: peer.name, role: peer.role, ready: peer.ready,
    tutorialReady: peer.tutorialReady, host: peer === room.host,
  }));
}

function publishRoom(room) {
  broadcast(room, { type: 'room', code: room.code, phase: room.phase, players: roomSnapshot(room) });
}

function removePeer(peer) {
  if (peer.closed) return;
  peer.closed = true;
  peers.delete(peer);
  const room = peer.room;
  if (!room) return;
  room.players.delete(peer.id);
  if (room.players.size === 0) rooms.delete(room.code);
  else {
    if (room.host === peer) room.host = room.players.values().next().value;
    if (room.phase !== 'lobby') {
      broadcast(room, { type: 'peer-left', id: peer.id, name: peer.name });
      if (room.players.size < 2) room.phase = 'lobby';
    }
    publishRoom(room);
  }
}

function fail(peer, message) { send(peer, { type: 'error', message }); }

function receive(peer, message) {
  if (!message || typeof message.type !== 'string') return;
  if (message.type === 'join') {
    if (peer.room) return fail(peer, 'Você já está em uma sala.');
    const code = String(message.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || Math.random().toString(36).slice(2, 6).toUpperCase();
    const name = String(message.name || 'Jogadora').trim().slice(0, 24) || 'Jogadora';
    let room = rooms.get(code);
    if (!room) {
      room = { code, phase: 'lobby', players: new Map(), host: null };
      rooms.set(code, room);
    }
    if (room.phase !== 'lobby') return fail(peer, 'A partida desta sala já começou.');
    if (room.players.size >= 3) return fail(peer, 'A sala já tem 3 jogadoras.');
    const usedRoles = new Set([...room.players.values()].map(player => player.role));
    const requestedRole = ROLES.includes(message.role) && !usedRoles.has(message.role) ? message.role : null;
    const role = requestedRole || ROLES.find(candidate => !usedRoles.has(candidate));
    if (!role) return fail(peer, 'Os três papéis já foram ocupados.');
    peer.room = room;
    peer.id = Math.random().toString(36).slice(2, 10);
    peer.name = name;
    peer.role = role;
    peer.ready = false;
    peer.tutorialReady = false;
    room.players.set(peer.id, peer);
    if (!room.host) room.host = peer;
    send(peer, { type: 'joined', id: peer.id, role, code, host: room.host === peer });
    publishRoom(room);
    return;
  }
  const room = peer.room;
  if (!room) return fail(peer, 'Entre em uma sala antes de enviar ações.');
  if (message.type === 'ready') {
    if (room.phase !== 'lobby') return fail(peer, 'A sala já iniciou a partida.');
    peer.ready = Boolean(message.ready);
    peer.tutorialReady = false;
    publishRoom(room);
    return;
  }
  if (message.type === 'start') {
    if (peer !== room.host) return fail(peer, 'Somente a anfitriã pode iniciar a partida.');
    if (room.phase !== 'lobby') return fail(peer, 'A sala já iniciou a partida.');
    if (room.players.size < 3) return fail(peer, 'Para esta fase, é preciso reunir as três equipes: Analista, Mobilidade e Infraestrutura.');
    if ([...room.players.values()].some(player => !player.ready)) return fail(peer, 'Todas precisam marcar “Pronta”.');
    room.phase = 'story';
    broadcast(room, { type: 'game-start', room: room.code, startDelayMs: 1400, players: roomSnapshot(room) });
    publishRoom(room);
    return;
  }
  if (message.type === 'tutorial-ready') {
    if (room.phase !== 'tutorial') return;
    peer.tutorialReady = Boolean(message.ready);
    publishRoom(room);
    if ([...room.players.values()].every(player => player.tutorialReady)) {
      room.phase = 'playing';
      broadcast(room, { type: 'tutorial-start', startDelayMs: 500 });
      publishRoom(room);
    }
    return;
  }
  if (message.type === 'tutorial-open') {
    if (room.phase === 'story') {
      room.phase = 'tutorial';
      publishRoom(room);
    }
    return;
  }
  if (message.type === 'move') {
    if (room.phase !== 'playing' || !Number.isFinite(message.x) || !Number.isFinite(message.z) || !Number.isFinite(message.yaw)) return;
    broadcast(room, { type: 'move', id: peer.id, role: peer.role, x: message.x, z: message.z, yaw: message.yaw }, peer);
    return;
  }
  if (message.type === 'action') {
    if (room.phase !== 'playing' || !message.action || typeof message.action !== 'object') return;
    broadcast(room, { type: 'action', id: peer.id, role: peer.role, action: message.action }, peer);
    return;
  }
  if (message.type === 'pause') {
    broadcast(room, { type: 'pause', paused: Boolean(message.paused), by: peer.name }, peer);
  }
}

function parseFrames(peer, chunk) {
  peer.buffer = Buffer.concat([peer.buffer, chunk]);
  while (peer.buffer.length >= 2) {
    const first = peer.buffer[0];
    const opcode = first & 15;
    const masked = (peer.buffer[1] & 128) !== 0;
    let length = peer.buffer[1] & 127;
    let offset = 2;
    if (length === 126) {
      if (peer.buffer.length < 4) return;
      length = peer.buffer.readUInt16BE(2); offset = 4;
    } else if (length === 127) {
      if (peer.buffer.length < 10) return;
      const longLength = peer.buffer.readBigUInt64BE(2);
      if (longLength > 1024n * 1024n) return peer.socket.destroy();
      length = Number(longLength); offset = 10;
    }
    const maskBytes = masked ? 4 : 0;
    if (peer.buffer.length < offset + maskBytes + length) return;
    const mask = masked ? peer.buffer.subarray(offset, offset + 4) : null;
    offset += maskBytes;
    const payload = Buffer.from(peer.buffer.subarray(offset, offset + length));
    peer.buffer = peer.buffer.subarray(offset + length);
    if (mask) for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index & 3];
    if (opcode === 8) { peer.socket.end(Buffer.from([0x88, 0x00])); removePeer(peer); return; }
    if (opcode === 9) { peer.socket.write(Buffer.from([0x8a, 0x00])); continue; }
    if (opcode !== 1) continue;
    try { receive(peer, JSON.parse(payload.toString('utf8'))); }
    catch { fail(peer, 'Mensagem inválida.'); }
  }
}

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size, players: peers.size }));
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
  response.end('SUBURBAN coop server is running. WebSocket endpoint: /coop');
});

server.on('upgrade', (request, socket) => {
  const key = request.headers['sec-websocket-key'];
  if (request.url?.split('?')[0] !== '/coop' || typeof key !== 'string') return socket.destroy();
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  const peer = { socket, buffer: Buffer.alloc(0), closed: false, room: null };
  peers.add(peer);
  socket.on('data', chunk => parseFrames(peer, chunk));
  socket.on('close', () => removePeer(peer));
  socket.on('error', () => removePeer(peer));
});

server.listen(PORT, HOST, () => console.log(`SUBURBAN coop server listening on http://${HOST}:${PORT}`));
