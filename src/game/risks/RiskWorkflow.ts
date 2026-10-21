import { inspectRisk, installSensor, cycleLight, copyRoute, moveRouteStop } from '../core/AbilityActions';
import type { AbilityPoint, AbilityLight } from '../core/AbilityActions';
import type { TileCell } from '../map/GridMap';
import type { RiskDefinition } from './riskData';

export type RiskStatus = 'hidden' | 'inspected' | 'released' | 'routing' | 'resolved';
export type CoopRole = 1 | 2 | 3;
export type CoopRisk = RiskDefinition & { status: RiskStatus; point: AbilityPoint };
export type RiskSnapshot = {
  risks: CoopRisk[]; sensors: AbilityPoint[]; light: AbilityLight | null;
  stops: AbilityPoint[]; draft: AbilityPoint[] | null; message: string;
};
export type RoutePlan = { stops: readonly AbilityPoint[]; movedIndex: number; destination: AbilityPoint };

/** Máquina de estados determinística; recebe uma célula já alcançada pela personagem. */
export class RiskWorkflow {
  private readonly state: RiskSnapshot;
  private readonly route: RoutePlan;
  constructor(risks: readonly (RiskDefinition & { point: AbilityPoint })[], route: RoutePlan) {
    this.route = structuredClone(route);
    this.state = {
      risks: risks.map(risk => ({ ...structuredClone(risk), status: 'hidden' })),
      sensors: [], light: null, stops: copyRoute(route.stops), draft: null,
      message: 'Análise: aproxime-se de um ponto e use E para inspecionar; E novamente para marcar.',
    };
  }

  snapshot(): RiskSnapshot { return structuredClone(this.state); }

  /** true indica que a célula era um risco, mesmo se a ação estiver bloqueada. */
  interact(role: CoopRole, cell: TileCell): boolean {
    const risk = this.state.risks.find(item => item.column === cell.column && item.row === cell.row);
    if (!risk) return false;
    if (risk.status === 'resolved') { this.state.message = 'Este risco já foi resolvido pela equipe.'; return true; }
    if (role === 3) {
      if (risk.status === 'hidden') {
        const inspection = inspectRisk({ revealed: false, marked: false });
        if (inspection.revealed) risk.status = 'inspected';
        this.state.message = `${risk.title}: ${risk.detail} Use E novamente para marcar e liberar a tarefa.`;
      } else if (risk.status === 'inspected') {
        const inspection = inspectRisk({ revealed: true, marked: false }, true);
        if (inspection.marked) risk.status = 'released';
        this.state.message = `Tarefa liberada: ${risk.title}. Troque para ${risk.kind === 'route' ? 'Mobilidade' : 'Infraestrutura'}.`;
      } else this.state.message = 'Risco marcado. O especialista responsável deve resolver a tarefa.';
      return true;
    }
    if (risk.status === 'hidden' || risk.status === 'inspected') {
      this.state.message = 'Análise precisa inspecionar e marcar este risco antes da intervenção.';
      return true;
    }
    if (role !== (risk.kind === 'route' ? 2 : 1)) {
      this.state.message = `Esta tarefa pertence a ${risk.kind === 'route' ? 'Mobilidade' : 'Infraestrutura'}.`;
      return true;
    }
    if (risk.kind === 'sensor') {
      const action = installSensor(this.state.sensors, risk.point);
      if (action.result !== 'installed') { this.state.message = 'Não foi possível instalar outro sensor neste ponto.'; return true; }
      this.state.sensors = [...action.sensors];
    } else if (risk.kind === 'light') {
      this.state.light = cycleLight(this.state.light, risk.point);
    } else if (risk.status === 'released') {
      this.state.draft = moveRouteStop(this.state.stops, this.route.movedIndex, this.route.destination);
      if (!this.state.draft) { this.state.message = 'O desvio precisa de pontos separados.'; return true; }
      risk.status = 'routing';
      this.state.message = 'Desvio preparado. Use E novamente neste ponto para confirmar a nova rota.';
      return true;
    } else {
      if (!this.state.draft) return true;
      this.state.stops = copyRoute(this.state.draft);
      this.state.draft = null;
    }
    risk.status = 'resolved';
    this.state.message = this.state.risks.every(item => item.status === 'resolved')
      ? 'Os três riscos de teste foram resolvidos pela equipe!'
      : `${risk.title}: resolvido. A intervenção permanece ao trocar de personagem.`;
    return true;
  }

  /** Como no laboratório, sair da Mobilidade descarta somente o rascunho. */
  selectRole(role: CoopRole): boolean {
    if (role === 2 || !this.state.draft) return false;
    this.state.draft = null;
    this.state.risks.forEach(risk => { if (risk.status === 'routing') risk.status = 'released'; });
    this.state.message = 'Rascunho de rota descartado. A tarefa continua liberada para Mobilidade.';
    return true;
  }
}
