export type SessionStatus = 'menu' | 'playing' | 'paused' | 'finished';

export type OrderDefinition = {
  id: string;
  title: string;
  /** IDs dos riscos, na ordem exigida. Cada risco aparece uma vez no pedido. */
  riskIds: readonly number[];
  /** Janela de tempo de referência (ms) para cálculo do bônus de agilidade (não expira a tarefa). */
  timeLimitMs: number;
  basePoints: number;
  maxSpeedBonus: number;
  expirationPenalty?: number;
};

export type SessionConfig = {
  phaseDurationMs?: number;
  orderIntervalMs: number;
  firstOrderDelayMs: number;
  /** Catálogo percorrido ciclicamente, sem aleatoriedade implícita. */
  orders: readonly OrderDefinition[];
  /** Agenda finita, na mesma ordem do catálogo. Sem repetição nem vitória antecipada. */
  scheduledAtMs?: readonly number[];
  /** Em campanhas guiadas, só há um chamado e o próximo espera o arquivamento. */
  sequential?: boolean;
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
  | { type: 'score-warning'; message: string };

const DEFAULT_PHASE_DURATION_MS = 360_000;

/** Relógio simulado: sem Three, DOM, Date, timers, callbacks ou recursos a descartar. */
export class GameSession {
  private readonly config: SessionConfig & { phaseDurationMs: number };
  private status: SessionStatus = 'menu';
  private elapsedMs = 0;
  private score = 0;
  private completedOrders = 0;
  private expiredOrders = 0;
  private orders: ActiveOrder[] = [];
  private issuedOrders = 0;
  /** Momento de conclusão quando uma missão sequencial já foi concluída e aguarda arquivamento. */
  private readonly completedAtMs = new Map<number, number>();
  // Mantido entre reinícios para não aceitar uma resolução antiga em uma nova partida.
  private nextOrderId = 1;

  constructor(config: SessionConfig) {
    this.validate(config);
    const cloned = structuredClone(config);
    this.config = {
      ...cloned,
      phaseDurationMs: cloned.phaseDurationMs ?? DEFAULT_PHASE_DURATION_MS,
    };
  }

  snapshot(): SessionSnapshot {
    return {
      status: this.status, elapsedMs: this.elapsedMs,
      remainingMs: Math.max(0, this.config.phaseDurationMs - this.elapsedMs),
      score: this.score, completedOrders: this.completedOrders, expiredOrders: this.expiredOrders,
      orders: this.orders.map(order => ({
        ...order, riskIds: [...order.riskIds],
        remainingMs: Math.max(0, order.expiresAtMs - (this.completedAtMs.get(order.id) ?? this.elapsedMs)),
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
    if (this.nextArrival() === 0) this.issueOrder(events);
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
    if (this.config.scheduledAtMs) return [];
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
   * com o teto da física: avanços grandes processam todas as chegadas de chamados.
   * Sem cronômetros fatais: chamados permanecem ativos até serem resolvidos pela equipe.
   */
  advance(deltaMs: number): SessionEvent[] {
    if (!Number.isFinite(deltaMs) || deltaMs < 0) throw new Error('Delta de tempo inválido.');
    if (this.status !== 'playing' || deltaMs === 0) return [];
    if (this.config.sequential) {
      const events: SessionEvent[] = [];
      const target = this.elapsedMs + deltaMs;
      while (this.elapsedMs < target && this.status === 'playing') {
        const arrival = this.orders.length === 0 && this.issuedOrders < this.config.orders.length
          ? Math.max(this.elapsedMs, this.nextArrival()) : Infinity;
        const next = Math.min(target, arrival);
        this.elapsedMs = next;
        if (this.orders.length === 0 && this.issuedOrders < this.config.orders.length
          && this.nextArrival() <= this.elapsedMs) this.issueOrder(events);
        if (this.elapsedMs === target) break;
      }
      return events;
    }
    const target = this.elapsedMs + deltaMs;
    const events: SessionEvent[] = [];
    while (this.elapsedMs < target && this.status === 'playing') {
      const nextArrival = this.nextArrival();
      const stepTarget = nextArrival > this.elapsedMs ? Math.min(target, nextArrival) : target;
      this.elapsedMs = stepTarget;
      if (this.elapsedMs === nextArrival) this.issueOrder(events);
      if (this.elapsedMs === target) break;
    }
    return events;
  }

  /**
   * O chamador confirma uma intervenção concluída pelo RiskWorkflow, não um clique.
   * Só o primeiro pedido recebe progresso; pedido/risco incorretos são no-op.
   * O ID da instância impede que uma ação repetida conclua outro pedido.
   */
  resolveRisk(orderId: number, riskId: number): SessionEvent[] {
    const order = this.config.scheduledAtMs
      ? this.orders.find(item => item.id === orderId) : this.orders[0];
    if (this.status !== 'playing' || !order || order.id !== orderId
      || order.riskIds[order.completedSteps] !== riskId) return [];
    order.completedSteps++;
    const events: SessionEvent[] = [{ type: 'risk-resolved', orderId, riskId }];
    if (order.completedSteps === order.riskIds.length) {
      const elapsedOnOrder = Math.max(0, this.elapsedMs - order.createdAtMs);
      const remainingBonusMs = Math.max(0, order.timeLimitMs - elapsedOnOrder);
      const speedBonus = Math.max(0, Math.floor(order.maxSpeedBonus * (remainingBonusMs / order.timeLimitMs)));
      const points = Math.max(0, order.basePoints + speedBonus);
      this.score = Math.max(0, this.score + points);
      this.completedOrders++;
      if (this.config.sequential) this.completedAtMs.set(order.id, this.elapsedMs);
      if (!this.config.sequential) this.orders.splice(this.orders.indexOf(order), 1);
      events.push({ type: 'order-completed', orderId, basePoints: order.basePoints, speedBonus, points });
      if (this.config.sequential && this.issuedOrders === this.config.orders.length
        && this.completedOrders === this.config.orders.length) {
        this.orders.splice(this.orders.indexOf(order), 1);
        this.completedAtMs.delete(order.id);
        this.status = 'finished';
        events.push({ type: 'status', status: this.status });
      }
    }
    return events;
  }

  /** Emite apenas um aviso instrutivo sem subtrair pontos: a pontuação nunca fica negativa. */
  warnScore(message: string): SessionEvent[] {
    if (this.status !== 'playing' || !message.trim()) return [];
    return [{ type: 'score-warning', message }];
  }

  /** Arquiva um chamado e libera o próximo; a última missão encerra a fase ao ser concluída. */
  archiveCompleted(orderId: number): SessionEvent[] {
    if (!this.config.sequential || this.status !== 'playing') return [];
    const order = this.orders.find(item => item.id === orderId);
    if (!order || order.completedSteps !== order.riskIds.length) return [];
    this.orders.splice(this.orders.indexOf(order), 1);
    this.completedAtMs.delete(order.id);
    const events: SessionEvent[] = [];
    if (this.issuedOrders === this.config.orders.length && this.completedOrders === this.config.orders.length
      && this.orders.length === 0) {
      this.status = 'finished';
      events.push({ type: 'status', status: this.status });
    } else if (this.issuedOrders < this.config.orders.length && this.nextArrival() <= this.elapsedMs) this.issueOrder(events);
    return events;
  }

  private nextArrival(): number {
    return this.config.scheduledAtMs
      ? this.config.scheduledAtMs[this.issuedOrders] ?? Infinity
      : this.config.firstOrderDelayMs + this.issuedOrders * this.config.orderIntervalMs;
  }

  private issueOrder(events: SessionEvent[]): void {
    const definition = this.config.orders[this.issuedOrders % this.config.orders.length];
    const { id: definitionId, expirationPenalty = 0, ...data } = definition;
    const order: ActiveOrder = {
      ...data, expirationPenalty, riskIds: [...data.riskIds], definitionId, id: this.nextOrderId++,
      completedSteps: 0, createdAtMs: this.elapsedMs,
      expiresAtMs: this.elapsedMs + definition.timeLimitMs,
    };
    this.issuedOrders++;
    this.orders.push(order);
    events.push({ type: 'order-arrived', order: structuredClone(order) });
  }

  private reset(): void {
    this.elapsedMs = 0;
    this.score = 0;
    this.completedOrders = 0;
    this.expiredOrders = 0;
    this.orders = [];
    this.completedAtMs.clear();
    this.issuedOrders = 0;
  }

  private validate(config: SessionConfig): void {
    const integer = (value: number, minimum: number) => Number.isSafeInteger(value) && value >= minimum;
    const phaseDurationMs = config.phaseDurationMs ?? DEFAULT_PHASE_DURATION_MS;
    if (config.scheduledAtMs && (config.scheduledAtMs.length !== config.orders.length
      || config.scheduledAtMs.some((at, index, all) => !integer(at, 0)
        || at >= phaseDurationMs || (index > 0 && at <= all[index - 1])))) {
      throw new Error('Agenda de eventos inválida.');
    }
    if (!integer(phaseDurationMs, 1) || !integer(config.orderIntervalMs, 1)
      || !integer(config.firstOrderDelayMs, 0) || config.firstOrderDelayMs >= phaseDurationMs
      || !config.orders.length) throw new Error('Configuração de partida inválida.');
    const ids = new Set<string>();
    for (const order of config.orders) {
      const penalty = order.expirationPenalty ?? 0;
      if (!order.id.trim() || ids.has(order.id) || !order.title.trim()
        || !order.riskIds.length || new Set(order.riskIds).size !== order.riskIds.length
        || order.riskIds.some(id => !integer(id, 1))
        || !integer(order.timeLimitMs, 1)
        || !integer(order.basePoints, 0) || !integer(order.maxSpeedBonus, 0)
        || !integer(penalty, 0)
        || !Number.isSafeInteger(phaseDurationMs + order.timeLimitMs)
        || !Number.isSafeInteger(order.basePoints + order.maxSpeedBonus)) {
        throw new Error('Definição de pedido inválida.');
      }
      ids.add(order.id);
    }
  }
}
