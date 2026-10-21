import type { SessionConfig } from './GameSession';

/** Tempos em milissegundos; riskIds correspondem aos pontos de ORLA_RISKS. */
export const ORLA_SESSION_CONFIG = {
  phaseDurationMs: 180_000,
  orderIntervalMs: 30_000,
  firstOrderDelayMs: 0,
  orders: [
    { id: 'iluminar-monitorar', title: 'Iluminar e monitorar', riskIds: [1, 2],
      timeLimitMs: 60_000, basePoints: 100, maxSpeedBonus: 50, expirationPenalty: 30 },
    { id: 'desvio-seguro', title: 'Preparar um desvio seguro', riskIds: [1, 3],
      timeLimitMs: 75_000, basePoints: 120, maxSpeedBonus: 60, expirationPenalty: 40 },
    { id: 'orla-completa', title: 'Recuperar o trecho da orla', riskIds: [2, 1, 3],
      timeLimitMs: 90_000, basePoints: 180, maxSpeedBonus: 90, expirationPenalty: 50 },
  ],
} as const satisfies SessionConfig;

export const SESSION_STATUS_LABELS = {
  menu: 'Menu', playing: 'Jogando', paused: 'Pausado', finished: 'Fim de fase',
} as const;
