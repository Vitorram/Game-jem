import type { SessionConfig } from './GameSession';
import { ORLA_DURATION_MS, ORLA_EVENTS } from './orlaEvents';

/** Chamados liberados em série após arquivamento, sem expiração nem tempo limite punitivo. */
export const ORLA_SESSION_CONFIG = {
  phaseDurationMs: ORLA_DURATION_MS,
  orderIntervalMs: 55_000,
  firstOrderDelayMs: ORLA_EVENTS[0].atMs,
  scheduledAtMs: ORLA_EVENTS.map(event => event.atMs),
  sequential: true,
  orders: ORLA_EVENTS.map(event => ({
    id: event.id, title: event.title, riskIds: event.steps,
    timeLimitMs: event.timeLimitMs ?? 90_000,
    basePoints: 100, maxSpeedBonus: 100,
  })),
} as const satisfies SessionConfig;

export const SESSION_STATUS_LABELS = {
  menu: 'Menu', playing: 'Jogando', paused: 'Pausado', finished: 'Fim de fase',
} as const;
