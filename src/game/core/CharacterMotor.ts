import type { ORLA_MOVEMENT } from '../config';

type Point = { x: number; z: number };
type MovementConfig = { [K in keyof typeof ORLA_MOVEMENT]: number };

/** Integra a velocidade analiticamente: mesma resposta em 30, 60 ou 120 FPS. */
export class CharacterMotor {
  private velocity: Point = { x: 0, z: 0 };
  private readonly config: MovementConfig;

  constructor(config: MovementConfig) { this.config = config; }

  stop(): void { this.velocity.x = 0; this.velocity.z = 0; }

  step(dt: number, position: Point, axis: Point, sprint: boolean,
    resolve: (from: Point, to: Point) => Point): Point {
    if (!Number.isFinite(dt) || dt <= 0) return { ...position };
    const x = Number.isFinite(axis.x) ? axis.x : 0;
    const z = Number.isFinite(axis.z) ? axis.z : 0;
    const length = Math.hypot(x, z);
    const speed = this.config.speed * (sprint ? this.config.sprintMultiplier : 1);
    const rate = length > 0 ? this.config.acceleration : this.config.braking;
    const decay = Math.exp(-rate * dt);
    const target = { x: x / Math.max(1, length) * speed, z: z / Math.max(1, length) * speed };
    const next = { ...position };
    for (const key of ['x', 'z'] as const) {
      next[key] += target[key] * dt + (this.velocity[key] - target[key]) * (1 - decay) / rate;
      this.velocity[key] = target[key] + (this.velocity[key] - target[key]) * decay;
      if (Math.abs(this.velocity[key]) < this.config.stopThreshold && length === 0) this.velocity[key] = 0;
    }
    const resolved = resolve(position, next);
    // Remove só a componente bloqueada; a outra continua deslizando pela borda.
    if (Math.abs(resolved.x - next.x) > 1e-7) this.velocity.x = 0;
    if (Math.abs(resolved.z - next.z) > 1e-7) this.velocity.z = 0;
    return resolved;
  }
}
