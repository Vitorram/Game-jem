import type { PlayerId } from '../entities/Player';

export type ProblemStatus = 'ACTIVE' | 'MAINTENANCE' | 'RESOLVED';
export type ResponseTeam = 'infraestrutura' | 'mobilidade';
export type UrbanProblem = {
  id: string;
  type: string;
  label: string;
  status: ProblemStatus;
  position: { x: number; z: number };
  dispatchedTeams: ResponseTeam[];
  requiredTeams?: ResponseTeam[];
  stage?: 'warning' | 'active';
  instruction?: string;
  startedAtMs?: number;
  analyzed?: boolean;
};

export type RoadState = {
  id: string;
  direction: 'NORMAL' | 'REVERSE';
  status: 'open' | 'blocked' | 'stopped';
  type: 'PRINCIPAL' | 'SECUNDARIA' | 'GREEN';
  capacity: number;
  priority: number;
  redirected: boolean;
  vehicleCount: number;
  congestion: number;
  conesActive: boolean;
  coneZoneId: string | null;
};

export type GameStateSnapshot = {
  activeCharacter: PlayerId;
  selectedProblemId: UrbanProblem['id'] | null;
  budget: number;
  problems: UrbanProblem[];
  roads: RoadState[];
  phase?: { elapsedMs: number; recovery: boolean; waitingPedestrians: number; queuedVehicles: number };
};

/** Estado central compartilhado pelas entidades da partida. */
export class GameState {
  private state: GameStateSnapshot = {
    activeCharacter: 1,
    selectedProblemId: null,
    budget: 1000,
    problems: [{
      id: 'broken-light-pole-1', type: 'broken-light-pole', label: 'POSTE',
      status: 'ACTIVE', position: { x: -9, z: 4.7 }, dispatchedTeams: [],
    }],
    roads: [
      { id: 'orla-eastbound', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-eastbound-2', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-westbound', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-westbound-2', direction: 'NORMAL', status: 'open', type: 'PRINCIPAL', capacity: 100, priority: 1, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
      { id: 'orla-green', direction: 'NORMAL', status: 'open', type: 'GREEN', capacity: 30, priority: 0, redirected: false, vehicleCount: 0, congestion: 0, conesActive: false, coneZoneId: null },
    ],
  };

  reset(): void { this.state = new GameState().snapshot(); }

  snapshot(): GameStateSnapshot { return structuredClone(this.state); }

  /** Cópia isolada de uma ocorrência, sem clonar as vias e o restante do estado. */
  findProblem(id: UrbanProblem['id']): UrbanProblem | undefined {
    const problem = this.state.problems.find(item => item.id === id);
    return problem ? structuredClone(problem) : undefined;
  }

  /** Cópia isolada da lista de ocorrências para as consultas da simulação. */
  getProblems(): UrbanProblem[] { return structuredClone(this.state.problems); }

  get activeCharacter(): PlayerId { return this.state.activeCharacter; }
  get selectedProblemId(): UrbanProblem['id'] | null { return this.state.selectedProblemId; }

  setActiveCharacter(id: PlayerId): void { this.state.activeCharacter = id; }

  selectProblem(id: UrbanProblem['id'] | null): void {
    if (id !== null && !this.state.problems.some(problem => problem.id === id && problem.status !== 'RESOLVED')) return;
    this.state.selectedProblemId = id;
  }

  analyzeProblem(id: UrbanProblem['id']): boolean {
    const problem = this.state.problems.find(item => item.id === id && item.status !== 'RESOLVED');
    if (!problem) return false;
    problem.analyzed = true;
    this.state.selectedProblemId = id;
    return true;
  }

  setBudget(budget: number): void {
    if (!Number.isFinite(budget) || budget < 0) throw new Error('Orçamento inválido.');
    this.state.budget = budget;
  }

  setProblems(problems: UrbanProblem[]): void {
    this.state.problems = structuredClone(problems);
  }

  setPhase(phase: GameStateSnapshot['phase']): void { this.state.phase = phase; }

  setProblemStatus(id: UrbanProblem['id'], status: ProblemStatus): void {
    const problem = this.state.problems.find(item => item.id === id);
    if (problem) problem.status = status;
  }

  dispatchTeam(id: UrbanProblem['id'], team: ResponseTeam): void {
    const problem = this.state.problems.find(item => item.id === id);
    if (!problem || problem.status === 'RESOLVED' || this.state.selectedProblemId !== id || problem.dispatchedTeams.includes(team)) return;
    problem.dispatchedTeams.push(team);
  }

  setRoads(roads: RoadState[]): void {
    this.state.roads = structuredClone(roads);
  }
}

/** Uma única instância para o jogo; todas as personagens leem e escrevem aqui. */
export const suburbanGameState = new GameState();

