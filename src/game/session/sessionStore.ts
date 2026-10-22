import type { GameSession, SessionEvent, SessionSnapshot } from './GameSession';

export type SessionView = {
  snapshot: SessionSnapshot | null;
  /** Último evento que merece aviso na tela. `seq` muda a cada novo aviso. */
  feedback: { seq: number; event: SessionEvent } | null;
};

/** Pontuação mínima para 1, 2 e 3 estrelas. Ajuste ao balanceamento da fase. */
export const STAR_THRESHOLDS = [100, 350, 600] as const;

export function starsFor(score: number): number {
  return STAR_THRESHOLDS.filter(minimum => score >= minimum).length;
}

const EMPTY: SessionView = { snapshot: null, feedback: null };
const PRIORITY: Partial<Record<SessionEvent['type'], number>> = {
  'order-completed': 3,
  'order-expired': 2,
  'order-arrived': 1,
};

type Listener = () => void;

/**
 * Ponte entre a cena (que avança o relógio) e o HUD React.
 * O React só é avisado quando algo muda de verdade: evento da partida
 * ou virada de segundo no cronômetro (no máximo 1 vez por segundo).
 */
class SessionStore {
  private session: GameSession | null = null;
  private view: SessionView = EMPTY;
  private readonly listeners = new Set<Listener>();
  private lastSecond = -1;
  private seq = 0;
  private onRestart?: () => void;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): SessionView => this.view;
  readonly getServerSnapshot = (): SessionView => EMPTY;

  bind(session: GameSession, onRestart?: () => void): void {
    this.session = session;
    this.onRestart = onRestart;
    this.view = EMPTY;
    this.lastSecond = -1;
    this.publish(session.snapshot(), []);
  }

  /** Só desfaz se for a mesma sessão, para o dispose de uma cena velha não apagar a nova. */
  unbind(session: GameSession): void {
    if (this.session !== session) return;
    this.session = null;
    this.onRestart = undefined;
    this.view = EMPTY;
    this.emit();
  }

  start(): void {
    if (!this.session) return;
    this.lastSecond = -1;
    this.publish(this.session.snapshot(), this.session.start());
  }

  restart(): void {
    if (this.session?.snapshot().status !== 'finished') return;
    if (this.onRestart) this.onRestart();
    else this.start();
  }

  setPaused(paused: boolean): void {
    if (!this.session) return;
    this.publish(this.session.snapshot(), paused ? this.session.pause() : this.session.resume());
  }

  resolveStep(step: number): void {
    const session = this.session;
    const order = session?.snapshot().orders[0];
    if (!session || !order) return;
    const events = session.resolveRisk(order.id, step);
    if (!events.length) return;
    if (events.some(event => event.type === 'order-completed')) events.push(...session.finish());
    this.publish(session.snapshot(), events);
  }

  resolveEvent(definitionId: string, step: number): void {
    const session = this.session;
    const order = session?.snapshot().orders.find(item => item.definitionId === definitionId);
    if (!session || !order) return;
    const events = session.resolveRisk(order.id, step);
    if (events.length) this.publish(session.snapshot(), events);
  }

  /** Chame uma vez por frame com o tempo real decorrido, em ms (sem o teto da física). */
  tick(deltaMs: number): void {
    const session = this.session;
    if (!session || deltaMs <= 0) return;
    const events = session.advance(deltaMs);
    const snapshot = session.snapshot();
    const second = Math.ceil(snapshot.remainingMs / 1000);
    if (events.length === 0 && second === this.lastSecond) return;
    this.lastSecond = second;
    this.publish(snapshot, events);
  }

  /** Só para teste: conclui o próximo passo do primeiro pedido. */
  debugResolveNext(): void {
    const session = this.session;
    const order = session?.snapshot().orders[0];
    if (!session || !order) return;
    this.publish(session.snapshot(), session.resolveRisk(order.id, order.nextRiskId));
  }

  private publish(snapshot: SessionSnapshot, events: SessionEvent[]): void {
    let best: SessionEvent | null = null;
    for (const event of events) {
      const priority = PRIORITY[event.type] ?? 0;
      if (priority > 0 && (!best || priority >= (PRIORITY[best.type] ?? 0))) best = event;
    }
    // Se algum evento mudou o placar, o snapshot do final do chamador pode estar velho.
    const fresh = this.session?.snapshot() ?? snapshot;
    this.view = {
      snapshot: fresh,
      feedback: best ? { seq: ++this.seq, event: best } : this.view.feedback,
    };
    this.emit();
  }

  private emit(): void { this.listeners.forEach(listener => listener()); }
}

export const sessionStore = new SessionStore();

