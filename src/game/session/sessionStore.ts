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
  'xp-penalty': 2,
  'xp-warning': 2,
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
  private onOrderExpired?: (definitionId: string, continuePhase: boolean) => void;
  private onPauseForPenalty?: () => void;
  private readonly definitionsByOrderId = new Map<number, string>();

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  readonly getSnapshot = (): SessionView => this.view;
  readonly getServerSnapshot = (): SessionView => EMPTY;

  bind(
    session: GameSession,
    onRestart?: () => void,
    onOrderExpired?: (definitionId: string, continuePhase: boolean) => void,
    onPauseForPenalty?: () => void,
  ): void {
    this.session = session;
    this.onRestart = onRestart;
    this.onOrderExpired = onOrderExpired;
    this.onPauseForPenalty = onPauseForPenalty;
    this.definitionsByOrderId.clear();
    this.view = EMPTY;
    this.lastSecond = -1;
    this.publish(session.snapshot(), []);
  }

  /** Só desfaz se for a mesma sessão, para o dispose de uma cena velha não apagar a nova. */
  unbind(session: GameSession): void {
    if (this.session !== session) return;
    this.session = null;
    this.onRestart = undefined;
    this.onOrderExpired = undefined;
    this.onPauseForPenalty = undefined;
    this.definitionsByOrderId.clear();
    this.view = EMPTY;
    this.emit();
  }

  start(): void {
    if (!this.session) return;
    this.lastSecond = -1;
    this.definitionsByOrderId.clear();
    const events = this.session.start();
    this.processOrderEvents(events);
    this.publish(this.session.snapshot(), events);
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

  penalizeXP(amount: number, reason: string): void {
    if (!this.session) return;
    const events = this.session.penalizeXP(amount, reason);
    if (events.length) {
      this.publish(this.session.snapshot(), events);
      if (this.session.snapshot().status === 'playing') this.onPauseForPenalty?.();
    }
  }

  dismissFeedback(seq: number): void {
    if (this.view.feedback?.seq !== seq) return;
    this.view = { ...this.view, feedback: null };
    this.emit();
  }

  warnXP(message: string): void {
    if (!this.session || this.session.snapshot().status !== 'playing') return;
    this.publish(this.session.snapshot(), [{ type: 'xp-warning', message }]);
  }

  archiveCompleted(definitionId: string): void {
    const session = this.session;
    const order = session?.snapshot().orders.find(item => item.definitionId === definitionId);
    if (!session || !order || order.completedSteps !== order.riskIds.length) return;
    this.publish(session.snapshot(), session.archiveCompleted(order.id));
  }

  /** Chame uma vez por frame com o tempo real decorrido, em ms (sem o teto da física). */
  tick(deltaMs: number): void {
    const session = this.session;
    if (!session || deltaMs <= 0) return;
    const events = session.advance(deltaMs);
    this.processOrderEvents(events);
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

  private processOrderEvents(events: SessionEvent[]): void {
    for (const event of events) {
      if (event.type === 'order-arrived') this.definitionsByOrderId.set(event.order.id, event.order.definitionId);
      else if (event.type === 'order-expired') {
        const definitionId = this.definitionsByOrderId.get(event.orderId);
        if (definitionId) this.onOrderExpired?.(definitionId, this.session?.snapshot().status === 'playing');
        if (this.session?.snapshot().status === 'playing') this.onPauseForPenalty?.();
      }
    }
  }

  private emit(): void { this.listeners.forEach(listener => listener()); }
}

export const sessionStore = new SessionStore();

