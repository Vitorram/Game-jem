import type { UrbanProblem } from '../core/GameState';
import type { PlayerId } from '../entities/Player';
import type { SessionSnapshot } from '../session/GameSession';
import { ORLA_EVENTS } from '../session/orlaEvents';

type Order = SessionSnapshot['orders'][number];
const teamNames = { infraestrutura: 'Infraestrutura', mobilidade: 'Mobilidade' };
const steps: Record<number, { team: string; action: string; location: string }> = {
  201: { team: 'Mobilidade', action: 'Use 3 junto à faixa e aguarde os pedestres atravessarem. Infraestrutura já pode reparar quando a travessia começar.', location: 'Faixa de pedestres · semáforo' },
  601: { team: 'Infraestrutura', action: 'Use E junto ao semáforo e conclua o reparo. Mantenha a travessia protegida.', location: 'Semáforo da faixa de pedestres' },
  202: { team: 'Mobilidade', action: 'Travessia e reparo concluídos: use 1 junto à faixa para reabrir a via.', location: 'Faixa de pedestres' },
  301: { team: 'Mobilidade', action: 'Use 4 para desviar os elétricos. Mantenha as vias principais abertas por 8 segundos; use 1 se houver bloqueio.', location: 'Avenida · siga a seta' },
  401: { team: 'Infraestrutura', action: 'Use E junto ao sensor. Permaneça no local e conclua a calibração.', location: 'Sensor · siga a seta' },
  501: { team: 'Mobilidade', action: 'Pegue um cone no baú com E, coloque-o na marca com E e use 2 para bloquear o sentido.', location: 'Baú de cones → acidente · siga a seta' },
  502: { team: 'Infraestrutura', action: 'Área isolada: use E junto aos veículos e conclua o protocolo de segurança.', location: 'Veículos do acidente · siga a seta' },
  101: { team: 'Infraestrutura', action: 'Use E junto ao poste e conclua o reparo do circuito.', location: 'Poste apagado · siga a seta' },
  701: { team: 'Mobilidade', action: 'Use 3 junto ao entregador para proteger a travessia. Aguarde até ele chegar à calçada.', location: 'Entregador · faixa de pedestres' },
  702: { team: 'Mobilidade', action: 'Mantenha a via protegida. Quando o entregador e todos os pedestres chegarem à calçada, use 1 para reabrir.', location: 'Faixa de pedestres' },
  801: { team: 'Infraestrutura', action: 'Use E junto ao semáforo e confira os tempos do controlador.', location: 'Controlador do semáforo · siga a seta' },
  803: { team: 'Mobilidade', action: 'Recolha o cone da ciclovia com E. Leve-o ao baú e use E novamente para guardar.', location: 'Ciclovia → baú de cones · siga a seta' },
  901: { team: 'Mobilidade', action: 'Use 4 para desviar os elétricos antes do reparo do carregador.', location: 'Avenida Verde · siga a seta' },
  902: { team: 'Infraestrutura', action: 'Desvio ativo: use E junto ao carregador, permaneça no local e conclua o reparo.', location: 'Carregador da Avenida Verde · siga a seta' },
  1001: { team: 'Analista', action: 'Abra o tablet com Q. Na lista telefônica, ligue para o Guincho Rota Verde.', location: 'Tablet · lista telefônica' },
  1002: { team: 'Guincho', action: 'Guincho acionado. Aguarde a remoção do carro; a faixa será liberada pelo reboque.', location: 'Avenida · carro enguiçado' },
};

/** Read-only presentation of confirmed world/session progress; never advances a mission. */
export function missionBrief(problem: UrbanProblem, order?: Order) {
  const title = ORLA_EVENTS.find(event => event.id === problem.id)?.title ?? problem.label;
  if (problem.status === 'RESOLVED') return { title, team: 'Analista', action: 'Abra o tablet com Q e arquive o relatório para liberar o próximo chamado.', location: 'Tablet · relatório concluído', stage: 'Concluído · falta arquivar' };
  if (!problem.analyzed) return { title, team: 'Analista', action: 'Abra o tablet com Q, selecione o chamado e analise o relatório.', location: 'Tablet · relatório do chamado', stage: '1. Analisar o chamado' };
  const missing = (problem.requiredTeams ?? []).filter(team => !problem.dispatchedTeams.includes(team));
  if (missing.length) return { title, team: 'Analista', action: `No tablet, acione ${missing.map(team => teamNames[team]).join(' e ')}. Depois siga a seta com a equipe de campo.`, location: 'Tablet · acionar equipes', stage: '2. Acionar a equipe' };
  const step = order && steps[order.nextRiskId];
  return { title, team: step?.team ?? 'Equipe em campo', action: step?.action ?? problem.instruction ?? 'Siga a seta até o chamado.', location: step?.location ?? 'Local do chamado · siga a seta', stage: problem.status === 'MAINTENANCE' ? 'Em atendimento' : `Em campo${order ? ` · etapa ${order.completedSteps + 1}/${order.riskIds.length}` : ''}` };
}

export function playerTeamName(player: PlayerId): string {
  return player === 1 ? 'Infraestrutura' : player === 2 ? 'Mobilidade' : 'Analista';
}

const compactSteps: Record<number, string> = {
  201: 'Use 3 na faixa e aguarde a travessia.',
  601: 'Use E no semáforo para reparar.',
  202: 'Use 1 na faixa para liberar a via.',
  301: 'Use 4 e mantenha as vias abertas por 8 s.',
  401: 'Use E no sensor e conclua a calibração.',
  501: 'Coloque um cone com E e bloqueie o sentido com 2.',
  502: 'Use E junto aos veículos para liberar a faixa.',
  101: 'Use E no poste e repare o circuito.',
  701: 'Use 3 e acompanhe a travessia do entregador.',
  702: 'Use 1 só quando todos estiverem na calçada.',
  801: 'Use E no semáforo e confira o controlador.',
  803: 'Recolha o cone com E e guarde no baú com E.',
  901: 'Use 4 para desviar os elétricos.',
  902: 'Use E no carregador e conclua o reparo.',
  1001: 'No tablet, chame o Guincho Rota Verde.',
  1002: 'Aguarde o guincho liberar a faixa.',
};

export function compactMissionObjective(problem: UrbanProblem, order?: Order): string {
  if (problem.status === 'RESOLVED') return 'Abra o tablet com Q e arquive o relatório.';
  if (!problem.analyzed) return 'Abra o tablet com Q e analise o chamado.';
  const missing = (problem.requiredTeams ?? []).filter(team => !problem.dispatchedTeams.includes(team));
  if (missing.length) return `Acione ${missing.map(team => teamNames[team]).join(' e ')} no tablet.`;
  return (order && compactSteps[order.nextRiskId]) || 'Siga a seta até o chamado.';
}
