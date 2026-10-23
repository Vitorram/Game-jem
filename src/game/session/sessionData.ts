import type { SessionConfig } from './GameSession';
import { ORLA_DURATION_MS, ORLA_EVENTS } from './orlaEvents';

/** Um chamado por vez; o próximo só entra depois do arquivamento pela Analista. */
export const ORLA_SESSION_CONFIG = {
  phaseDurationMs: ORLA_DURATION_MS,
  orderIntervalMs: ORLA_DURATION_MS,
  firstOrderDelayMs: 0,
  sequential: true,
  orders: ORLA_EVENTS.map(event => ({
    id: event.id, title: event.title, riskIds: event.steps,
    timeLimitMs: ORLA_DURATION_MS - event.atMs,
    basePoints: 100, maxSpeedBonus: 50, expirationPenalty: 20,
  })),
} as const satisfies SessionConfig;

export const SESSION_STATUS_LABELS = {
  menu: 'Menu', playing: 'Jogando', paused: 'Pausado', finished: 'Fim de fase',
} as const;
