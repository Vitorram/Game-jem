import type { PlayerId } from '../entities/Player';
import type { ResponseTeam } from '../core/GameState';
import type { RepairPuzzleType } from '../session/repairPuzzleTypes';

export type CoopRole = PlayerId;
export type CoopPlayer = { id: string; name: string; role: CoopRole; ready: boolean };
export type CoopRoom = {
  code: string;
  hostId: string;
  status: 'lobby' | 'countdown' | 'running';
  startAt: number | null;
  players: CoopPlayer[];
  serverTime: number;
};
export type CoopAction =
  | { kind: 'interact' }
  | { kind: 'select-problem'; problemId: string }
  | { kind: 'analyze'; problemId: string }
  | { kind: 'dispatch'; problemId: string; team: ResponseTeam }
  | { kind: 'reinforce'; problemId: string }
  | { kind: 'archive'; problemId: string }
  | { kind: 'mobility'; key: 'Digit1' | 'Digit2' | 'Digit3' | 'Digit4' }
  | { kind: 'repair'; puzzle: RepairPuzzleType };
export type CoopPlayerState = { x: number; z: number; rotation: number };
export type CoopEvent =
  | { type: 'room'; room: CoopRoom }
  | { type: 'error'; message: string }
  | { type: 'player_state'; playerId: string; role: CoopRole; state: CoopPlayerState }
  | { type: 'action'; playerId: string; role: CoopRole; action: CoopAction }
  | { type: 'pause'; playerId: string; role: CoopRole; paused: boolean }
  | { type: 'start_game'; room: CoopRoom }
  | { type: 'closed' };

const randomId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class CoopClient {
  readonly playerId = randomId();
  private socket: WebSocket | null = null;
  private room: CoopRoom | null = null;
  private listeners = new Set<(event: CoopEvent) => void>();
  private pendingPings = new Map<number, number>();
  private serverOffsetMs = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledStartAt: number | null = null;
  private closedByUser = false;
  private readonly url: string;

  constructor(url: string) { this.url = url; }

  subscribe(listener: (event: CoopEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getRoom(): CoopRoom | null { return this.room; }
  getServerTime(): number { return Date.now() + this.serverOffsetMs; }

  async createRoom(name: string, role: CoopRole): Promise<void> {
    await this.connect();
    this.send({ type: 'create', playerId: this.playerId, name, role });
  }

  async joinRoom(code: string, name: string, role: CoopRole): Promise<void> {
    await this.connect();
    this.send({ type: 'join', playerId: this.playerId, code, name, role });
  }

  chooseRole(role: CoopRole): void { this.send({ type: 'choose_role', role }); }
  setReady(ready: boolean): void { this.send({ type: 'ready', ready }); }
  start(): void { this.send({ type: 'start' }); }

  sendPlayerState(state: CoopPlayerState): void {
    this.send({ type: 'player_state', state });
  }

  sendAction(action: CoopAction): void { this.send({ type: 'action', action }); }
  sendPause(paused: boolean): void { this.send({ type: 'pause', paused }); }

  leave(): void {
    this.closedByUser = true;
    this.clearTimers();
    if (this.socket?.readyState === WebSocket.OPEN) this.send({ type: 'leave' });
    this.socket?.close();
    this.socket = null;
    this.room = null;
  }

  private async connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.socket?.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve, reject) => {
        const socket = this.socket!;
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('Não foi possível conectar ao servidor coop.')), { once: true });
      });
      return;
    }
    this.closedByUser = false;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.ping();
        this.pingTimer = setInterval(() => this.ping(), 3000);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        const error = new Error(`Servidor coop indisponível em ${this.url}. Inicie backend/server.py e tente novamente.`);
        this.emit({ type: 'error', message: error.message });
        reject(error);
      }, { once: true });
      socket.addEventListener('message', event => this.handleMessage(event.data));
      socket.addEventListener('close', () => {
        this.clearTimers();
        this.socket = null;
        if (!this.closedByUser) this.emit({ type: 'closed' });
      });
    });
  }

  private ping(): void {
    const sentAt = Date.now();
    this.pendingPings.set(sentAt, sentAt);
    this.send({ type: 'ping', clientTime: sentAt });
    while (this.pendingPings.size > 8) this.pendingPings.delete(this.pendingPings.keys().next().value!);
  }

  private handleMessage(raw: string): void {
    let message: Record<string, unknown>;
    try { message = JSON.parse(raw) as Record<string, unknown>; }
    catch { return; }
    if (message.type === 'pong' && typeof message.clientTime === 'number' && typeof message.serverTime === 'number') {
      const receivedAt = Date.now();
      const sentAt = this.pendingPings.get(message.clientTime) ?? message.clientTime;
      this.pendingPings.delete(message.clientTime);
      this.serverOffsetMs = message.serverTime - (sentAt + receivedAt) / 2;
      return;
    }
    if (message.type === 'room' && message.room && typeof message.room === 'object') {
      this.room = message.room as CoopRoom;
      this.scheduleStart(this.room);
      this.emit({ type: 'room', room: this.room });
    } else if (message.type === 'error' && typeof message.message === 'string') {
      this.emit({ type: 'error', message: message.message });
    } else if (message.type === 'player_state' && typeof message.playerId === 'string'
      && typeof message.role === 'number' && message.state && typeof message.state === 'object') {
      this.emit({ type: 'player_state', playerId: message.playerId, role: message.role as CoopRole,
        state: message.state as CoopPlayerState });
    } else if (message.type === 'action' && typeof message.playerId === 'string'
      && typeof message.role === 'number' && message.action && typeof message.action === 'object') {
      this.emit({ type: 'action', playerId: message.playerId, role: message.role as CoopRole,
        action: message.action as CoopAction });
    } else if (message.type === 'pause' && typeof message.playerId === 'string'
      && typeof message.role === 'number' && typeof message.paused === 'boolean') {
      this.emit({ type: 'pause', playerId: message.playerId, role: message.role as CoopRole, paused: message.paused });
    }
  }

  private scheduleStart(room: CoopRoom): void {
    if ((room.status !== 'countdown' && room.status !== 'running') || room.startAt === null) {
      if (this.startTimer) clearTimeout(this.startTimer);
      this.startTimer = null;
      this.scheduledStartAt = null;
      return;
    }
    if (this.scheduledStartAt === room.startAt) return;
    if (this.startTimer) clearTimeout(this.startTimer);
    this.scheduledStartAt = room.startAt;
    const delay = Math.max(0, room.startAt - (Date.now() + this.serverOffsetMs));
    this.startTimer = setTimeout(() => {
      if ((this.room?.status === 'countdown' || this.room?.status === 'running') && this.room.startAt === room.startAt) {
        this.emit({ type: 'start_game', room: this.room });
      }
    }, delay);
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private emit(event: CoopEvent): void { this.listeners.forEach(listener => listener(event)); }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.startTimer) clearTimeout(this.startTimer);
    this.pingTimer = null;
    this.startTimer = null;
    this.scheduledStartAt = null;
  }
}

export function defaultCoopUrl(): string {
  if (process.env.NEXT_PUBLIC_COOP_WS_URL) return process.env.NEXT_PUBLIC_COOP_WS_URL;
  if (typeof window === 'undefined') return 'ws://localhost:8765';
  return `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8765`;
}
