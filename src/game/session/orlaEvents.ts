import type { ResponseTeam } from '../core/GameState';

export const ORLA_DURATION_MS = 360_000;
export const ORLA_RECOVERY_MS = ORLA_DURATION_MS;

/** Horários dos chamados e tempo opcional de aviso após o acionamento das equipes. */
type OrlaEvent = {
  id: string; title: string; atMs: number; warningMs: number;
  teams: ResponseTeam[]; position: { x: number; z: number };
  warning: string; instruction: string; steps: number[];
};

const ORLA_EVENT_DEFINITIONS: OrlaEvent[] = [
  { id: 'traffic-signal-failure', title: 'Semáforo quebrado · travessia urgente', atMs: 10_000, warningMs: 0,
    teams: ['mobilidade', 'infraestrutura'], position: { x: 0, z: 4.7 }, steps: [201, 601, 202],
    warning: 'URGENTE · O semáforo quebrou e solta faíscas! Os carros pararam e os pedestres estão se reunindo na faixa.',
    instruction: 'Mobilidade: use 3 perto da faixa para proteger a travessia. Infraestrutura: conserte o semáforo em paralelo. Quando o grupo terminar e o reparo estiver pronto, Mobilidade usa 1 para liberar a via.' },
  { id: 'minor-collision', title: 'Acidente leve', atMs: 130_000, warningMs: 0,
    teams: ['mobilidade', 'infraestrutura'], position: { x: 10, z: 8.2 }, steps: [501, 502],
    warning: 'Batida leve entre dois carros! Há uma fumacinha; prepare o isolamento da faixa.',
    instruction: 'Mobilidade: coloque um cone na marca e bloqueie o sentido com 2. Infraestrutura: use E junto aos carros e siga o protocolo de isolamento antes do reboque.' },
  { id: 'sensor-failure', title: 'Falha de sensor', atMs: 150_000, warningMs: 0,
    teams: ['infraestrutura'], position: { x: 9, z: 4.7 }, steps: [401],
    warning: 'O sensor está perdendo sinal. Um trecho pode ficar sem monitoramento.',
    instruction: 'Infraestrutura: siga a seta até o sensor e use E para instalar e calibrar o substituto.' },
  { id: 'broken-light-pole-1', title: 'Poste apagado', atMs: 170_000, warningMs: 0,
    teams: ['infraestrutura'], position: { x: -9, z: 4.7 }, steps: [101],
    warning: 'Um poste apagou depois de uma falha no circuito. Prepare o reparo.',
    instruction: 'Infraestrutura: siga a seta, use E no poste e conecte o circuito elétrico.' },
  { id: 'ev-charger-repair', title: 'Carregador elétrico quebrado', atMs: 190_000, warningMs: 0,
    teams: ['mobilidade', 'infraestrutura'], position: { x: -3, z: 7.32 }, steps: [901, 902],
    warning: 'O carregador da avenida verde falhou e os carros elétricos estão formando uma fila. Mobilidade: a Habilidade 4 desvia os elétricos para as pistas comuns.',
    instruction: 'Mobilidade: use a Habilidade 4 (tecla 4) para desviar os elétricos para a rua normal. Infraestrutura: vá ao carregador e use E para iniciar o reparo.' },
  { id: 'cyclist-assist', title: 'Resgate do entregador 99', atMs: 50_000, warningMs: 0,
    teams: ['mobilidade'], position: { x: 0, z: 4.7 }, steps: [701, 702],
    warning: 'Um entregador de bicicleta se feriu e precisa atravessar a avenida. Mobilidade, proteja a travessia.',
    instruction: 'Mobilidade: vá até o entregador, use 3 para parar os carros e acompanhe a travessia. Quando ele chegar à calçada, use 1 para reabrir a via.' },
  { id: 'rush-hour', title: 'Fluxo intenso', atMs: 30_000, warningMs: 0,
    teams: ['mobilidade'], position: { x: -16, z: 8.2 }, steps: [301],
    warning: 'Fluxo intenso na Orla: mantenha as faixas abertas para o trânsito circular.',
    instruction: 'Mobilidade: use 4 para desviar os carros eletricos para a rua normal. Depois, mantenha as vias principais abertas por 8 segundos.' },
  { id: 'signal-check', title: 'Checagem do semáforo', atMs: 70_000, warningMs: 0,
    teams: ['infraestrutura'], position: { x: 0, z: 4.7 }, steps: [801],
    warning: 'O semáforo voltou a piscar. Faça uma checagem rápida do controlador.',
    instruction: 'Infraestrutura: aproxime-se do semáforo e use E. Confira os tempos do amarelo, do intervalo e do ciclo.' },
  { id: 'bike-lane-cone', title: 'Cone bloqueando a ciclovia', atMs: 110_000, warningMs: 0,
    teams: ['mobilidade'], position: { x: -12, z: 2.4 }, steps: [803],
    warning: 'Um cone apareceu no meio da ciclovia e está atrapalhando as bicicletas.',
    instruction: 'Mobilidade: recolha o cone com E e leve até a caixa de cones. Use E junto à caixa para guardar.' },
];

ORLA_EVENT_DEFINITIONS.push({ id: 'roadside-breakdown', title: 'Carro parado · faixa bloqueada', atMs: 225_000, warningMs: 0,
  teams: [], position: { x: 10, z: 8.2 }, steps: [1001, 1002],
  warning: 'Um carro enguiçou na avenida e está bloqueando uma faixa. Analista: consulte a lista telefônica e chame um guincho.',
  instruction: 'Analista: abra a lista telefônica e ligue para o Guincho Rota Verde. Acompanhe o reboque até a faixa ser liberada.' });

export const ORLA_EVENTS: readonly OrlaEvent[] = ORLA_EVENT_DEFINITIONS.sort((a, b) => a.atMs - b.atMs);

export const ORLA_EVENT_STEPS: Record<number, { icon: string; label: string }> = {
  1001: { icon: '☎', label: 'Analista: chamar o guincho' },
  1002: { icon: '↗', label: 'Guincho: liberar a faixa' },
  101: { icon: '💡', label: 'Infra: reparar poste' },
  201: { icon: '🚶', label: 'Mob: 3 e aguardar travessia' },
  202: { icon: '▶', label: 'Mob: 1 para liberar fluxo' },
  301: { icon: '↗', label: 'Mob: faixas abertas + desvio' },
  401: { icon: '📡', label: 'Infra: E para instalar sensor' },
  501: { icon: '🚧', label: 'Mob: cone + desvio' },
  502: { icon: '🔧', label: 'Infra: E junto aos carros' },
  601: { icon: '🚦', label: 'Infra: consertar semáforo' },
  701: { icon: '🚴', label: 'Mob: proteger a travessia do entregador' },
  702: { icon: '✅', label: 'Mob: liberar a via após o resgate' },
  801: { icon: '🚦', label: 'Infra: checar semáforo' },
  803: { icon: '🚧', label: 'Mob: levar cone até a caixa' },
  901: { icon: '↗', label: 'Mob: habilidade 4 · desviar elétricos' },
  902: { icon: '🔌', label: 'Infra: reparar carregador' },
};
