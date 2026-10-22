/** Operações compartilhadas pelo laboratório e pelo fluxo cooperativo, sem Three. */
export type AbilityPoint = { x: number; z: number };
export type Inspection = { revealed: boolean; marked: boolean };
export type AbilityLight = AbilityPoint & { level: number };
export const SENSOR_LIMIT = 5;
const distance = (a: AbilityPoint, b: AbilityPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const finite = (point: AbilityPoint) => Number.isFinite(point.x) && Number.isFinite(point.z);

export const inspectRisk = (issue: Inspection, mark = false): Inspection => {
  if (mark) return issue.revealed ? { ...issue, marked: !issue.marked } : issue;
  return { ...issue, revealed: true };
};

export const installSensor = (sensors: readonly AbilityPoint[], point: AbilityPoint) => {
  if (sensors.length >= SENSOR_LIMIT) return { sensors, result: 'limit' as const };
  if (!finite(point) || sensors.some(sensor => distance(sensor, point) < 0.8)) return { sensors, result: 'near' as const };
  return { sensors: [...sensors, { ...point }], result: 'installed' as const };
};

export const cycleLight = (light: AbilityLight | null, point: AbilityPoint): AbilityLight => ({
  ...(light ?? point), level: ((light?.level ?? 0) + 1) % 3,
});

export const copyRoute = (stops: readonly AbilityPoint[]): AbilityPoint[] => stops.map(point => ({ ...point }));

export const moveRouteStop = (stops: readonly AbilityPoint[], index: number, point: AbilityPoint): AbilityPoint[] | null => {
  if (!Number.isInteger(index) || index < 0 || index >= stops.length || !finite(point)) return null;
  if (stops.some((stop, i) => i !== index && distance(stop, point) < 1)) return null;
  const draft = copyRoute(stops);
  draft[index] = { ...point };
  return draft;
};
