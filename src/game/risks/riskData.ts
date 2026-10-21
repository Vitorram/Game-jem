import type { TileCell } from '../map/GridMap';

export type RiskKind = 'light' | 'sensor' | 'route';
export type RiskDefinition = TileCell & {
  id: number; kind: RiskKind; title: string; detail: string;
};
export const ORLA_RISKS = [
  { id: 1, kind: 'light', column: 3, row: 7, title: 'Trecho sem iluminação', detail: 'Infraestrutura deve acender uma luz neste trecho.' },
  { id: 2, kind: 'sensor', column: 7, row: 7, title: 'Trecho sem monitoramento', detail: 'Infraestrutura deve instalar um sensor neste trecho.' },
  { id: 3, kind: 'route', column: 11, row: 7, title: 'Calçada interditada', detail: 'Mobilidade deve preparar e confirmar o desvio do ponto de ônibus.' },
] as const satisfies readonly RiskDefinition[];

/** Rota de teste: o ponto intermediário sai da interdição e vai à faixa superior. */
export const ORLA_ROUTE = {
  stops: [{ column: 10, row: 7 }, { column: 11, row: 7 }, { column: 12, row: 7 }],
  movedIndex: 1,
  destination: { column: 11, row: 6 },
} as const;
export const RISK_STATUS_LABELS = {
  hidden: 'Inspecionar com Análise',
  inspected: 'Marcar com Análise',
  released: 'Liberado para especialista',
  routing: 'Confirmar desvio com Mobilidade',
  resolved: 'Resolvido',
} as const;
