export type CoopRole = 'analista' | 'mobilidade' | 'infraestrutura';
export type CoopPlayer = { id: string; name: string; role: CoopRole; ready: boolean; tutorialReady: boolean; host: boolean };
export type CoopRoom = { code: string; phase: 'lobby' | 'story' | 'tutorial' | 'playing'; players: CoopPlayer[] };
export type CoopAction =
  | { type: 'interact'; axis: { x: number; z: number }; pose: { x: number; z: number; yaw: number } }
  | { type: 'analyze'; problemId: string }
  | { type: 'dispatch'; team: 'infraestrutura' | 'mobilidade' }
  | { type: 'archive'; problemId: string }
  | { type: 'mobility-hotkey'; key: string; pose: { x: number; z: number; yaw: number } }
  | { type: 'repair-complete' }
  | { type: 'problem-select'; problemId: string | null };

export type CoopMessage =
  | { type: 'open' }
  | { type: 'joined'; id: string; role: CoopRole; code: string; host: boolean }
  | ({ type: 'room' } & CoopRoom)
  | { type: 'game-start'; room: string; startDelayMs: number; players: CoopPlayer[] }
  | { type: 'tutorial-start'; startDelayMs: number }
  | { type: 'tutorial-open' }
  | { type: 'move'; id: string; role: CoopRole; x: number; z: number; yaw: number }
  | { type: 'action'; id: string; role: CoopRole; action: CoopAction }
  | { type: 'pause'; paused: boolean; by: string }
  | { type: 'peer-left'; id: string; name: string }
  | { type: 'error'; message: string };

type Listener = (message: CoopMessage) => void;
const DEFAULT_URL = process.env.NEXT_PUBLIC_COOP_SERVER_URL || 'ws://localhost:3001/coop';

export class CoopClient {
  private socket: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private queue: unknown[] = [];
  private closedIntentionally = false;

  constructor(readonly url = DEFAULT_URL) {}

  connect(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.socket?.readyState === WebSocket.CONNECTING) return Promise.resolve();
    this.closedIntentionally = false;
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      this.socket = socket;
      let settled = false;
      socket.addEventListener('open', () => {
        settled = true;
        for (const item of this.queue.splice(0)) socket.send(JSON.stringify(item));
        this.emit({ type: 'open' });
        resolve();
      }, { once: true });
      socket.addEventListener('message', event => {
        try { this.emit(JSON.parse(String(event.data)) as CoopMessage); } catch { /* ignora payload inválido */ }
      });
      socket.addEventListener('error', () => {
        if (!settled) reject(new Error(`Não consegui conectar ao servidor coop em ${this.url}.`));
      }, { once: true });
      socket.addEventListener('close', () => {
        if (!this.closedIntentionally) this.emit({ type: 'error', message: 'Conexão com o coop perdida.' });
      });
    });
  }

  on(listener: Listener): void { this.listeners.add(listener); }
  off(listener: Listener): void { this.listeners.delete(listener); }
  private emit(message: CoopMessage): void { this.listeners.forEach(listener => listener(message)); }

  send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    else if (!this.socket || this.socket.readyState === WebSocket.CONNECTING) this.queue.push(message);
  }

  join(code: string, name: string, role?: CoopRole): void { this.send({ type: 'join', code, name, role }); }
  ready(ready: boolean): void { this.send({ type: 'ready', ready }); }
  start(): void { this.send({ type: 'start' }); }
  tutorialOpen(): void { this.send({ type: 'tutorial-open' }); }
  tutorialReady(ready: boolean): void { this.send({ type: 'tutorial-ready', ready }); }
  move(role: CoopRole, x: number, z: number, yaw: number): void { this.send({ type: 'move', role, x, z, yaw }); }
  action(action: CoopAction): void { this.send({ type: 'action', action }); }
  pause(paused: boolean): void { this.send({ type: 'pause', paused }); }

  disconnect(): void {
    this.closedIntentionally = true;
    this.socket?.close(); this.socket = null;
    this.queue = [];
  }
}

declare global {
  interface Window { __suburbanCoopClient?: CoopClient }
}

export function getCoopClient(url?: string): CoopClient {
  if (typeof window === 'undefined') return new CoopClient(url);
  if (!window.__suburbanCoopClient) window.__suburbanCoopClient = new CoopClient(url);
  return window.__suburbanCoopClient;
}

export const coopRoleToPlayerId = (role: CoopRole): 1 | 2 | 3 => role === 'infraestrutura' ? 1 : role === 'mobilidade' ? 2 : 3;
