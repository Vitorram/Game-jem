/** Distâncias em unidades do mapa; cada faixa tem sua própria área de conflito. */
export const CROSSING_RULES = {
  roadGroupSize: 3,
  roadStopDistance: 2.45,
  roadConflictHalfWidth: 2.05, // Meia faixa + meio ônibus + margem.
  roadApproachDistance: 7,
  roadFlowSeconds: 3,
  cycleStopDistance: 1.65,
  cycleConflictHalfWidth: 1.48,
  cycleApproachDistance: 4,
  cycleFlowSeconds: .6,
  stoppedSpeed: .08,
} as const;

/** Frenagem por distância, com limite físico no avanço para nunca ultrapassar a retenção. */
export function advanceWithRoom(speed: number, desired: number, room: number, dt: number, acceleration = 1.8, braking = 4) {
  const available = Math.max(0, room);
  const target = Math.min(desired, Math.sqrt(2 * braking * available));
  const rate = target < speed ? braking : acceleration;
  const nextSpeed = Math.max(0, speed + Math.max(-rate * dt, Math.min(rate * dt, target - speed)));
  const distance = Math.min(nextSpeed * dt, available);
  return { distance, speed: distance >= available || available < .001 ? 0 : nextSpeed };
}
