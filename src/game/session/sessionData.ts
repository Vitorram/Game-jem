import type { SessionConfig } from './GameSession';
import { ORLA_DURATION_MS, ORLA_EVENTS } from './orlaEvents';

/** Cinco ocorrências, seguidas de recuperação até completar os seis minutos. */
export const ORLA_SESSION_CONFIG = {
  phaseDurationMs: ORLA_DURATION_MS,
  orderIntervalMs: ORLA_DURATION_MS,
  firstOrderDelayMs: ORLA_EVENTS[0].atMs,
  scheduledAtMs: ORLA_EVENTS.map(event => event.atMs),
  orders: ORLA_EVENTS.map(event => ({
    id: event.id, title: event.title, riskIds: event.steps,
    timeLimitMs: ORLA_DURATION_MS - event.atMs,
    basePoints: 100, maxSpeedBonus: 50, expirationPenalty: 20,
  })),
} as const satisfies SessionConfig;

export const SESSION_STATUS_LABELS = {
  menu: 'Menu', playing: 'Jogando', paused: 'Pausado', finished: 'Fim de fase',
} as const;
