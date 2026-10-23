import type { SessionConfig } from './GameSession';
import { ORLA_DURATION_MS, ORLA_EVENTS } from './orlaEvents';

/** Chamados espaçados durante os seis minutos e liberados em série após arquivamento. */
export const ORLA_SESSION_CONFIG = {
  phaseDurationMs: ORLA_DURATION_MS,
  orderIntervalMs: 55_000,
  firstOrderDelayMs: ORLA_EVENTS[0].atMs,
  scheduledAtMs: ORLA_EVENTS.map(event => event.atMs),
  // Tolera até 3 chamados perdidos: quem ainda está aprendendo não perde a fase antes de entender o ritmo.
  maxExpiredOrders: 4,
  sequential: true,
  orders: ORLA_EVENTS.map(event => ({
    id: event.id, title: event.title, riskIds: event.steps,
    timeLimitMs: 60_000,
    basePoints: 100, maxSpeedBonus: 50, expirationPenalty: 200,
  })),
} as const satisfies SessionConfig;

export const SESSION_STATUS_LABELS = {
  menu: 'Menu', playing: 'Jogando', paused: 'Pausado', finished: 'Fim de fase',
} as const;
