import type { SessionConfig } from './GameSession';

/** Uma missão completa para o cenário atual: acionar equipes, preparar área e reparar. */
export const ORLA_SESSION_CONFIG = {
  phaseDurationMs: 180_000,
  orderIntervalMs: 180_000,
  firstOrderDelayMs: 0,
  orders: [
    { id: 'recuperar-poste', title: 'Luz de volta à Orla', riskIds: [1, 2, 3],
      timeLimitMs: 180_000, basePoints: 300, maxSpeedBonus: 300, expirationPenalty: 0 },
  ],
} as const satisfies SessionConfig;

export const SESSION_STATUS_LABELS = {
  menu: 'Menu', playing: 'Jogando', paused: 'Pausado', finished: 'Fim de fase',
} as const;
