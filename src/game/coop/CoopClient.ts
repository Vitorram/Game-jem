export type CoopRole = 'analista' | 'mobilidade' | 'infraestrutura';
/** 'trio': cada papel com uma pessoa. 'duo': Mobilidade + Infraestrutura dividem o tablet da Analista. */
export type CoopTeamMode = 'trio' | 'duo';
export type CoopPlayer = { id: string; name: string; role: CoopRole; ready: boolean; tutorialReady: boolean; host: boolean };
export type CoopRoom = {
  code: string; phase: 'lobby' | 'story' | 'tutorial' | 'playing'; isPublic: boolean; paused: boolean; players: CoopPlayer[];
  mode?: CoopTeamMode | null; sharedAnalyst?: boolean;
};
export type CoopRoomListing = Pick<CoopRoom, 'code' | 'phase' | 'players' | 'mode'>;
export type CoopAction =
  | { type: 'interact'; axis: { x: number; z: number }; pose: { x: number; z: number; yaw: number } }
  | { type: 'analyze'; problemId: string }
  | { type: 'dispatch'; team: 'infraestrutura' | 'mobilidade'; problemId?: string }
  | { type: 'archive'; problemId: string }
  | { type: 'call-tow'; problemId: string }
  | { type: 'mobility-hotkey'; key: string; pose: { x: number; z: number; yaw: number } }
  | { type: 'repair-complete' }
  | { type: 'problem-select'; problemId: string | null };
export type CoopConnectionState = 'connecting' | 'connected' | 'disconnected';
export type CoopMessage =
  | { type: 'open' }
  | { type: 'connection'; state: CoopConnectionState; message?: string }
  | { type: 'ack'; requestId: string }
  | { type: 'left' }
  | { type: 'session-ended'; code: string; message: string }
  | { type: 'joined'; id: string; role: CoopRole; code: string; host: boolean }
  | ({ type: 'room' } & CoopRoom)
  | { type: 'rooms'; rooms: CoopRoomListing[] }
  | { type: 'game-start'; room: string; startDelayMs: number; players: CoopPlayer[]; mode?: CoopTeamMode; sharedAnalyst?: boolean }
  | { type: 'tutorial-start'; startDelayMs: number }
  | { type: 'move'; id: string; role: CoopRole; x: number; z: number; yaw: number }
  | { type: 'action'; id: string; role: CoopRole; action: CoopAction }
  | { type: 'pause'; paused: boolean; by: string }
  | { type: 'peer-left'; id: string; name: string }
  | { type: 'error'; code: string; message: string; requestId?: string };

type Listener = (message: CoopMessage) => void;
export class CoopError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'CoopError'; }
}
type Pending = { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const roles = ['analista', 'mobilidade', 'infraestrutura'];
const phases = ['lobby', 'story', 'tutorial', 'playing'];
export const COOP_MIN_PLAYERS = 2;
export const COOP_MAX_PLAYERS = roles.length;
export const COOP_DUO_ROLES: readonly CoopRole[] = ['mobilidade', 'infraestrutura'];
/** Mesma regra do servidor (backend/protocol.mjs): o lobby só a usa para orientar, quem decide é o servidor. */
export function coopTeamMode(members: readonly Pick<CoopPlayer, 'role'>[]): CoopTeamMode | null {
  const unique = new Set(members.map(member => member.role));
  if (unique.size !== members.length) return null;
  if (members.length === COOP_MAX_PLAYERS && roles.every(role => unique.has(role as CoopRole))) return 'trio';
  if (members.length === COOP_MIN_PLAYERS && COOP_DUO_ROLES.every(role => unique.has(role))) return 'duo';
  return null;
}
const validMode = (value: unknown) => value === undefined || value === null || value === 'trio' || value === 'duo';
const optionalBoolean = (value: unknown) => value === undefined || typeof value === 'boolean';
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const validRole = (value: unknown) => typeof value === 'string' && roles.includes(value);
const validPose = (value: unknown) => record(value) && ['x', 'z', 'yaw'].every(key => Number.isFinite(value[key]));
const players = (value: unknown): boolean => Array.isArray(value) && value.length <= 3 && value.every(player =>
  record(player) && string(player.id) && string(player.name) && validRole(player.role)
  && ['ready', 'tutorialReady', 'host'].every(key => typeof player[key] === 'boolean'))
  && new Set(value.map(player => player.id)).size === value.length
  && new Set(value.map(player => player.role)).size === value.length;
const listing = (value: unknown) => record(value) && string(value.code) && typeof value.phase === 'string' && phases.includes(value.phase) && players(value.players) && validMode(value.mode);
function validAction(value: unknown): boolean {
  if (!record(value)) return false;
  switch (value.type) {
    case 'interact': return validPose(value.pose) && record(value.axis) && Number.isFinite(value.axis.x) && Number.isFinite(value.axis.z);
    case 'mobility-hotkey': return validPose(value.pose) && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(String(value.key));
    case 'dispatch': return ['mobilidade', 'infraestrutura'].includes(String(value.team)) && (value.problemId === undefined || string(value.problemId));
    case 'repair-complete': return true;
    case 'analyze': case 'archive': case 'call-tow': return string(value.problemId);
    case 'problem-select': return value.problemId === null || string(value.problemId);
    default: return false;
  }
}
function isServerMessage(value: unknown): value is CoopMessage {
  if (!record(value)) return false;
  switch (value.type) {
    case 'ack': return string(value.requestId);
    case 'left': return true;
    case 'error': return string(value.code) && string(value.message) && (value.requestId === undefined || string(value.requestId));
    case 'session-ended': return string(value.code) && string(value.message);
    case 'joined': return string(value.id) && validRole(value.role) && string(value.code) && typeof value.host === 'boolean';
    case 'room': return listing(value) && typeof value.isPublic === 'boolean' && typeof value.paused === 'boolean' && optionalBoolean(value.sharedAnalyst);
    case 'rooms': return Array.isArray(value.rooms) && value.rooms.every(listing);
    case 'game-start': return string(value.room) && players(value.players) && typeof value.startDelayMs === 'number' && value.startDelayMs >= 0 && value.startDelayMs <= 10000
      && validMode(value.mode) && optionalBoolean(value.sharedAnalyst);
    case 'tutorial-start': return typeof value.startDelayMs === 'number' && value.startDelayMs >= 0 && value.startDelayMs <= 10000;
    case 'move': return string(value.id) && validRole(value.role) && validPose(value);
    case 'action': return string(value.id) && validRole(value.role) && validAction(value.action);
    case 'pause': return typeof value.paused === 'boolean' && string(value.by);
    case 'peer-left': return string(value.id) && string(value.name);
    default: return false;
  }
}
function defaultUrl(): string {
  if (process.env.NEXT_PUBLIC_COOP_SERVER_URL) return process.env.NEXT_PUBLIC_COOP_SERVER_URL;
  if (typeof window === 'undefined') return 'ws://localhost:3001/coop';
  const url = new URL(window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (url.protocol === 'ws:') url.port = '3001';
  url.pathname = '/coop'; url.search = ''; url.hash = '';
  return url.href;
}

export class CoopClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<void> | null = null;
  private cancelConnect: ((error: Error) => void) | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<string, Pending>();
  private sequence = 0;
  private identity: { id: string; code: string; role: CoopRole } | null = null;
  private room: CoopRoom | null = null;
  private connectionState: CoopConnectionState = 'disconnected';
  constructor(readonly url = defaultUrl(), private readonly timeoutMs = 8000) {}
  get state(): CoopConnectionState { return this.connectionState; }
  get currentRoom(): CoopRoom | null { return this.room; }
  hasSession(id: string, code: string): boolean {
    return this.connectionState === 'connected' && this.identity?.id === id && this.identity.code === code && !!this.room;
  }
  private changeState(state: CoopConnectionState, message?: string): void {
    this.connectionState = state; this.emit({ type: 'connection', state, message });
  }
  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;
    let socket: WebSocket;
    try {
      const parsed = new URL(this.url);
      if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      socket = new WebSocket(this.url);
    } catch { return Promise.reject(new Error('Endereço do servidor coop inválido.')); }
    this.socket = socket;
    this.changeState('connecting');
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => this.disconnect('O servidor demorou para conectar. Tente novamente.'), this.timeoutMs);
      this.cancelConnect = error => { clearTimeout(timer); reject(error); };
      socket.addEventListener('open', () => {
        if (this.socket !== socket) return;
        clearTimeout(timer); this.cancelConnect = null; this.connecting = null;
        this.changeState('connected'); this.emit({ type: 'open' }); resolve();
      }, { once: true });
      socket.addEventListener('message', event => {
        if (this.socket !== socket) return;
        let message: unknown;
        try { message = JSON.parse(String(event.data)); }
        catch { this.disconnect('Resposta inválida do servidor coop.'); return; }
        if (!isServerMessage(message)) { this.disconnect('Protocolo incompatível. Atualize o jogo e o servidor coop.'); return; }
        if (message.type === 'joined') this.identity = { id: message.id, code: message.code, role: message.role };
        if (message.type === 'room') this.room = message;
        if (message.type === 'left' || message.type === 'session-ended') { this.identity = null; this.room = null; }
        if (message.type === 'pause' && this.room) this.room = { ...this.room, paused: message.paused };
        if (message.type === 'ack' || message.type === 'error' && message.requestId) {
          const pending = this.pending.get(message.requestId!);
          if (pending) {
            clearTimeout(pending.timer); this.pending.delete(message.requestId!);
            if (message.type === 'ack') pending.resolve(); else pending.reject(new CoopError(message.code, message.message));
          }
          return;
        }
        this.emit(message);
      });
      socket.addEventListener('error', () => {
        if (this.socket === socket) this.disconnect('Não foi possível conectar ao servidor coop. Confira se ele está ligado.');
      }, { once: true });
      socket.addEventListener('close', () => {
        if (this.socket === socket) this.disconnect('Conexão perdida. Entre novamente na sala.');
      }, { once: true });
    });
    this.connecting = promise;
    return promise;
  }
  on(listener: Listener): void { this.listeners.add(listener); }
  off(listener: Listener): void { this.listeners.delete(listener); }
  private emit(message: CoopMessage): void { this.listeners.forEach(listener => listener(message)); }
  private request(message: Record<string, unknown>): Promise<void> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Conecte ao servidor antes de continuar.'));
    if (this.pending.size >= 64) return Promise.reject(new Error('Aguarde os comandos pendentes.'));
    const requestId = 'r' + ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.disconnect('O servidor não confirmou a operação. A conexão foi encerrada para evitar uma sessão inconsistente.'), this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      try { this.socket!.send(JSON.stringify({ ...message, requestId })); }
      catch { this.disconnect('Não foi possível enviar o comando. Entre novamente na sala.'); }
    });
  }
  createRoom(name: string, role: CoopRole, isPublic = true): Promise<void> { return this.request({ type: 'create-room', name, role, isPublic }); }
  join(code: string, name: string, role: CoopRole): Promise<void> { return this.request({ type: 'join', code, name, role }); }
  joinOpen(code: string, name: string, role: CoopRole): Promise<void> { return this.request({ type: 'join-open', code, name, role }); }
  requestRooms(): Promise<void> { return this.request({ type: 'list-rooms' }); }
  setPublic(isPublic: boolean): Promise<void> { return this.request({ type: 'set-public', isPublic }); }
  setRole(role: CoopRole): Promise<void> { return this.request({ type: 'set-role', role }); }
  ready(ready: boolean): Promise<void> { return this.request({ type: 'ready', ready }); }
  start(): Promise<void> { return this.request({ type: 'start' }); }
  leave(): Promise<void> { return this.request({ type: 'leave' }); }
  tutorialOpen(): Promise<void> { return this.request({ type: 'tutorial-open' }); }
  tutorialReady(ready: boolean): Promise<void> { return this.request({ type: 'tutorial-ready', ready }); }
  private gameplay(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN || this.room?.phase !== 'playing') return;
    if (this.room.paused && message.type !== 'pause') return;
    try { this.socket.send(JSON.stringify(message)); }
    catch { this.disconnect('Conexão perdida ao enviar uma ação.'); }
  }
  move(_role: CoopRole, x: number, z: number, yaw: number): void { this.gameplay({ type: 'move', x, z, yaw }); }
  action(action: CoopAction): void { this.gameplay({ type: 'action', action }); }
  pause(paused: boolean): void { this.gameplay({ type: 'pause', paused }); }
  disconnect(message?: string): void {
    const socket = this.socket;
    this.socket = null;
    const error = new Error(message || 'Conexão encerrada.');
    this.cancelConnect?.(error); this.cancelConnect = null; this.connecting = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear(); this.identity = null; this.room = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.changeState('disconnected', message);
  }
}
declare global { interface Window { __suburbanCoopClient?: CoopClient } }
export function getCoopClient(url?: string): CoopClient {
  if (typeof window === 'undefined') return new CoopClient(url);
  if (!window.__suburbanCoopClient || url && window.__suburbanCoopClient.url !== url) {
    window.__suburbanCoopClient?.disconnect();
    window.__suburbanCoopClient = new CoopClient(url);
  }
  return window.__suburbanCoopClient;
}
export const coopRoleToPlayerId = (role: CoopRole): 1 | 2 | 3 => role === 'infraestrutura' ? 1 : role === 'mobilidade' ? 2 : 3;
/** Ações executadas pela central de análise, não pela personagem de quem as enviou. */
export const COOP_ANALYST_ACTIONS: ReadonlySet<CoopAction['type']> = new Set(['analyze', 'dispatch', 'archive', 'call-tow', 'problem-select']);
export const coopHasAnalystAccess = (role: CoopRole, sharedAnalyst: boolean): boolean =>
  role === 'analista' || (sharedAnalyst && COOP_DUO_ROLES.includes(role));
