export type SessionStatus = 'menu' | 'playing' | 'paused' | 'finished';

export type OrderDefinition = {
  id: string;
  title: string;
  /** IDs dos riscos, na ordem exigida. Cada risco aparece uma vez no pedido. */
  riskIds: readonly number[];
  timeLimitMs: number;
  basePoints: number;
  maxSpeedBonus: number;
  expirationPenalty: number;
};

export type SessionConfig = {
  phaseDurationMs: number;
  orderIntervalMs: number;
  firstOrderDelayMs: number;
  /** Catálogo percorrido ciclicamente, sem aleatoriedade implícita. */
  orders: readonly OrderDefinition[];
};

export type ActiveOrder = {
  id: number;
  definitionId: string;
  title: string;
  riskIds: number[];
  completedSteps: number;
  createdAtMs: number;
  expiresAtMs: number;
  timeLimitMs: number;
  basePoints: number;
  maxSpeedBonus: number;
  expirationPenalty: number;
};

export type SessionSnapshot = {
  status: SessionStatus;
  elapsedMs: number;
  remainingMs: number;
  score: number;
  completedOrders: number;
  expiredOrders: number;
  orders: (ActiveOrder & { remainingMs: number; nextRiskId: number })[];
};

export type SessionEvent =
  | { type: 'status'; status: SessionStatus }
  | { type: 'order-arrived'; order: ActiveOrder }
  | { type: 'risk-resolved'; orderId: number; riskId: number }
  | { type: 'order-completed'; orderId: number; basePoints: number; speedBonus: number; points: number }
  | { type: 'order-expired'; orderId: number; penalty: number; reason: 'deadline' | 'phase-ended' };

/** Relógio simulado: sem Three, DOM, Date, timers, callbacks ou recursos a descartar. */
export class GameSession {
  private readonly config: SessionConfig;
  private status: SessionStatus = 'menu';
  private elapsedMs = 0;
  private score = 0;
  private completedOrders = 0;
  private expiredOrders = 0;
  private orders: ActiveOrder[] = [];
  private issuedOrders = 0;
  // Mantido entre reinícios para não aceitar uma resolução antiga em uma nova partida.
  private nextOrderId = 1;

  constructor(config: SessionConfig) {
    this.validate(config);
    this.config = structuredClone(config);
  }

  snapshot(): SessionSnapshot {
    return {
      status: this.status, elapsedMs: this.elapsedMs,
      remainingMs: this.config.phaseDurationMs - this.elapsedMs,
      score: this.score, completedOrders: this.completedOrders, expiredOrders: this.expiredOrders,
      orders: this.orders.map(order => ({
        ...order, riskIds: [...order.riskIds],
        remainingMs: Math.max(0, order.expiresAtMs - this.elapsedMs),
        nextRiskId: order.riskIds[order.completedSteps],
      })),
    };
  }

  /** Inicia pelo menu ou reinicia após o fim; não reinicia uma partida em curso. */
  start(): SessionEvent[] {
    if (this.status !== 'menu' && this.status !== 'finished') return [];
    this.reset();
    this.status = 'playing';
    const events: SessionEvent[] = [{ type: 'status', status: this.status }];
    if (this.config.firstOrderDelayMs === 0) this.issueOrder(events);
    return events;
  }

  pause(): SessionEvent[] {
    if (this.status !== 'playing') return [];
    this.status = 'paused';
    return [{ type: 'status', status: this.status }];
  }

  resume(): SessionEvent[] {
    if (this.status !== 'paused') return [];
    this.status = 'playing';
    return [{ type: 'status', status: this.status }];
  }

  /** Vitória antecipada somente após concluir todos os pedidos emitidos. */
  finish(): SessionEvent[] {
    if (this.status !== 'playing' || this.orders.length || this.completedOrders === 0) return [];
    this.status = 'finished';
    return [{ type: 'status', status: this.status }];
  }

  returnToMenu(): SessionEvent[] {
    if (this.status === 'menu') return [];
    this.reset();
    this.status = 'menu';
    return [{ type: 'status', status: this.status }];
  }

  /**
   * Recebe tempo decorrido em milissegundos (inclusive frações). Não limite o delta
   * com o teto da física: avanços grandes processam todas as chegadas/expirações.
   * Empates: expiração, fim da fase, chegada. No prazo exato, o pedido já expirou.
   */
  advance(deltaMs: number): SessionEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Delta de tempo inválido.');
    if (this.status !== 'playing' || deltaMs === 0) return [];
    const target = Math.min(this.config.phaseDurationMs, this.elapsedMs + deltaMs);
    const events: SessionEvent[] = [];
    while (this.elapsedMs < target) {
      const nextArrival = this.config.firstOrderDelayMs + this.issuedOrders * this.config.orderIntervalMs;
      let nextDeadline = Infinity;
      for (const order of this.orders) nextDeadline = Math.min(nextDeadline, order.expiresAtMs);
      this.elapsedMs = Math.min(target, nextArrival, nextDeadline);
      this.expireOrders(events, false);
      if (this.elapsedMs === this.config.phaseDurationMs) {
        // Pendências também expiram ao encerrar, uma única vez por pedido.
        this.expireOrders(events, true);
        this.status = 'finished';
        events.push({ type: 'status', status: this.status });
        break;
      }
      if (this.elapsedMs === nextArrival) this.issueOrder(events);
    }
    return events;
  }

  /**
   * O chamador confirma uma intervenção concluída pelo RiskWorkflow, não um clique.
   * Só o primeiro pedido recebe progresso; pedido/risco incorretos são no-op.
   * O ID da instância impede que uma ação repetida conclua outro pedido.
   */
  resolveRisk(orderId: number, riskId: number): SessionEvent[] {
    const order = this.orders[0];
    if (this.status !== 'playing' || !order || order.id !== orderId
      || order.riskIds[order.completedSteps] !== riskId) return [];
    order.completedSteps++;
    const events: SessionEvent[] = [{ type: 'risk-resolved', orderId, riskId }];
    if (order.completedSteps === order.riskIds.length) {
      const remaining = order.expiresAtMs - this.elapsedMs;
      const speedBonus = Math.floor(order.maxSpeedBonus * (remaining / order.timeLimitMs));
      const points = order.basePoints + speedBonus;
      this.score += points;
      this.completedOrders++;
      this.orders.shift();
      events.push({ type: 'order-completed', orderId, basePoints: order.basePoints, speedBonus, points });
    }
    return events;
  }

  private issueOrder(events: SessionEvent[]): void {
    const definition = this.config.orders[this.issuedOrders % this.config.orders.length];
    const { id: definitionId, ...data } = definition;
    const order: ActiveOrder = {
      ...data, riskIds: [...data.riskIds], definitionId, id: this.nextOrderId++,
      completedSteps: 0, createdAtMs: this.elapsedMs,
      expiresAtMs: this.elapsedMs + definition.timeLimitMs,
    };
    this.issuedOrders++;
    this.orders.push(order);
    events.push({ type: 'order-arrived', order: structuredClone(order) });
  }

  private expireOrders(events: SessionEvent[], phaseEnded: boolean): void {
    this.orders = this.orders.filter(order => {
      const deadlineReached = order.expiresAtMs <= this.elapsedMs;
      if (!deadlineReached && !phaseEnded) return true;
      this.score -= order.expirationPenalty;
      this.expiredOrders++;
      events.push({ type: 'order-expired', orderId: order.id, penalty: order.expirationPenalty,
        reason: deadlineReached ? 'deadline' : 'phase-ended' });
      return false;
    });
  }

  private reset(): void {
    this.elapsedMs = 0;
    this.score = 0;
    this.completedOrders = 0;
    this.expiredOrders = 0;
    this.orders = [];
    this.issuedOrders = 0;
  }

  private validate(config: SessionConfig): void {
    const integer = (value: number, minimum: number) => Number.isSafeInteger(value) && value >= minimum;
    if (!integer(config.phaseDurationMs, 1) || !integer(config.orderIntervalMs, 1)
      || !integer(config.firstOrderDelayMs, 0) || config.firstOrderDelayMs >= config.phaseDurationMs
      || !config.orders.length) throw new Error('Configuração de partida inválida.');
    const ids = new Set<string>();
    for (const order of config.orders) {
      if (!order.id.trim() || ids.has(order.id) || !order.title.trim()
        || !order.riskIds.length || new Set(order.riskIds).size !== order.riskIds.length
        || order.riskIds.some(id => !integer(id, 1))
        || !integer(order.timeLimitMs, 1)
        || !integer(order.basePoints, 0) || !integer(order.maxSpeedBonus, 0)
        || !integer(order.expirationPenalty, 0)
        || !Number.isSafeInteger(config.phaseDurationMs + order.timeLimitMs)
        || !Number.isSafeInteger(order.basePoints + order.maxSpeedBonus)) {
        throw new Error('Definição de pedido inválida.');
      }
      ids.add(order.id);
    }
  }
}

