import type { ResponseTeam } from '../core/GameState';

export const ORLA_DURATION_MS = 360_000;
export const ORLA_RECOVERY_MS = ORLA_DURATION_MS;

/** Os horários marcam o primeiro aviso; a consequência vem alguns segundos depois. */
export const ORLA_EVENTS: readonly {
  id: string; title: string; atMs: number; warningMs: number;
  teams: ResponseTeam[]; position: { x: number; z: number };
  warning: string; instruction: string; steps: number[];
}[] = [
  { id: 'broken-light-pole-1', title: 'Poste falhando', atMs: 15_000, warningMs: 7_000,
    teams: ['infraestrutura'], position: { x: -9, z: 4.7 }, steps: [101],
    warning: 'A luz está piscando. Infraestrutura: prepare o reparo do circuito.',
    instruction: 'Infraestrutura: siga a seta, use E no poste e conecte o circuito elétrico.' },
  { id: 'unsafe-crossing', title: 'Travessia insegura', atMs: 70_000, warningMs: 8_000,
    teams: ['mobilidade'], position: { x: 1, z: 5 }, steps: [201, 202],
    warning: 'Motoristas não estão cedendo passagem. Pedestres começam a se acumular.',
    instruction: 'Mobilidade: junto à faixa, use 3 para parar os carros. Aguarde o grupo atravessar e use 1 para liberar.' },
  { id: 'rush-hour', title: 'Pico de trânsito', atMs: 130_000, warningMs: 10_000,
    teams: ['mobilidade'], position: { x: -16, z: 8.2 }, steps: [301],
    warning: 'O volume de carros está aumentando. Prepare uma rota de escape.',
    instruction: 'Mobilidade: use 1 para abrir as faixas e 4 para abrir o desvio. Mantenha o fluxo por 8 segundos.' },
  { id: 'traffic-signal-failure', title: 'Semáforo desregulado', atMs: 190_000, warningMs: 7_000,
    teams: ['infraestrutura'], position: { x: 0, z: 4.7 }, steps: [601],
    warning: 'O semáforo está alternando fora de sincronia. Prepare o ajuste do controlador.',
    instruction: 'Infraestrutura: siga a seta e use E para sincronizar as luzes do semáforo.' },
  { id: 'sensor-failure', title: 'Falha de sensor', atMs: 250_000, warningMs: 7_000,
    teams: ['infraestrutura'], position: { x: 9, z: 4.7 }, steps: [401],
    warning: 'O sensor está perdendo sinal. Um trecho pode ficar sem monitoramento.',
    instruction: 'Infraestrutura: siga a seta até o sensor e use E para instalar o substituto.' },
  { id: 'minor-collision', title: 'Colisão leve', atMs: 325_000, warningMs: 5_000,
    teams: ['mobilidade', 'infraestrutura'], position: { x: 10, z: 8.2 }, steps: [501, 502],
    warning: 'Um veículo está freando e acionou o pisca-alerta. Prepare o isolamento.',
    instruction: 'Mobilidade: coloque um cone na marca e abra o desvio com 4. Infraestrutura: use E junto ao carro para liberar a faixa.' },
];

export const ORLA_EVENT_STEPS: Record<number, { icon: string; label: string }> = {
  101: { icon: '💡', label: 'Infra: reparar circuito' },
  201: { icon: '🚶', label: 'Mob: 3 e aguardar travessia' },
  202: { icon: '▶', label: 'Mob: 1 para liberar fluxo' },
  301: { icon: '↗', label: 'Mob: faixas abertas + desvio' },
  401: { icon: '📡', label: 'Infra: E para instalar sensor' },
  501: { icon: '🚧', label: 'Mob: cone + desvio' },
  502: { icon: '🔧', label: 'Infra: E junto ao veículo' },
  601: { icon: '🚦', label: 'Infra: sincronizar semáforo' },
};
